"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError, createPost, request, updatePost } from "@/lib/client/api";
import { issueUploadSession, uploadImage, cancelUploadSession } from "@/lib/client/media-api";
import { validatePost } from "@/lib/client/validation";
import { plainToDocument } from "@/lib/posts/document";
import { serializeForSave, toEditorDocument, type EditorDraft } from "@/lib/posts/editor-document";
import type { Post, PostInput } from "@/lib/posts/types";
import { Failure, Loading } from "./feedback";
import { RichEditor } from "./rich-editor";
import { RichContent } from "./rich-content";

type Session = { token: string; expiresAt: string; signature: string };
export function PostEditor({ mode, initial }: { mode: "create" | "edit"; initial?: Post }): React.JSX.Element {
  const router = useRouter();
  const [initialDocument] = useState(() => initial?.document ?? plainToDocument(initial?.content ?? ""));
  const draft = useRef<EditorDraft>({ json: toEditorDocument(initialDocument), images: new Map() });
  const session = useRef<Session | undefined>(undefined), controller = useRef<AbortController | undefined>(undefined);
  const [values, setValues] = useState<PostInput & { nickname: string; password: string }>({ title: initial?.title ?? "", content: initial?.content ?? "", nickname: initial?.nickname ?? "", password: "" });
  const [errors, setErrors] = useState<Record<string, string>>({}), [failure, setFailure] = useState<unknown>();
  const [busy, setBusy] = useState(false), [progress, setProgress] = useState("");
  const [config, setConfig] = useState<{ enabled: boolean }>(), [configError, setConfigError] = useState<unknown>(), [attempt, setAttempt] = useState(0);
  const submitting = useRef(false), back = initial ? `/posts/${initial.id}` : "/";
  useEffect(() => {
    const abort = new AbortController();
    request<{ enabled: boolean }>("/api/editor-config", { signal: abort.signal }).then(setConfig, error => { if (!abort.signal.aborted) setConfigError(error); });
    return () => abort.abort();
  }, [attempt]);
  useEffect(() => () => {
    controller.current?.abort();
    if (session.current) void cancelUploadSession(session.current.token).catch(() => undefined);
    session.current = undefined;
  }, []);
  async function discardSession() {
    const previous = session.current; session.current = undefined;
    if (previous) await cancelUploadSession(previous.token).catch(() => undefined);
    for (const image of draft.current.images.values()) { image.uploaded = undefined; image.uploadedSessionToken = undefined; image.idempotencyKey = undefined; }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (submitting.current || !config) return;
    let input: PostInput = { title: values.title, content: values.content }; let validation: Record<string, string>;
    try {
      if (config.enabled) input = { ...input, document: serializeForSave(draft.current, true) };
      validation = validatePost(input);
    } catch (error) {
      validation = { ...validatePost(values), content: error instanceof Error ? error.message : "본문을 확인해 주세요." };
    }
    setErrors(validation); setFailure(undefined);
    if (Object.keys(validation).length) { document.getElementById("field-" + Object.keys(validation)[0])?.focus(); return; }
    submitting.current = true; setBusy(true); controller.current = new AbortController();
    try {
      if (config.enabled) {
        const images = [...draft.current.images.values()], signature = images.map(image => image.draftId).sort().join(",");
        if (session.current && (session.current.signature !== signature || Date.parse(session.current.expiresAt) < Date.now() + 60000)) await discardSession();
        if (images.length) {
          if (!session.current) {
            setProgress("업로드를 준비하고 있습니다…");
            session.current = { ...await issueUploadSession(initial ? { postId: initial.id } : {}, controller.current.signal), signature };
          }
          const token = session.current.token;
          for (let index = 0; index < images.length; index++) {
            const image = images[index];
            if (image.uploaded && image.uploadedSessionToken === token) continue;
            setProgress(`이미지 ${index + 1}/${images.length} 업로드 중…`);
            image.idempotencyKey ??= crypto.randomUUID();
            image.uploaded = await uploadImage(image.file, token, image.idempotencyKey, controller.current.signal);
            image.uploadedSessionToken = token;
          }
        }
        input = { title: values.title, document: serializeForSave(draft.current), ...(session.current ? { uploadSessionToken: session.current.token } : {}) };
      }
      setProgress("이야기를 저장하고 있습니다…");
      const post = initial ? await updatePost(initial.id, input, controller.current.signal) : await createPost(input, controller.current.signal);
      session.current = undefined;
      for (const image of draft.current.images.values()) { if (image.previewUrl) URL.revokeObjectURL(image.previewUrl); image.previewUrl = ""; }
      draft.current.images.clear(); setValues(value => ({ ...value, password: "" }));
      router.push(`/posts/${post.id}`);
    } catch (error) {
      if (controller.current.signal.aborted) return;
      setFailure(error); if (error instanceof ApiError) { setErrors(error.fieldErrors ?? {}); if ([401, 409].includes(error.status)) await discardSession(); }
      setValues(value => ({ ...value, password: "" })); setBusy(false); submitting.current = false; setProgress("");
    }
  }
  if (!config && !configError) return <Loading />;
  if (!config) return <Failure error={configError} retry={() => { setConfigError(undefined); setAttempt(value => value + 1); }} />;
  if (failure instanceof ApiError && failure.status === 404) return <Failure error={failure} />;
  if (!config.enabled && initial?.document) return <section className="panel editor"><Link href={back}>← 이야기로 돌아가기</Link><h1>서식 편집이 일시 중지되었습니다</h1><p>기존 이야기는 그대로 보관됩니다. 잠시 후 다시 수정해 주세요.</p><RichContent document={initial.document} /><Link className="button danger-outline" href={`/posts/${initial.id}/delete`}>글 삭제</Link></section>;
  return <>
    <Link className="back-link" href={back}>← {initial ? "이야기로 돌아가기" : "전체 이야기"}</Link>
    <section className="panel editor"><div className="form-heading"><p className="eyebrow">당신의 이야기를 기다려요</p><h1>{mode === "edit" ? "이야기 수정하기" : "새 이야기 쓰기"}</h1><p>서로를 존중하는 따뜻한 이야기를 나눠주세요.</p></div>
      <form method="post" onSubmit={submit} noValidate aria-busy={busy}>
        {(["title", "nickname", "password"] as const).map(field => <div className="form-field" key={field}>
          <label htmlFor={`field-${field}`}>{{ title: "제목", nickname: "닉네임", password: "비밀번호" }[field]}<span className="required" aria-hidden="true"> *</span></label>
          <input id={`field-${field}`} name={field} value={values[field]} type={field === "password" ? "password" : "text"} maxLength={{ title: 100, nickname: 20, password: 64 }[field]} required disabled={busy}
            aria-invalid={!!errors[field]} aria-describedby={errors[field] ? `error-${field}` : field === "password" ? "password-help" : undefined}
            autoComplete={field === "password" ? (mode === "create" ? "new-password" : "current-password") : "off"}
            onChange={event => setValues(value => ({ ...value, [field]: event.target.value }))} />
          {field === "password" && <p className="field-help" id="password-help">{initial ? "작성할 때 사용한 비밀번호를 입력해 주세요." : "수정·삭제할 때 필요합니다. 잊어버리면 복구할 수 없습니다."}</p>}
          {errors[field] && <p className="field-error" id={`error-${field}`}>{errors[field]}</p>}
        </div>)}
        <div className="form-field"><label htmlFor="field-content">본문<span className="required" aria-hidden="true"> *</span></label>
          {config.enabled ? <RichEditor initial={initialDocument} disabled={busy} errorId={errors.content ? "error-content" : undefined} onChange={value => { draft.current = value; }} /> :
            <textarea id="field-content" name="content" value={values.content} required maxLength={10000} rows={12} disabled={busy} aria-invalid={!!errors.content} aria-describedby={errors.content ? "error-content" : undefined} onChange={event => setValues(value => ({ ...value, content: event.target.value }))} />}
          {errors.content && <p className="field-error" id="error-content">{errors.content}</p>}
        </div>
        <div aria-live="polite" role="status">{progress}</div>
        <div aria-live="polite">{failure ? <p className="error-message" role="alert">{failure instanceof Error ? failure.message : "처리 중 오류가 발생했습니다."}{failure instanceof ApiError && failure.retryAfterSeconds ? ` ${failure.retryAfterSeconds}초 후 다시 시도해 주세요.` : ""}</p> : Object.keys(errors).length ? <p className="error-message" role="alert">입력 내용을 확인해 주세요.</p> : null}</div>
        <div className="form-actions"><Link className="button secondary" href={back}>취소</Link><button className="button primary" type="submit" disabled={busy}>{busy ? "저장 중…" : initial ? "수정 저장" : "글 등록"}</button></div>
      </form>
    </section>
  </>;
}
