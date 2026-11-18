import assert from "node:assert/strict";
import { test } from "node:test";
import sql from "mssql";
import { readAuthConfig, type EntraConfig } from "../src/lib/server/auth-config";
import { beginLogin, finishLogin, safeReturnTo } from "../src/lib/server/auth-flow";
import { BoardError } from "../src/lib/server/errors";
import { emptySqlFixture as sqlFixture } from "./helpers/sql-fixture";
import nextConfig from "../next.config";
const config = () => readAuthConfig() as EntraConfig;
const error = (status: number) => (value: unknown) => value instanceof BoardError && value.status === status;
async function authorize(start: { authorizationUrl: string }, actor = "alice") {
  const response = await fetch(start.authorizationUrl, { headers: { Cookie: "oidc_test_user=" + actor }, redirect: "manual" });
  assert.equal(response.status, 302); return new URL(response.headers.get("location")!);
}

test("callback request logging excludes query secrets and protocol errors never log raw material", async () => {
  const logging = nextConfig.logging;
  assert.ok(logging && typeof logging === "object" && logging.incomingRequests && typeof logging.incomingRequests === "object");
  assert.ok(logging.incomingRequests.ignore?.some(pattern => pattern.test("/api/auth/callback?code=secret-code&state=secret-state")));
  const f = await sqlFixture(), cfg = config();
  try {
    const start = await beginLogin(f.pool, cfg, undefined, "/"), callback = await authorize(start, "bad-signature");
    const log = console.log, err = console.error, output: unknown[][] = [];
    try {
      console.log = (...args) => { output.push(args); }; console.error = (...args) => { output.push(args); };
      await assert.rejects(finishLogin(f.pool, cfg, callback, start.browserCookie), error(401));
    } finally { console.log = log; console.error = err; }
    assert.deepEqual(output, []);
  } finally { await f.close(); }
});

test("safe return paths preserve Korean search while rejecting redirects and auth loops", () => {
  assert.equal(safeReturnTo("/posts/123/edit"), "/posts/123/edit");
  assert.equal(safeReturnTo("/?q=한글 검색%25&page=2"), "/?q=%ED%95%9C%EA%B8%80%20%EA%B2%80%EC%83%89%25&page=2");
  for (const value of [undefined, null, "https://example.invalid", "//example.invalid", "/\\example.invalid", "/%2fexample.invalid", "/%252fexample.invalid",
    "/login", "/a/../login", "/%61pi/auth/login", "/%2561pi/auth/login", "/posts\n", "/%0aexample.invalid", "/%ZZ", "/" + "a".repeat(2048)]) assert.equal(safeReturnTo(value), "/");
});

test("OIDC code grant consumes encrypted browser-bound state and verifies signed Member claims", async () => {
  const f = await sqlFixture(), cfg = config();
  try {
    const start = await beginLogin(f.pool, cfg, undefined, "/posts/new"), callback = await authorize(start, "admin");
    const row = (await f.pool.request().query("SELECT state_hash,browser_hash,secret_cipher FROM dbo.oidc_login_attempts")).recordset[0];
    assert.notEqual(row.state_hash, callback.searchParams.get("state")); assert.notEqual(row.browser_hash, start.browserCookie);
    assert.equal(row.secret_cipher[0], 1); assert.ok(!row.secret_cipher.toString("utf8").includes('"verifier"'));
    await assert.rejects(finishLogin(f.pool, cfg, callback, "f".repeat(64)), error(401));
    assert.equal((await f.pool.request().query("SELECT COUNT(*) n FROM dbo.oidc_login_attempts")).recordset[0].n, 1);
    const result = await finishLogin(f.pool, cfg, callback, start.browserCookie);
    assert.equal(result.principal.isAdmin, true); assert.equal(result.returnTo, "/posts/new");
    await assert.rejects(finishLogin(f.pool, cfg, callback, start.browserCookie), error(401));
    assert.equal((await f.pool.request().query("SELECT COUNT(*) n FROM dbo.auth_sessions")).recordset[0].n, 1);
    assert.equal((await f.pool.request().query("SELECT COUNT(*) n FROM dbo.oidc_login_attempts")).recordset[0].n, 0);
    const a = await beginLogin(f.pool, cfg, start.browserCookie, "/"), b = await beginLogin(f.pool, cfg, start.browserCookie, "/");
    assert.equal(a.browserCookie, b.browserCookie);
    const results = await Promise.all([finishLogin(f.pool, cfg, await authorize(a), a.browserCookie), finishLogin(f.pool, cfg, await authorize(b), b.browserCookie)]);
    assert.notEqual(results[0].cookieValue, results[1].cookieValue);
  } finally { await f.close(); }
});

test("parallel callbacks permit one winner; tampered, expired and cross-client proof cannot log in", async () => {
  const f = await sqlFixture(), cfg = config();
  try {
    const start = await beginLogin(f.pool, cfg, undefined, "/"), callback = await authorize(start);
    const results = await Promise.allSettled([finishLogin(f.pool, cfg, callback, start.browserCookie), finishLogin(f.pool, cfg, callback, start.browserCookie)]);
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
    const bad = await beginLogin(f.pool, cfg, undefined, "/"), badCallback = await authorize(bad);
    await f.pool.request().query("UPDATE dbo.oidc_login_attempts SET secret_cipher=CONVERT(varbinary(32),REPLICATE('x',32))");
    await assert.rejects(finishLogin(f.pool, cfg, badCallback, bad.browserCookie), error(401));
    const expired = await beginLogin(f.pool, cfg, undefined, "/"), expiredCallback = await authorize(expired);
    await f.pool.request().query("DECLARE @now datetime2(3)=SYSUTCDATETIME(); UPDATE dbo.oidc_login_attempts SET created_at=DATEADD(minute,-11,@now),expires_at=DATEADD(minute,-1,@now)");
    await assert.rejects(finishLogin(f.pool, cfg, expiredCallback, expired.browserCookie), error(401));
    const changed = await beginLogin(f.pool, cfg, undefined, "/"), changedCallback = await authorize(changed);
    await assert.rejects(finishLogin(f.pool, { ...cfg, origin: "http://127.0.0.1:3200" }, changedCallback, changed.browserCookie), error(401));
    const duplicated = new URL(changedCallback); duplicated.searchParams.append("state", duplicated.searchParams.get("state")!);
    await assert.rejects(finishLogin(f.pool, cfg, duplicated, changed.browserCookie), error(401));
    const otherClient = { ...cfg, clientId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
    await assert.rejects(finishLogin(f.pool, otherClient, changedCallback, changed.browserCookie), error(401));
    await finishLogin(f.pool, cfg, changedCallback, changed.browserCookie);
    assert.equal((await f.pool.request().query("SELECT COUNT(*) n FROM dbo.auth_sessions")).recordset[0].n, 2);
  } finally { await f.close(); }
});

test("corrupted PKCE and nonce bindings are rejected after flow consumption", async () => {
  const f = await sqlFixture(), cfg = config();
  try {
    const start = await beginLogin(f.pool, cfg, undefined, "/"), target = new URL(start.authorizationUrl);
    target.searchParams.set("code_challenge", "a".repeat(43));
    const callback = await authorize({ authorizationUrl: target.href });
    await assert.rejects(finishLogin(f.pool, cfg, callback, start.browserCookie), error(401));
    await assert.rejects(finishLogin(f.pool, cfg, callback, start.browserCookie), error(401));
    const rotated = await beginLogin(f.pool, cfg, undefined, "/"), rotatedCallback = await authorize(rotated);
    await f.pool.request().input("hash", sql.Char(16), "b".repeat(16)).query("UPDATE dbo.oidc_login_attempts SET crypto_key_id=@hash");
    await assert.rejects(finishLogin(f.pool, cfg, rotatedCallback, rotated.browserCookie), error(401));
  } finally { await f.close(); }
});
