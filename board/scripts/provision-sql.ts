import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import sql, { type ConnectionPool } from "mssql";
import { openDatabase, readSqlConfig } from "../src/lib/server/database";
import { migrateDatabase } from "../src/lib/server/migrations";

export async function provisionSql(pool: ConnectionPool, user: string, password: string): Promise<void> {
  if (user !== "board_app" || password.length < 32 || password.length > 128) throw new Error("Invalid app credential configuration");
  await migrateDatabase(pool);
  const existing = await pool.request().input("user", sql.NVarChar(128), user)
    .query("SELECT 1 FROM sys.database_principals WHERE name=@user");
  if (!existing.recordset.length) {
    // SQL DDL cannot parameterize a password literal; only a fixed identifier and escaped literal are used.
    await pool.request().batch("CREATE USER [board_app] WITH PASSWORD=N'" + password.replaceAll("'", "''") + "'");
  }
  await pool.request().batch(await readFile(resolve("sql/grant-app-user.sql"), "utf8"));
}
async function main(): Promise<void> {
  process.loadEnvFile(".env.local");
  let pool: ConnectionPool | undefined;
  try {
    pool = await openDatabase(readSqlConfig(process.env, "migration"));
    await provisionSql(pool, process.env.SQL_USER ?? "", process.env.SQL_PASSWORD ?? "");
    console.log("Schema migrations and limited application grants applied.");
  } catch { console.error("SQL provisioning failed; credentials and SQL text are suppressed."); process.exitCode = 1; }
  finally { await pool?.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void main().catch(() => { console.error("SQL provisioning configuration unavailable."); process.exitCode = 1; });
}
