"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import type { JSONContent } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { isSafeLink, type RichDocument } from "@/lib/posts/document";
import { toEditorDocument, type DraftImage, type EditorDraft } from "@/lib/posts/editor-document";
import { EditorToolbar } from "./editor-toolbar";

const PrivateImage = Image.extend({
  addAttributes() { return { assetId: { default: null }, draftId: { default: null }, previewUrl: { default: null }, alt: { default: "" } }; },
  parseHTML() { return []; }, // Pasted HTML cannot import arbitrary remote images.
  addInputRules() { return []; },
  renderHTML({ node }) {
    const assetId = typeof node.attrs.assetId === "string" ? node.attrs.assetId : "";
    const preview = typeof node.attrs.previewUrl === "string" && node.attrs.previewUrl.startsWith("blob:") ? node.attrs.previewUrl : null;
    return ["img", { src: preview ?? (assetId ? `/api/images/${assetId}` : undefined), alt: node.attrs.alt ?? "" }];
  },
});
type Props = { initial: RichDocument; disabled: boolean; onChange: (draft: EditorDraft) => void; errorId?: string };
export function RichEditor({ initial, disabled, onChange, errorId }: Props): React.JSX.Element {
  const editorRef = useRef<Editor | null>(null), images = useRef(new Map<string, DraftImage>()), callback = useRef(onChange);
  const [error, setError] = useState(""), [version, setVersion] = useState(0);
  useEffect(() => { callback.current = onChange; }, [onChange]);
  const publish = useCallback((editor: Editor) => {
    const json = editor.getJSON(), selected = new Map<string, DraftImage>();
    const ids = new Set<string>();
    function visit(node: JSONContent) {
      if (node.type === "image" && node.attrs?.draftId) ids.add(node.attrs.draftId);
      node.content?.forEach(visit);
    }
    visit(json);
    // Undo may restore a removed draft node. Its File stays in memory for history,
    // but the revoked URL must be replaced before it is displayed again.
    let repaired = false;
    const transaction = editor.state.tr;
    editor.state.doc.descendants((node, position) => {
      const image = node.type.name === "image" ? images.current.get(node.attrs.draftId) : undefined;
      if (image && ids.has(image.draftId) && !image.previewUrl) {
        image.previewUrl = URL.createObjectURL(image.file);
        transaction.setNodeMarkup(position, undefined, { ...node.attrs, previewUrl: image.previewUrl }); repaired = true;
      }
    });
    if (repaired) { editor.view.dispatch(transaction.setMeta("addToHistory", false)); return; }
    for (const [id, image] of images.current) {
      if (!ids.has(id) && image.previewUrl) { URL.revokeObjectURL(image.previewUrl); image.previewUrl = ""; }
      if (ids.has(id)) selected.set(id, image);
    }
    callback.current({ json, images: selected }); setVersion(value => value + 1);
  }, []);
  const addFiles = useCallback((files: File[]) => {
    const editor = editorRef.current;
    if (!editor?.isEditable || !files.length || editor.view.composing) return;
    const nodes = (editor.getJSON().content ?? []).filter(node => node.type === "image");
    const existingBytes = nodes.reduce((sum, node) => sum + (images.current.get(node.attrs?.draftId)?.file.size ?? 0), 0);
    if (nodes.length + files.length > 5) { setError("이미지는 글당 최대 5장까지 넣을 수 있습니다."); return; }
    if (files.some(file => !["image/jpeg", "image/png", "image/webp"].includes(file.type))) { setError("JPEG, PNG, WebP 이미지만 선택해 주세요."); return; }
    if (files.some(file => file.size === 0 || file.size > 5242880)) { setError("이미지 한 장은 5MiB 이하로 선택해 주세요."); return; }
    if (existingBytes + files.reduce((sum, file) => sum + file.size, 0) > 20971520) { setError("이미지 원본 합계는 20MiB 이하로 선택해 주세요."); return; }
    const content: JSONContent[] = [];
    for (const file of files) {
      const draftId = crypto.randomUUID(), previewUrl = URL.createObjectURL(file);
      images.current.set(draftId, { draftId, file, previewUrl, alt: "첨부 이미지" });
      content.push({ type: "image", attrs: { draftId, previewUrl, alt: "첨부 이미지" } });
    }
    content.push({ type: "paragraph" });
    editor.view.dispatch(closeHistory(editor.state.tr));
    editor.commands.insertContentAt(editor.state.doc.content.size, content); setError("");
  }, []);
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit.configure({ heading: { levels: [2, 3] }, code: false, codeBlock: false, horizontalRule: false,
      link: { openOnClick: false, autolink: false, linkOnPaste: false, isAllowedUri: isSafeLink } }), PrivateImage],
    content: toEditorDocument(initial),
    editorProps: {
      attributes: { id: "field-content", role: "textbox", "aria-label": "본문", "aria-multiline": "true", class: "editor-body" },
      handleDrop(_view, event) {
        const files = Array.from(event.dataTransfer?.files ?? []);
        if (!files.length) return false;
        event.preventDefault(); addFiles(files); return true;
      },
      handlePaste(_view, event) {
        const files = Array.from(event.clipboardData?.files ?? []);
        if (!files.length) return false;
        event.preventDefault(); addFiles(files); return true;
      },
    },
    onCreate({ editor }) { editorRef.current = editor; publish(editor); },
    onUpdate({ editor }) { publish(editor); },
    onSelectionUpdate() { setVersion(value => value + 1); },
  });
  useEffect(() => {
    if (!editor) return;
    editorRef.current = editor; editor.setEditable(!disabled);
    editor.setOptions({ editorProps: { ...editor.options.editorProps, attributes: {
      id: "field-content", role: "textbox", "aria-label": "본문", "aria-multiline": "true", class: "editor-body",
      "aria-invalid": errorId ? "true" : "false", ...(errorId ? { "aria-describedby": errorId } : {}),
    } } });
  }, [editor, disabled, errorId]);
  useEffect(() => {
    const files = images.current;
    return () => { for (const image of files.values()) if (image.previewUrl) URL.revokeObjectURL(image.previewUrl); files.clear(); };
  }, []);
  function imageAction(index: number, action: "remove" | "up" | "down", alt?: string) {
    if (!editor || disabled || editor.view.composing) return;
    const json = editor.getJSON(), blocks = [...(json.content ?? [])];
    if (alt !== undefined) {
      let position = 0;
      for (let i = 0; i < index; i++) position += editor.state.doc.child(i).nodeSize;
      editor.commands.command(({ tr, dispatch }) => { if (dispatch) tr.setNodeMarkup(position, undefined, { ...editor.state.doc.child(index).attrs, alt }); return true; });
      return;
    }
    if (action === "remove") blocks.splice(index, 1);
    else {
      const next = index + (action === "up" ? -1 : 1);
      if (next < 0 || next >= blocks.length) return;
      [blocks[index], blocks[next]] = [blocks[next], blocks[index]];
    }
    editor.view.dispatch(closeHistory(editor.state.tr));
    editor.commands.setContent({ type: "doc", content: blocks.length ? blocks : [{ type: "paragraph" }] });
  }
  // Selection changes refresh pressed state without replacing content during IME.
  void version;
  const imageBlocks = editor?.getJSON().content?.flatMap((node, index) => node.type === "image" ? [{ node, index }] : []);
  return <div className="rich-editor">
    <EditorToolbar editor={editor} disabled={disabled} />
    <EditorContent editor={editor} />
    <div className="image-picker"><label className="button secondary">이미지 선택<input className="sr-only" type="file" aria-label="이미지 선택" accept="image/jpeg,image/png,image/webp" multiple disabled={disabled} onChange={event => { addFiles(Array.from(event.target.files ?? [])); event.target.value = ""; }} /></label>
      <span className="field-help">붙여넣기·끌어놓기 가능 · 5MiB/장 · 최대 5장 · 합계 20MiB</span></div>
    {error && <p role="alert" className="field-error">{error}</p>}
    <div className="image-controls">{imageBlocks?.map(({ node, index }, number) =>
      <div key={node.attrs?.draftId ?? node.attrs?.assetId} className="image-control"><label>이미지 {number + 1} 설명<input aria-label={`이미지 ${number + 1} 설명`} value={node.attrs?.alt ?? ""} maxLength={200} disabled={disabled} onChange={event => imageAction(index, "up", event.target.value)} /></label>
        <button type="button" disabled={disabled || index === 0} aria-label={`이미지 ${number + 1} 위로`} onClick={() => imageAction(index, "up")}>↑</button>
        <button type="button" disabled={disabled || index === (editor?.getJSON().content?.length ?? 0) - 1} aria-label={`이미지 ${number + 1} 아래로`} onClick={() => imageAction(index, "down")}>↓</button>
        <button type="button" disabled={disabled} aria-label={`이미지 ${number + 1} 제거`} onClick={() => imageAction(index, "remove")}>제거</button></div>)}</div>
  </div>;
}
