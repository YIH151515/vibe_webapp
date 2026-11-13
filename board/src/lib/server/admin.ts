import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import sql, { type ConnectionPool } from "mssql";
import { BoardError } from "./errors";
import { verifyPassword } from "./password";
import { readAppOrigin } from "./request-context";
import { parsePostId } from "./validation";

export type AdminSession = { expiresAt: string };
function settings() {
 const hash = process.env.ADMIN_PASSWORD_HASH ?? "", secret = process.env.ADMIN_SESSION_SECRET ?? "";
 if (!/^scrypt\$16384\$8\$1\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(hash) || hash.length !== 178 ||
 !/^[a-f0-9]{64}$/.test(secret) || secret.length !== 64)
   throw new BoardError("SERVICE_UNAVAILABLE",503,"관리자 설정을 확인해 주세요.");
 return { hash, secret, origin: readAppOrigin().origin };
}
function mac(value:string) {
 const config = settings();
 return createHmac("sha256",Buffer.from(config.secret,"hex"))
 .update(JSON.stringify(["board-admin-v1",config.origin,config.hash,value])).digest("hex");
}
function digest(sid:string) { return createHash("sha256").update(sid).digest("hex"); }
function token(value:string|undefined,now:Date) {
 settings();
 if (!value || value.length > 256) return null;
 const parts=value.split(".");
 if(parts.length!==4) return null;
 const [sid,iatRaw,expRaw,signature]=parts;
 if(!/^[a-f0-9]{64}$/.test(sid)||sid.length!==64||!/^[a-f0-9]{64}$/.test(signature)||signature.length!==64 ||
 !/^[1-9][0-9]*$/.test(iatRaw)||!/^[1-9][0-9]*$/.test(expRaw))return null;
 const iat=Number(iatRaw),exp=Number(expRaw),clock=Math.floor(now.getTime()/1000);
 if(!Number.isSafeInteger(iat)||!Number.isSafeInteger(exp)||exp-iat!==3600||iat>clock+30||exp<=clock)return null;
 if(!timingSafeEqual(Buffer.from(signature,"hex"),Buffer.from(mac(parts.slice(0,3).join(".")),"hex")))return null;
 return {sid,exp};
}
export async function loginAdmin(pool:ConnectionPool,password:string,now=new Date()):Promise<{cookieValue:string;session:AdminSession}> {
 const {hash}=settings();
 if(typeof password!=="string"||password.length<8||password.length>128||!password.trim())
 throw new BoardError("VALIDATION_ERROR",400,"비밀번호는 8~128자로 입력해 주세요.");
 if(!await verifyPassword(password,hash))throw new BoardError("UNAUTHENTICATED",401,"관리자 비밀번호가 일치하지 않습니다.");
 const sid=randomBytes(32).toString("hex"),iat=Math.floor(now.getTime()/1000),exp=iat+3600;
 const expires=new Date(exp*1000),value=[sid,iat,exp].join(".");
 await pool.request().input("id",sql.Char(64),digest(sid)).input("expires",sql.DateTime2(3),expires)
 .query("INSERT dbo.admin_sessions(id_hash,expires_at) VALUES(@id,@expires)");
 try { await pool.request().query("DELETE TOP(1000) FROM dbo.admin_sessions WHERE expires_at<DATEADD(day,-1,SYSUTCDATETIME())"); }
 catch { console.error("ADMIN_SESSION_CLEANUP_FAILED"); }
 return {cookieValue:value+"."+mac(value),session:{expiresAt:expires.toISOString()}};
}
export async function getAdminSession(pool:ConnectionPool,value:string|undefined,now=new Date()):Promise<AdminSession|null> {
 const parsed=token(value,now);if(!parsed)return null;
 const row=(await pool.request().input("id",sql.Char(64),digest(parsed.sid)).input("now",sql.DateTime2(3),now)
 .query<{expires_at:Date}>("SELECT expires_at FROM dbo.admin_sessions WHERE id_hash=@id AND expires_at>@now")).recordset[0];
 return row ? {expiresAt:row.expires_at.toISOString()}:null;
}
export async function revokeAdminSession(pool:ConnectionPool,value:string|undefined):Promise<void> {
 const parsed=token(value,new Date());if(!parsed)return;
 await pool.request().input("id",sql.Char(64),digest(parsed.sid)).query("DELETE dbo.admin_sessions WHERE id_hash=@id");
}
export async function deletePostAsAdmin(pool:ConnectionPool,id:number):Promise<void> {
 parsePostId(String(id));
 const result=await pool.request().input("id",sql.BigInt,String(id)).query("DELETE dbo.posts WHERE id=@id");
 if(!result.rowsAffected[0])throw new BoardError("NOT_FOUND",404,"글을 찾을 수 없습니다.");
}
