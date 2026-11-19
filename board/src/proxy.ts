import { NextResponse, type NextRequest } from "next/server";
import { readAuthConfig, assertTestOidc } from "./lib/server/auth-config";
import { randomBytes } from "node:crypto";
import { contentSecurityPolicy } from "./lib/security-headers";
export function proxy(request: NextRequest) {
 let loginOrigin="https://login.microsoftonline.com";
 if(process.env.APP_TEST_MODE==="1"){assertTestOidc(process.env);loginOrigin=new URL(process.env.TEST_OIDC_ISSUER!).origin;}
 const csp=contentSecurityPolicy(randomBytes(32).toString("base64"),process.env.NODE_ENV==="development",loginOrigin);
 const protectedPage=/^\/(?:$|posts(?:\/|$)|admin(?:\/|$))/.test(request.nextUrl.pathname);
 if(protectedPage){
 try {
  if(readAuthConfig().mode!=="entra")throw new Error("MAINTENANCE");
 }catch{
  return new NextResponse('<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>게시판 준비 중</title><main><h1>게시판을 준비하고 있습니다</h1><p>잠시 후 다시 접속해 주세요.</p><a href="/login">로그인 안내</a></main></html>',{status:503,headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store","Retry-After":"60","Content-Security-Policy":csp}});
 }
 }
 const headers=new Headers(request.headers);headers.delete("x-board-return-to");
 headers.delete("x-nonce");headers.delete("content-security-policy");
 const nonce=/\bnonce-([^']+)/.exec(csp)![1];headers.set("x-nonce",nonce);headers.set("Content-Security-Policy",csp);
 if(protectedPage)headers.set("x-board-return-to",request.nextUrl.pathname+request.nextUrl.search);
 const response=NextResponse.next({request:{headers}});response.headers.set("Cache-Control","private,no-store");response.headers.set("Content-Security-Policy",csp);return response;
}
export const config={matcher:["/((?!api(?:/|$)|_next/static|_next/image).*)"]};
