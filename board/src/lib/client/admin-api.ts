import { request } from "./api";
type Session={expiresAt:string};
export const adminLogin=(password:string)=>request<Session>("/api/admin/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password})});
export const adminSession=()=>request<Session>("/api/admin/session");
export const adminLogout=()=>request<void>("/api/admin/logout",{method:"POST"});
export const adminDeletePost=(id:number)=>request<void>(`/api/admin/posts/${id}`,{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({confirm:true})});
