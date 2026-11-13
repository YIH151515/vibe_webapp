"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { ApiError, createPost, updatePost } from "@/lib/client/api";
import { validatePost } from "@/lib/client/validation";
import type { Post, PostInput } from "@/lib/posts/types";
import { Failure, Loading } from "./feedback";
import { usePost } from "./use-post";

export function PostForm({ mode, id }: { mode: "create" | "edit"; id?: number }): React.JSX.Element {
  const { post, loading, error, retry } = usePost(mode === "edit" ? id : undefined);
  if (mode === "edit") {
    if (loading) return <Loading />;
    if (error || !post) return <Failure error={error} retry={retry} />;
  }
  return <PostEditor key={id ?? "new"} mode={mode} initial={post} />;
}

function PostEditor({ mode, initial }: { mode: "create" | "edit"; initial?: Post }): React.JSX.Element {
  const router = useRouter();
  const [values, setValues] = useState<PostInput>({
    title: initial?.title ?? "", content: initial?.content ?? "",
    nickname: initial?.nickname ?? "", password: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const back = initial ? `/posts/${initial.id}` : "/";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const validation = validatePost(values);
    setErrors(validation);
    setFailure(undefined);
    if (Object.keys(validation).length) {
      document.getElementById("field-" + Object.keys(validation)[0])?.focus();
      return;
    }
    submitting.current = true;
    setBusy(true);
    try {
      const post = initial ? await updatePost(initial.id, values) : await createPost(values);
      setValues(value => ({ ...value, password: "" }));
      router.push(`/posts/${post.id}`);
    } catch (error) {
      setFailure(error);
      if (error instanceof ApiError) setErrors(error.fieldErrors ?? {});
      setValues(value => ({ ...value, password: "" }));
      setBusy(false);
      submitting.current = false;
    }
  }

  if (failure instanceof ApiError && failure.status === 404) return <Failure error={failure} />;
  return (
    <>
      <Link className="back-link" href={back}>← {initial ? "이야기로 돌아가기" : "전체 이야기"}</Link>
      <section className="panel editor">
        <div className="form-heading"><p className="eyebrow">당신의 이야기를 기다려요</p><h1>{mode === "edit" ? "이야기 수정하기" : "새 이야기 쓰기"}</h1><p>서로를 존중하는 따뜻한 이야기를 나눠주세요.</p></div>
        <form method="post" onSubmit={submit} noValidate aria-busy={busy}>
          {(["title", "nickname", "password", "content"] as const).map(field => {
            const label = { title: "제목", nickname: "닉네임", password: "비밀번호", content: "본문" }[field];
            const max = { title: 100, nickname: 20, password: 64, content: 10000 }[field];
            const props = {
              id: "field-" + field, name: field, value: values[field], required: true,
              maxLength: max, disabled: busy,
              "aria-invalid": !!errors[field],
              "aria-describedby": errors[field] ? "error-" + field : field === "password" ? "password-help" : undefined,
              onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
                setValues(value => ({ ...value, [field]: event.target.value })),
            };
            return <div className="form-field" key={field}>
              <label htmlFor={props.id}>{label}<span className="required" aria-hidden="true"> *</span></label>
              {field === "content" ? <textarea {...props} rows={12} placeholder="나누고 싶은 이야기를 적어주세요." />
                : <input {...props} type={field === "password" ? "password" : "text"}
                    minLength={field === "password" ? 8 : field === "nickname" ? 2 : 1}
                    autoComplete={field === "password" ? (mode === "create" ? "new-password" : "current-password") : "off"}
                    placeholder={field === "title" ? "이야기의 제목을 적어주세요." : field === "nickname" ? "2~20자의 이름" : "8~64자의 비밀번호"} />}
              {field === "password" && <p className="field-help" id="password-help">{mode === "edit" ? "작성할 때 사용한 비밀번호를 입력해 주세요." : "수정·삭제할 때 필요합니다. 잊어버리면 복구할 수 없습니다."}</p>}
              {errors[field] && <p className="field-error" id={"error-" + field}>{errors[field]}</p>}
            </div>;
          })}
          <div aria-live="polite">{failure ? <p className="error-message" role="alert">{failure instanceof ApiError ? failure.message : "처리 중 오류가 발생했습니다."}</p> : Object.keys(errors).length > 0 ? <p className="error-message" role="alert">입력 내용을 확인해 주세요.</p> : null}</div>
          <div className="form-actions"><Link className="button secondary" href={back}>취소</Link><button className="button primary" type="submit" disabled={busy}>{busy ? "저장 중…" : mode === "edit" ? "수정 저장" : "글 등록"}</button></div>
        </form>
      </section>
    </>
  );
}
