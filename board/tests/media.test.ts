import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import sharp from "sharp";
import sql from "mssql";
import { createTestActor, createTestSession } from "./helpers/auth-fixture";
import { mediaFixture } from "./helpers/media-fixture";
import { FakeBlobStore } from "./helpers/fake-blob-store";
import { createMediaService } from "../src/lib/server/media-service";
import { cancelUploadSession, issueUploadSession, readUploadSession } from "../src/lib/server/upload-sessions";
import { createPostService } from "../src/lib/server/posts";
import { getPublishedImage } from "../src/lib/server/published-images";
import { finishMediaRequest, reserveMediaRequest } from "../src/lib/server/media-rate-limit";
import { deletePostAsAdmin } from "../src/lib/server/admin";
import { BoardError } from "../src/lib/server/errors";
import type { RichDocument } from "../src/lib/posts/document";

const key = () => randomBytes(32).toString("hex");
const is = (status: number) => (error: unknown) => error instanceof BoardError && error.status === status;
const postInput = { title: "이미지 검증", content: "기존 본문" };
const document = (...ids: string[]): RichDocument => ({ version: 1, type: "doc", content: ids.map(assetId => ({ type: "image", attrs: { assetId, alt: "첨부" } })) });
async function jpeg() { return sharp({ create: { width: 50, height: 25, channels: 3, background: "red" } }).jpeg().toBuffer(); }
function upload(token: string, bytes: Buffer, id = randomUUID()) {
  const form = new FormData(); form.set("file", new Blob([Uint8Array.from(bytes)], { type: "image/jpeg" }), "discard-me.jpg");
  return new Request("http://localhost/api/images/uploads", { method: "POST", body: form,
    headers: { authorization: "Bearer " + token, "idempotency-key": id } });
}
const request = () => new Request("http://localhost/image");
async function invariant(pool: sql.ConnectionPool) {
  const row = (await pool.request().query(`SELECT (SELECT occupied_bytes FROM dbo.media_capacity WHERE id=1) occupied,
    (SELECT COALESCE(SUM(charge_bytes),0) FROM dbo.image_assets) charged`)).recordset[0];
  assert.equal(Number(row.occupied), Number(row.charged));
}

test("private upload, idempotency, atomic ownership, ETag, detach, author/admin outbox", async () => {
  const f = await mediaFixture(); const service = createPostService(f.pool);
  try {
    const session = await issueUploadSession(f.pool, f.principal, {}), bytes = await jpeg(), idempotency = randomUUID();
    const media = createMediaService(f.pool, f.store);
    const { asset } = await media.uploadImage(upload(session.token, bytes, idempotency), f.principal);
    assert.equal(asset.mimeType, "image/webp"); assert.equal(asset.width, 50);
    await assert.rejects(getPublishedImage(f.pool, f.store, asset.id, request(), f.principal), is(404));
    assert.equal((await media.uploadImage(upload(session.token, bytes, idempotency), f.principal)).status, 200);
    await assert.rejects(media.uploadImage(upload(session.token, Buffer.concat([bytes, Buffer.from("different")]), idempotency), f.principal), is(409));
    await assert.rejects(media.uploadImage(upload(session.token, bytes), (await createTestSession(f.pool, createTestActor())).principal), is(401));
    const post = await service.create({ ...postInput, document: document(asset.id), uploadSessionToken: session.token }, f.context);
    assert.equal(post.content, ""); await invariant(f.pool);
    await assert.rejects(readUploadSession(f.pool, session.token, f.principal), is(409));
    const response = await getPublishedImage(f.pool, f.store, asset.id, request(), f.principal);
    assert.equal(response.status, 200); const etag = response.headers.get("etag")!;
    assert.equal((await sharp(Buffer.from(await response.arrayBuffer())).metadata()).format, "webp");
    assert.equal((await getPublishedImage(f.pool, f.store, asset.id, request(), f.principal, true)).body, null);
    const conditional = new Request("http://localhost", { headers: { "If-None-Match": etag } });
    assert.equal((await getPublishedImage(f.pool, f.store, asset.id, conditional, f.principal)).status, 304);
    const other = await service.create(postInput, f.context);
    await assert.rejects(service.update(other.id, { ...postInput, document: document(asset.id) }, f.context), is(409));
    assert.equal((await service.get(other.id, f.principal)).content, postInput.content);
    await service.update(post.id, { ...postInput, document: document(asset.id) }, f.context);
    await service.update(post.id, { ...postInput, document: { version: 1, type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "이미지 제거" }] }] } }, f.context);
    await assert.rejects(getPublishedImage(f.pool, f.store, asset.id, conditional, f.principal), is(404));
    assert.equal((await f.pool.request().query("SELECT COUNT(*) n FROM dbo.image_delete_jobs")).recordset[0].n, 1);
    const editing = await issueUploadSession(f.pool, f.principal, { postId: other.id });
    const editedAsset = (await media.uploadImage(upload(editing.token, bytes), f.principal)).asset;
    await service.update(other.id, { ...postInput, document: document(editedAsset.id), uploadSessionToken: editing.token }, f.context);
    await deletePostAsAdmin(f.pool, other.id, (await createTestSession(f.pool, createTestActor({ isAdmin: true }))).principal);
    await assert.rejects(getPublishedImage(f.pool, f.store, editedAsset.id, request(), f.principal), is(404));
    await service.remove(post.id, { confirm: true }, f.principal); await invariant(f.pool);
    assert.equal((await f.pool.request().query("SELECT COUNT(*) n FROM dbo.image_delete_jobs")).recordset[0].n, 2);
  } finally { await f.close(); }
});

test("session ownership, expiry, cancellation, consumed tokens and source binding", async () => {
  const f = await mediaFixture(); const posts = createPostService(f.pool);
  try {
    const post = await posts.create(postInput, f.context);
    await assert.rejects(issueUploadSession(f.pool, (await createTestSession(f.pool, createTestActor())).principal, { postId: post.id }), is(403));
    await assert.rejects(issueUploadSession(f.pool, f.principal, { postId: 99999999 }), is(404));
    const session = await issueUploadSession(f.pool, f.principal, { postId: post.id });
    await assert.rejects(cancelUploadSession(f.pool, session.token, (await createTestSession(f.pool, createTestActor())).principal), is(401));
    const read = await readUploadSession(f.pool, session.token, f.principal);
    await assert.rejects(readUploadSession(f.pool, session.token, f.principal, new Date(read.expiresAt.getTime() + 1)), is(401));
    await cancelUploadSession(f.pool, session.token, f.principal); await cancelUploadSession(f.pool, session.token, f.principal);
    await assert.rejects(readUploadSession(f.pool, session.token, f.principal), is(401));
    await assert.rejects(readUploadSession(f.pool, "invalid", f.principal), is(401));
    const active = await issueUploadSession(f.pool, f.principal, { postId: post.id });
    await posts.remove(post.id, { confirm: true }, f.principal);
    await assert.rejects(readUploadSession(f.pool, active.token, f.principal), is(401));
  } finally { await f.close(); }
});

test("durable session/file budgets, stale reservations, generation guard and idempotent finish", async () => {
  const f = await mediaFixture();
  try {
    const now = new Date(), client = key();
    const sessions = await Promise.allSettled(Array.from({ length: 6 }, () => reserveMediaRequest(f.pool, "session", client, now)));
    assert.equal(sessions.filter(result => result.status === "fulfilled").length, 5);
    const first = sessions.find(result => result.status === "fulfilled"); assert.ok(first?.status === "fulfilled");
    const next = await reserveMediaRequest(f.pool, "session", client, new Date(now.getTime() + 601000));
    await finishMediaRequest(f.pool, first.value, 0); await finishMediaRequest(f.pool, first.value, 0);
    let bucket = (await f.pool.request().input("key", sql.Char(64), client).query("SELECT * FROM dbo.media_buckets WHERE kind='session' AND client_key=@key")).recordset[0];
    assert.equal(bucket.attempts_pending, 1); assert.equal(bucket.attempts_used, 0);
    await finishMediaRequest(f.pool, next, 0);
    const fileClient = key();
    const reservations = await Promise.all(Array.from({ length: 9 }, () => reserveMediaRequest(f.pool, "file", fileClient, now)));
    await assert.rejects(reserveMediaRequest(f.pool, "file", fileClient, now), is(429));
    for (const item of reservations) await finishMediaRequest(f.pool, item, 0);
    for (let count = 9; count < 20; count++) await finishMediaRequest(f.pool, await reserveMediaRequest(f.pool, "file", fileClient, now), 100);
    await assert.rejects(reserveMediaRequest(f.pool, "file", fileClient, now), is(429));
    const staleClient = key(); await reserveMediaRequest(f.pool, "file", staleClient, now);
    await reserveMediaRequest(f.pool, "file", staleClient, new Date(now.getTime() + 121000));
    bucket = (await f.pool.request().input("key", sql.Char(64), staleClient).query("SELECT * FROM dbo.media_buckets WHERE kind='file' AND client_key=@key")).recordset[0];
    assert.equal(bucket.attempts_used, 1); assert.equal(Number(bucket.bytes_used), 5308416);
  } finally { await f.close(); }
});

test("cancel racing Blob completion never revives an image; prewrite failures refund capacity", async () => {
  const f = await mediaFixture(), store = new FakeBlobStore();
  try {
    const session = await issueUploadSession(f.pool, f.principal, {}), media = createMediaService(f.pool, store);
    const invalid = upload(session.token, Buffer.from("not jpeg"));
    await assert.rejects(media.uploadImage(invalid, f.principal), is(415)); await invariant(f.pool);
    assert.equal((await f.pool.request().query("SELECT occupied_bytes FROM dbo.media_capacity")).recordset[0].occupied_bytes, "0");
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    store.beforeOperation = async operation => { if (operation === "put") { entered(); await gate; } };
    const pending = media.uploadImage(upload(session.token, await jpeg()), f.principal);
    const rejected = assert.rejects(pending, is(409));
    await started; await cancelUploadSession(f.pool, session.token, f.principal); release(); await rejected;
    assert.equal((await f.pool.request().query("SELECT COUNT(*) n FROM dbo.image_assets WHERE state='ready'")).recordset[0].n, 0);
    assert.equal((await f.pool.request().query("SELECT COUNT(*) n FROM dbo.image_delete_jobs")).recordset[0].n, 1);
    await invariant(f.pool);
  } finally { await f.close(); }
});

test("five files, global capacity and Blob/SQL failure keep conservative accounting", async () => {
  const f = await mediaFixture(), store = new FakeBlobStore();
  try {
    const session = await issueUploadSession(f.pool, f.principal, {}), media = createMediaService(f.pool, store), bytes = await jpeg();
    for (let n = 0; n < 5; n++) await media.uploadImage(upload(session.token, bytes), f.principal);
    await assert.rejects(media.uploadImage(upload(session.token, bytes), f.principal), is(409));
    await invariant(f.pool);
    const second = await issueUploadSession(f.pool, f.principal, {});
    store.failOnce("put"); await assert.rejects(media.uploadImage(upload(second.token, bytes), f.principal), is(503));
    await invariant(f.pool);
    const row = (await f.pool.request().query("SELECT TOP(1) id FROM dbo.image_assets ORDER BY id")).recordset[0];
    const occupied = Number((await f.pool.request().query("SELECT occupied_bytes FROM dbo.media_capacity")).recordset[0].occupied_bytes);
    const extra = 1073741824 - occupied;
    await f.pool.request().input("id", sql.UniqueIdentifier, row.id).input("extra", sql.BigInt, extra).query(`
      UPDATE dbo.image_assets SET charge_bytes=charge_bytes+@extra WHERE id=@id;
      UPDATE dbo.media_capacity SET occupied_bytes=occupied_bytes+@extra WHERE id=1;
    `);
    await assert.rejects(media.uploadImage(upload(second.token, bytes), f.principal), (error: unknown) => error instanceof BoardError && error.code === "STORAGE_FULL");
    await invariant(f.pool);
  } finally { await f.close(); }
});

test("session and final post enforce the 20MiB input budget independently", async () => {
  const f = await mediaFixture(), media = createMediaService(f.pool, f.store), posts = createPostService(f.pool);
  try {
    const original = await jpeg(), padded = Buffer.alloc(4 * 1024 * 1024 + 1); original.copy(padded);
    const session = await issueUploadSession(f.pool, f.principal, {}), ids: string[] = [];
    for (let n = 0; n < 4; n++) ids.push((await media.uploadImage(upload(session.token, padded), f.principal)).asset.id);
    await assert.rejects(media.uploadImage(upload(session.token, padded), f.principal), is(409));
    const post = await posts.create({ ...postInput, document: document(...ids), uploadSessionToken: session.token }, f.context);
    const edit = await issueUploadSession(f.pool, f.principal, { postId: post.id });
    const extra = (await media.uploadImage(upload(edit.token, padded), f.principal)).asset;
    await assert.rejects(posts.update(post.id, { ...postInput, document: document(...ids, extra.id), uploadSessionToken: edit.token }, f.context), is(409));
    assert.deepEqual((await posts.get(post.id, f.principal)).document, document(...ids));
    await invariant(f.pool);
  } finally { await f.close(); }
});

test("Blob success followed by a lost finalize lease remains charged and queued", async () => {
  const f = await mediaFixture(), store = new FakeBlobStore();
  try {
    const session = await issueUploadSession(f.pool, f.principal, {});
    store.beforeOperation = async operation => {
      if (operation === "put") await f.pool.request().query("UPDATE dbo.image_assets SET lease_until=DATEADD(second,-1,SYSUTCDATETIME()) WHERE state='uploading'");
    };
    await assert.rejects(createMediaService(f.pool, store).uploadImage(upload(session.token, await jpeg()), f.principal), is(409));
    const asset = (await f.pool.request().query("SELECT state,charge_bytes FROM dbo.image_assets")).recordset[0];
    assert.equal(asset.state, "deleting"); assert.equal(Number(asset.charge_bytes), 5242880); assert.equal(store.active.size, 1);
    await invariant(f.pool);
  } finally { await f.close(); }
});

test("disconnect returns promptly while durable upload compensation finishes safely", async () => {
  const f = await mediaFixture(), store = new FakeBlobStore(), abort = new AbortController();
  let release!: () => void;
  try {
    const session = await issueUploadSession(f.pool, f.principal, {});
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    store.beforeOperation = async operation => { if (operation === "put") { entered(); await gate; } };
    const pending = createMediaService(f.pool, store).uploadImage(new Request(upload(session.token, await jpeg()), { signal: abort.signal }), f.principal);
    const rejected = assert.rejects(pending, is(503));
    await started; abort.abort(); await rejected; release();
    for (let n = 0; n < 100; n++) {
      const row = (await f.pool.request().query("SELECT COUNT(*) n FROM dbo.image_delete_jobs")).recordset[0];
      if (row.n === 1) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal((await f.pool.request().query("SELECT COUNT(*) n FROM dbo.image_assets WHERE state='deleting'")).recordset[0].n, 1);
    await invariant(f.pool);
  } finally { release?.(); await f.close(); }
});
