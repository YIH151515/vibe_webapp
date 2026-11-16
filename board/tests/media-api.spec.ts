import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { test, expect } from "./helpers/client-fixture";

const origin = "http://127.0.0.1:3100";
test("session → multipart → atomic post → private/public image cache → authenticated delete", async ({ request }) => {
  const issued = await request.post("/api/upload-sessions", { headers: { Origin: origin }, data: {} });
  expect(issued.status()).toBe(201); const { token } = await issued.json();
  const jpeg = await sharp({ create: { width: 20, height: 10, channels: 3, background: "blue" } }).jpeg().toBuffer();
  const headers = { Origin: origin, Authorization: "Bearer " + token, "Idempotency-Key": randomUUID() };
  const upload = await request.post("/api/images/uploads", { headers, multipart: { file: { name: "not-stored.jpg", mimeType: "image/jpeg", buffer: jpeg } } });
  expect(upload.status()).toBe(201); const asset = await upload.json();
  expect(asset.mimeType).toBe("image/webp"); expect((await request.get(asset.url)).status()).toBe(404);
  expect((await request.post("/api/images/uploads", { headers, multipart: { file: { name: "again.jpg", mimeType: "image/jpeg", buffer: jpeg } } })).status()).toBe(200);
  const posted = await request.post("/api/posts", { headers: { Origin: origin }, data: {
    title: "이미지 API", nickname: "작성자", password: "test-password", uploadSessionToken: token,
    document: { version: 1, type: "doc", content: [{ type: "image", attrs: { assetId: asset.id, alt: "검증" } }] },
  } });
  expect(posted.status()).toBe(201); const post = await posted.json();
  const image = await request.get(asset.url); expect(image.status()).toBe(200); expect(image.headers()["content-type"]).toBe("image/webp");
  await expect((await request.head(asset.url)).body()).resolves.toHaveLength(0);
  expect((await request.get(asset.url, { headers: { "If-None-Match": image.headers().etag } })).status()).toBe(304);
  expect((await request.delete(`/api/posts/${post.id}`, { headers: { Origin: origin }, data: { password: "test-password" } })).status()).toBe(204);
  const missing = await request.get(asset.url, { headers: { "If-None-Match": image.headers().etag } });
  expect(missing.status()).toBe(404); expect(missing.headers()["cache-control"]).toBe("no-store");
});
test("media mutation requires Origin and rejects invalid token/fields without exposing internals", async ({ request }) => {
  expect((await request.post("/api/upload-sessions", { data: {} })).status()).toBe(403);
  expect((await request.post("/api/upload-sessions", { headers: { Origin: "https://external.invalid" }, data: {} })).status()).toBe(403);
  expect((await request.post("/api/upload-sessions", { headers: { Origin: origin }, data: { postId: 1 } })).status()).toBe(400);
  expect((await request.delete("/api/upload-sessions/current", { headers: { Origin: origin, Authorization: "Bearer invalid" } })).status()).toBe(401);
});
