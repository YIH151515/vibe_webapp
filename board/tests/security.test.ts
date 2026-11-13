import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import sql from "mssql";
import { BoardError, RateLimitError } from "../src/lib/server/errors";
import { getClientKey, normalizeClientIp, readAppOrigin, readRequestConfig } from "../src/lib/server/request-context";
import { ensureSameOrigin, readJson, toErrorResponse } from "../src/lib/server/http";
import { finish, reserve, withRateLimit } from "../src/lib/server/rate-limit";
import { sqlFixture } from "./helpers/sql-fixture";

const key = () => randomBytes(32).toString("hex");
const errorIs = (code: string, status: number) => (error: unknown) =>
  error instanceof BoardError && error.code === code && error.status === status;

function env<T>(changes: Record<string, string | undefined>, work: () => T): T {
  const previous = Object.fromEntries(Object.keys(changes).map(name => [name, process.env[name]]));
  try {
    for (const [name, value] of Object.entries(changes)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    return work();
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
}

test("canonical origin works behind HTTPS termination and rejects ambiguous origins", () => {
  env({ APP_ORIGIN: "https://board.example" }, () => {
    const request = (origin?: string, host = "board.example") => new Request("http://internal:8080/api/posts", {
      headers: { host, ...(origin === undefined ? {} : { origin }) },
    });
    assert.doesNotThrow(() => ensureSameOrigin(request("https://board.example")));
    assert.doesNotThrow(() => ensureSameOrigin(request()));
    assert.throws(() => ensureSameOrigin(request(), { requireOrigin: true }), errorIs("FORBIDDEN", 403));
    for (const origin of ["null", "https://other.example", "https://board.example/", "https://board.example:444", "invalid"]) {
      assert.throws(() => ensureSameOrigin(request(origin)), errorIs("FORBIDDEN", 403));
    }
    assert.throws(() => ensureSameOrigin(request("https://board.example", "other.example")), errorIs("FORBIDDEN", 403));
    assert.throws(() => ensureSameOrigin(new Request("http://internal", {
      headers: { "sec-fetch-site": "cross-site" },
    })), errorIs("FORBIDDEN", 403));
  });
  for (const origin of [undefined, "https://board.example/", "https://board.example/path", "https://user@board.example", " https://board.example", "file:///tmp"]) {
    assert.throws(() => readAppOrigin({ ...process.env, APP_ORIGIN: origin }), errorIs("SERVICE_UNAVAILABLE", 503));
  }
});

test("IP normalization unifies ports, IPv6 spelling and IPv4-mapped addresses", () => {
  for (const ip of ["192.0.2.1", "192.0.2.1:1234", "::ffff:192.0.2.1", "[::ffff:c000:201]:443"]) {
    assert.equal(normalizeClientIp(ip), "192.0.2.1");
  }
  assert.equal(normalizeClientIp("[2001:0db8:0:0:0:0:0:1]:123"), "2001:db8::1");
  assert.equal(normalizeClientIp("2001:DB8::1"), "2001:db8::1");
  for (const invalid of ["", " 192.0.2.1", "192.0.2.1,192.0.2.2", "192.0.2.1:0", "192.0.2.1:65536", "1.2.3", "fe80::1%eth0", "[not-ip]:123", "example.com"]) {
    assert.throws(() => normalizeClientIp(invalid), errorIs("SERVICE_UNAVAILABLE", 503));
  }
});

test("only the configured topology determines client identity and secrets never enter the key", () => {
  const secret = key();
  env({ APP_ORIGIN: "http://127.0.0.1:3000", REQUEST_IP_MODE: "local", LOCAL_CLIENT_IP: "192.0.2.4", RATE_LIMIT_KEY_SECRET: secret }, () => {
    const first = getClientKey(new Request("http://localhost", { headers: { "client-ip": "1.2.3.4", "x-forwarded-for": "5.6.7.8" } }));
    const second = getClientKey(new Request("http://localhost", { headers: { "client-ip": "5.6.7.8" } }));
    assert.equal(first, second);
    assert.match(first, /^[a-f0-9]{64}$/);
    assert.notEqual(first, secret);
    assert.notEqual(first, "192.0.2.4");
  });
  env({ APP_ORIGIN: "https://board.example", REQUEST_IP_MODE: "app-service", WEBSITE_INSTANCE_ID: "test-instance", APP_TEST_MODE: undefined, RATE_LIMIT_KEY_SECRET: secret }, () => {
    const request = (ip?: string, forwarded = "8.8.8.8") => new Request("http://internal", {
      headers: { ...(ip ? { "client-ip": ip } : {}), "x-forwarded-for": forwarded, "x-client-ip": forwarded },
    });
    assert.equal(getClientKey(request("192.0.2.4:123")), getClientKey(request("::ffff:192.0.2.4", "9.9.9.9")));
    assert.throws(() => getClientKey(request()), errorIs("SERVICE_UNAVAILABLE", 503));
    env({ WEBSITE_INSTANCE_ID: undefined }, () => assert.throws(() => getClientKey(request("192.0.2.4")), errorIs("SERVICE_UNAVAILABLE", 503)));
    env({ APP_ORIGIN: "http://board.example" }, () => assert.throws(() => getClientKey(request("192.0.2.4")), errorIs("SERVICE_UNAVAILABLE", 503)));
  });
  assert.throws(() => readRequestConfig({ ...process.env, REQUEST_IP_MODE: "test", SQL_SERVER: "production.database.windows.net" }), errorIs("SERVICE_UNAVAILABLE", 503));
  assert.throws(() => readRequestConfig({ ...process.env, RATE_LIMIT_KEY_SECRET: "" }), errorIs("SERVICE_UNAVAILABLE", 503));
});

test("JSON body limit checks both the declared size and streamed bytes", async () => {
  const make = (body: string, extra: Record<string, string> = {}) => new Request("http://localhost", {
    method: "POST", headers: { "content-type": "application/json", ...extra }, body,
  });
  assert.deepEqual(await readJson(make('{"ok":true}')), { ok: true });
  await assert.rejects(readJson(make("{}", { "content-length": "65537" })), errorIs("PAYLOAD_TOO_LARGE", 413));
  await assert.rejects(readJson(make("{")), errorIs("VALIDATION_ERROR", 400));
  await assert.rejects(readJson(make("{}", { "content-type": "text/plain" })), errorIs("UNSUPPORTED_MEDIA_TYPE", 415));
  let canceled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(32768));
      controller.enqueue(new Uint8Array(32768));
      controller.enqueue(new Uint8Array(1));
    },
    cancel() { canceled = true; },
  });
  const streamed = new Request("http://localhost", {
    method: "POST", headers: { "content-type": "application/json" }, body, duplex: "half",
  } as RequestInit & { duplex: "half" });
  await assert.rejects(readJson(streamed), errorIs("PAYLOAD_TOO_LARGE", 413));
  assert.equal(canceled, true);
});

test("parallel reservations allow only five and survive different SQL pools", async () => {
  const f = await sqlFixture();
  const ip = key();
  const now = new Date("2040-01-01T00:00:00Z");
  try {
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => reserve(f.pool, "post-create", ip, now)));
    const successes = results.filter(result => result.status === "fulfilled");
    assert.equal(successes.length, 5);
    assert.equal(results.filter(result => result.status === "rejected" && result.reason instanceof RateLimitError).length, 15);
    for (const result of successes) if (result.status === "fulfilled") await finish(f.pool, result.value, true);
    const other = await f.reopen();
    try {
      await assert.rejects(reserve(other, "post-create", ip, now), errorIs("RATE_LIMITED", 429));
    } finally { await other.close(); }
    await f.pool.close();
    const reopened = await f.reopen();
    try {
      await assert.rejects(reserve(reopened, "post-create", ip, now), errorIs("RATE_LIMITED", 429));
      const row = (await reopened.request().input("key", sql.Char(64), ip)
        .query("SELECT used_count, pending_count FROM dbo.rate_buckets WHERE client_key = @key")).recordset[0];
      assert.deepEqual(row, { used_count: 5, pending_count: 0 });
    } finally { await reopened.close(); }
  } finally { await f.close(); }
});

test("old generation completion and double finish do not corrupt a new window", async () => {
  const f = await sqlFixture();
  const ip = key();
  const now = new Date("2040-01-01T00:00:00Z");
  try {
    const old = await reserve(f.pool, "post-create", ip, now);
    const next = await reserve(f.pool, "post-create", ip, new Date(now.getTime() + 600000));
    assert.notEqual(old.generation.toLowerCase(), next.generation.toLowerCase());
    await finish(f.pool, old, true);
    let row = (await f.pool.request().input("key", sql.Char(64), ip)
      .query("SELECT used_count, pending_count FROM dbo.rate_buckets WHERE client_key = @key")).recordset[0];
    assert.deepEqual(row, { used_count: 0, pending_count: 1 });
    await finish(f.pool, next, false);
    await finish(f.pool, next, true);
    row = (await f.pool.request().input("key", sql.Char(64), ip)
      .query("SELECT used_count, pending_count FROM dbo.rate_buckets WHERE client_key = @key")).recordset[0];
    assert.deepEqual(row, { used_count: 0, pending_count: 0 });
  } finally { await f.close(); }
});

test("successful passwords and failed writes release reservations, only confirmed failures count", async () => {
  const f = await sqlFixture();
  const ip = key();
  try {
    await assert.rejects(withRateLimit(f.pool, "post-create", ip, async () => { throw new Error("work failed"); }));
    for (let i = 0; i < 12; i++) assert.equal(await withRateLimit(f.pool, "post-password", ip, async () => "ok"), "ok");
    for (let i = 0; i < 10; i++) {
      await assert.rejects(withRateLimit(f.pool, "post-password", ip, async () => {
        throw new BoardError("INVALID_PASSWORD", 403, "비밀번호가 일치하지 않습니다.");
      }), errorIs("INVALID_PASSWORD", 403));
    }
    let called = false;
    await assert.rejects(withRateLimit(f.pool, "post-password", ip, async () => { called = true; }), errorIs("RATE_LIMITED", 429));
    assert.equal(called, false);
    for (let i = 0; i < 5; i++) {
      await assert.rejects(withRateLimit(f.pool, "admin-login", ip, async () => {
        throw new BoardError("UNAUTHENTICATED", 401, "로그인 실패");
      }), errorIs("UNAUTHENTICATED", 401));
    }
    await assert.rejects(reserve(f.pool, "admin-login", ip), (error: unknown) =>
      error instanceof RateLimitError && error.retryAfterSeconds > 0 && error.retryAfterSeconds <= 900);
    const rows = (await f.pool.request().input("key", sql.Char(64), ip)
      .query("SELECT action, used_count, pending_count FROM dbo.rate_buckets WHERE client_key = @key ORDER BY action")).recordset;
    assert.deepEqual(rows.map(row => row.pending_count), [0, 0, 0]);
    assert.equal(rows.find(row => row.action === "post-create")!.used_count, 0);
  } finally { await f.close(); }
});

test("limiter SQL failure is closed and stale cleanup does not undo successful work", async () => {
  const f = await sqlFixture();
  try {
    const staleKey = key();
    await f.pool.request().input("key", sql.Char(64), staleKey).query(`
      INSERT dbo.rate_buckets(action, client_key, generation, used_count, pending_count, window_started_at, expires_at)
      VALUES ('post-create', @key, NEWID(), 0, 0, DATEADD(day,-3,SYSUTCDATETIME()), DATEADD(day,-2,SYSUTCDATETIME()))
    `);
    assert.equal(await withRateLimit(f.pool, "post-create", key(), async () => "done"), "done");
    assert.equal((await f.pool.request().input("key", sql.Char(64), staleKey)
      .query("SELECT COUNT(*) AS n FROM dbo.rate_buckets WHERE client_key=@key")).recordset[0].n, 0);
    await f.pool.close();
    await assert.rejects(reserve(f.pool, "post-create", key()), errorIs("SERVICE_UNAVAILABLE", 503));
  } finally { await f.close(); }
});

test("rate errors carry a bounded retry instruction and no private identifier", async () => {
  const response = toErrorResponse(new RateLimitError(59.2));
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "60");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    error: { code: "RATE_LIMITED", message: "요청이 많습니다. 60초 후 다시 시도해 주세요." },
  });
});
