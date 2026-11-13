import assert from "node:assert/strict";
import { test } from "node:test";
import sql from "mssql";
import type { PostInput } from "../src/lib/posts/types";
import { assertTestDatabase, closeDatabase, getDatabase, readSqlConfig } from "../src/lib/server/database";
import { migrateDatabase } from "../src/lib/server/migrations";
import { BoardError } from "../src/lib/server/errors";
import { hashPassword, verifyPassword } from "../src/lib/server/password";
import { createPostService } from "../src/lib/server/posts";
import { toErrorResponse } from "../src/lib/server/http";
import { parseListQuery, parsePasswordInput, parsePostId, parsePostInput } from "../src/lib/server/validation";
import { sqlFixture } from "./helpers/sql-fixture";

const input: PostInput = {
  title: "첫 번째 글", content: "본문 내용", nickname: "작성자", password: " password ",
};

function isError(code: string, status: number) {
  return (error: unknown) =>
    error instanceof BoardError && error.code === code && error.status === status;
}

test("CRUD persists across SQL reconnections and returns only public fields", async () => {
  const f = await sqlFixture();
  try {
    const created = await f.service.create({
      ...input, title: "  제목  ", content: "  첫 줄\r\n둘째 줄  ", nickname: "  별명  ",
    });
    assert.deepEqual(Object.keys(created).sort(), ["content", "createdAt", "id", "nickname", "title"]);
    assert.equal(created.title, "제목");
    assert.equal(created.content, "첫 줄\n둘째 줄");
    assert.equal(created.nickname, "별명");
    assert.ok(Number.isSafeInteger(created.id));
    assert.equal(new Date(created.createdAt).toISOString(), created.createdAt);
    const before = (await f.pool.request().input("id", sql.BigInt, String(created.id))
      .query<{ password_hash: string }>("SELECT password_hash FROM dbo.posts WHERE id = @id")).recordset[0];
    assert.notEqual(before.password_hash, input.password);
    await assert.rejects(f.service.update(created.id, { ...input, password: "wrong-pass" }), isError("INVALID_PASSWORD", 403));
    await assert.rejects(f.service.remove(created.id, { password: "wrong-pass" }), isError("INVALID_PASSWORD", 403));
    await assert.rejects(f.service.remove(created.id, { password: input.password.trim() }), isError("INVALID_PASSWORD", 403));
    assert.equal((await f.service.get(created.id)).title, "제목");
    const updated = await f.service.update(created.id, { ...input, title: "수정", nickname: "다른별명" });
    assert.equal(updated.title, "수정");
    assert.equal(updated.nickname, "다른별명");
    assert.equal(updated.createdAt, created.createdAt);
    assert.equal((await f.pool.request().input("id", sql.BigInt, String(created.id))
      .query("SELECT password_hash FROM dbo.posts WHERE id = @id")).recordset[0].password_hash, before.password_hash);
    await f.pool.close();
    const reopened = await f.reopen();
    try {
      const service = createPostService(reopened);
      assert.equal((await service.get(created.id)).title, "수정");
      const list = await service.list({ q: "", page: 1 });
      assert.equal(list.total, 1);
      assert.deepEqual(Object.keys(list.items[0]).sort(), ["createdAt", "id", "nickname", "title"]);
      await service.remove(created.id, { password: input.password });
      await assert.rejects(service.get(created.id), isError("NOT_FOUND", 404));
      await assert.rejects(service.update(created.id, input), isError("NOT_FOUND", 404));
      await assert.rejects(service.remove(created.id, { password: input.password }), isError("NOT_FOUND", 404));
    } finally { await reopened.close(); }
  } finally { await f.close(); }
});

test("password hashes use unique salts, fixed parameters and strict parsing", async () => {
  const first = await hashPassword(input.password);
  const second = await hashPassword(input.password);
  assert.notEqual(first, second);
  assert.match(first, /^scrypt\$16384\$8\$1\$[a-f0-9]{32}\$[a-f0-9]{128}$/);
  assert.equal(await verifyPassword(input.password, first), true);
  assert.equal(await verifyPassword("wrong-password", first), false);
  for (const malformed of [
    "", "plaintext", first + "$extra", first.replace("$16384$", "$32768$"),
    first.replace("$8$", "$0$"), first.slice(0, -1), first.toUpperCase(),
    first.replace(/.$/, "z"), first + "\n",
  ]) {
    assert.equal(await verifyPassword(input.password, malformed), false);
  }
});

test("input limits, normalization and unknown field handling", () => {
  const upper = parsePostInput({
    title: "가".repeat(100), content: "가".repeat(10000),
    nickname: "나".repeat(20), password: "x".repeat(64), ignored: "value",
  });
  assert.equal(upper.content.length, 10000);
  assert.equal(Object.hasOwn(upper, "ignored"), false);
  assert.equal(parsePostInput({ ...input, title: "가", content: "나", nickname: "다라", password: "12345678" }).title, "가");
  assert.equal(parsePostInput({ ...input, title: "😀".repeat(50) }).title.length, 100);
  assert.equal(parsePostInput({ ...input, content: ("a\r\n").repeat(3333) }).content.length, 6665);
  assert.equal(parsePasswordInput({ password: " 123456 " }).password, " 123456 ");
  for (const invalid of [
    null, [], new Date(), 1, "text", {},
    { ...input, title: "" }, { ...input, title: " \t " },
    { ...input, title: "x".repeat(101) }, { ...input, content: " " },
    { ...input, content: "x".repeat(10001) }, { ...input, nickname: "x" },
    { ...input, nickname: "x".repeat(21) }, { ...input, title: 123 },
    { ...input, content: null }, { ...input, nickname: true },
    { ...input, password: "1234567" }, { ...input, password: "x".repeat(65) },
    { ...input, password: " ".repeat(8) }, { ...input, password: 12345678 },
  ]) {
    assert.throws(() => parsePostInput(invalid), (error: unknown) =>
      isError("VALIDATION_ERROR", 400)(error) && Object.keys((error as BoardError).fieldErrors ?? {}).length > 0);
  }
});

test("query and id parsing rejects malformed or ambiguous values", () => {
  assert.deepEqual(parseListQuery(new URLSearchParams()), { q: "", page: 1 });
  assert.deepEqual(parseListQuery(new URLSearchParams("q=+hello+&page=2&ignored=ok")), { q: "hello", page: 2 });
  assert.equal(parseListQuery(new URLSearchParams({ q: "x".repeat(100) })).q.length, 100);
  assert.equal(parsePostId(String(Number.MAX_SAFE_INTEGER)), Number.MAX_SAFE_INTEGER);
  for (const raw of ["", "0", "-1", "01", "1.0", "1e2", " 1", "1 ", "1\n", "NaN", "Infinity", "9007199254740992"]) {
    assert.throws(() => parsePostId(raw), isError("VALIDATION_ERROR", 400));
    assert.throws(() => parseListQuery(new URLSearchParams({ page: raw })), isError("VALIDATION_ERROR", 400));
  }
  for (const raw of ["q=a&q=b", "page=1&page=2", "q=" + "x".repeat(101)]) {
    assert.throws(() => parseListQuery(new URLSearchParams(raw)), isError("VALIDATION_ERROR", 400));
  }
});

test("SQL pagination and literal searches preserve ASCII-only case folding", async () => {
  const f = await sqlFixture();
  try {
    assert.deepEqual(await f.service.list({ q: "", page: 99 }), {
      items: [], total: 0, page: 1, pageSize: 20, totalPages: 1, q: "",
    });
    const ids: number[] = [];
    for (let i = 0; i < 23; i++) ids.push((await f.service.create({ ...input, title: `Alpha ${i}` })).id);
    await f.pool.request().input("date", sql.DateTime2(3), new Date("2026-11-13T00:00:00.000Z"))
      .query("UPDATE dbo.posts SET created_at = @date");
    const first = await f.service.list({ q: " alpha ", page: 1 });
    const second = await f.service.list({ q: "ALPHA", page: 2 });
    assert.equal(first.q, "alpha");
    assert.equal(first.total, 23);
    assert.equal(first.items.length, 20);
    assert.equal(first.totalPages, 2);
    assert.equal(first.items[0].id, ids[22]);
    assert.deepEqual(second.items.map(p => p.id), ids.slice(0, 3).reverse());
    assert.equal((await f.service.list({ q: "Alpha", page: 99 })).page, 2);
    const special = await f.service.create({ ...input, title: "100%_[done]", content: "path\\file 제목검색" });
    for (const q of ["%", "_", "[", "\\", "제목검색", "100%_[done]"]) {
      const found = await f.service.list({ q, page: 1 });
      assert.equal(found.total, 1);
      assert.equal(found.items[0].id, special.id);
    }
    const unicode = await f.service.create({ ...input, title: "ÄBC 한국어 😀", content: "특별한 글" });
    assert.equal((await f.service.list({ q: "Äbc", page: 1 })).items[0].id, unicode.id);
    assert.equal((await f.service.list({ q: "äbc", page: 1 })).total, 0);
    assert.equal((await f.service.list({ q: "😀", page: 1 })).total, 1);
    assert.equal((await f.service.list({ q: "' OR 1=1 --", page: 1 })).total, 0);
    const injection = await f.service.create({ ...input, title: "'; DROP TABLE posts; --" });
    assert.equal((await f.service.get(injection.id)).title, injection.title);
    await assert.rejects(f.service.get(Number.MAX_SAFE_INTEGER), isError("NOT_FOUND", 404));
    await assert.rejects(f.service.get(0), isError("VALIDATION_ERROR", 400));
    await assert.rejects(f.service.list({ q: "", page: 0 }), isError("VALIDATION_ERROR", 400));
    await assert.rejects(f.service.create({ ...input, title: "" }), isError("VALIDATION_ERROR", 400));
  } finally { await f.close(); }
});

test("deletion during asynchronous password verification returns not found", async () => {
  const f = await sqlFixture();
  try {
    for (const action of ["update", "remove"] as const) {
      const created = await f.service.create(input);
      // Start the real read/hash verification, and remove its row while scrypt runs.
      const pending = action === "update"
        ? f.service.update(created.id, { ...input, title: "변경" })
        : f.service.remove(created.id, { password: input.password });
      const rejected = assert.rejects(pending, isError("NOT_FOUND", 404));
      await f.pool.request().input("id", sql.BigInt, String(created.id))
        .query("DELETE FROM dbo.posts WHERE id = @id");
      await rejected;
    }
  } finally { await f.close(); }
});

test("migration is concurrent-safe, idempotent and refuses a future schema", async () => {
  const f = await sqlFixture();
  try {
    const another = await f.reopen();
    try {
      await Promise.all([migrateDatabase(f.pool), migrateDatabase(another)]);
    } finally { await another.close(); }
    const versions = (await f.pool.request().query("SELECT version FROM dbo.schema_migrations ORDER BY version")).recordset;
    assert.deepEqual(versions, [{ version: 1 }]);
    const created = await f.service.create({ ...input, title: "보존" });
    await migrateDatabase(f.pool);
    assert.equal((await f.service.get(created.id)).title, "보존");
    assert.equal((await f.pool.request().query("SELECT COUNT(*) AS n FROM sys.indexes WHERE name = 'IX_posts_created_at_id'")).recordset[0].n, 1);
    await assert.rejects(
      f.pool.request().query(`INSERT dbo.posts(title,content,nickname,password_hash)
        VALUES (N'제목', REPLICATE(CAST(N'가' AS NVARCHAR(MAX)), 10001), N'별명', 'hash')`),
    );
    await f.pool.request().query("INSERT dbo.schema_migrations(version) VALUES(999)");
    await assert.rejects(migrateDatabase(f.pool), /스키마 버전/);
    assert.equal((await f.service.get(created.id)).title, "보존");
  } finally { await f.close(); }
});

test("test isolation and production TLS configuration fail closed", async () => {
  assertTestDatabase(process.env);
  const valid = readSqlConfig(process.env);
  assert.equal(valid.options?.encrypt, true);
  assert.equal(valid.options?.trustServerCertificate, true);
  const production = {
    NODE_ENV: "production" as const,
    SQL_SERVER: "example.database.windows.net", SQL_DATABASE: "board",
    SQL_USER: "board_app", SQL_PASSWORD: "test-only-configuration",
  };
  const prodConfig = readSqlConfig(production);
  assert.equal(prodConfig.options?.trustServerCertificate, false);
  assert.equal(prodConfig.options?.useUTC, true);
  assert.equal(prodConfig.pool?.max, 5);
  assert.throws(() => readSqlConfig(production, "migration"), isError("SERVICE_UNAVAILABLE", 503));
  for (const invalid of [
    { ...production, APP_TEST_MODE: "1", SQL_DATABASE: "board_test_" + "a".repeat(32) },
    { ...process.env, SQL_DATABASE: "production" },
    { ...process.env, SQL_PORT: "1433\n" },
    { ...process.env, SQL_PASSWORD: "" },
  ]) {
    assert.throws(() => readSqlConfig(invalid), isError("SERVICE_UNAVAILABLE", 503));
  }
  const unavailable = toErrorResponse({ code: "ETIMEOUT", message: "private connection info" });
  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), {
    error: { code: "SERVICE_UNAVAILABLE", message: "데이터베이스에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요." },
  });
});

test("shared pool connects once and a rejected connection can recover", async () => {
  await closeDatabase();
  try {
    const [one, two] = await Promise.all([getDatabase(), getDatabase()]);
    assert.equal(one, two);
    await closeDatabase();
    const previous = process.env.SQL_PASSWORD;
    try {
      process.env.SQL_PASSWORD = "incorrect-test-password";
      await assert.rejects(getDatabase(), isError("SERVICE_UNAVAILABLE", 503));
    } finally {
      process.env.SQL_PASSWORD = previous;
    }
    const recovered = await getDatabase();
    assert.equal((await recovered.request().query("SELECT 1 AS ok")).recordset[0].ok, 1);
  } finally { await closeDatabase(); }
});
