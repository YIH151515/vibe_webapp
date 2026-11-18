import { request } from "./api";
import type { SessionDto as Session } from "../auth/types";
export const adminSession=()=>request<Session>("/api/admin/session");
export const adminDeletePost=(id:number)=>request<void>(`/api/admin/posts/${id}`,{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({confirm:true})});
