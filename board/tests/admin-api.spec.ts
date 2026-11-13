import {test,expect} from "./helpers/client-fixture";
import {seedPosts} from "./helpers/sql-fixture";
import {closeDatabase} from "../src/lib/server/database";
test.afterAll(()=>closeDatabase());
const origin="http://127.0.0.1:3100";
test("admin permissions, consent, cookie attributes and logout",async({request})=>{
 const [post]=await seedPosts([{title:"삭제 검증",content:"본문",nickname:"작성자",password:"author-password"}]);
 const path="/api/admin/posts/"+post.id;
 expect((await request.delete(path,{headers:{Origin:origin},data:{confirm:true}})).status()).toBe(401);
 expect((await request.post("/api/admin/login",{data:{password:"admin-test-password"}})).status()).toBe(403);
 const login=await request.post("/api/admin/login",{headers:{Origin:origin},data:{password:"admin-test-password"}});
 expect(login.status()).toBe(200);
 const cookie=login.headers()["set-cookie"];
 expect(cookie).toContain("HttpOnly");expect(cookie).toContain("SameSite=strict");expect(cookie).toContain("Path=/");
 expect((await request.get("/api/admin/session")).status()).toBe(200);
 expect((await request.delete(path,{headers:{Origin:origin},data:{confirm:false}})).status()).toBe(400);
 expect((await request.delete(path,{headers:{Origin:origin},data:{confirm:true}})).status()).toBe(204);
 expect((await request.delete(path,{headers:{Origin:origin},data:{confirm:true}})).status()).toBe(404);
 expect((await request.post("/api/admin/logout",{headers:{Origin:origin}})).status()).toBe(204);
 expect((await request.get("/api/admin/session",{headers:{Cookie:cookie.split(";")[0]}})).status()).toBe(401);
});
test("admin login blocks the sixth wrong password",async({request})=>{
 for(let i=0;i<5;i++)expect((await request.post("/api/admin/login",{headers:{Origin:origin},data:{password:"incorrect-password"}})).status()).toBe(401);
 const blocked=await request.post("/api/admin/login",{headers:{Origin:origin},data:{password:"admin-test-password"}});
 expect(blocked.status()).toBe(429);expect(Number(blocked.headers()["retry-after"])).toBeGreaterThan(0);
});
