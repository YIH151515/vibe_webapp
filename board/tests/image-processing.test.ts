import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { normalizeImage } from "../src/lib/server/image-processing";
import { readImageFile, type ImageInput } from "../src/lib/server/multipart";
import { MAX_MULTIPART_BYTES } from "../src/lib/server/media-limits";
import { BoardError } from "../src/lib/server/errors";
import { toErrorResponse } from "../src/lib/server/http";

const input = (bytes: Buffer, mimeType: ImageInput["mimeType"] = "image/png"): ImageInput => ({ bytes, mimeType, receivedBytes: bytes.length });
const image = () => sharp({ create: { width: 40, height: 20, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0.5 } } });
const status = (code: number) => (error: unknown) => error instanceof BoardError && error.status === code;

test("JPEG/transparent PNG/WebP become bounded metadata-free WebP with input hash", async () => {
  for (const kind of ["jpeg", "png", "webp"] as const) {
    const bytes = await image()[kind]().toBuffer();
    const result = await normalizeImage(input(bytes, `image/${kind}`));
    const meta = await sharp(result.bytes).metadata();
    assert.equal(meta.format, "webp"); assert.equal(result.width, 40); assert.equal(result.height, 20);
    assert.equal(result.inputBytes, bytes.length); assert.match(result.inputSha256, /^[a-f0-9]{64}$/);
    assert.equal(meta.exif, undefined); assert.equal(meta.icc, undefined);
    if (kind === "png") assert.equal(meta.hasAlpha, true);
  }
  const original = await image().withMetadata({ orientation: 6 }).jpeg().toBuffer();
  const rotated = await normalizeImage(input(original, "image/jpeg"));
  assert.equal(rotated.width, 20); assert.equal(rotated.height, 40);
  const metadata = await sharp(rotated.bytes).metadata(); assert.equal(metadata.exif, undefined); assert.equal(metadata.orientation, undefined);
  const resized = await normalizeImage(input(await sharp({ create: { width: 2400, height: 1200, channels: 3, background: "white" } }).png().toBuffer()));
  assert.equal(resized.width, 1920); assert.equal(resized.height, 960);
});

test("corrupt, disguised, animated, excessive dimensions/pixels and oversized images fail", async () => {
  await assert.rejects(normalizeImage(input(Buffer.from("<svg/>"))), status(415));
  await assert.rejects(normalizeImage(input(await image().png().toBuffer(), "image/jpeg")), status(415));
  await assert.rejects(normalizeImage(input(Buffer.from([137,80,78,71,13,10,26,10,0]))), status(400));
  await assert.rejects(normalizeImage(input(Buffer.alloc(5242881))), status(413));
  const png = await image().png().toBuffer();
  const chunk = Buffer.alloc(20); chunk.writeUInt32BE(8, 0); chunk.write("acTL", 4);
  await assert.rejects(normalizeImage(input(Buffer.concat([png.subarray(0, 33), chunk, png.subarray(33)]))), status(400));
  const animation = await sharp({ create: { width: 4, height: 8, channels: 3, background: "red" } }).raw().toBuffer();
  // Distinct frames are essential: the encoder coalesces identical frames.
  for (let offset = 4 * 4 * 3; offset < animation.length; offset += 3) {
    animation[offset] = 0; animation[offset + 1] = 0; animation[offset + 2] = 255;
  }
  const webp = await sharp(animation, { raw: { width: 4, height: 8, channels: 3, pageHeight: 4 } }).webp({ loop: 0, delay: [100, 100] }).toBuffer();
  assert.equal((await sharp(webp).metadata()).pages, 2);
  await assert.rejects(normalizeImage(input(webp, "image/webp")), status(400));
  for (const [width, height] of [[10001, 1], [5000, 5000]]) {
    const bytes = await sharp({ create: { width, height, channels: 3, background: "white" } }).png().toBuffer();
    await assert.rejects(normalizeImage(input(bytes)), status(413));
  }
});

test("conversion slots reject third operation with Retry-After; abort retains native slot", async () => {
  const bytes = await image().png().toBuffer();
  const abort = new AbortController();
  const first = normalizeImage(input(bytes), abort.signal);
  const second = normalizeImage(input(bytes));
  abort.abort();
  await assert.rejects(normalizeImage(input(bytes)), (error: unknown) => {
    const response = toErrorResponse(error); assert.equal(response.headers.get("retry-after"), "1"); return response.status === 503;
  });
  await assert.rejects(first, status(503)); await second;
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(normalizeImage(input(bytes), aborted.signal), status(503));
});

function request(form: FormData) { return new Request("http://localhost", { method: "POST", body: form }); }
test("multipart accepts exactly one file, counts body bytes and rejects extras/types/limits", async () => {
  const bytes = await image().png().toBuffer();
  const form = new FormData(); form.set("file", new Blob([Uint8Array.from(bytes)], { type: "image/png" }), "private-name.png");
  let observed = 0;
  const result = await readImageFile(request(form), count => { assert.ok(count >= observed); observed = count; });
  assert.deepEqual(result.bytes, bytes); assert.equal(result.receivedBytes, observed); assert.ok(observed > bytes.length);
  form.set("unexpected", "value"); await assert.rejects(readImageFile(request(form), () => {}), status(400));
  form.delete("unexpected"); form.append("file", new Blob([bytes]), "two.png"); await assert.rejects(readImageFile(request(form), () => {}), status(400));
  const wrong = new FormData(); wrong.set("file", new Blob(["<svg/>"], { type: "image/svg+xml" }));
  await assert.rejects(readImageFile(request(wrong), () => {}), status(415));
  const big = new FormData(); big.set("file", new Blob([Buffer.alloc(5242881)], { type: "image/png" }));
  await assert.rejects(readImageFile(request(big), () => {}), status(413));
  await assert.rejects(readImageFile(new Request("http://localhost", { method: "POST", body: "x" }), () => {}), status(415));
  // Model an incoming wire body, not Undici's still-running FormData encoder.
  // Early header rejection may cancel the stream before that encoder finishes.
  const encoded = request(form), wire = new Uint8Array(await encoded.arrayBuffer());
  for (const length of ["invalid", "9007199254740992", "5308417"]) {
    const req = new Request("http://localhost", { method: "POST", headers: { "content-type": encoded.headers.get("content-type")!, "content-length": length }, body: wire });
    await assert.rejects(readImageFile(req, () => {}), status(length === "5308417" ? 413 : 400));
  }
});

test("lengthless multipart stream is capped and cancelled; stalled read aborts", async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ pull(c) { c.enqueue(new Uint8Array(65536)); }, cancel() { cancelled = true; } });
  const streamed = new Request("http://localhost", { method: "POST", headers: { "content-type": "multipart/form-data; boundary=test" }, body, duplex: "half" } as RequestInit);
  let received = 0;
  await assert.rejects(readImageFile(streamed, count => { received = count; }), status(413));
  assert.equal(received, MAX_MULTIPART_BYTES); assert.equal(cancelled, true);
  const abort = new AbortController();
  const stalled = new Request("http://localhost", { method: "POST", headers: { "content-type": "multipart/form-data; boundary=test" },
    body: new ReadableStream(), duplex: "half" } as RequestInit);
  const pending = readImageFile(stalled, () => {}, abort.signal); abort.abort();
  await assert.rejects(pending, status(503));
});
