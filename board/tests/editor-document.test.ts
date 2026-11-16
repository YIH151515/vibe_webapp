import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { serializeForSave, type DraftImage } from "../src/lib/posts/editor-document";
import { normalizeDocument, isSafeLink } from "../src/lib/posts/document";
import { RichContent } from "../src/components/rich-content";
import { uploadImage, issueUploadSession } from "../src/lib/client/media-api";

test("editor serialization extracts canonical attributes and keeps preview/File/token out of JSON", () => {
  const id = randomUUID(), draftId = randomUUID();
  const image: DraftImage = { draftId, file: new File(["bytes"], "discard-name.png", { type: "image/png" }), previewUrl: "blob:local-preview", alt: "이미지",
    uploadedSessionToken: "a".repeat(64), uploaded: { id, url: "/api/images/" + id, width: 1, height: 1, bytes: 5, inputBytes: 10, mimeType: "image/webp" } };
  const document = serializeForSave({ json: { type: "doc", content: [
    { type: "orderedList", attrs: { start: 2, type: null }, content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "서식", marks: [{ type: "link", attrs: { href: "https://example.com", target: "_blank", rel: "noopener", class: null } }] }] }] }] },
    { type: "image", attrs: { draftId, previewUrl: image.previewUrl, src: image.previewUrl, alt: image.alt } },
  ] }, images: new Map([[draftId, image]]) });
  const json = JSON.stringify(document); assert.ok(!/blob:|previewUrl|draftId|uploadedSessionToken|discard-name|"src"/.test(json));
  assert.deepEqual(normalizeDocument(document).imageIds, [id]);
  assert.equal((document.content[0] as { attrs: { start: number } }).attrs.start, 2);
  assert.throws(() => serializeForSave({ json: { type: "doc", content: [{ type: "html", content: [] }] }, images: new Map() }));
  assert.throws(() => serializeForSave({ json: { type: "doc", content: [{ type: "image", attrs: { draftId } }] }, images: new Map() }));
});

test("React rich renderer escapes text and uses only app-mediated image URLs and safe links", () => {
  const id = randomUUID();
  const document = normalizeDocument({ version: 1, type: "doc", content: [
    { type: "paragraph", content: [{ type: "text", text: "<script>alert(1)</script>", marks: [{ type: "bold" }, { type: "link", attrs: { href: "https://example.com" } }] }] },
    { type: "image", attrs: { assetId: id, alt: '<img onerror="alert(1)">' } },
  ] }).document;
  const html = renderToStaticMarkup(createElement(RichContent, { document }));
  assert.ok(html.includes("&lt;script&gt;")); assert.ok(!html.includes("<script>"));
  assert.ok(html.includes(`/api/images/${id}`)); assert.ok(html.includes('rel="noopener noreferrer"'));
  for (const url of ["javascript:alert(1)", "data:text/html,x", "//external.invalid", "https://user:password@example.com", "https://example.com\n"]) assert.equal(isSafeLink(url), false);
  for (const url of ["http://example.com", "https://example.com", "mailto:author@example.com"]) assert.equal(isSafeLink(url), true);
});

test("client validates successful media response shapes before caching credentials/assets", async () => {
  const original = globalThis.fetch, id = randomUUID(), file = new File(["bytes"], "local.png", { type: "image/png" });
  const asset = { id, url: `/api/images/${id}`, mimeType: "image/webp", bytes: 10, inputBytes: 20, width: 1, height: 1 };
  try {
    for (const value of [null, {}, { ...asset, url: "https://external.invalid" }, { ...asset, bytes: -1 }]) {
      globalThis.fetch = async () => Response.json(value);
      await assert.rejects(uploadImage(file, "a".repeat(64), randomUUID()));
    }
    globalThis.fetch = async () => Response.json(asset);
    assert.deepEqual(await uploadImage(file, "a".repeat(64), randomUUID()), asset);
    globalThis.fetch = async () => Response.json({ token: "invalid", expiresAt: "not-a-date" });
    await assert.rejects(issueUploadSession({}));
  } finally { globalThis.fetch = original; }
});
