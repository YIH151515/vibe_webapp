import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import sql, { type ConnectionPool } from "mssql";
import { mediaFixture } from "./helpers/media-fixture";
import { FakeBlobStore } from "./helpers/fake-blob-store";
import { runMediaCleanup } from "../src/lib/server/media-cleanup";
import { createPostService } from "../src/lib/server/posts";
import { reserveMediaRequest } from "../src/lib/server/media-rate-limit";
import { cleanupCli, parseCleanupArguments } from "../scripts/media-cleanup";
import { register } from "../src/instrumentation";

const day = 86400000, base = new Date("2030-01-01T00:00:00.000Z");
type Store = FakeBlobStore | Awaited<ReturnType<typeof mediaFixture>>["store"];
async function seed(pool: ConnectionPool, store: Store, state: "ready" | "deleting" | "attached", write = true) {
  const id = randomUUID(), sid = randomUUID(), name = "images/" + id.replaceAll("-", "") + ".webp", bytes = Buffer.from("private-image");
  const post = state === "attached" ? await createPostService(pool).create({ title: "보존할 글", nickname: "작성자", password: "author-password", content: "본문" }) : null;
  await pool.request().input("sid", sql.UniqueIdentifier, sid).input("token", sql.Char(64), randomBytes(32).toString("hex"))
    .input("key", sql.Char(64), randomBytes(32).toString("hex")).input("now", sql.DateTime2(3), base).query(`
      INSERT dbo.upload_sessions(id,token_hash,client_key,created_at,expires_at,file_count)
      VALUES(@sid,@token,@key,@now,DATEADD(minute,15,@now),1);
    `);
  await pool.request().input("id", sql.UniqueIdentifier, id).input("sid", sql.UniqueIdentifier, sid).input("post", sql.BigInt, post?.id ?? null)
    .input("key", sql.UniqueIdentifier, randomUUID()).input("state", sql.VarChar(12), state).input("name", sql.NVarChar(120), name)
    .input("bytes", sql.Int, bytes.length).input("now", sql.DateTime2(3), base).input("write", sql.Bit, write).query(`
      INSERT dbo.image_assets(id,session_id,post_id,idempotency_key,state,blob_name,stored_bytes,input_bytes,charge_bytes,width,height,blob_write_started,created_at,lease_until)
      VALUES(@id,@sid,@post,@key,@state,@name,@bytes,@bytes,@bytes,1,1,@write,@now,DATEADD(minute,2,@now));
      UPDATE dbo.media_capacity SET occupied_bytes=occupied_bytes+@bytes WHERE id=1;
      IF @state='deleting' INSERT dbo.image_delete_jobs(asset_id,available_at,created_at) VALUES(@id,@now,@now);
    `);
  if (write) await store.put(name, bytes);
  return { id, name, sid, bytes: bytes.length, postId: post?.id };
}
async function state(pool: ConnectionPool, id: string) {
  return (await pool.request().input("id", sql.UniqueIdentifier, id).query("SELECT * FROM dbo.image_assets WHERE id=@id")).recordset[0];
}
async function occupied(pool: ConnectionPool) {
  const row = (await pool.request().query(`SELECT (SELECT occupied_bytes FROM dbo.media_capacity) occupied,
    (SELECT COALESCE(SUM(charge_bytes),0) FROM dbo.image_assets) charged`)).recordset[0];
  assert.equal(Number(row.occupied), Number(row.charged)); return Number(row.occupied);
}

test("24h unused draft boundary, attached safety and exact seven-day capacity release", async () => {
  const f = await mediaFixture(); let now = base; const store = new FakeBlobStore(() => now);
  try {
    const draft = await seed(f.pool, store, "ready"), attached = await seed(f.pool, store, "attached");
    now = new Date(base.getTime() + day - 1);
    assert.equal((await runMediaCleanup(f.pool, store, { now })).deleted, 0);
    assert.equal((await state(f.pool, draft.id)).state, "ready");
    now = new Date(base.getTime() + day);
    assert.equal((await runMediaCleanup(f.pool, store, { now })).deleted, 1);
    assert.equal((await state(f.pool, draft.id)).state, "soft_deleted");
    assert.equal(await occupied(f.pool), draft.bytes + attached.bytes);
    assert.equal(store.retainedBytes(), draft.bytes + attached.bytes);
    const deleted = now.getTime();
    now = new Date(deleted + 7 * day - 1);
    assert.equal((await runMediaCleanup(f.pool, store, { now })).releasedBytes, 0);
    now = new Date(deleted + 7 * day);
    assert.equal((await runMediaCleanup(f.pool, store, { now })).releasedBytes, draft.bytes);
    assert.equal((await runMediaCleanup(f.pool, store, { now })).releasedBytes, 0);
    assert.equal(await occupied(f.pool), attached.bytes); assert.equal(store.retainedBytes(), attached.bytes);
    assert.equal(store.calls.filter(call => call.operation === "remove" && call.name === attached.name).length, 0);
    assert.equal((await state(f.pool, attached.id)).state, "attached");
  } finally { await f.close(); }
});

test("Blob failure backoff, SQL finalize failure after deletion and safe idempotent retry", async () => {
  const f = await mediaFixture(); let now = base; const store = new FakeBlobStore(() => now);
  try {
    const asset = await seed(f.pool, store, "deleting"); store.failOnce("remove");
    assert.equal((await runMediaCleanup(f.pool, store, { now })).failed, 1);
    const job = (await f.pool.request().query("SELECT * FROM dbo.image_delete_jobs")).recordset[0];
    assert.equal(job.attempts, 1); assert.equal(job.last_error_code, "BLOB_UNAVAILABLE");
    now = new Date(base.getTime() + 119000); assert.equal((await runMediaCleanup(f.pool, store, { now })).claimed, 0);
    now = new Date(base.getTime() + 120000);
    await f.pool.request().batch(`CREATE TRIGGER dbo.reject_media_finalize ON dbo.image_assets AFTER UPDATE AS
      BEGIN IF EXISTS(SELECT 1 FROM inserted WHERE state='soft_deleted') THROW 50001,'injected',1; END;`);
    const failed = await runMediaCleanup(f.pool, store, { now });
    assert.equal(failed.failed, 1); assert.equal(failed.releasedBytes, 0);
    assert.equal((await state(f.pool, asset.id)).state, "deleting");
    assert.equal((await f.pool.request().query("SELECT last_error_code FROM dbo.image_delete_jobs")).recordset[0].last_error_code, "DB_UNAVAILABLE");
    await f.pool.request().batch("DROP TRIGGER dbo.reject_media_finalize");
    now = new Date(base.getTime() + 360000);
    assert.equal((await runMediaCleanup(f.pool, store, { now })).deleted, 1);
    assert.equal(await occupied(f.pool), asset.bytes);
    assert.equal((await state(f.pool, asset.id)).purge_after.getTime(), now.getTime() + 7 * day);
  } finally { await f.close(); }
});

test("two workers, stale job leases and proven prewrite failure release only once", async () => {
  const f = await mediaFixture(), store = new FakeBlobStore(() => base);
  let release!: () => void;
  try {
    const asset = await seed(f.pool, store, "deleting");
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    store.beforeOperation = async op => { if (op === "remove") { entered(); await gate; } };
    const first = runMediaCleanup(f.pool, store, { now: base }); await started;
    assert.equal((await runMediaCleanup(f.pool, store, { now: base })).claimed, 0);
    release(); assert.equal((await first).deleted, 1); store.beforeOperation = undefined;
    const beforeWrite = await seed(f.pool, store, "deleting", false);
    await f.pool.request().input("id", sql.UniqueIdentifier, beforeWrite.id).input("owner", sql.UniqueIdentifier, randomUUID())
      .input("now", sql.DateTime2(3), base).query("UPDATE dbo.image_delete_jobs SET lease_owner=@owner,lease_until=DATEADD(minute,2,@now) WHERE asset_id=@id");
    assert.equal((await runMediaCleanup(f.pool, store, { now: base })).releasedBytes, 0);
    const done = await runMediaCleanup(f.pool, store, { now: new Date(base.getTime() + 120000) });
    assert.equal(done.releasedBytes, beforeWrite.bytes); assert.equal((await state(f.pool, beforeWrite.id)).state, "purged");
    assert.equal(await occupied(f.pool), asset.bytes);
    assert.equal(store.calls.filter(call => call.operation === "remove").length, 1);
  } finally { release?.(); await f.close(); }
});

test("late object is durably queued before re-delete and restarts its retention", async () => {
  const f = await mediaFixture(); let now = base; const store = new FakeBlobStore(() => now);
  try {
    const asset = await seed(f.pool, store, "deleting");
    await runMediaCleanup(f.pool, store, { now });
    const originalDeadline = (await state(f.pool, asset.id)).purge_after.getTime();
    now = new Date(base.getTime() + day);
    await store.put(asset.name, Buffer.from("late"));
    await runMediaCleanup(f.pool, store, { now });
    assert.equal((await state(f.pool, asset.id)).state, "deleting");
    assert.equal((await f.pool.request().query("SELECT COUNT(*) n FROM dbo.image_delete_jobs")).recordset[0].n, 1);
    await runMediaCleanup(f.pool, store, { now });
    assert.equal((await state(f.pool, asset.id)).purge_after.getTime(), now.getTime() + 7 * day);
    now = new Date(originalDeadline); assert.equal((await runMediaCleanup(f.pool, store, { now })).releasedBytes, 0);
    now = new Date(base.getTime() + 8 * day);
    assert.equal((await runMediaCleanup(f.pool, store, { now })).releasedBytes, asset.bytes);
    assert.equal(await occupied(f.pool), 0); assert.equal(store.retainedBytes(), 0);
  } finally { await f.close(); }
});

test("Azurite deletion is real but retention is tracked in SQL; CLI dry-run changes nothing", async () => {
  const f = await mediaFixture(); const previous = process.env.SQL_DATABASE;
  try {
    const asset = await seed(f.pool, f.store, "deleting");
    const database = (await f.pool.request().query("SELECT DB_NAME() name")).recordset[0].name;
    process.env.SQL_DATABASE = database;
    const snapshot = async () => JSON.stringify((await f.pool.request().query(`SELECT * FROM dbo.media_maintenance;
      SELECT * FROM dbo.image_delete_jobs; SELECT * FROM dbo.media_capacity;`)).recordsets);
    const before = await snapshot(); assert.equal((await cleanupCli([])).claimed, 1); assert.equal(await snapshot(), before);
    assert.ok(await f.store.head(asset.name));
    assert.equal((await runMediaCleanup(f.pool, f.store, { now: base })).deleted, 1);
    assert.equal(await f.store.head(asset.name), null); assert.equal(await occupied(f.pool), asset.bytes);
    assert.throws(() => parseCleanupArguments(["--limit", "0"])); assert.throws(() => parseCleanupArguments(["--unknown"]));
  } finally { process.env.SQL_DATABASE = previous; await f.close(); }
});

test("expired media reservations finish conservatively and own asset filters do not sweep others", async () => {
  const f = await mediaFixture(), store = new FakeBlobStore(() => base);
  try {
    const first = await seed(f.pool, store, "deleting"), second = await seed(f.pool, store, "deleting");
    const client = randomBytes(32).toString("hex"); await reserveMediaRequest(f.pool, "file", client, base);
    await runMediaCleanup(f.pool, store, { now: new Date(base.getTime() + 121000), assetIds: [first.id] });
    assert.equal((await state(f.pool, first.id)).state, "soft_deleted"); assert.equal((await state(f.pool, second.id)).state, "deleting");
    assert.equal((await f.pool.request().query("SELECT attempts_pending FROM dbo.media_buckets")).recordset[0].attempts_pending, 1);
    await runMediaCleanup(f.pool, store, { now: new Date(base.getTime() + 121000) });
    const bucket = (await f.pool.request().query("SELECT * FROM dbo.media_buckets")).recordset[0];
    assert.equal(bucket.attempts_pending, 0); assert.equal(bucket.attempts_used, 1); assert.equal(Number(bucket.bytes_used), 5308416);
  } finally { await f.close(); }
});

test("instrumentation remains inert in build/local/Edge/test and when cleanup is disabled", async () => {
  const before = { ...process.env };
  try {
    for (const patch of [
      { NEXT_RUNTIME: "edge", WEBSITE_INSTANCE_ID: "test", MEDIA_CLEANUP_ENABLED: "1", APP_TEST_MODE: "0" },
      { NEXT_RUNTIME: "nodejs", WEBSITE_INSTANCE_ID: "test", MEDIA_CLEANUP_ENABLED: "0", APP_TEST_MODE: "0" },
      { NEXT_RUNTIME: "nodejs", WEBSITE_INSTANCE_ID: "", MEDIA_CLEANUP_ENABLED: "1", APP_TEST_MODE: "0" },
      { NEXT_RUNTIME: "nodejs", WEBSITE_INSTANCE_ID: "test", MEDIA_CLEANUP_ENABLED: "1", APP_TEST_MODE: "1" },
    ]) { Object.assign(process.env, patch); await register(); }
    assert.equal((globalThis as typeof globalThis & { boardMediaCleanupStop?: unknown }).boardMediaCleanupStop, undefined);
  } finally {
    for (const name of ["NEXT_RUNTIME", "WEBSITE_INSTANCE_ID", "MEDIA_CLEANUP_ENABLED", "APP_TEST_MODE"]) {
      if (before[name] === undefined) delete process.env[name]; else process.env[name] = before[name];
    }
  }
});

test("purged metadata waits thirty days after capacity release and keeps referenced sessions", async () => {
  const f = await mediaFixture(), store = new FakeBlobStore(() => base);
  try {
    const asset = await seed(f.pool, store, "deleting", false), attached = await seed(f.pool, store, "attached");
    await runMediaCleanup(f.pool, store, { now: base });
    await runMediaCleanup(f.pool, store, { now: new Date(base.getTime() + 30 * day - 1) });
    assert.equal((await state(f.pool, asset.id)).state, "purged");
    await runMediaCleanup(f.pool, store, { now: new Date(base.getTime() + 30 * day + 1) });
    assert.equal(await state(f.pool, asset.id), undefined);
    assert.equal((await state(f.pool, attached.id)).state, "attached");
    const session = (await f.pool.request().input("id", sql.UniqueIdentifier, attached.sid).query("SELECT id FROM dbo.upload_sessions WHERE id=@id")).recordset[0];
    assert.ok(session); assert.equal(await occupied(f.pool), attached.bytes);
  } finally { await f.close(); }
});
