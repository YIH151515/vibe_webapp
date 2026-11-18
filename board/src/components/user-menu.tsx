"use client";
import Link from "next/link";
import {useState} from "react";
import {useRouter} from "next/navigation";
import type {SessionDto} from "@/lib/auth/types";
import {appLogout} from "@/lib/client/auth-api";
export function UserMenu({session}:{session:SessionDto|null}){
 const router=useRouter(),[busy,setBusy]=useState(false),[failure,setFailure]=useState("");
 async function logout(){if(busy)return;setBusy(true);try{await appLogout();router.replace("/login");router.refresh();}catch{setFailure("로그아웃하지 못했습니다. 다시 시도해 주세요.");setBusy(false);}}
 return session?<div className="user-menu"><span className="user-name" title={session.displayName}>{session.displayName}</span>{session.isAdmin&&<Link href="/admin">관리자</Link>}<button className="button secondary" onClick={logout} disabled={busy}>{busy?"로그아웃 중…":"로그아웃"}</button>{failure&&<span role="alert">{failure}</span>}</div>:<span className="header-note">회사 계정 전용 공간</span>;
}
