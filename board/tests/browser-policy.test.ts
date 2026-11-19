import assert from "node:assert/strict";
import { test } from "node:test";
import { randomBytes } from "node:crypto";
import { contentSecurityPolicy, securityHeaders } from "../src/lib/security-headers";
test("production CSP allows only nonce scripts and keeps editor images/styles usable",()=>{
 const nonce=randomBytes(32).toString("base64"),csp=contentSecurityPolicy(nonce,false);
 const script=csp.split(";").find(d=>d.trim().startsWith("script-src "))!;
 assert.ok(script.includes(`'nonce-${nonce}'`)&&script.includes("'strict-dynamic'"));
 assert.ok(!script.includes("unsafe-inline")&&!script.includes("unsafe-eval"));
 assert.ok(csp.includes("img-src 'self' blob: data:")&&csp.includes("frame-ancestors 'none'"));
 assert.ok(contentSecurityPolicy(nonce,true).includes("'unsafe-eval'"));
  assert.ok(csp.includes("form-action 'self' https://login.microsoftonline.com"));
  assert.throws(()=>contentSecurityPolicy(nonce,false,"https://attacker.invalid"));
  assert.throws(()=>contentSecurityPolicy(nonce,false,"http://127.0.0.1:1234"));
 for(const value of ["",nonce+"\n","attacker'; script-src *", "a".repeat(43)])assert.throws(()=>contentSecurityPolicy(value,false));
 assert.equal(securityHeaders.find(h=>h.key==="X-Frame-Options")?.value,"DENY");
 assert.equal(securityHeaders.find(h=>h.key==="Strict-Transport-Security")?.value,"max-age=31536000");
});
