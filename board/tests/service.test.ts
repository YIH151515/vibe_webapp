import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import type { PostInput } from "../src/lib/posts/types";
import { openDatabase } from "../src/lib/server/database";
import { BoardError } from "../src/lib/server/errors";
import { hashPassword, verifyPassword } from "../src/lib/server/password";
import { createPostService } from "../src/lib/server/posts";
import {
  parseListQuery, parsePasswordInput, parsePostId, parsePostInput,
} from "../src/lib/server/validation";

const input: PostInput = {
  title: "첫 번째 글", content: "본문 내용", nickname: "작성자", password: " password ",
};

function isError(code: string, status: number) {
  return (error: unknown) =>
    error instanceof BoardError && error.code === code && error.status === status;
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "free-board-service-"));
  const path = join(root, "nested", "posts.sqlite");
  const db = openDatabase(path);
  return {
    path, db, service: createPostService(db),
    close() {
      if (db.isOpen) db.close();
      const target = resolve(root);
      assert.ok(target.startsWith(resolve(tmpdir()) + sep));
      rmSync(target, { recursive: true, force: true });
    },
  };
}

test("CRUD persists across reopen and never exposes passwords", async () => {
  const f = fixture();
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
    const before = f.db.prepare("SELECT password_hash FROM posts WHERE id = ?").get(created.id)!;
    assert.notEqual(before.password_hash, input.password);
    await assert.rejects(
      f.service.update(created.id, { ...input, password: "wrong-pass" }),
      isError("INVALID_PASSWORD", 403),
    );
    await assert.rejects(
      f.service.remove(created.id, { password: "wrong-pass" }),
      isError("INVALID_PASSWORD", 403),
    );
    // Password spaces are significant: trimming it must fail authorization.
    await assert.rejects(
      f.service.remove(created.id, { password: input.password.trim() }),
      isError("INVALID_PASSWORD", 403),
    );
    assert.equal(f.service.get(created.id).title, "제목");
    const updated = await f.service.update(created.id, { ...input, title: "수정", nickname: "다른별명" });
    assert.equal(updated.title, "수정");
    assert.equal(updated.nickname, "다른별명");
    assert.equal(updated.createdAt, created.createdAt);
    assert.equal(
      f.db.prepare("SELECT password_hash FROM posts WHERE id = ?").get(created.id)!.password_hash,
      before.password_hash,
    );
    f.db.close();
    const reopened = openDatabase(f.path);
    try {
      const service = createPostService(reopened);
      assert.equal(service.get(created.id).title, "수정");
      const listed = service.list({ q: "", page: 1 });
      assert.deepEqual(Object.keys(listed.items[0]).sort(), ["createdAt", "id", "nickname", "title"]);
      assert.equal(listed.total, 1);
      await service.remove(created.id, { password: input.password });
      assert.throws(() => service.get(created.id), isError("NOT_FOUND", 404));
      await assert.rejects(service.update(created.id, input), isError("NOT_FOUND", 404));
      await assert.rejects(service.remove(created.id, { password: input.password }), isError("NOT_FOUND", 404));
    } finally { reopened.close(); }
  } finally { f.close(); }
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

test("pagination and literal search use matching count and ordering", async () => {
  const f = fixture();
  try {
    assert.deepEqual(f.service.list({ q: "", page: 99 }), {
      items: [], total: 0, page: 1, pageSize: 20, totalPages: 1, q: "",
    });
    for (let i = 0; i < 23; i++) await f.service.create({ ...input, title: `Alpha ${i}` });
    // Equal timestamps exercise the stable id tie breaker.
    f.db.prepare("UPDATE posts SET created_at = ?").run("2026-11-13T00:00:00.000Z");
    const first = f.service.list({ q: " alpha ", page: 1 });
    const second = f.service.list({ q: "ALPHA", page: 2 });
    assert.equal(first.q, "alpha");
    assert.equal(first.total, 23);
    assert.equal(first.items.length, 20);
    assert.equal(first.totalPages, 2);
    assert.equal(first.items[0].id, 23);
    assert.deepEqual(second.items.map(p => p.id), [3, 2, 1]);
    assert.equal(f.service.list({ q: "Alpha", page: 99 }).page, 2);
    const special = await f.service.create({ ...input, title: "100%_done", content: "path\\file 제목검색" });
    for (const q of ["%", "_", "\\", "제목검색", "100%_done"]) {
      const found = f.service.list({ q, page: 1 });
      assert.equal(found.total, 1);
      assert.equal(found.items[0].id, special.id);
    }
    assert.equal(f.service.list({ q: "' OR 1=1 --", page: 1 }).total, 0);
    const injection = await f.service.create({ ...input, title: "'; DROP TABLE posts; --" });
    assert.equal(f.service.get(injection.id).title, injection.title);
    assert.equal(f.service.list({ q: "", page: 1 }).total, 25);
    assert.throws(() => f.service.list({ q: "", page: 0 }), isError("VALIDATION_ERROR", 400));
    assert.throws(() => f.service.get(0), isError("VALIDATION_ERROR", 400));
    assert.throws(() => f.service.get(99999), isError("NOT_FOUND", 404));
    await assert.rejects(f.service.create({ ...input, title: "" }), isError("VALIDATION_ERROR", 400));
  } finally { f.close(); }
});

test("deletion during asynchronous authorization returns not found", async () => {
  const f = fixture();
  try {
    const first = await f.service.create(input);
    const updating = f.service.update(first.id, { ...input, title: "변경" });
    f.db.prepare("DELETE FROM posts WHERE id = ?").run(first.id);
    await assert.rejects(updating, isError("NOT_FOUND", 404));
    const second = await f.service.create(input);
    const removing = f.service.remove(second.id, { password: input.password });
    f.db.prepare("DELETE FROM posts WHERE id = ?").run(second.id);
    await assert.rejects(removing, isError("NOT_FOUND", 404));
  } finally { f.close(); }
});

test("database schema is versioned, supports memory DB and refuses future versions", () => {
  const f = fixture();
  try {
    assert.equal(f.db.prepare("PRAGMA user_version").get()!.user_version, 1);
    assert.equal(f.db.prepare("PRAGMA busy_timeout").get()!.timeout, 5000);
    assert.equal(f.db.prepare("PRAGMA journal_mode").get()!.journal_mode, "wal");
    assert.ok(f.db.prepare("PRAGMA index_list(posts)").all().some(row => row.name === "posts_created_at_id"));
    f.db.exec("PRAGMA user_version = 2");
    f.db.close();
    assert.throws(() => openDatabase(f.path), /스키마 버전/);
    // The unsupported DB was not rewritten or deleted.
    const existing = new DatabaseSync(f.path);
    try { assert.equal(existing.prepare("PRAGMA user_version").get()!.user_version, 2); }
    finally { existing.close(); }
    const memory = openDatabase(":memory:");
    try { assert.equal(createPostService(memory).list({ q: "", page: 1 }).total, 0); }
    finally { memory.close(); }
  } finally { f.close(); }
});
