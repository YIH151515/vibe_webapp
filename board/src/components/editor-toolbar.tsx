"use client";
import { useState } from "react";
import type { Editor } from "@tiptap/core";
import { isSafeLink } from "@/lib/posts/document";

export function EditorToolbar({ editor, disabled }: { editor: Editor | null; disabled: boolean }) {
  const [href, setHref] = useState(""), [error, setError] = useState("");
  if (!editor) return null;
  const buttons: [string, string, () => void, boolean][] = [
    ["굵게", "B", () => { editor.chain().focus().toggleBold().run(); }, editor.isActive("bold")],
    ["기울임", "I", () => { editor.chain().focus().toggleItalic().run(); }, editor.isActive("italic")],
    ["밑줄", "U", () => { editor.chain().focus().toggleUnderline().run(); }, editor.isActive("underline")],
    ["취소선", "S", () => { editor.chain().focus().toggleStrike().run(); }, editor.isActive("strike")],
    ["제목 2", "H2", () => { editor.chain().focus().toggleHeading({ level: 2 }).run(); }, editor.isActive("heading", { level: 2 })],
    ["제목 3", "H3", () => { editor.chain().focus().toggleHeading({ level: 3 }).run(); }, editor.isActive("heading", { level: 3 })],
    ["글머리 목록", "• 목록", () => { editor.chain().focus().toggleBulletList().run(); }, editor.isActive("bulletList")],
    ["번호 목록", "1. 목록", () => { editor.chain().focus().toggleOrderedList().run(); }, editor.isActive("orderedList")],
    ["인용", "인용", () => { editor.chain().focus().toggleBlockquote().run(); }, editor.isActive("blockquote")],
    ["실행 취소", "↶", () => { editor.chain().focus().undo().run(); }, false],
    ["다시 실행", "↷", () => { editor.chain().focus().redo().run(); }, false],
  ];
  return <div className="editor-tools">
    <div role="toolbar" aria-label="본문 서식" className="editor-toolbar">{buttons.map(([label, text, action, active]) =>
      <button key={label} type="button" aria-label={label} aria-pressed={active} disabled={disabled} onMouseDown={e => e.preventDefault()} onClick={action}>{text}</button>)}</div>
    <div className="editor-link"><input aria-label="링크 주소" type="url" value={href} disabled={disabled} placeholder="https:// 또는 mailto:" onChange={e => setHref(e.target.value)} />
      <button type="button" disabled={disabled} onMouseDown={e => e.preventDefault()} onClick={() => {
        if (!isSafeLink(href)) { setError("http, https, mailto 주소를 입력해 주세요."); return; }
        editor.chain().focus().extendMarkRange("link").setLink({ href }).run(); setError("");
      }}>링크 적용</button>
      <button type="button" disabled={disabled} onClick={() => editor.chain().focus().unsetLink().run()}>링크 해제</button></div>
    {error && <p className="field-error" role="alert">{error}</p>}
  </div>;
}
