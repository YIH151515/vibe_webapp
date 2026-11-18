import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sql, { type ConnectionPool } from "mssql";
import { openDatabase, readSqlConfig } from "../src/lib/server/database";
import { EXPECTED_SCHEMA_VERSION } from "../src/lib/server/schema-version";

export async function verifySqlAccess(app: ConnectionPool, admin: ConnectionPool): Promise<void> {
  const marker = "qa-" + randomUUID();
  const object = "qa_" + randomUUID().replaceAll("-", "");
  let id: string | undefined;
  try {
    const row = await app.request().input("marker", sql.NVarChar(100), marker)
      .query<{id:string}>("INSERT dbo.posts(title,content,nickname,password_hash) OUTPUT CONVERT(varchar(20),INSERTED.id) AS id VALUES(@marker,N'permission check',N'QA',REPLICATE('x',178))");
    id = row.recordset[0].id;
    const crud = await app.request().input("id", sql.BigInt, id).query<{content:string}>("UPDATE dbo.posts SET content=N'updated' WHERE id=@id; SELECT content FROM dbo.posts WHERE id=@id; DELETE dbo.posts WHERE id=@id");
    assert.equal(crud.recordset[0].content, "updated");
    const permission = await app.request().query<{ddl:number}>("SELECT HAS_PERMS_BY_NAME(DB_NAME(),'DATABASE','CREATE TABLE') AS ddl; SELECT version FROM dbo.schema_migrations");
    assert.equal(permission.recordset[0].ddl, 0);
    await assert.rejects(app.request().batch(`CREATE TABLE dbo.[${object}](id int)`), (error: unknown) => error instanceof sql.RequestError && error.number === 262);
    const broad = await app.request().query<{owner:number;alter:number}>("SELECT IS_ROLEMEMBER('db_owner') AS [owner], HAS_PERMS_BY_NAME(DB_NAME(),'DATABASE','ALTER') AS [alter]");
    assert.equal(broad.recordset[0].owner, 0); assert.equal(broad.recordset[0].alter, 0);
    const schema = await app.request().query<{version:number}>("SELECT MAX(version) AS version FROM dbo.schema_migrations");
    assert.equal(schema.recordset[0].version, EXPECTED_SCHEMA_VERSION);
    for (const table of ["posts", "rate_buckets", "admin_sessions", "upload_sessions", "image_assets", "media_capacity", "media_buckets", "media_reservations", "image_delete_jobs", "media_maintenance", "board_users", "auth_sessions", "oidc_login_attempts"]) {
      const permission = await app.request().input("table", sql.NVarChar(128), "dbo." + table)
        .query<{s:number;i:number;u:number;d:number}>(`SELECT
          HAS_PERMS_BY_NAME(@table,'OBJECT','SELECT') AS s,
          HAS_PERMS_BY_NAME(@table,'OBJECT','INSERT') AS i,
          HAS_PERMS_BY_NAME(@table,'OBJECT','UPDATE') AS u,
          HAS_PERMS_BY_NAME(@table,'OBJECT','DELETE') AS d`);
      assert.deepEqual(permission.recordset[0], { s: 1, i: 1, u: 1, d: 1 });
    }
    console.log("Encrypted app connection: CRUD allowed, DDL and db_owner denied.");
  } finally {
    if (id) await admin.request().input("id", sql.BigInt, id).input("marker", sql.NVarChar(100), marker).query("DELETE dbo.posts WHERE id=@id AND title=@marker");
    await admin.request().batch(`IF OBJECT_ID(N'dbo.${object}',N'U') IS NOT NULL DROP TABLE dbo.[${object}]`);
  }
}
async function main(): Promise<void> {
process.loadEnvFile(".env.local");
let app: ConnectionPool | undefined, admin: ConnectionPool | undefined;
try {
  const config = readSqlConfig(process.env);
  assert.equal(config.options?.encrypt, true); assert.equal(config.options?.trustServerCertificate, false);
  app = await openDatabase(config); admin = await openDatabase(readSqlConfig(process.env, "migration"));
  await verifySqlAccess(app, admin);
  if (process.argv.includes("--expect-empty")) {
    const count = await app.request().query<{total:number}>("SELECT COUNT(*) AS total FROM dbo.posts");
    assert.equal(count.recordset[0].total, 0);
    console.log("Fresh production database has zero posts and the expected schema version.");
  }
} catch (error) {
  const diagnostic = error as {code?:unknown;number?:unknown;name?:unknown};
  console.error("SQL permission verification failed:",
    typeof diagnostic.code === "string" && /^[A-Z_]+$/.test(diagnostic.code) ? diagnostic.code : "CHECK_FAILED",
    typeof diagnostic.number === "number" ? diagnostic.number : "");
  process.exitCode = 1;
}
finally { await app?.close(); await admin?.close(); }
}
void main().catch(() => { console.error("SQL verification configuration unavailable."); process.exitCode = 1; });
