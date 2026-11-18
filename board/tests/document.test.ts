import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { DocumentValidationError, normalizeDocument, plainToDocument } from "../src/lib/posts/document";
import { parsePostInput } from "../src/lib/server/validation";
import { validatePost } from "../src/lib/client/validation";
import { editorEnabled } from "../src/lib/server/editor-config";

const doc = (content: unknown[]) => ({ version: 1, type: "doc", content });
const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const image = (assetId = randomUUID()) => ({ type: "image", attrs: { assetId, alt: "첨부 이미지" } });
const rejects = (value: unknown) => assert.throws(() => normalizeDocument(value), DocumentValidationError);

test("rich document canonicalization preserves text, line breaks, lists and safe marks", () => {
  const input = doc([
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "제목" }] },
    { type: "paragraph", content: [
      { type: "text", text: "첫 줄", marks: [{ type: "underline" }, { type: "bold" }] },
      { type: "hardBreak" }, { type: "text", text: "둘째 줄\r\n한글😀" },
    ] },
    { type: "orderedList", content: [
      { type: "listItem", content: [paragraph("항목1")] },
      { type: "listItem", content: [paragraph("항목2")] },
    ] },
    { type: "blockquote", content: [paragraph("인용")] },
  ]);
  const normalized = normalizeDocument(input);
  assert.equal(normalized.text, "제목\n첫 줄\n둘째 줄\n한글😀\n항목1\n항목2\n인용");
  assert.deepEqual(normalized.imageIds, []);
  assert.deepEqual(normalizeDocument(JSON.parse(normalized.json)), normalized);
  assert.equal((JSON.parse(normalized.json).content[2]).attrs.start, 1);
  assert.equal(JSON.parse(normalized.json).content[1].content[0].marks[0].type, "bold");
  for (const href of ["https://example.org/path?a=1&b=2", "http://example.org", "mailto:user@example.org"]) {
    assert.equal(normalizeDocument(doc([{ type: "paragraph", content: [
      { type: "text", text: "링크", marks: [{ type: "link", attrs: { href } }] },
    ] }])).text, "링크");
  }
});

test("document allowlist rejects executable nodes, foreign attributes and unsafe URLs", () => {
  for (const href of ["javascript:alert(1)", "data:text/html,test", "file:///tmp/a", "/relative", "//example.org", " https://example.org", "https://user:password@example.org", "https://example.org/\n", "mailto:", "https://example.org/" + "a".repeat(2048)]) {
    rejects(doc([{ type: "paragraph", content: [{ type: "text", text: "링크", marks: [{ type: "link", attrs: { href } }] }] }]));
  }
  for (const value of [
    null, [], "<script>alert(1)</script>", doc([]), { ...doc([paragraph("안녕")]), version: 2 },
    doc([{ type: "html", content: "<img onerror=alert(1)>" }]),
    doc([{ ...paragraph("안녕"), attrs: { style: "color:red" } }]),
    doc([{ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "제목" }] }]),
    doc([{ type: "paragraph", content: [{ type: "hardBreak", marks: [] }] }]),
    doc([{ type: "paragraph", content: [{ type: "text", text: "", marks: [] }] }]),
    doc([{ type: "paragraph", content: [{ type: "text", text: "a", marks: [{ type: "bold" }, { type: "bold" }] }] }]),
    doc([{ type: "paragraph", content: [{ type: "text", text: "a", marks: [{ type: "link", attrs: { href: "https://example.org", target: "_self" } }] }] }]),
    doc([{ type: "orderedList", attrs: { start: 0 }, content: [{ type: "listItem", content: [paragraph("a")] }] }]),
    doc([{ type: "bulletList", content: [{ type: "listItem", content: [image()] }] }]),
    doc([{ type: "blockquote", content: [image()] }]),
    { ...doc([paragraph("a")]), onload: "bad" }, Object.create({ version: 1, type: "doc", content: [paragraph("a")] }),
  ]) rejects(value);
  assert.equal(normalizeDocument(doc([paragraph("<script>alert(1)</script>")])).text, "<script>alert(1)</script>");
});

test("images require distinct owned-format UUIDs and never contain URLs or preview data", () => {
  const files = Array.from({ length: 5 }, () => image());
  assert.deepEqual(normalizeDocument(doc(files)).imageIds, files.map(file => file.attrs.assetId));
  assert.equal(normalizeDocument(doc(files)).text, "");
  rejects(doc([...files, image()])); rejects(doc([files[0], files[0]]));
  for (const attrs of [
    { assetId: "https://example.org/photo.webp", alt: "a" },
    { ...files[0].attrs, src: "data:image/png;base64,AAAA" },
    { ...files[0].attrs, previewUrl: "blob:preview" },
    { ...files[0].attrs, draftId: randomUUID() },
    { ...files[0].attrs, alt: "a".repeat(201) },
    { ...files[0].attrs, assetId: files[0].attrs.assetId.toUpperCase() },
  ]) rejects(doc([{ type: "image", attrs }]));
});

test("document limits count UTF-16 text, UTF-8 JSON, all nodes and nested list depth", () => {
  assert.equal(normalizeDocument(doc([paragraph("😀".repeat(5000))])).text.length, 10000);
  rejects(doc([paragraph("가".repeat(10001))]));
  rejects(doc([paragraph("가".repeat(6000)), paragraph("나".repeat(5000))]));
  assert.equal(normalizeDocument(doc([paragraph("\u0001".repeat(8000))])).text.length, 8000);
  rejects(doc([paragraph("\u0001".repeat(8200))]));
  const many = (count: number) => doc([{ type: "paragraph", content: Array.from({ length: count }, () => ({ type: "text", text: "a" })) }]);
  assert.equal(normalizeDocument(many(998)).text.length, 998);
  rejects(many(999));
  function nested(levels: number): unknown {
    return { type: "bulletList", content: [{ type: "listItem", content: [paragraph("a"), ...(levels > 1 ? [nested(levels - 1)] : [])] }] };
  }
  normalizeDocument(doc([nested(3)])); rejects(doc([nested(4)]));
  const cycle = nested(1) as { content: { content: unknown[] }[] };
  cycle.content[0].content.push(cycle); rejects(doc([cycle]));
  rejects(doc([, paragraph("a")]));
  for (const blank of ["", " \n\t ", "\u200b\ufeff"]) rejects(doc([paragraph(blank)]));
});

test("plain import preserves LF boundaries and client/server share rich validation", () => {
  const plain = "첫 줄\r\n\r\n둘째 줄 😀";
  const document = plainToDocument(plain);
  assert.equal(normalizeDocument(document).text, plain.replace(/\r\n/g, "\n"));
  const input = { title: "제목", document };
  assert.deepEqual(validatePost(input), {});
  assert.equal(parsePostInput({ ...input, content: "클라이언트가 조작한 검색어" }).content, "첫 줄\n\n둘째 줄 😀");
  assert.throws(() => parsePostInput({ ...input, contentFormat: "plain" }), { code: "VALIDATION_ERROR" });
  assert.equal(parsePostInput({ ...input, document: null, content: "본문" }).contentFormat, "plain");
  assert.ok(validatePost({ ...input, document: { ...document, content: [] } }).content);
  assert.throws(() => parsePostInput({ ...input, uploadSessionToken: "a".repeat(64) + "\n" }), { code: "VALIDATION_ERROR" });
  assert.equal(editorEnabled({ NODE_ENV: "test" }), false);
  assert.equal(editorEnabled({ NODE_ENV: "test", EDITOR_FEATURE_ENABLED: "0" }), false);
  assert.equal(editorEnabled({ NODE_ENV: "test", EDITOR_FEATURE_ENABLED: "1" }), true);
  assert.throws(() => editorEnabled({ NODE_ENV: "test", EDITOR_FEATURE_ENABLED: "true" }), { code: "SERVICE_UNAVAILABLE" });
});
