import assert from "node:assert/strict";
import { resolve } from "node:path";
import type { ConnectionPool } from "mssql";
import { openDatabase, readSqlConfig } from "../src/lib/server/database";
import { migrateDatabase } from "../src/lib/server/migrations";
import { provisionSql } from "./provision-sql";
import { verifySqlAccess } from "./verify-sql-access";

/** Snapshots remain in memory. Never serialize user content, hashes or row values. */
export async function cutoverSchema(pool: ConnectionPool, grantAndVerify: () => Promise<void>) {
  const version = Number((await pool.request().query("SELECT MAX(version) version FROM dbo.schema_migrations")).recordset[0].version);
  assert.ok([4, 5].includes(version), "expected-existing-schema");
  const columns = "id,title,nickname,content,content_json,content_format,password_hash,created_at";
  const before = (await pool.request().query("SELECT " + columns + (version === 5 ? ",author_tenant_id,author_object_id" : "") + " FROM dbo.posts ORDER BY id")).recordset;
  const attachments = (await pool.request().query("SELECT id,post_id,blob_name,stored_bytes FROM dbo.image_assets WHERE state='attached' ORDER BY id")).recordset;
  await migrateDatabase(pool); await migrateDatabase(pool);
  await grantAndVerify();
  const after = (await pool.request().query("SELECT " + columns + ",author_tenant_id,author_object_id FROM dbo.posts ORDER BY id")).recordset;
  if (version === 4) {
    assert.ok(after.every(row => row.author_tenant_id === null && row.author_object_id === null), "legacy-ownership-unchanged");
    assert.deepEqual(after.map(row => Object.fromEntries(Object.entries(row).filter(([key]) => !["author_tenant_id", "author_object_id"].includes(key)))), before, "original-posts-preserved");
  } else assert.deepEqual(after, before, "existing-ownership-preserved");
  assert.deepEqual((await pool.request().query("SELECT id,post_id,blob_name,stored_bytes FROM dbo.image_assets WHERE state='attached' ORDER BY id")).recordset, attachments, "original-attachments-preserved");
  const capacity = (await pool.request().query("SELECT (SELECT occupied_bytes FROM dbo.media_capacity WHERE id=1) occupied,COALESCE(SUM(charge_bytes),0) charged FROM dbo.image_assets")).recordset[0];
  assert.equal(Number(capacity.occupied), Number(capacity.charged), "media-accounting-consistent");
  return { schemaVersion: 5, preservedPosts: before.length, preservedAttachments: attachments.length };
}
async function main() {
  assert.ok(process.env.APP_TEST_MODE !== "1");
  process.loadEnvFile(".env.local");
  assert.equal(process.env.SQL_SERVER, "sql-vibe-board-7b1417.database.windows.net"); assert.equal(process.env.SQL_DATABASE, "dbboardprod");
  const closed = await fetch("https://app-vibe-board-prod-7b1417.azurewebsites.net/api/posts", { redirect: "manual", signal: AbortSignal.timeout(20000) });
  assert.equal(closed.status, 503, "content-must-be-closed-before-schema-change");
  assert.equal((await fetch("https://app-vibe-board-prod-7b1417.azurewebsites.net", { redirect: "manual", signal: AbortSignal.timeout(20000) })).status, 503);
  assert.equal((await fetch("https://app-vibe-board-prod-7b1417.azurewebsites.net/login", { redirect: "manual", signal: AbortSignal.timeout(20000) })).status, 200);
  const operator = await openDatabase(readSqlConfig(process.env, "migration"));
  let app: ConnectionPool | undefined;
  try {
    app = await openDatabase(readSqlConfig(process.env));
    const result = await cutoverSchema(operator, async () => {
      await provisionSql(operator, process.env.SQL_USER ?? "", process.env.SQL_PASSWORD ?? "");
      await verifySqlAccess(app!, operator);
    });
    console.log("ENTRA_SQL_CUTOVER_VERIFIED", JSON.stringify(result));
  } finally { await app?.close(); await operator.close(); }
}
if (process.argv[1] && resolve(process.argv[1]) === resolve("scripts/cutover-entra-sql.ts")) {
  void main().catch(() => { console.error("ENTRA_SQL_CUTOVER_FAILED_DETAILS_SUPPRESSED"); process.exitCode = 1; });
}
