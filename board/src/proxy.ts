import { NextResponse, type NextRequest } from "next/server";
import { readAuthConfig } from "./lib/server/auth-config";
export function proxy(request: NextRequest) {
 try {
  if(readAuthConfig().mode!=="entra")throw new Error("MAINTENANCE");
 }catch{
  return new NextResponse('<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>게시판 준비 중</title><main><h1>게시판을 준비하고 있습니다</h1><p>잠시 후 다시 접속해 주세요.</p><a href="/login">로그인 안내</a></main></html>',{status:503,headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store","Retry-After":"60"}});
 }
 const headers=new Headers(request.headers);headers.delete("x-board-return-to");
 headers.set("x-board-return-to",request.nextUrl.pathname+request.nextUrl.search);
 const response=NextResponse.next({request:{headers}});response.headers.set("Cache-Control","private,no-store");return response;
}
export const config={matcher:["/","/posts/:path*","/admin/:path*"]};
