import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import type { APIRequestContext } from "@playwright/test";
import sql, { type ConnectionPool } from "mssql";
import { assertTestOidc } from "../../src/lib/server/auth-config";
import { assertTestDatabase } from "../../src/lib/server/database";
import { assertMediaTestStorage, type BlobStore } from "../../src/lib/server/blob-store";
import type { Principal } from "../../src/lib/server/auth-principal";
import { createTestActor, createTestSession } from "./auth-fixture";
import { runMediaCleanup } from "../../src/lib/server/media-cleanup";
export async function verifyAuthenticatedApi({pool,store,request,anonymous,principal}: {pool:ConnectionPool;store:BlobStore;request:APIRequestContext;anonymous:APIRequestContext;principal:Principal}):Promise<{checks:string[]}>{
 assertTestDatabase(process.env); assertMediaTestStorage(process.env); assertTestOidc(process.env);
 if(process.env.APP_ORIGIN!=="http://127.0.0.1:3100")throw new Error("TEST_ORIGIN_REQUIRED");
 const origin=process.env.APP_ORIGIN, prefix="isolated-qa-"+randomUUID(),checks:string[]=[],ids:number[]=[],assets:string[]=[];
 const admin=await createTestSession(pool,createTestActor({isAdmin:true})),bob=await createTestSession(pool,createTestActor());
 const adminHeaders={Origin:origin,Cookie:admin.cookieName+"="+admin.cookieValue},bobHeaders={Origin:origin,Cookie:bob.cookieName+"="+bob.cookieValue};
 try{
  assert.equal((await anonymous.get("/api/posts")).status(),401);
  const session=await request.post("/api/upload-sessions",{data:{}});assert.equal(session.status(),201);const {token}=await session.json();
  const bytes=await sharp({create:{width:30,height:20,channels:3,background:"blue"}}).jpeg().toBuffer();
  const headers={Authorization:"Bearer "+token,"Idempotency-Key":randomUUID()};
  const multipart={file:{name:"discard.jpg",mimeType:"image/jpeg",buffer:bytes}};
  const first=await request.post("/api/images/uploads",{headers,multipart});assert.equal(first.status(),201);const asset=await first.json();assets.push(asset.id);
  assert.equal((await request.post("/api/images/uploads",{headers,multipart})).status(),200);
  assert.equal((await request.get(asset.url)).status(),404);
  assert.equal((await request.post("/api/images/uploads",{headers:{...headers,...bobHeaders},multipart})).status(),401);
  checks.push("upload/retry/session-ownership");
  const data={title:prefix,uploadSessionToken:token,document:{version:1,type:"doc",content:[{type:"paragraph",content:[{type:"text",text:"서식 본문"}]},{type:"image",attrs:{assetId:asset.id,alt:"검증"}}]}};
  const created=await request.post("/api/posts",{data});assert.equal(created.status(),201);const post=await created.json();ids.push(post.id);
  const image=await request.get(asset.url);assert.equal(image.status(),200);assert.equal(image.headers()["cache-control"],"private,no-store");
  assert.equal((await request.get(asset.url,{headers:{"If-None-Match":image.headers().etag}})).status(),304);
  assert.equal((await anonymous.get(asset.url,{headers:{"If-None-Match":image.headers().etag}})).status(),401);
  assert.equal((await anonymous.head(asset.url)).status(),401);
  assert.equal((await request.patch("/api/posts/"+post.id,{headers:bobHeaders,data:{title:prefix,content:"침해"}})).status(),403);
  assert.equal((await request.patch("/api/posts/"+post.id,{headers:adminHeaders,data:{title:prefix,document:data.document}})).status(),403);
  const changed=await request.patch("/api/posts/"+post.id,{data:{title:prefix+" updated",document:data.document}});assert.equal(changed.status(),200);
  assert.equal((await changed.json()).createdAt,post.createdAt);checks.push("post/ownership/retained-image/date");
  assert.equal((await request.delete("/api/admin/posts/"+post.id,{headers:adminHeaders,data:{confirm:false}})).status(),400);
  assert.equal((await request.delete("/api/admin/posts/"+post.id,{headers:adminHeaders,data:{confirm:true}})).status(),204);
  assert.equal((await request.get(asset.url,{headers:{"If-None-Match":image.headers().etag}})).status(),404);
  checks.push("admin/consent/outbox");
  await runMediaCleanup(pool,store,{assetIds:assets});
  const row=(await pool.request().input("id",sql.UniqueIdentifier,asset.id).query("SELECT state,charge_bytes FROM dbo.image_assets WHERE id=@id")).recordset[0];
  assert.equal(row.state,"soft_deleted");assert.ok(Number(row.charge_bytes)>0);checks.push("cleanup/retention-accounting");
  const state=await request.storageState(),cookie=state.cookies.find(c=>c.name.endsWith("board_session"));assert.ok(cookie);
  assert.equal((await request.post("/api/auth/logout")).status(),204);
  assert.equal((await request.get("/api/posts",{headers:{Cookie:cookie.name+"="+cookie.value}})).status(),401);checks.push("logout/replay-denied");
  return {checks};
 }finally{
  for(const id of ids){
   const row=(await pool.request().input("id",sql.BigInt,id).query("SELECT title,author_tenant_id,author_object_id FROM dbo.posts WHERE id=@id")).recordset[0];
   if(row&&row.title.startsWith(prefix)&&row.author_tenant_id.toLowerCase()===principal.tenantId&&row.author_object_id.toLowerCase()===principal.objectId)
    assert.equal((await request.delete("/api/admin/posts/"+id,{headers:adminHeaders,data:{confirm:true}})).status(),204);
  }
  if(assets.length)await runMediaCleanup(pool,store,{assetIds:assets});
 }
}
