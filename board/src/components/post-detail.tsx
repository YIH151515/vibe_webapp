"use client";

import Link from "next/link";
import { formatDate } from "@/lib/posts/format";
import { Failure, Loading } from "./feedback";
import { usePost } from "./use-post";
import { RichContent } from "./rich-content";

export function PostDetail({ id }: { id: number }): React.JSX.Element {
  const { post, loading, error, retry } = usePost(id);
  if (loading) return <Loading />;
  if (error || !post) return <Failure error={error} retry={retry} />;
  return (
    <>
      <Link className="back-link" href="/">← 전체 이야기</Link>
      <article className="panel post">
        <header className="post-heading">
          <p className="eyebrow">자유로운 이야기</p>
          <h1>{post.title}</h1>
          <div className="post-meta"><span>{post.nickname}</span><span aria-hidden="true">·</span><time dateTime={post.createdAt}>{formatDate(post.createdAt)}</time></div>
        </header>
        {post.document ? <RichContent document={post.document} /> : <div className="post-content">{post.content}</div>}
        {!post.canEdit && <p className="field-help">이 글은 읽기 전용입니다.</p>}
        <footer className="post-footer">
          <Link className="button secondary" href="/">목록으로</Link>
          <div className="actions">
            {post.canEdit && <Link className="button secondary" href={`/posts/${id}/edit`}>글 수정</Link>}
            {post.canDelete && <Link className="button danger-outline" href={`/posts/${id}/delete`}>글 삭제</Link>}
          </div>
        </footer>
      </article>
    </>
  );
}
