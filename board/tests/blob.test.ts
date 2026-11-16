import assert from "node:assert/strict";
import { test } from "node:test";
import { assertMediaTestStorage, createBlobStore } from "../src/lib/server/blob-store";
import { BoardError } from "../src/lib/server/errors";
import { mediaFixture } from "./helpers/media-fixture";
import { FakeBlobStore } from "./helpers/fake-blob-store";

const name = "images/" + "a".repeat(32) + ".webp";
test("private Azurite SDK roundtrip, conditional put, missing and cancelled streams", async () => {
  const fixture = await mediaFixture();
  try {
    const bytes = Buffer.alloc(1024 * 1024, 31);
    const stored = await fixture.store.put(name, bytes);
    assert.deepEqual(await fixture.store.head(name), { bytes: bytes.length, etag: stored.etag });
    const result = await fixture.store.read(name);
    assert.deepEqual(Buffer.from(await new Response(result.stream).arrayBuffer()), bytes);
    const anonymous = await fetch(`${process.env.STORAGE_BLOB_SERVICE_URL}/${fixture.containerName}/${name}`);
    assert.notEqual(anonymous.status, 200); await anonymous.body?.cancel();
    await assert.rejects(fixture.store.put(name, bytes), (error: unknown) => error instanceof BoardError && error.code === "MEDIA_CONFLICT");
    const cancelled = await fixture.store.read(name); await cancelled.stream.cancel();
    const abort = new AbortController(); abort.abort();
    await assert.rejects(fixture.store.read(name, abort.signal), (error: unknown) => error instanceof BoardError && error.status === 503);
    await fixture.store.remove(name); await fixture.store.remove(name);
    assert.equal(await fixture.store.head(name), null);
    await assert.rejects(fixture.store.read(name), (error: unknown) => error instanceof BoardError && error.status === 404);
    await assert.rejects(fixture.store.put("../secret", bytes), (error: unknown) => error instanceof BoardError && error.status === 400);
  } finally { await fixture.close(); }
});

test("test storage guards reject production endpoints, credentials and malformed names", () => {
  assertMediaTestStorage(process.env);
  for (const patch of [
    { NODE_ENV: "production" as const }, { APP_TEST_MODE: "0" }, { SQL_SERVER: "prod.database.windows.net" },
    { SQL_DATABASE: "dbboardprod" }, { STORAGE_BLOB_SERVICE_URL: "https://prod.blob.core.windows.net" },
    { STORAGE_BLOB_SERVICE_URL: "http://localhost:10000/boardtest" }, { STORAGE_CONTAINER: "board-images" },
    { AZURITE_KEY: "not-a-key" }, { WEBSITE_INSTANCE_ID: "azure" },
  ]) assert.throws(() => createBlobStore({ ...process.env, ...patch }));
  const production: NodeJS.ProcessEnv = { NODE_ENV: "production", STORAGE_AUTH_MODE: "azure-cli", STORAGE_CONTAINER: "board-images",
    STORAGE_BLOB_SERVICE_URL: "https://example123.blob.core.windows.net" };
  assert.doesNotThrow(() => createBlobStore(production)); // construction makes no network calls
  assert.doesNotThrow(() => createBlobStore({ ...production, WEBSITE_INSTANCE_ID: "app", STORAGE_AUTH_MODE: "managed-identity" }));
  for (const url of ["http://example123.blob.core.windows.net", production.STORAGE_BLOB_SERVICE_URL + "/path", production.STORAGE_BLOB_SERVICE_URL + "?sig=secret", "https://user@example123.blob.core.windows.net"])
    assert.throws(() => createBlobStore({ ...production, STORAGE_BLOB_SERVICE_URL: url }));
  assert.throws(() => createBlobStore({ ...production, WEBSITE_INSTANCE_ID: "app" }));
  assert.throws(() => createBlobStore({ ...production, STORAGE_AUTH_MODE: "managed-identity" }));
});

test("fake storage retains deleted bytes for seven days and supports injected failures", async () => {
  let clock = new Date("2026-01-01Z");
  const store = new FakeBlobStore(() => clock);
  await store.put(name, Buffer.alloc(10)); await store.remove(name); await store.remove(name);
  assert.equal(store.retainedBytes(), 10);
  await store.put(name, Buffer.alloc(20)); assert.equal(store.retainedBytes(), 30);
  store.failOnce("remove"); await assert.rejects(store.remove(name)); assert.equal(store.retainedBytes(), 30);
  clock = new Date(clock.getTime() + 7 * 86400000); assert.equal(store.retainedBytes(), 20);
});
