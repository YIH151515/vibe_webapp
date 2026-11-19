import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile } from "node:fs/promises";
import sharp from "sharp";

const origin="https://app-vibe-board-prod-7b1417.azurewebsites.net",commit=process.argv[2];
assert.match(commit??"",/^[a-f0-9]{40}$/);
const checks=[];
let stage="public-headers",headless,server,browser,context,complete=false;
function headers(values,auth=false){
 assert.equal(values["strict-transport-security"],"max-age=31536000");
 assert.equal(values["x-frame-options"],"DENY");assert.equal(values["x-content-type-options"],"nosniff");
 assert.equal(values["referrer-policy"],auth?"no-referrer":"strict-origin-when-cross-origin");
 assert.ok(values["content-security-policy"]?.includes("frame-ancestors 'none'"));assert.ok(!values["x-powered-by"]);
}
function nonce(policy){
 const value=/nonce-([A-Za-z0-9+/]+=)/.exec(policy??"")?.[1];assert.ok(value);assert.equal(Buffer.from(value,"base64").length,32);
 const script=policy.split(";").find(d=>d.trim().startsWith("script-src "));
 assert.ok(script?.includes("'strict-dynamic'")&&!script.includes("unsafe-inline")&&!script.includes("unsafe-eval"));
 assert.ok(policy.includes("form-action 'self' https://login.microsoftonline.com"));return value;
}
async function anonymous(path){return fetch(origin+path,{redirect:"manual",signal:AbortSignal.timeout(20000)});}
try{
 const health=await anonymous("/api/health");assert.equal(health.status,200);headers(Object.fromEntries(health.headers));
 assert.deepEqual(await health.json(),{status:"ok",version:commit});
 const nonces=[];
 for(const [path,status] of [["/login",200],["/security-check-missing",404],["/api/posts",401],["/api/auth/session",401]]){
  const r=await anonymous(path);assert.equal(r.status,status);headers(Object.fromEntries(r.headers),path.startsWith("/api/auth/"));
  if(path==="/login"||status===404)nonces.push(nonce(r.headers.get("content-security-policy")));await r.body?.cancel();
 }
 const second=await anonymous("/login");nonces.push(nonce(second.headers.get("content-security-policy")));await second.body?.cancel();
 assert.equal(new Set(nonces).size,nonces.length);checks.push("health-version/headers/unique-production-nonces/anonymous-401");
 stage="parser-csp";headless=await chromium.launch({headless:true});
 const hc=await headless.newContext({serviceWorkers:"block"}),probe=await hc.newPage();
 await probe.route(origin+"/login",async route=>{const response=await route.fetch();const body=(await response.text()).replace("</head>","<script>window.__untrustedParserScript=1</script></head>");await route.fulfill({response,body});},{times:1});
 await probe.goto(origin+"/login");await probe.unrouteAll({behavior:"wait"});
 assert.equal(await probe.evaluate(()=>Reflect.get(window,"__untrustedParserScript")),undefined);
 await probe.waitForFunction(()=>typeof Reflect.get(window,"next")?.version==="string");
 stage="frame-policy";const embedding=await hc.newPage(),framed=embedding.waitForResponse(r=>r.url()===origin+"/login");
 await embedding.setContent('<iframe src="'+origin+'/login"></iframe>');await framed;
 assert.equal(await embedding.frameLocator("iframe").getByRole("button",{name:"회사 계정으로 로그인"}).count(),0);
 await headless.close();headless=undefined;checks.push("parser-inline-blocked/trusted-next-runtime/target-framing-blocked");

 stage="real-sign-in";server=await chromium.launchServer({headless:false,host:"127.0.0.1",args:["--start-maximized"]});
 browser=await chromium.connect(server.wsEndpoint());context=await browser.newContext({serviceWorkers:"block"});
 // Observe only directive names on our origin. Never retain callback URLs or text.
 await context.addInitScript(({origin})=>{if(location.origin===origin){Reflect.set(window,"__boardCspViolations",[]);addEventListener("securitypolicyviolation",event=>{if(event.disposition==="enforce")Reflect.get(window,"__boardCspViolations").push(event.effectiveDirective);});}},{origin});
 let attemptedContentWrite=false;
 await context.route("**/api/**",async route=>{
  const r=route.request(),p=new URL(r.url()).pathname;
  if(!["GET","HEAD","OPTIONS"].includes(r.method())&&/^\/api\/(?:posts|admin\/posts|upload-sessions|images\/uploads)(?:\/|$)/.test(p)){attemptedContentWrite=true;await route.abort();}else await route.continue();
 });
 const page=await context.newPage();await page.goto(origin+"/login");
 await page.waitForFunction(()=>typeof Reflect.get(window,"next")?.version==="string");
 assert.deepEqual(await page.evaluate(()=>Reflect.get(window,"__boardCspViolations")),[]);
 await page.getByRole("button",{name:"회사 계정으로 로그인"}).click();
 const pid=server.process().pid;assert.ok(Number.isInteger(pid));
 const focus='Add-Type -TypeDefinition \'using System; using System.Runtime.InteropServices; public class BoardSecurityFocus { [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd,int nCmdShow); [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd); }\'; $window=(Get-Process -Id '+pid+').MainWindowHandle; if($window -ne 0){[void][BoardSecurityFocus]::ShowWindowAsync($window,9);[void][BoardSecurityFocus]::SetForegroundWindow($window)}';
 if(process.platform==="win32")await promisify(execFile)("powershell.exe",["-NoProfile","-Command",focus],{windowsHide:true}).catch(()=>{});
 console.log("SECURITY_HARDENING_BROWSER_READY: 회사 계정 로그인과 MFA를 완료해 주세요.");
 await page.waitForURL(u=>u.origin===origin&&!u.pathname.startsWith("/login")&&!u.pathname.startsWith("/api/auth"),{timeout:600000});
 const get=path=>context.request.get(origin+path,{maxRedirects:0,timeout:20000});
 const sessionResponse=await get("/api/auth/session");assert.equal(sessionResponse.status(),200);const session=await sessionResponse.json();assert.equal(session.isAdmin,true);
 const cookie=(await context.cookies(origin)).find(c=>c.name==="__Host-board_session");assert.ok(cookie?.httpOnly&&cookie.secure&&cookie.sameSite==="Lax"&&cookie.path==="/");
 stage="authenticated-pages";
 for(const path of ["/","/posts/new","/admin"]){
  const r=await page.goto(origin+path);assert.equal(r.status(),200);headers(r.headers());nonce(r.headers()["content-security-policy"]);
  await page.waitForFunction(()=>typeof Reflect.get(window,"next")?.version==="string");
  await page.locator(".user-name").waitFor();assert.equal(await page.locator(".user-name").textContent(),session.displayName);
  if(path==="/posts/new"){
   stage="editor-preview";
   await page.getByRole("textbox",{name:/^제목/}).fill("[security-hardening-preview]");const body=page.getByRole("textbox",{name:/^본문/});await body.fill("저장하지 않는 보안 검증 초안");await body.press("ControlOrMeta+a");await page.getByRole("button",{name:"굵게",exact:true}).click();
   const png=await sharp({create:{width:40,height:20,channels:4,background:{r:40,g:80,b:180,alpha:0.5}}}).png().toBuffer();
   await page.getByLabel("이미지 선택",{exact:true}).setInputFiles({name:"preview.png",mimeType:"image/png",buffer:png});
   await page.locator(".editor-body img").waitFor();await page.waitForFunction(()=>document.querySelector(".editor-body img")?.naturalWidth>0);
   assert.ok(await page.locator(".editor-body strong").count());stage="authenticated-pages";
  }
  const violations=await page.evaluate(()=>Reflect.get(window,"__boardCspViolations"));assert.deepEqual(violations,[]);
 }
 const list=await get("/api/posts");assert.equal(list.status(),200);const data=await list.json(),id=data.items?.[0]?.id;
 if(Number.isSafeInteger(id)&&id>0){
  const detail=await get("/api/posts/"+id);assert.equal(detail.status(),200);let image;
  function visit(node){if(node?.type==="image"&&/^[a-f0-9-]{36}$/.test(node.attrs?.assetId??""))image??=node.attrs.assetId;for(const child of node?.content??[])visit(child);}
  visit((await detail.json()).document);
  if(image){const r=await get("/api/images/"+image);assert.equal(r.status(),200);assert.equal(r.headers()["cache-control"],"private,no-store");const anon=await anonymous("/api/images/"+image);assert.equal(anon.status,401);await anon.body?.cancel();}
 }
 assert.equal(attemptedContentWrite,false);checks.push("real-admin-SSO/pages/editor-format-blob-preview/no-CSP-violations/private-image/no-content-writes");
 stage="logout";
 const csrf=await context.request.post(origin+"/api/auth/logout",{headers:{Origin:"https://security-review.invalid"},timeout:20000});assert.equal(csrf.status(),403);assert.equal((await get("/api/auth/session")).status(),200);
 complete=true;
}catch{console.error("SECURITY_HARDENING_CHECK_FAILED",stage);process.exitCode=1;}
finally{
 if(context){try{
  const r=await context.request.post(origin+"/api/auth/logout",{headers:{Origin:origin},timeout:20000});assert.equal(r.status(),204);
  assert.equal((await context.request.get(origin+"/api/auth/session",{timeout:20000})).status(),401);checks.push("own-logout/replay-401");
 }catch{complete=false;process.exitCode=1;console.error("SECURITY_HARDENING_OWN_SESSION_CLEANUP_FAILED");}}
 await headless?.close();if(context)await context.unrouteAll({behavior:"wait"});await browser?.close();await server?.close();
 const result={commit,complete,checks};await writeFile(".deploy/security-hardening-verification.json",JSON.stringify(result,null,2)+"\n");console.log(JSON.stringify(result));
}
