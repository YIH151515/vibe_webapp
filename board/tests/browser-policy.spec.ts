import {test,expect} from "./helpers/client-fixture";
test("HTML policies cover login/errors, ignore injected nonce and differ per request",async({request,page})=>{
 const nonces:string[]=[];
 for(const path of ["/login","/missing-security-page","/posts/new"]){
  const r=await request.get(path,{headers:{"x-nonce":"attacker","Content-Security-Policy":"script-src *"}});
  const csp=r.headers()["content-security-policy"];expect(csp).toContain("frame-ancestors 'none'");expect(csp).not.toContain("attacker");
  const nonce=/nonce-([^']+)/.exec(csp)![1];nonces.push(nonce);
  expect(r.headers()["x-frame-options"]).toBe("DENY");expect(r.headers()["strict-transport-security"]).toBe("max-age=31536000");
  expect(r.headers()["x-content-type-options"]).toBe("nosniff");expect(r.headers()["referrer-policy"]).toBe("strict-origin-when-cross-origin");expect(r.headers()["x-powered-by"]).toBeUndefined();
 }
 expect(new Set(nonces).size).toBe(nonces.length);
 await page.route("**/login",async route=>{const response=await route.fetch();const body=(await response.text()).replace("</head>","<script>window.__untrustedParserScript=1</script></head>");await route.fulfill({response,body});},{times:1});
 await page.goto("/login");
 await page.unrouteAll({behavior:"wait"});
 expect(await page.evaluate(()=>Reflect.get(window,"__untrustedParserScript"))).toBeUndefined();
 // A fresh embedding document has no CSP of its own, so the target must defend itself.
 const embedding=await page.context().newPage();
 const framed=embedding.waitForResponse(r=>r.url()==="http://127.0.0.1:3100/login");
 await embedding.setContent('<iframe src="http://127.0.0.1:3100/login"></iframe>');await framed;
 expect(await embedding.frameLocator("iframe").getByRole("button",{name:"회사 계정으로 로그인"}).count()).toBe(0);
 await embedding.close();
});
