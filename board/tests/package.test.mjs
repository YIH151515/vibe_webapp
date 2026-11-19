import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { createServer } from "node:net";
import { once } from "node:events";
import { chromium } from "@playwright/test";

test("release ZIP runs independently, serves assets and fails health safely without SQL", { timeout: 60000 }, async () => {
  const zip = resolve(".deploy/board.zip");
  const names = execFileSync("unzip", ["-Z1", zip], { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 }).trim().split("\n");
  for (const file of ["server.js", "package.json"]) assert.ok(names.includes(file));
  assert.ok(names.some(name => name.startsWith("node_modules/")));
  assert.ok(names.some(name => name.startsWith(".next/static/") && name.endsWith(".css")));
  for (const name of names) {
    assert.ok(!name.startsWith("/") && !name.split("/").includes(".."));
    assert.ok(!/(^|\/)(\.env[^/]*|\.git|\.memory)(\/|$)|\.(sqlite(?:-[^/]*)?|pem|key|pfx|p12)$/i.test(name), name);
    assert.ok(!/^(src|scripts|data|tests|sql)\//.test(name), name);
  }
  const manifest = JSON.parse(await readFile(".deploy/release.json", "utf8"));
  assert.equal(manifest.sha256, createHash("sha256").update(await readFile(zip)).digest("hex"));
  assert.match(manifest.commit, /^[a-f0-9]{40}$/); assert.equal(manifest.nodeMajor, 24);
  const temp = await mkdtemp(join(tmpdir(), "board-package-test-"));
  let child;
  try {
    execFileSync("unzip", ["-q", zip, "-d", temp]);
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(AUTH_|ENTRA_|TEST_OIDC_|SQL_|ADMIN_|APP_|RATE_LIMIT_|MEDIA_|STORAGE_|AZURITE_|EDITOR_|AZURE_)/.test(key)));
    execFileSync(process.execPath, ["-e", `
      const assert = require('node:assert/strict');
      const sharp = require('sharp');
      import('openid-client').then(client => assert.equal(typeof client.discovery,'function')).catch(() => {process.exitCode=1;});
      assert.equal(typeof require('@azure/storage-blob').BlobServiceClient, 'function');
      assert.equal(typeof require('@azure/identity').ManagedIdentityCredential, 'function');
      sharp({create:{width:1,height:1,channels:4,background:'transparent'}}).png().toBuffer()
        .then(png => sharp(png).webp().toBuffer()).then(async bytes => {
          assert.equal((await sharp(bytes).metadata()).format, 'webp');
        }).catch(() => { process.exitCode = 1; });
    `], { cwd: temp, env, stdio: "pipe", timeout: 15000 });
    const reservation = createServer().listen(0, "127.0.0.1");
    await once(reservation, "listening"); const port = reservation.address().port;
    await new Promise(done => reservation.close(done));
    child = spawn(process.execPath, ["server.js"], { cwd: temp, env: { ...env, WEBSITE_INSTANCE_ID: "package-check", MEDIA_CLEANUP_ENABLED: "0", HOSTNAME: "0.0.0.0", PORT: String(port) }, stdio: "ignore" });
    const base = `http://127.0.0.1:${port}`;
    let response;
    for (let i = 0; i < 100; i++) {
      try { response = await fetch(base+"/login"); if (response.status === 200) break; } catch {}
      await new Promise(done => setTimeout(done, 200));
    }
    assert.equal(response?.status, 200);
    const html = await response.text();
    const csp=response.headers.get("content-security-policy"),nonce=/nonce-([^']+)/.exec(csp)[1];
    assert.ok(!csp.includes("unsafe-eval"));
    assert.ok(csp.includes("frame-ancestors 'none'"));
    assert.equal(response.headers.get("x-frame-options"),"DENY");
    assert.equal(response.headers.get("strict-transport-security"),"max-age=31536000");
    for(const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)){
      if(script[1].includes('type="application/ld+json"'))continue;
      assert.ok(script[1].includes('nonce="'+nonce+'"'),"production-script-nonce");
    }
    const browser=await chromium.launch({headless:true});
    try{
      const context=await browser.newContext({serviceWorkers:"block"}),page=await context.newPage();
      await page.route(base+"/login",async route=>{const response=await route.fetch();const body=(await response.text()).replace("</head>","<script>window.__untrustedParserScript=1</script></head>");await route.fulfill({response,body});},{times:1});
      await page.goto(base+"/login");
      await page.unrouteAll({behavior:"wait"});
      assert.equal(await page.evaluate(()=>window.__untrustedParserScript),undefined);
      // The SQL-free maintenance login button is intentionally disabled. A Next Link
      // client navigation (RSC request) proves real hydration without any credentials.
      const clicked=page.waitForRequest(r=>new URL(r.url()).origin===base&&new URL(r.url()).pathname==="/"&&r.headers().rsc==="1");
      await page.locator("a.brand").click();await clicked;
      const formPage=await context.newPage();await formPage.goto(base+"/login");
      // A native POST must retain Origin; global no-referrer would make it null
      // and break the real login's strict CSRF check. Never send this stub to SQL.
      let postOrigin;
      await formPage.route(base+"/api/auth/login",async route=>{postOrigin=route.request().headers().origin;await route.fulfill({status:400,body:"synthetic-form-check"});},{times:1});
      const submitted=formPage.waitForResponse(r=>r.url()===base+"/api/auth/login"&&r.request().method()==="POST");
      await formPage.evaluate(()=>{const form=document.createElement("form");form.method="POST";form.action="/api/auth/login";document.body.append(form);form.requestSubmit();});
      await submitted;await formPage.unrouteAll({behavior:"wait"});assert.equal(postOrigin,base,"native-login-post-origin");
      const embedding=await context.newPage(),framed=embedding.waitForResponse(r=>r.url()===base+"/login");
      await embedding.setContent('<iframe src="'+base+'/login"></iframe>');await framed;
      assert.equal(await embedding.frameLocator("iframe").getByRole("button",{name:"회사 계정으로 로그인"}).count(),0);
      await embedding.close();
    }finally{await browser.close();}
    const css = html.match(/href="([^" ]+\.css(?:\?[^" ]*)?)"/);
    assert.ok(css); assert.equal((await fetch(new URL(css[1].replaceAll("&amp;", "&"), base))).status, 200);
    const health = await fetch(base + "/api/health");
    assert.equal(health.status, 503); assert.equal(health.headers.get("cache-control"), "no-store");
    assert.deepEqual(await health.json(), { status: "unavailable" });
    const editorConfig = await fetch(base + "/api/editor-config");
    assert.equal(editorConfig.status, 503); assert.equal(editorConfig.headers.get("cache-control"), "no-store");
    assert.equal((await editorConfig.json()).error.code,"SERVICE_UNAVAILABLE");
    assert.equal((await fetch(base)).status, 503);
    assert.equal((await fetch(base+"/api/posts")).status,503);
    assert.equal((await fetch(base+"/api/images/invalid")).status,503);
    assert.ok(!html.includes("글 등록"));
  } finally {
    if (child && child.exitCode === null) { const exited = once(child, "exit"); child.kill("SIGTERM"); await exited; }
    await rm(temp, { recursive: true, force: true });
  }
});
