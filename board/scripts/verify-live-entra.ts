import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import sql, { type ConnectionPool } from "mssql";
import sharp from "sharp";
import { chromium, expect, type BrowserContext } from "@playwright/test";
import { AzureCliCredential } from "@azure/identity";
import { ContainerClient } from "@azure/storage-blob";
import { assertTestOidc } from "../src/lib/server/auth-config";
import { openDatabase, readSqlConfig } from "../src/lib/server/database";
import { createBlobStore, mediaStoragePipeline, type BlobStore } from "../src/lib/server/blob-store";
import { runMediaCleanup } from "../src/lib/server/media-cleanup";
import { verifyImageAccess } from "./verify-image-access";
import type { Post } from "../src/lib/posts/types";
import type { SessionDto } from "../src/lib/auth/types";
export type LiveEntraInput={url:string;expectedCommit:string;allowQaWrites:boolean;expectAdmin:boolean;qaProfile?:"local-smoke"|"production-full"};
type Asset={id:string;blob_name:string;state:string;charge_bytes:string;purge_after:Date|null};
const productionUrl="https://app-vibe-board-prod-7b1417.azurewebsites.net";
function checkedOrigin(url:string){
 if(url===productionUrl||url==="http://127.0.0.1:3200")return url;
 assertTestOidc(process.env);assert.equal(url,"http://127.0.0.1:3100");return url;
}
export async function verifyLiveEntra(input:LiveEntraInput,deps:{context:BrowserContext;operatorPool:ConnectionPool;store:BlobStore;restart:()=>Promise<void>}):Promise<{deployedCommit:string;checks:string[];remainingQaPostIds:number[];remainingQaAssetIds:string[]}>{
 const origin=checkedOrigin(input.url);assert.ok(/^[a-f0-9]{40}$/.test(input.expectedCommit)||origin.endsWith(":3100")&&input.expectedCommit==="local");
 const request=deps.context.request,pool=deps.operatorPool,checks:string[]=[],prefix="[entra-check:"+randomUUID()+"]",owned=new Set<number>(),assets=new Map<string,Asset>(),tokens=new Set<string>();
 const cookie=(await deps.context.cookies(origin)).find(c=>c.name===(origin.startsWith("https:")?"__Host-board_session":"board_session"));assert.ok(cookie,"current-app-session-required");
 const sessionHash=createHash("sha256").update(cookie.value).digest("hex");
 const identity=(await pool.request().input("hash",sql.Char(64),sessionHash).input("origin",sql.NVarChar(256),origin).query<{tenant_id:string;object_id:string}>("SELECT tenant_id,object_id FROM dbo.auth_sessions WHERE id_hash=@hash AND app_origin COLLATE Latin1_General_100_BIN2=@origin AND revoked_at IS NULL AND expires_at>SYSUTCDATETIME()")).recordset[0];assert.ok(identity,"current-scoped-identity");
 const call=(path:string,method="GET",data?:unknown,headers:Record<string,string>={})=>request.fetch(origin+path,{method,headers:{Origin:origin,...headers},...(data===undefined?{}:{data}),maxRedirects:0,timeout:60000});
 const anonymous=(path:string,headers:Record<string,string>={})=>fetch(origin+path,{headers,redirect:"manual",signal:AbortSignal.timeout(20000)});
 async function health(){const response=await anonymous("/api/health");assert.equal(response.status,200,"health");assert.deepEqual(await response.json(),{status:"ok",version:input.expectedCommit});}
 async function reconcile(){
  const rows=(await pool.request().input("prefix",sql.NVarChar(100),prefix).input("tenant",sql.UniqueIdentifier,identity.tenant_id).input("owner",sql.UniqueIdentifier,identity.object_id)
   .query<{id:number}>("SELECT id FROM dbo.posts WHERE CHARINDEX(@prefix,title)=1 AND author_tenant_id=@tenant AND author_object_id=@owner")).recordset;
  for(const row of rows)owned.add(Number(row.id));
  for(const token of tokens){
   const hash=createHash("sha256").update(token).digest("hex");
   const rows=(await pool.request().input("hash",sql.Char(64),hash).input("sid",sql.Char(64),sessionHash).input("tenant",sql.UniqueIdentifier,identity.tenant_id).input("owner",sql.UniqueIdentifier,identity.object_id).query<Asset>(
    "SELECT a.id,a.blob_name,a.state,a.charge_bytes,a.purge_after FROM dbo.image_assets a JOIN dbo.upload_sessions u ON u.id=a.session_id WHERE u.token_hash=@hash AND u.auth_session_hash=@sid AND u.owner_tenant_id=@tenant AND u.owner_object_id=@owner")).recordset;
   for(const row of rows)assets.set(row.id.toLowerCase(),{...row,id:row.id.toLowerCase()});
  }
 }
 async function remove(id:number){
  const row=(await pool.request().input("id",sql.BigInt,id).query<{title:string;author_tenant_id:string;author_object_id:string}>("SELECT title,author_tenant_id,author_object_id FROM dbo.posts WHERE id=@id")).recordset[0];
  if(!row){owned.delete(id);return;}
  assert.ok(row.title.startsWith(prefix)&&row.author_tenant_id.toLowerCase()===identity.tenant_id.toLowerCase()&&row.author_object_id.toLowerCase()===identity.object_id.toLowerCase(),"owned-prefix-and-identity");
  const response=await call((input.expectAdmin?"/api/admin/posts/":"/api/posts/")+id,"DELETE",{confirm:true});assert.equal(response.status(),204,"own-QA-delete");owned.delete(id);
 }
 await health();assert.equal((await anonymous("/api/posts")).status,401,"anonymous-content-denied");
 const sessionResponse=await call("/api/auth/session");assert.equal(sessionResponse.status(),200);const session=await sessionResponse.json() as SessionDto;assert.equal(session.isAdmin,input.expectAdmin);
 checks.push("real-session/anonymous-denial");
 if(!input.allowQaWrites)return {deployedCommit:input.expectedCommit,checks,remainingQaPostIds:[],remainingQaAssetIds:[]};
 const page=await deps.context.newPage(),observations:Promise<void>[]=[],issues:string[]=[];
 page.on("response",response=>{
  const url=new URL(response.url());if(url.origin===origin&&url.pathname==="/api/upload-sessions"&&response.request().method()==="POST"&&response.status()===201){
   observations.push(response.json().then((data:{token?:unknown})=>{if(typeof data.token!=="string"||data.token.length!==64||!/^[a-f0-9]{64}$/.test(data.token))throw new Error();tokens.add(data.token);}).catch(()=>{issues.push("upload-observation");}));
  }
 });
 let primaryFailure=false,stage="browser-create";
 try{
  await page.goto(origin+"/posts/new");await expect(page.locator('input[type="password"],input[name="nickname"]')).toHaveCount(0);
  stage="browser-fill-title-body";
  await page.getByRole("textbox",{name:/^제목/}).fill(prefix+" 본문");const body=page.getByRole("textbox",{name:/^본문/});await body.fill("서식 QA 한글");await body.press("ControlOrMeta+a");await page.getByRole("button",{name:"굵게",exact:true}).click();
  const png=await sharp({create:{width:40,height:20,channels:4,background:{r:40,g:80,b:180,alpha:0.5}}}).png().toBuffer();
  stage="browser-select-image";
  await page.getByLabel("이미지 선택",{exact:true}).setInputFiles({name:"qa.png",mimeType:"image/png",buffer:png});
  stage="browser-submit-post";
  await page.getByRole("button",{name:"글 등록",exact:true}).click();await expect(page).toHaveURL(/\/posts\/\d+$/,{timeout:60000});
  const id=Number(new URL(page.url()).pathname.split("/").pop());owned.add(id);console.log("OWN_QA_POST",id);await Promise.all(observations);assert.equal(issues.length,0);await reconcile();assert.equal(assets.size,1,"single-initial-image");
  stage="created-post-and-private-image";
  const postResponse=await call("/api/posts/"+id);assert.equal(postResponse.status(),200);const post=await postResponse.json() as Post;assert.equal(post.canEdit,true);assert.equal(post.contentFormat,"rich_v1");
  await expect(page.locator(".rich-content strong")).toContainText("서식 QA");
  await expect(page.locator(".user-name")).toHaveText(session.displayName);
  for(const width of [1280,390]){await page.setViewportSize({width,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),"responsive-post-width");}
  for(const field of ["nickname","password","author_object_id"])assert.equal((await call("/api/posts/"+id,"PATCH",{title:prefix,content:"위조",[field]:"위조"})).status(),400,"identity-input-rejected");
  const first=[...assets.keys()][0],imagePath="/api/images/"+first,image=await call(imagePath);assert.equal(image.status(),200);assert.equal(image.headers()["cache-control"],"private,no-store");const etag=image.headers().etag,imageHash=createHash("sha256").update(await image.body()).digest("hex");
  assert.equal((await call(imagePath,"GET",undefined,{"If-None-Match":etag})).status(),304);assert.equal((await anonymous(imagePath,{"If-None-Match":etag})).status,401);
  assert.equal((await call(imagePath,"HEAD")).status(),200);
  assert.equal((await fetch(origin+imagePath,{method:"HEAD",signal:AbortSignal.timeout(20000)})).status,401,"anonymous-image-head-denied");
  if(origin===productionUrl){
   const client=new ContainerClient(process.env.STORAGE_BLOB_SERVICE_URL+"/board-images",mediaStoragePipeline(new AzureCliCredential()));await verifyImageAccess(client);
   const blobResponse=await fetch(client.url+"/"+assets.get(first)!.blob_name,{redirect:"manual",signal:AbortSignal.timeout(20000)});assert.ok([401,403,404,409].includes(blobResponse.status),"direct-blob-private");
  }
  checks.push("browser/rich-image/search/private-conditional-image");
  stage="search-and-update";
  const search=await call("/api/posts?q="+encodeURIComponent(prefix));assert.ok((await search.json()).items.some((p:{id:number})=>p.id===id));
  await page.goto(origin+"/posts/"+id+"/edit");await page.getByRole("textbox",{name:/^제목/}).fill(prefix+" 수정");
  for(const width of [1280,390]){await page.setViewportSize({width,height:844});await expect(page.getByRole("button",{name:"굵게",exact:true})).toBeVisible();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),"responsive-editor-width");}
  if(input.qaProfile!=="local-smoke")await page.getByLabel("이미지 선택",{exact:true}).setInputFiles({name:"qa-add.png",mimeType:"image/png",buffer:png});
  await page.getByRole("button",{name:"수정 저장",exact:true}).click();await expect(page).toHaveURL(new RegExp("/posts/"+id+"$"),{timeout:60000});await Promise.all(observations);await reconcile();assert.ok(assets.size<=(input.qaProfile==="local-smoke"?1:2));assert.ok(tokens.size<=(input.qaProfile==="local-smoke"?1:2));
  assert.equal((await (await call("/api/posts/"+id)).json() as Post).createdAt,post.createdAt);
  stage="restart-persistence";
  await deps.restart();let ready=false;for(let i=0;i<45;i++){try{await health();ready=true;break;}catch{await delay(2000);}}assert.ok(ready,"restart-health");
  assert.equal((await call("/api/auth/session")).status(),200,"restart-session");await page.reload();await expect(page.locator(".rich-content img")).toHaveCount(input.qaProfile==="local-smoke"?1:2);
  assert.equal(createHash("sha256").update(await (await call(imagePath)).body()).digest("hex"),imageHash,"restart-image-bytes");
  checks.push("restart/persistent-document-image-session/author-date");
  if(input.qaProfile!=="local-smoke"){
   await page.goto(origin+"/posts/"+id+"/edit");await page.getByRole("button",{name:"이미지 1 제거",exact:true}).click();await page.getByRole("button",{name:"수정 저장",exact:true}).click();await expect(page).toHaveURL(new RegExp("/posts/"+id+"$"));assert.equal((await call(imagePath)).status(),404,"detached-inaccessible");
  }
  stage="admin-consent";
  if(input.expectAdmin){
   assert.equal((await call("/api/admin/posts/"+id,"DELETE",{confirm:false})).status(),400);
   await page.goto(origin+"/admin");await page.getByRole("searchbox",{name:"관리자 검색"}).fill(prefix);await page.getByRole("button",{name:"검색",exact:true}).click();
   await page.getByRole("button",{name:"삭제 확인: "+prefix+" 수정",exact:true}).click();await expect(page.getByRole("button",{name:"삭제 실행"})).toBeDisabled();
   await page.getByRole("button",{name:"취소",exact:true}).click();
  }
  await remove(id);checks.push("admin/consent/delete");
 }catch(error){
  primaryFailure=true;console.error("LIVE_ENTRA_STAGE_FAILED",stage,error instanceof assert.AssertionError?"assertion":error instanceof Error&&error.name==="TimeoutError"?"timeout":"check-failed");
  // Fixed booleans/counts only: never log browser text, URLs, claims or response bodies.
  const current=new URL(page.url());
  console.log("LIVE_ENTRA_SAFE_DIAGNOSTICS",JSON.stringify({onCreatePage:current.origin===origin&&current.pathname==="/posts/new",titleFields:await page.getByRole("textbox",{name:/^제목/}).count(),bodyFields:await page.getByRole("textbox",{name:/^본문/}).count(),editorStatus:(await call("/api/editor-config")).status(),sessionStatus:(await call("/api/auth/session")).status()}));
 }
 finally{
  await Promise.all(observations);await reconcile();for(const id of [...owned]){try{await remove(id);}catch{issues.push("own-post-remains");}}
  for(const token of tokens){try{await call("/api/upload-sessions/current","DELETE",undefined,{Authorization:"Bearer "+token});}catch{}}
  await reconcile();
  if(assets.size){
   for(let i=0;i<65;i++){
    await runMediaCleanup(pool,deps.store,{assetIds:[...assets.keys()]});await reconcile();
    if([...assets.values()].every(a=>["soft_deleted","purged"].includes(a.state)))break;await delay(5000);
   }
   for(const asset of assets.values())if(asset.state==="soft_deleted")assert.ok(Number(asset.charge_bytes)>0&&asset.purge_after&&asset.purge_after.getTime()>Date.now()+6*86400000,"retention-charge-preserved");
   checks.push("owned-filter-cleanup/7-day-charge-retained");
  }
  const logout=await call("/api/auth/logout","POST");assert.equal(logout.status(),204);
  assert.equal((await call("/api/posts","GET",undefined,{Cookie:cookie.name+"="+cookie.value})).status(),401,"logout-replay-denied");
  for(const id of assets.keys())assert.equal((await call("/api/images/"+id)).status(),401);
  checks.push("logout/replay-denied");await page.close();
 }
 const remainingQaPostIds=[...owned],remainingQaAssetIds=[...assets.values()].filter(a=>!["soft_deleted","purged"].includes(a.state)).map(a=>a.id);
 for(const id of remainingQaPostIds)console.error("OWN_QA_POST_REMAINS",id);for(const id of remainingQaAssetIds)console.error("OWN_QA_ASSET_REMAINS",id);
 assert.ok(!primaryFailure&&issues.length===0&&remainingQaPostIds.length===0&&remainingQaAssetIds.length===0,"entra-QA-and-cleanup-complete");
 return {deployedCommit:input.expectedCommit,checks,remainingQaPostIds,remainingQaAssetIds};
}
export async function liveEntraMain(){
 const args=process.argv.slice(2),get=(key:string)=>args[args.indexOf(key)+1];
 const commit=get("--commit"),url=get("--url");assert.ok(args.includes("--commit")&&/^[a-f0-9]{40}$/.test(commit));checkedOrigin(url);
 assert.ok(!process.env.APP_TEST_MODE||process.env.APP_TEST_MODE==="0");process.loadEnvFile(".env.local");
 assert.equal(process.env.SQL_SERVER,"sql-vibe-board-7b1417.database.windows.net");assert.equal(process.env.SQL_DATABASE,"dbboardprod");
 assert.equal(process.env.STORAGE_AUTH_MODE,"azure-cli");assert.equal(process.env.STORAGE_BLOB_SERVICE_URL,"https://stvibeboardimg7b1417.blob.core.windows.net");
 const pool=await openDatabase(readSqlConfig(process.env,"migration"));
 let browserServer:Awaited<ReturnType<typeof chromium.launchServer>>|undefined,browser:Awaited<ReturnType<typeof chromium.connect>>|undefined;
 try{
  browserServer=await chromium.launchServer({headless:false,host:"127.0.0.1",args:["--start-maximized"]});
  browser=await chromium.connect(browserServer.wsEndpoint());const context=await browser.newContext({serviceWorkers:"block"});
  console.log("ENTRA_SIGN_IN_REQUIRED: 열린 브라우저에서 회사 계정 로그인과 MFA를 완료해 주세요. 최대 10분 동안 기다립니다.");
  const page=await context.newPage();await page.goto(url+"/login");await page.getByRole("button",{name:"회사 계정으로 로그인"}).click();
  if(process.platform==="win32"){
   const pid=browserServer.process().pid;assert.ok(Number.isInteger(pid));
   const command='Add-Type -TypeDefinition \'using System; using System.Runtime.InteropServices; public class BoardBrowserFocus { [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd,int nCmdShow); [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd); }\'; $window=(Get-Process -Id '+pid+').MainWindowHandle; if($window -ne 0){[void][BoardBrowserFocus]::ShowWindowAsync($window,9);[void][BoardBrowserFocus]::SetForegroundWindow($window)}';
   await promisify(execFile)("powershell.exe",["-NoProfile","-Command",command],{windowsHide:true}).catch(()=>{console.log("ENTRA_LOGIN_WINDOW_USE_TASKBAR");});
  }
  console.log("ENTRA_APP_LOGIN_BROWSER_READY");
  await page.waitForURL(u=>u.origin===url&&!u.pathname.startsWith("/login")&&!u.pathname.startsWith("/api/auth"),{timeout:600000});
  const result=await verifyLiveEntra({url,expectedCommit:commit,allowQaWrites:args.includes("--qa-writes"),expectAdmin:true,qaProfile:url===productionUrl?"production-full":"local-smoke"},{context,operatorPool:pool,store:createBlobStore(process.env),restart:async()=>{
   if(url!==productionUrl)return;
   await promisify(execFile)("powershell.exe",["-NoProfile","-Command","az webapp restart --subscription 7b1417d8-833d-4ba9-a5cd-d27c91a28b83 --resource-group rg-vibe-board-prod --name app-vibe-board-prod-7b1417 --output none --only-show-errors; if ($LASTEXITCODE -ne 0) { exit 1 }"],{windowsHide:true});
  }});console.log(JSON.stringify(result));
 }finally{await pool.close();await browser?.close();await browserServer?.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===resolve("scripts/verify-live-entra.ts"))void liveEntraMain().catch(()=>{console.error("LIVE_ENTRA_CHECK_FAILED: 로그인 상태 또는 자체 QA 정리를 확인해 주세요.");process.exitCode=1;});
