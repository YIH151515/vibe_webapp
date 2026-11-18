"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { ApiError, deletePost } from "@/lib/client/api";
import { validatePassword } from "@/lib/client/validation";
import { Failure, Loading } from "./feedback";
import { usePost } from "./use-post";

export function DeletePostForm({ id }: { id: number }): React.JSX.Element {
  const { post, loading, error, retry } = usePost(id);
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>();
  const [passwordError, setPasswordError] = useState<string>();
  const submitting = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || !agreed) return;
    const validation = validatePassword(password);
    setPasswordError(validation);
    setFailure(undefined);
    if (validation) { document.getElementById("delete-password")?.focus(); return; }
    submitting.current = true;
    setBusy(true);
    try {
      await deletePost(id);
      setPassword("");
      router.push("/");
    } catch (cause) {
      setFailure(cause);
      setPassword("");
      setBusy(false);
      submitting.current = false;
    }
  }

  if (loading) return <Loading />;
  if (error || !post) return <Failure error={error} retry={retry} />;
  if (failure instanceof ApiError && failure.status === 404) return <Failure error={failure} />;
  return (
    <>
      <Link className="back-link" href={`/posts/${id}`}>← 이야기로 돌아가기</Link>
      <section className="panel editor">
        <div className="form-heading"><p className="eyebrow">삭제 전 확인해 주세요</p><h1>이야기 삭제하기</h1><p>삭제한 글은 복구할 수 없습니다.</p></div>
        <div className="delete-summary"><strong>{post.title}</strong><span>{post.nickname}</span></div>
        <form method="post" onSubmit={submit} noValidate aria-busy={busy}>
          <div className="form-field">
            <label htmlFor="delete-password">비밀번호</label>
            <input id="delete-password" name="password" type="password" autoComplete="current-password" minLength={8} maxLength={64} required disabled={busy}
              value={password} onChange={event => setPassword(event.target.value)} aria-invalid={!!passwordError} aria-describedby="delete-password-help" />
            <p className={passwordError ? "field-error" : "field-help"} id="delete-password-help">{passwordError ?? "작성할 때 사용한 비밀번호를 입력해 주세요."}</p>
          </div>
          <label className="checkbox-label"><input type="checkbox" checked={agreed} disabled={busy} onChange={event => setAgreed(event.target.checked)} />삭제에 동의합니다</label>
          <div aria-live="polite">{failure ? <p role="alert" className="error-message">{failure instanceof ApiError ? failure.message : "처리 중 오류가 발생했습니다."}</p> : null}</div>
          <div className="form-actions"><Link className="button secondary" href={`/posts/${id}`}>취소</Link><button type="submit" className="button danger" disabled={!agreed || busy}>{busy ? "삭제 중…" : "글 삭제"}</button></div>
        </form>
      </section>
    </>
  );
}
