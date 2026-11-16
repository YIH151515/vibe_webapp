import type { JSONContent } from "@tiptap/core";
import type { ImageAssetDto } from "../server/media-service";
import { normalizeDocument, type RichDocument } from "./document";

export type DraftImage = { draftId: string; file: File; previewUrl: string; alt: string; uploaded?: ImageAssetDto; uploadedSessionToken?: string; idempotencyKey?: string };
export type EditorDraft = { json: JSONContent; images: Map<string, DraftImage> };
export function toEditorDocument(document: RichDocument): JSONContent {
  return { type: "doc", content: document.content };
}
/** Extract the canonical schema, never send preview URLs or Tiptap-only attributes. */
export function serializeForSave(draft: EditorDraft, allowPending = false): RichDocument {
  function node(value: JSONContent): JSONContent {
    const type = value.type;
    if (!type || !["doc", "paragraph", "heading", "blockquote", "bulletList", "orderedList", "listItem", "hardBreak", "text", "image"].includes(type)) throw new Error("지원하지 않는 본문 서식입니다.");
    if (type === "image") {
      const pending = typeof value.attrs?.draftId === "string" ? draft.images.get(value.attrs.draftId) : undefined;
      const assetId = pending?.uploaded?.id ?? value.attrs?.assetId ?? (allowPending ? pending?.draftId : undefined);
      if (!assetId) throw new Error("이미지 업로드를 완료해 주세요.");
      return { type, attrs: { assetId, alt: value.attrs?.alt ?? "" } };
    }
    return { type,
      ...(type === "text" ? { text: value.text } : {}),
      ...(type === "heading" ? { attrs: { level: value.attrs?.level } } : {}),
      ...(type === "orderedList" ? { attrs: { start: value.attrs?.start ?? 1 } } : {}),
      ...(value.content ? { content: value.content.map(node) } : {}),
      ...(value.marks?.length ? { marks: value.marks.map(mark => {
        if (!["bold", "italic", "underline", "strike", "link"].includes(mark.type)) throw new Error("지원하지 않는 본문 서식입니다.");
        return { type: mark.type, ...(mark.type === "link" ? { attrs: { href: mark.attrs?.href } } : {}) };
      }) } : {}),
    };
  }
  return normalizeDocument({ ...node(draft.json), version: 1 }).document;
}
