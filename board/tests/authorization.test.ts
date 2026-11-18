import assert from "node:assert/strict";
import { test } from "node:test";
import sql from "mssql";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { sqlFixture } from "./helpers/sql-fixture";
import { mediaFixture } from "./helpers/media-fixture";
import { createTestActor, createTestSession } from "./helpers/auth-fixture";
import { getAccountKey } from "../src/lib/server/auth-principal";
import { revokeAppSession } from "../src/lib/server/auth-session";
import { deletePostAsAdmin } from "../src/lib/server/admin";
import { issueUploadSession, readUploadSession } from "../src/lib/server/upload-sessions";
import { createMediaService } from "../src/lib/server/media-service";
import { FakeBlobStore } from "./helpers/fake-blob-store";
import { withRateLimit } from "../src/lib/server/rate-limit";
const input={title:"계정 글",content:"본문"};
test("accounts enforce owner/admin/legacy boundaries and reject forged principal flags",async()=>{
 const f=await sqlFixture();
 try{
  const bob=(await createTestSession(f.pool,createTestActor({displayName:f.principal.displayName}))).principal;
  const admin=(await createTestSession(f.pool,createTestActor({isAdmin:true}))).principal;
  const post=await f.service.create(input,f.context);
  assert.equal((await f.service.get(post.id,bob)).canEdit,false);
  assert.equal((await f.service.get(post.id,admin)).canDelete,true);
  for(const principal of [bob,admin])await assert.rejects(f.service.update(post.id,input,{principal,clientKey:getAccountKey(principal)}),{code:"FORBIDDEN"});
  await assert.rejects(f.service.remove(post.id,{confirm:true},bob),{code:"FORBIDDEN"});
  await assert.rejects(deletePostAsAdmin(f.pool,post.id,{...bob,isAdmin:true}),{code:"FORBIDDEN"});
  const legacy=(await f.pool.request().query("INSERT dbo.posts(title,content,nickname,password_hash) OUTPUT inserted.id VALUES(N'기존글',N'보존',N'이전 작성자','legacy-hash')")).recordset[0];
  assert.equal((await f.service.get(Number(legacy.id),f.principal)).canEdit,false);
  await assert.rejects(f.service.update(Number(legacy.id),input,f.context),{code:"FORBIDDEN"});
  await assert.rejects(f.service.remove(Number(legacy.id),{confirm:true},f.principal),{code:"FORBIDDEN"});
  await deletePostAsAdmin(f.pool,Number(legacy.id),admin);
  await deletePostAsAdmin(f.pool,post.id,admin);
 }finally{await f.close();}
});
test("Entra display names of length 1,21,256 and changed names retain object ownership",async()=>{
 const f=await sqlFixture();
 try{for(const length of [1,21,256]){
  const actor=createTestActor({displayName:"가".repeat(length)}), first=await createTestSession(f.pool,actor);
  const ctx={principal:first.principal,clientKey:getAccountKey(first.principal)};
  const post=await f.service.create(input,ctx);assert.equal(post.nickname.length,length);
  const second=await createTestSession(f.pool,{...actor,displayName:"변경된 이름"});
  assert.equal(getAccountKey(first.principal),getAccountKey(second.principal));
  const updated=await f.service.update(post.id,{...input,title:"수정"},{principal:second.principal,clientKey:getAccountKey(second.principal)});
  assert.equal(updated.nickname,post.nickname);assert.equal(updated.createdAt,post.createdAt);
  await revokeAppSession(f.pool,first.principal);
  await assert.rejects(f.service.get(post.id,first.principal),{code:"UNAUTHENTICATED"});
  assert.equal((await f.service.get(post.id,second.principal)).canEdit,true);
 }}finally{await f.close();}
});
test("upload tokens bind to account and app session; logout racing Blob put never revives ready",async()=>{
 const f=await mediaFixture(),store=new FakeBlobStore(); let release!:()=>void;
 try{
  const token=(await issueUploadSession(f.pool,f.principal,{})).token;
  const sameAccount=(await createTestSession(f.pool,f.principal)).principal;
  await assert.rejects(readUploadSession(f.pool,token,sameAccount),{code:"UNAUTHENTICATED"});
  let entered!:()=>void;const started=new Promise<void>(r=>entered=r),gate=new Promise<void>(r=>release=r);
  store.beforeOperation=async op=>{if(op==="put"){entered();await gate;}};
  const bytes=await sharp({create:{width:20,height:20,channels:3,background:"red"}}).jpeg().toBuffer();
  const body=new FormData();body.set("file",new Blob([Uint8Array.from(bytes)],{type:"image/jpeg"}),"private.jpg");
  const work=createMediaService(f.pool,store).uploadImage(new Request("http://localhost/api/images/uploads",{method:"POST",body,headers:{Authorization:"Bearer "+token,"Idempotency-Key":randomUUID()}}),f.principal);
  const rejected=assert.rejects(work,{code:"UNAUTHENTICATED"});
  await started;await revokeAppSession(f.pool,f.principal);release();await rejected;
  assert.equal((await f.pool.request().query("SELECT COUNT(*) n FROM dbo.image_assets WHERE state='ready'")).recordset[0].n,0);
  assert.equal((await f.pool.request().query("SELECT COUNT(*) n FROM dbo.image_delete_jobs")).recordset[0].n,1);
 }finally{release?.();await f.close();}
});
test("account budgets span sessions, separate accounts, and SQL role revocation is immediate",async()=>{
 const f=await sqlFixture();try{
  const same=(await createTestSession(f.pool,f.principal)).principal, bob=(await createTestSession(f.pool,createTestActor())).principal;
  for(let i=0;i<5;i++)await withRateLimit(f.pool,"post-create",getAccountKey(f.principal),async()=>true);
  await assert.rejects(withRateLimit(f.pool,"post-create",getAccountKey(same),async()=>true),{code:"RATE_LIMITED"});
  await withRateLimit(f.pool,"post-create",getAccountKey(bob),async()=>true);
  const admin=(await createTestSession(f.pool,createTestActor({isAdmin:true}))).principal, post=await f.service.create(input,f.context);
  await f.pool.request().input("sid",sql.Char(64),admin.sessionHash).query("UPDATE dbo.auth_sessions SET is_admin=0 WHERE id_hash=@sid");
  await assert.rejects(deletePostAsAdmin(f.pool,post.id,admin),{code:"FORBIDDEN"});
  await revokeAppSession(f.pool,f.principal);await assert.rejects(f.service.create(input,f.context),{code:"UNAUTHENTICATED"});
 }finally{await f.close();}
});

test("concurrent attachment and deletion leave no orphan attachment or revived draft",async()=>{
 const f=await mediaFixture();try{
  const post=await (await import("../src/lib/server/posts")).createPostService(f.pool).create(input,f.context);
  const session=await issueUploadSession(f.pool,f.principal,{postId:post.id});
  const bytes=await sharp({create:{width:20,height:20,channels:3,background:"red"}}).jpeg().toBuffer();
  const body=new FormData();body.set("file",new Blob([Uint8Array.from(bytes)],{type:"image/jpeg"}),"private.jpg");
  const {asset}=await createMediaService(f.pool,f.store).uploadImage(new Request("http://localhost/api/images/uploads",{method:"POST",body,headers:{Authorization:"Bearer "+session.token,"Idempotency-Key":randomUUID()}}),f.principal);
  const service=(await import("../src/lib/server/posts")).createPostService(f.pool);
  const results=await Promise.allSettled([
   service.update(post.id,{title:post.title,uploadSessionToken:session.token,document:{version:1,type:"doc",content:[{type:"image",attrs:{assetId:asset.id,alt:"첨부"}}]}},f.context),
   service.remove(post.id,{confirm:true},f.principal),
  ]);
  assert.equal(results[1].status,"fulfilled");
  assert.equal((await f.pool.request().query("SELECT COUNT(*) n FROM dbo.image_assets a LEFT JOIN dbo.posts p ON p.id=a.post_id WHERE a.state='attached' AND p.id IS NULL")).recordset[0].n,0);
  assert.equal((await f.pool.request().query("SELECT state FROM dbo.image_assets")).recordset[0].state,"deleting");
 }finally{await f.close();}
});
