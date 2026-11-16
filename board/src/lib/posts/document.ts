export type RichMark =
  | { type: "bold" | "italic" | "underline" | "strike" }
  | { type: "link"; attrs: { href: string } };
export type RichInline = { type: "text"; text: string; marks?: RichMark[] } | { type: "hardBreak" };
export type RichParagraph = { type: "paragraph"; content?: RichInline[] };
export type RichHeading = { type: "heading"; attrs: { level: 2 | 3 }; content?: RichInline[] };
export type RichListItem = { type: "listItem"; content: (RichParagraph | RichList)[] };
export type RichList =
  | { type: "bulletList"; content: RichListItem[] }
  | { type: "orderedList"; attrs: { start: number }; content: RichListItem[] };
export type RichImage = { type: "image"; attrs: { assetId: string; alt: string } };
export type RichBlock = RichParagraph | RichHeading | RichList
  | { type: "blockquote"; content: (RichParagraph | RichHeading | RichList)[] } | RichImage;
export type RichDocument = { version: 1; type: "doc"; content: RichBlock[] };
export type NormalizedDocument = { document: RichDocument; json: string; text: string; imageIds: string[] };

export function isSafeLink(value: string): boolean {
  if (!value || value.length > 2048 || value !== value.trim() || /[\u0000-\u0020\u007f-\u009f]/.test(value) || !/^(?:https?:\/\/|mailto:)/i.test(value)) return false;
  try {
    const url = new URL(value);
    return ["http:", "https:", "mailto:"].includes(url.protocol) && !url.username && !url.password && (url.protocol !== "mailto:" || !!url.pathname);
  } catch { return false; }
}

export class DocumentValidationError extends Error {
  constructor() { super("올바른 본문 서식과 허용된 크기를 확인해 주세요."); this.name = "DocumentValidationError"; }
}
function invalid(): never { throw new DocumentValidationError(); }
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Reflect.ownKeys(value).some(key => typeof key !== "string" || !keys.includes(key))) invalid();
  return value as Record<string, unknown>;
}
function array(value: unknown, minimum = 0): unknown[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > 1000) invalid();
  for (let index = 0; index < value.length; index++) if (!Object.hasOwn(value, index)) invalid();
  return value;
}

/** Shared allowlist: callers never turn arbitrary HTML into a stored document. */
export function normalizeDocument(value: unknown): NormalizedDocument {
  let count = 0;
  const imageIds: string[] = [];
  function visit(depth: number) { if (++count > 1000 || depth > 8) invalid(); }
  function inline(value: unknown, depth: number): RichInline {
    visit(depth);
    const node = object(value, ["type", "text", "marks"]);
    if (node.type === "hardBreak") { object(node, ["type"]); return { type: "hardBreak" }; }
    if (node.type !== "text" || typeof node.text !== "string" || !node.text.length || node.text.length > 10000) invalid();
    const text = node.text.replace(/\r\n/g, "\n");
    const marks: RichMark[] = [];
    const seen = new Set<string>();
    if (node.marks !== undefined) for (const raw of array(node.marks)) {
      const mark = object(raw, ["type", "attrs"]);
      if (typeof mark.type !== "string" || seen.has(mark.type)) invalid();
      seen.add(mark.type);
      if (mark.type === "link") {
        const attrs = object(mark.attrs, ["href"]);
        if (typeof attrs.href !== "string" || !isSafeLink(attrs.href)) invalid();
        marks.push({ type: "link", attrs: { href: attrs.href } });
      } else if (["bold", "italic", "underline", "strike"].includes(mark.type)) {
        object(mark, ["type"]);
        marks.push({ type: mark.type as "bold" | "italic" | "underline" | "strike" });
      } else invalid();
    }
    marks.sort((a, b) => a.type.localeCompare(b.type, "en"));
    return { type: "text", text, ...(marks.length ? { marks } : {}) };
  }
  function inlines(node: Record<string, unknown>, depth: number): { content?: RichInline[] } {
    if (node.content === undefined) return {};
    const content = array(node.content).map(child => inline(child, depth + 1));
    return content.length ? { content } : {};
  }
  function list(value: unknown, depth: number): RichList {
    visit(depth);
    const node = object(value, ["type", "attrs", "content"]);
    if (node.type !== "bulletList" && node.type !== "orderedList") invalid();
    let start = 1;
    if (node.type === "bulletList") object(node, ["type", "content"]);
    else if (node.attrs !== undefined) {
      const attrs = object(node.attrs, ["start"]);
      if (attrs.start !== undefined) {
        if (typeof attrs.start !== "number" || !Number.isInteger(attrs.start) || attrs.start < 1 || attrs.start > 10000) invalid();
        start = attrs.start;
      }
    }
    const content = array(node.content, 1).map(raw => {
      visit(depth + 1);
      const item = object(raw, ["type", "content"]);
      if (item.type !== "listItem") invalid();
      const children = array(item.content, 1).map((raw, index): RichParagraph | RichList => {
        const child = object(raw, ["type", "attrs", "content"]);
        if (child.type === "paragraph") return paragraph(child, depth + 2);
        if (index === 0) invalid();
        return list(child, depth + 2);
      });
      return { type: "listItem" as const, content: children };
    });
    return node.type === "bulletList" ? { type: "bulletList", content } : { type: "orderedList", attrs: { start }, content };
  }
  function paragraph(value: unknown, depth: number): RichParagraph {
    visit(depth);
    const node = object(value, ["type", "content"]);
    if (node.type !== "paragraph") invalid();
    return { type: "paragraph", ...inlines(node, depth) };
  }
  function block(value: unknown, depth: number, quoted = false): RichBlock {
    const node = object(value, ["type", "content", "attrs"]);
    if (node.type === "paragraph") return paragraph(node, depth);
    if (node.type === "bulletList" || node.type === "orderedList") return list(node, depth);
    visit(depth);
    if (node.type === "heading") {
      const attrs = object(node.attrs, ["level"]);
      if (attrs.level !== 2 && attrs.level !== 3) invalid();
      return { type: "heading", attrs: { level: attrs.level }, ...inlines(node, depth) };
    }
    if (node.type === "blockquote" && !quoted) {
      object(node, ["type", "content"]);
      const content = array(node.content, 1).map(child => block(child, depth + 1, true)) as (RichParagraph | RichHeading | RichList)[];
      return { type: "blockquote", content };
    }
    if (node.type === "image" && !quoted) {
      object(node, ["type", "attrs"]);
      const attrs = object(node.attrs, ["assetId", "alt"]);
      if (typeof attrs.assetId !== "string" ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(attrs.assetId) ||
        attrs.assetId.length !== 36 || typeof attrs.alt !== "string" || attrs.alt.length > 200 ||
        imageIds.includes(attrs.assetId) || imageIds.length >= 5) invalid();
      imageIds.push(attrs.assetId);
      return { type: "image", attrs: { assetId: attrs.assetId, alt: attrs.alt } };
    }
    return invalid();
  }
  const root = object(value, ["version", "type", "content"]);
  if (root.version !== 1 || root.type !== "doc") invalid();
  visit(0);
  const document: RichDocument = { version: 1, type: "doc", content: array(root.content, 1).map(child => block(child, 1)) };
  function textOf(node: RichBlock | RichListItem | RichInline): string {
    if (node.type === "text") return node.text;
    if (node.type === "hardBreak") return "\n";
    if (node.type === "image") return "";
    const join = node.type === "paragraph" || node.type === "heading" ? "" : "\n";
    return (node.content ?? []).map(textOf).join(join);
  }
  const text = document.content.filter(node => node.type !== "image").map(textOf).join("\n").trim();
  if (text.length > 10000 || (!imageIds.length && !text.replace(/[\u200b\ufeff]/g, "").trim())) invalid();
  const json = JSON.stringify(document);
  if (new TextEncoder().encode(json).byteLength > 49152) invalid();
  return { document, json, text, imageIds };
}

export function plainToDocument(text: string): RichDocument {
  const content: RichInline[] = [];
  text.replace(/\r\n/g, "\n").split("\n").forEach((line, index) => {
    if (index) content.push({ type: "hardBreak" });
    if (line) content.push({ type: "text", text: line });
  });
  return { version: 1, type: "doc", content: [{ type: "paragraph", ...(content.length ? { content } : {}) }] };
}
