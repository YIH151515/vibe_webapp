import { cookies } from "next/headers";
import sql from "mssql";
import { getDatabase } from "./database";
import { BoardError } from "./errors";
import { ensureSameOrigin, readJson, toErrorResponse } from "./http";
import { readAppOrigin, getClientKey } from "./request-context";
import { withRateLimit } from "./rate-limit";
import { loginAdmin,getAdminSession,revokeAdminSession,deletePostAsAdmin } from "./admin";
import { parsePostId } from "./validation";

export async function adminRequest(action:"login"|"logout"|"session"|"delete",request:Request,id?:string):Promise<Response> {
 try {
  if(action!=="session")ensureSameOrigin(request,{requireOrigin:true});
  const body=action==="login"||action==="delete" ? await readJson(request):undefined;
  if(action==="login" && (!body||typeof body!=="object"||Array.isArray(body)||typeof (body as {password?:unknown}).password!=="string"||
   (body as {password:string}).password.length<8||(body as {password:string}).password.length>128||!(body as {password:string}).password.trim()))
   throw new BoardError("VALIDATION_ERROR",400,"비밀번호는 8~128자로 입력해 주세요.");
  const jar=await cookies(),value=jar.get("board_admin")?.value;
  const cookie={httpOnly:true,secure:readAppOrigin().protocol==="https:",sameSite:"strict" as const,path:"/"};
  if(action==="logout") {
   try { await revokeAdminSession(await getDatabase(),value); }
   finally { jar.set("board_admin","",{...cookie,maxAge:0}); }
   return new Response(null,{status:204,headers:{"Cache-Control":"no-store"}});
  }
  const pool=await getDatabase();
  if(action==="login") {
   const result=await withRateLimit(pool,"admin-login",getClientKey(request),()=>loginAdmin(pool,(body as {password:string}).password));
   jar.set("board_admin",result.cookieValue,{...cookie,maxAge:3600});
   return Response.json(result.session,{headers:{"Cache-Control":"no-store"}});
  }
  const session=await getAdminSession(pool,value);
  if(!session)throw new BoardError("UNAUTHENTICATED",401,"관리자 로그인이 필요합니다.");
  if(action==="session")return Response.json(session,{headers:{"Cache-Control":"no-store"}});
  if(!body||typeof body!=="object"||(body as {confirm?:unknown}).confirm!==true)
   throw new BoardError("VALIDATION_ERROR",400,"삭제 동의가 필요합니다.");
  await deletePostAsAdmin(pool,parsePostId(id??""));
  return new Response(null,{status:204,headers:{"Cache-Control":"no-store"}});
 }catch(error){
  if(error instanceof sql.RequestError || error instanceof sql.ConnectionError || error instanceof sql.TransactionError)
   return toErrorResponse(new BoardError("SERVICE_UNAVAILABLE",503,"관리자 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요."));
  return toErrorResponse(error);
 }
}
