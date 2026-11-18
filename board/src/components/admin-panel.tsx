"use client";
import { useEffect,useState } from "react";
import { adminSession,adminDeletePost } from "@/lib/client/admin-api";
import { ApiError,listPosts } from "@/lib/client/api";
import type {PostPage,PostSummary} from "@/lib/posts/types";
import { formatDate } from "@/lib/posts/format";

export function AdminPanel(){
 const [authenticated,setAuthenticated]=useState<boolean|null>(null),[message,setMessage]=useState(""),
 [busy,setBusy]=useState(false),[data,setData]=useState<PostPage>(),[q,setQ]=useState(""),[page,setPage]=useState(1),
 [selected,setSelected]=useState<PostSummary>(),[agreed,setAgreed]=useState(false),[attempt,setAttempt]=useState(0);
 function failure(error:unknown){setMessage(error instanceof ApiError?error.message:"처리 중 오류가 발생했습니다.");if(error instanceof ApiError&&error.status===401)setAuthenticated(false);}
 useEffect(()=>{let active=true;adminSession().then(()=>{if(active)setAuthenticated(true);},error=>{if(active){setAuthenticated(false);if(!(error instanceof ApiError&&error.status===401))setMessage("관리자 설정 또는 연결을 확인해 주세요.");}});return()=>{active=false;};},[]);
 useEffect(()=>{if(!authenticated)return;const controller=new AbortController();listPosts({q,page},controller.signal).then(result=>{if(!controller.signal.aborted){setData(result);if(result.page!==page)setPage(result.page);}},error=>{if(!controller.signal.aborted)setMessage(error instanceof ApiError?error.message:"목록을 읽지 못했습니다.");});return()=>controller.abort();},[authenticated,q,page,attempt]);
 async function remove(){if(busy||!selected||!agreed)return;setBusy(true);try{await adminDeletePost(selected.id);setSelected(undefined);setAgreed(false);setMessage("글을 삭제했습니다.");setAttempt(x=>x+1);}catch(error){failure(error);if(error instanceof ApiError&&error.status===404){setSelected(undefined);setAttempt(x=>x+1);}}finally{setBusy(false);}}
 return <section className="panel editor" style={{marginTop:32}}>
 <h1>게시판 관리</h1><div role="status" aria-live="polite">{message}</div>
 {authenticated===null?<p>로그인 상태 확인 중…</p>:!authenticated?<p>접근 권한이 없습니다. 회사 계정 로그인과 관리자 권한을 확인해 주세요.</p>:<>
  <form className="search-form" onSubmit={e=>{e.preventDefault();const value=new FormData(e.currentTarget).get("q");setQ(String(value??""));setPage(1);}}>
 <label className="sr-only" htmlFor="admin-search">관리자 검색</label><input id="admin-search" name="q" type="search" maxLength={100}/><button className="button secondary" type="submit">검색</button></form>
 {data?<><p>총 {data.total}개의 글</p><ul style={{listStyle:"none",padding:0}}>{data.items.map(post=><li key={post.id} style={{borderBottom:"1px solid #e4e8f0",padding:"16px 0",overflowWrap:"anywhere"}}><strong>{post.title}</strong><p>{post.nickname} · {formatDate(post.createdAt)}</p><button aria-label={"삭제 확인: "+post.title} className="button danger-outline" type="button" disabled={busy} onClick={()=>{setSelected(post);setAgreed(false);setMessage("");}}>삭제 확인</button></li>)}</ul>
 <nav className="actions" aria-label="관리자 페이지 이동"><button className="button secondary" type="button" disabled={busy||page<=1} onClick={()=>setPage(x=>x-1)}>이전</button><span>{page} / {data.totalPages}</span><button className="button secondary" type="button" disabled={busy||page>=data.totalPages} onClick={()=>setPage(x=>x+1)}>다음</button></nav></>:<p>목록을 불러오는 중…</p>}
 {selected&&<section aria-label="삭제 확인"><h2>{selected.title}</h2><p>삭제한 글은 복구할 수 없습니다.</p><label className="checkbox-label"><input type="checkbox" checked={agreed} onChange={e=>setAgreed(e.target.checked)} disabled={busy}/>삭제에 동의합니다</label><div className="actions"><button className="button secondary" type="button" disabled={busy} onClick={()=>setSelected(undefined)}>취소</button><button className="button danger" type="button" disabled={busy||!agreed} onClick={remove}>삭제 실행</button></div></section>}
 </>}</section>;
}
