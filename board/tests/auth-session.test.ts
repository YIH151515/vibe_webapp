import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import sql from "mssql";
import { ENTRA_TENANT_ID, readAuthConfig, type EntraConfig } from "../src/lib/server/auth-config";
import { type VerifiedIdentity } from "../src/lib/server/auth-principal";
import { assertSessionInTransaction, cleanupAuthState, createAppSession, readAppSession, revokeAppSession } from "../src/lib/server/auth-session";
import { BoardError } from "../src/lib/server/errors";
import { mediaTransaction } from "../src/lib/server/media-transactions";
import { emptySqlFixture as sqlFixture } from "./helpers/sql-fixture";

const updates = { AUTH_MODE: "entra", ENTRA_TENANT_ID, AUTH_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
  TEST_OIDC_ISSUER: "http://127.0.0.1:43123", TEST_OIDC_CLIENT_ID: randomUUID(), TEST_OIDC_CLIENT_SECRET: "synthetic-session-test-secret" };
const previous = Object.fromEntries(Object.keys(updates).map(key => [key, process.env[key]]));
Object.assign(process.env, updates);
after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
const config = readAuthConfig() as EntraConfig;
const error = (status: number) => (value: unknown) => value instanceof BoardError && value.status === status;
const identity = (patch: Partial<VerifiedIdentity> = {}): VerifiedIdentity => ({ tenantId: ENTRA_TENANT_ID, objectId: randomUUID(), displayName: "사용자", isAdmin: false, tokenExpiresAt: new Date(Date.now() + 7200000), ...patch });

test("opaque sessions persist across pools, retain snapshots and expire within token lifetime", async () => {
  const f = await sqlFixture(); const user = identity({ displayName: "가".repeat(256) });
  try {
    const first = await createAppSession(f.pool, user, config), second = await createAppSession(f.pool, { ...user, displayName: "윤" }, config);
    assert.match(first.cookieValue, /^[a-f0-9]{64}$/); assert.notEqual(first.cookieValue, second.cookieValue);
    assert.equal(first.principal.sessionHash, createHash("sha256").update(first.cookieValue).digest("hex"));
    assert.notEqual(first.cookieValue, first.principal.sessionHash);
    const another = await f.reopen();
    try { assert.deepEqual(await readAppSession(another, first.cookieValue, config), first.principal); } finally { await another.close(); }
    const users = (await f.pool.request().query("SELECT display_name FROM dbo.board_users")).recordset;
    assert.deepEqual(users, [{ display_name: "윤" }]);
    assert.equal(first.principal.displayName.length, 256); assert.equal(second.principal.displayName, "윤");
    for (const cookie of [undefined, "", "short", "A".repeat(64), first.cookieValue + "0", first.cookieValue + "\n", randomBytes(32).toString("hex")]) assert.equal(await readAppSession(f.pool, cookie, config), null);
    for (const wrong of [{ ...config, origin: "http://127.0.0.1:3000" }, { ...config, clientId: randomUUID() }, { ...config, tenantId: randomUUID() }])
      assert.equal(await readAppSession(f.pool, first.cookieValue, wrong), null);
    assert.equal(await readAppSession(f.pool, first.cookieValue, config, first.principal.expiresAt), null);
    assert.ok(await readAppSession(f.pool, first.cookieValue, config, new Date(first.principal.expiresAt.getTime() - 1)));
    const rows = (await f.pool.request().query("SELECT created_at,expires_at FROM dbo.auth_sessions")).recordset;
    for (const row of rows) assert.equal(row.expires_at.getTime() - row.created_at.getTime(), 3600000);
    const shortExpiry = new Date(Date.now() + 30000);
    assert.equal((await createAppSession(f.pool, { ...user, tokenExpiresAt: shortExpiry }, config)).principal.expiresAt.getTime(), shortExpiry.getTime());
    await assert.rejects(createAppSession(f.pool, { ...user, tokenExpiresAt: new Date(0) }, config), error(401));
    assert.equal((await f.pool.request().query("SELECT COUNT(*) n FROM dbo.auth_sessions")).recordset[0].n, 3);
  } finally { await f.close(); }
});

test("transaction checks use current database identity and role, including concurrent logout", async () => {
  const f = await sqlFixture();
  try {
    const { principal: p, cookieValue } = await createAppSession(f.pool, identity({ isAdmin: true }), config);
    await mediaTransaction(f.pool, tx => assertSessionInTransaction(tx, p, true));
    await f.pool.request().input("hash", sql.Char(64), p.sessionHash).query("UPDATE dbo.auth_sessions SET is_admin=0 WHERE id_hash=@hash");
    await assert.rejects(mediaTransaction(f.pool, tx => assertSessionInTransaction(tx, p, true)), error(403));
    await assert.rejects(mediaTransaction(f.pool, tx => assertSessionInTransaction(tx, { ...p, objectId: randomUUID() })), error(401));
    const order: string[] = []; let entered!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const mutation = mediaTransaction(f.pool, async tx => {
      await assertSessionInTransaction(tx, p); order.push("checked"); entered();
      await new sql.Request(tx).query("WAITFOR DELAY '00:00:00.100'"); order.push("mutation-commits");
    });
    await Promise.race([ready, mutation]);
    await Promise.all([mutation, revokeAppSession(f.pool, p).then(() => { order.push("logout-commits"); })]);
    assert.deepEqual(order, ["checked", "mutation-commits", "logout-commits"]);
    assert.equal(await readAppSession(f.pool, cookieValue, config), null);
    await assert.rejects(mediaTransaction(f.pool, tx => assertSessionInTransaction(tx, p)), error(401));
    await revokeAppSession(f.pool, p);
  } finally { await f.close(); }
});

test("logout cancels only its own app-session drafts, retaining attached assets and charges", async () => {
  const f = await sqlFixture(); const user = identity();
  try {
    const one = await createAppSession(f.pool, user, config), two = await createAppSession(f.pool, user, config);
    const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID()], assets = Array.from({ length: 5 }, () => randomUUID());
    const post = (await f.pool.request().query("INSERT dbo.posts(title,content,nickname,password_hash) OUTPUT inserted.id VALUES(N'유지',N'본문',N'작성자','legacy-hash')")).recordset[0].id;
    for (const [index, id] of ids.entries()) {
      await f.pool.request().input("id", sql.UniqueIdentifier, id).input("tid", sql.UniqueIdentifier, user.tenantId).input("oid", sql.UniqueIdentifier, user.objectId)
        .input("hash", sql.Char(64), index === 3 ? null : index === 2 ? two.principal.sessionHash : one.principal.sessionHash)
        .input("token", sql.Char(64), randomBytes(32).toString("hex")).input("legacy", sql.Bit, index === 3)
        .input("state", sql.VarChar(12), index === 1 ? "consumed" : "active").query(`INSERT dbo.upload_sessions(id,token_hash,client_key,expires_at,state,owner_tenant_id,owner_object_id,auth_session_hash)
          VALUES(@id,@token,REPLICATE('a',64),DATEADD(minute,15,SYSUTCDATETIME()),@state,CASE WHEN @legacy=1 THEN NULL ELSE @tid END,CASE WHEN @legacy=1 THEN NULL ELSE @oid END,@hash)`);
    }
    for (const [index, asset] of assets.entries()) {
      const attached = index === 2;
      await f.pool.request().input("id", sql.UniqueIdentifier, asset).input("sid", sql.UniqueIdentifier, ids[index < 2 ? 0 : index - 1])
        .input("post", sql.BigInt, attached ? post : null).input("state", sql.VarChar(12), attached ? "attached" : index === 0 ? "uploading" : "ready")
        .input("name", sql.NVarChar(120), "images/" + asset.replaceAll("-", "") + ".webp").query(`INSERT dbo.image_assets(id,session_id,post_id,idempotency_key,state,blob_name,lease_until)
          VALUES(@id,@sid,@post,NEWID(),@state,@name,DATEADD(minute,2,SYSUTCDATETIME()))`);
    }
    await f.pool.request().query("UPDATE dbo.media_capacity SET occupied_bytes=5*5242880 WHERE id=1");
    await revokeAppSession(f.pool, one.principal); await revokeAppSession(f.pool, one.principal);
    assert.equal(await readAppSession(f.pool, one.cookieValue, config), null); assert.ok(await readAppSession(f.pool, two.cookieValue, config));
    const states = (await f.pool.request().query("SELECT id,state FROM dbo.image_assets")).recordset;
    for (const [index, id] of assets.entries()) assert.equal(states.find(row => row.id.toLowerCase() === id).state, index < 2 ? "deleting" : index === 2 ? "attached" : "ready");
    assert.equal((await f.pool.request().query("SELECT COUNT(*) n FROM dbo.image_delete_jobs")).recordset[0].n, 2);
    assert.equal((await f.pool.request().query("SELECT COUNT(*) n FROM dbo.posts")).recordset[0].n, 1);
    assert.equal(Number((await f.pool.request().query("SELECT occupied_bytes FROM dbo.media_capacity")).recordset[0].occupied_bytes), 5 * 5242880);
  } finally { await f.close(); }
});

test("auth cleanup is bounded and preserves upload FK sessions and account records", async () => {
  const f = await sqlFixture(), old = new Date(Date.now() - 40 * 86400000), user = identity();
  try {
    const expired = { ...user, tokenExpiresAt: new Date(old.getTime() + 3600000) };
    await createAppSession(f.pool, expired, config, old);
    const referenced = await createAppSession(f.pool, expired, config, old);
    await createAppSession(f.pool, user, config);
    await f.pool.request().input("hash", sql.Char(64), referenced.principal.sessionHash).input("tid", sql.UniqueIdentifier, user.tenantId).input("oid", sql.UniqueIdentifier, user.objectId)
      .query(`INSERT dbo.upload_sessions(id,token_hash,client_key,expires_at,owner_tenant_id,owner_object_id,auth_session_hash)
        VALUES(NEWID(),REPLICATE('b',64),REPLICATE('c',64),DATEADD(minute,15,SYSUTCDATETIME()),@tid,@oid,@hash);
        DECLARE @i int=0,@clock datetime2(3)=DATEADD(day,-1,SYSUTCDATETIME());
        WHILE @i<150 BEGIN
          INSERT dbo.oidc_login_attempts(state_hash,browser_hash,client_id,app_origin,return_to,secret_cipher,crypto_key_id,created_at,expires_at)
          VALUES(LOWER(CONVERT(varchar(64),HASHBYTES('SHA2_256',CONVERT(binary(4),@i)),2)),REPLICATE('d',64),NEWID(),N'http://127.0.0.1:3100',N'/',CONVERT(varbinary(32),REPLICATE('x',32)),'0123456789abcdef',@clock,DATEADD(minute,5,@clock));
          SET @i=@i+1;
        END;`);
    assert.deepEqual(await cleanupAuthState(f.pool), { flows: 100, sessions: 1 });
    assert.deepEqual(await cleanupAuthState(f.pool), { flows: 50, sessions: 0 });
    assert.equal((await f.pool.request().query("SELECT COUNT(*) n FROM dbo.board_users")).recordset[0].n, 1);
    await f.pool.request().query("DELETE dbo.upload_sessions");
    assert.deepEqual(await cleanupAuthState(f.pool), { flows: 0, sessions: 1 });
    assert.equal((await f.pool.request().query("SELECT COUNT(*) n FROM dbo.auth_sessions")).recordset[0].n, 1);
  } finally { await f.close(); }
});

test("SQL failures are closed and cleanup logs only its static diagnostic", async () => {
  const f = await sqlFixture();
  try {
    const session = await createAppSession(f.pool, identity(), config);
    await f.pool.close();
    await assert.rejects(readAppSession(f.pool, session.cookieValue, config), error(503));
    await assert.rejects(createAppSession(f.pool, identity(), config), error(503));
    const messages: unknown[][] = [], original = console.error;
    try { console.error = (...args) => { messages.push(args); }; assert.deepEqual(await cleanupAuthState(f.pool), { flows: 0, sessions: 0 }); }
    finally { console.error = original; }
    assert.deepEqual(messages, [["AUTH_STATE_CLEANUP_FAILED"]]);
  } finally { await f.close(); }
});
