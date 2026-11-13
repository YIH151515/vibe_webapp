"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ApiError, listPosts } from "@/lib/client/api";
import { formatDate } from "@/lib/posts/format";
import type { PostPage } from "@/lib/posts/types";
import { Failure, Loading } from "./feedback";

function href(q: string, page: number): string {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (page > 1) params.set("page", String(page));
  return params.size ? "/?" + params : "/";
}

export function BoardList(): React.JSX.Element {
  const search = useSearchParams();
  const raw = search.toString();
  const router = useRouter();
  const [attempt, setAttempt] = useState(0);
  const key = raw + ":" + attempt;
  const [result, setResult] = useState<{ key: string; data?: PostPage; error?: unknown }>({ key: "" });

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams(raw);
    const page = params.get("page") ?? "1";
    Promise.resolve().then(() => {
      if (params.getAll("q").length > 1 || params.getAll("page").length > 1 ||
        !/^[1-9][0-9]*$/.test(page) || page !== page.trim() || !Number.isSafeInteger(Number(page))) {
        throw new ApiError(400, "VALIDATION_ERROR", "검색 주소가 올바르지 않습니다. 목록으로 돌아가 다시 검색해 주세요.");
      }
      return listPosts({ q: params.get("q") ?? "", page: Number(page) }, controller.signal);
    }).then(
      data => {
        if (controller.signal.aborted) return;
        setResult({ key, data });
        if (Number(page) !== data.page) router.replace(href(data.q, data.page));
      },
      error => { if (!controller.signal.aborted) setResult({ key, error }); },
    );
    return () => controller.abort();
  }, [raw, key, router]);

  const data = result.key === key ? result.data : undefined;
  const error = result.key === key ? result.error : undefined;
  return (
    <>
      <section className="hero">
        <p className="eyebrow">일상도, 생각도, 궁금한 것도</p>
        <h1>편하게, 이야기해요.</h1>
        <p>작은 이야기들이 모여 더 넓은 세상이 되는 곳.</p>
      </section>
      <section aria-label="게시글 목록" className="board-section">
        <div className="section-heading">
          <div><h2>전체 이야기</h2><span className="count" aria-live="polite">{data ? `총 ${data.total.toLocaleString("ko-KR")}개의 글` : "이야기를 모으고 있어요"}</span></div>
          <Link className="button primary" href="/posts/new"><span aria-hidden="true">＋</span> 글쓰기</Link>
        </div>
        <form className="search-form" action="/" method="get" role="search" key={raw}>
          <label className="sr-only" htmlFor="search">제목과 본문 검색</label>
          <span className="search-icon" aria-hidden="true">⌕</span>
          <input id="search" name="q" type="search" maxLength={100} defaultValue={search.get("q") ?? ""} placeholder="어떤 이야기를 찾고 있나요?" />
          <button type="submit" className="button secondary">검색</button>
        </form>
        {error ? <Failure error={error} retry={() => setAttempt(value => value + 1)} />
          : !data ? <Loading />
          : !data.items.length ? (
            <div className="panel empty-state" role="status">
              <span className="empty-symbol" aria-hidden="true">✦</span>
              <h3>{data.q ? "검색 결과가 없습니다" : "아직 등록된 글이 없습니다"}</h3>
              <p>{data.q ? "다른 검색어로 이야기를 찾아보세요." : "가장 먼저 이야기를 들려주세요."}</p>
              <Link className="text-link" href={data.q ? "/" : "/posts/new"}>{data.q ? "전체 이야기 보기" : "첫 글 쓰기 →"}</Link>
            </div>
          ) : (
            <>
              <div className="panel desktop-list">
                <table>
                  <caption className="sr-only">최신순 게시글</caption>
                  <thead><tr><th scope="col">제목</th><th scope="col">작성자</th><th scope="col">작성일</th></tr></thead>
                  <tbody>{data.items.map(post => <tr key={post.id}>
                    <td><Link className="post-title-link" href={`/posts/${post.id}`}>{post.title}</Link></td>
                    <td className="author">{post.nickname}</td>
                    <td><time dateTime={post.createdAt}>{formatDate(post.createdAt)}</time></td>
                  </tr>)}</tbody>
                </table>
              </div>
              <ul className="panel mobile-list">{data.items.map(post => <li key={post.id}>
                <Link className="post-title-link" href={`/posts/${post.id}`}>{post.title}</Link>
                <div className="post-meta"><span>{post.nickname}</span><time dateTime={post.createdAt}>{formatDate(post.createdAt)}</time></div>
              </li>)}</ul>
            </>
          )}
        {data && data.totalPages > 1 && <nav className="pagination" aria-label="페이지 이동">
          {data.page > 1 ? <Link className="button secondary" href={href(data.q, data.page - 1)}>← 이전</Link> : <span className="page-disabled">← 이전</span>}
          <span aria-live="polite"><strong>{data.page}</strong> / {data.totalPages}</span>
          {data.page < data.totalPages ? <Link className="button secondary" href={href(data.q, data.page + 1)}>다음 →</Link> : <span className="page-disabled">다음 →</span>}
        </nav>}
      </section>
    </>
  );
}
