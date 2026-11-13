import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext, type APIResponse } from "@playwright/test";
import type { Post, PostInput } from "../src/lib/posts/types";
import { toErrorResponse } from "../src/lib/server/http";

const origin = "http://127.0.0.1:3100";

function input(): PostInput {
  return {
    title: `글-${randomUUID()}`, content: "일반 텍스트 본문",
    nickname: "작성자", password: "secret-password",
  };
}

async function create(request: APIRequestContext, data: PostInput): Promise<Post> {
  const response = await request.post("/api/posts", { data });
  expect(response.status()).toBe(201);
  expect(response.headers()["cache-control"]).toBe("no-store");
  const post = await response.json() as Post;
  expect(response.headers().location).toBe(`/posts/${post.id}`);
  expect(Object.keys(post).sort()).toEqual(["content", "createdAt", "id", "nickname", "title"]);
  return post;
}

async function expectError(response: APIResponse, status: number, code: string): Promise<void> {
  expect(response.status()).toBe(status);
  expect(response.headers()["cache-control"]).toBe("no-store");
  expect((await response.json()).error.code).toBe(code);
}

test("CRUD returns public DTOs and enforces passwords without modifying creation time", async ({ request }) => {
  const data = input();
  const post = await create(request, data);
  const path = `/api/posts/${post.id}`;
  const detail = await request.get(path);
  expect(detail.status()).toBe(200);
  expect(detail.headers()["cache-control"]).toBe("no-store");
  expect(await detail.json()).toEqual(post);

  await expectError(await request.patch(path, {
    data: { ...data, title: "거부될 제목", password: "wrong-password" },
  }), 403, "INVALID_PASSWORD");
  await expectError(await request.delete(path, {
    data: { password: "wrong-password" },
  }), 403, "INVALID_PASSWORD");
  expect(await (await request.get(path)).json()).toEqual(post);

  const updated = await request.patch(path, {
    headers: { Origin: origin },
    data: { ...data, title: "수정한 글", content: "수정한 내용", nickname: "수정자" },
  });
  expect(updated.status()).toBe(200);
  expect(updated.headers()["cache-control"]).toBe("no-store");
  expect(await updated.json()).toEqual({
    ...post, title: "수정한 글", content: "수정한 내용", nickname: "수정자",
  });
  const deleted = await request.delete(path, { data: { password: data.password } });
  expect(deleted.status()).toBe(204);
  expect(deleted.headers()["cache-control"]).toBe("no-store");
  expect(await deleted.text()).toBe("");
  await expectError(await request.get(path), 404, "NOT_FOUND");
  await expectError(await request.patch(path, { data }), 404, "NOT_FOUND");
  await expectError(await request.delete(path, { data: { password: data.password } }), 404, "NOT_FOUND");
});

test("write Origin checks run before content validation and block all mutations", async ({ request }) => {
  const data = input();
  const post = await create(request, data);
  const path = `/api/posts/${post.id}`;
  for (const blocked of ["https://other.example", "http://localhost:3100", "http://127.0.0.1:3101", "null", origin + "/", "invalid-origin"]) {
    await expectError(await request.post("/api/posts", { headers: { Origin: blocked }, data }), 403, "FORBIDDEN");
    await expectError(await request.patch(path, { headers: { Origin: blocked }, data }), 403, "FORBIDDEN");
    await expectError(await request.delete(path, { headers: { Origin: blocked }, data: { password: data.password } }), 403, "FORBIDDEN");
  }
  await expectError(await request.post("/api/posts", {
    headers: { "Sec-Fetch-Site": "cross-site", "Content-Type": "text/plain" }, data: "not JSON",
  }), 403, "FORBIDDEN");
  expect(await (await request.get(path)).json()).toEqual(post);
  const list = await (await request.get("/api/posts", { params: { q: data.title } })).json();
  expect(list.total).toBe(1);
});

test("JSON and media type failures have consistent errors", async ({ request }) => {
  const data = input();
  const post = await create(request, data);
  for (const path of ["/api/posts", `/api/posts/${post.id}`]) {
    const method = path === "/api/posts" ? "POST" : "PATCH";
    await expectError(await request.fetch(path, {
      method, headers: { "Content-Type": "text/plain" }, data: "{}",
    }), 415, "UNSUPPORTED_MEDIA_TYPE");
    await expectError(await request.fetch(path, {
      method, headers: { "Content-Type": "application/json" }, data: "{",
    }), 400, "VALIDATION_ERROR");
  }
  await expectError(await request.delete(`/api/posts/${post.id}`, {
    headers: { "Content-Type": "application/json" }, data: "{",
  }), 400, "VALIDATION_ERROR");
  const charset = await request.post("/api/posts", {
    headers: { "Content-Type": "Application/JSON; charset=utf-8", Origin: origin },
    data: JSON.stringify(input()),
  });
  expect(charset.status()).toBe(201);
});

test("server validates input bounds and preserves password whitespace", async ({ request }) => {
  const data = input();
  for (const invalid of [
    null, [], {}, { ...data, title: " " }, { ...data, title: 1 },
    { ...data, title: "x".repeat(101) }, { ...data, content: "x".repeat(10001) },
    { ...data, nickname: "x" }, { ...data, nickname: "x".repeat(21) },
    { ...data, password: "1234567" }, { ...data, password: "x".repeat(65) },
    { ...data, password: " ".repeat(8) },
  ]) {
    const response = await request.post("/api/posts", {
      headers: { "Content-Type": "application/json" }, data: JSON.stringify(invalid),
    });
    await expectError(response, 400, "VALIDATION_ERROR");
    expect((await response.json()).error.fieldErrors).toBeTruthy();
  }
  const upper = await create(request, {
    title: "가".repeat(100), content: "나".repeat(10000),
    nickname: "다".repeat(20), password: "p".repeat(64),
  });
  expect(upper.content.length).toBe(10000);
  const spaced = await create(request, {
    ...data, title: "  제목  ", content: "  첫줄\r\n둘째줄  ", nickname: "  별명  ", password: " 12345678 ",
  });
  expect(spaced.title).toBe("제목");
  expect(spaced.content).toBe("첫줄\n둘째줄");
  expect(spaced.nickname).toBe("별명");
  await expectError(await request.delete(`/api/posts/${spaced.id}`, {
    data: { password: "12345678" },
  }), 403, "INVALID_PASSWORD");
  expect((await request.delete(`/api/posts/${spaced.id}`, {
    data: { password: " 12345678 " },
  })).status()).toBe(204);
});

test("id and query validation rejects malformed and duplicated parameters", async ({ request }) => {
  for (const id of ["0", "-1", "01", "1.5", "1e2", "NaN", "9007199254740992", "1%0A"]) {
    await expectError(await request.get(`/api/posts/${id}`), 400, "VALIDATION_ERROR");
  }
  await expectError(await request.get("/api/posts/9007199254740991"), 404, "NOT_FOUND");
  for (const query of [
    "page=0", "page=01", "page=1.5", "page=9007199254740992",
    "page=1&page=2", "q=a&q=b", "q=" + "x".repeat(101),
  ]) {
    await expectError(await request.get("/api/posts?" + query), 400, "VALIDATION_ERROR");
  }
  expect((await request.put("/api/posts", { data: input() })).status()).toBe(405);
});

test("search pages preserve the query, match literal characters and expose only summaries", async ({ request }) => {
  const token = randomUUID();
  const data = input();
  for (let i = 0; i < 21; i++) await create(request, { ...data, title: `${token}-${i}` });
  const firstResponse = await request.get("/api/posts", { params: { q: token, page: "1" } });
  expect(firstResponse.headers()["cache-control"]).toBe("no-store");
  const first = await firstResponse.json();
  expect(first.total).toBe(21);
  expect(first.page).toBe(1);
  expect(first.pageSize).toBe(20);
  expect(first.totalPages).toBe(2);
  expect(first.q).toBe(token);
  expect(first.items.length).toBe(20);
  expect(Object.keys(first.items[0]).sort()).toEqual(["createdAt", "id", "nickname", "title"]);
  const second = await (await request.get("/api/posts", { params: { q: token, page: "2" } })).json();
  expect(second.items.length).toBe(1);
  expect(second.q).toBe(token);
  expect(first.items.some((post: Post) => post.id === second.items[0].id)).toBe(false);
  const overflow = await (await request.get("/api/posts", { params: { q: token, page: "99" } })).json();
  expect(overflow).toEqual(second);
  const empty = await (await request.get("/api/posts", { params: { q: randomUUID(), page: "99" } })).json();
  expect(empty).toMatchObject({ items: [], total: 0, page: 1, totalPages: 1 });
  const special = await create(request, { ...data, title: token + "%_", content: token + "\\literal" });
  for (const q of [token + "%_", token + "\\literal"]) {
    const found = await (await request.get("/api/posts", { params: { q } })).json();
    expect(found.total).toBe(1);
    expect(found.items[0].id).toBe(special.id);
  }
});

test("unexpected errors are sanitized instead of exposing internal values", async () => {
  const response = toErrorResponse(new Error("SELECT password_hash FROM posts: secret-password"));
  expect(response.status).toBe(500);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({
    error: { code: "INTERNAL_ERROR", message: "처리 중 오류가 발생했습니다." },
  });
});
