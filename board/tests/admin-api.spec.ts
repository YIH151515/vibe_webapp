import {test,expect} from "./helpers/client-fixture";
import {getDatabase} from "../src/lib/server/database";
import {createTestActor,createTestSession} from "./helpers/auth-fixture";
test("admin role, consent, retired password endpoints and session logout",async({request})=>{
 const created=await request.post("/api/posts",{data:{title:"삭제 검증",content:"본문"}});expect(created.status()).toBe(201);const post=await created.json(),path="/api/admin/posts/"+post.id;
 expect((await request.delete(path,{data:{confirm:true}})).status()).toBe(403);
 expect((await request.post("/api/admin/login",{data:{password:"admin-test-password"}})).status()).toBe(404);
 expect((await request.post("/api/admin/logout")).status()).toBe(404);
 const admin=await createTestSession(await getDatabase(),createTestActor({isAdmin:true})),headers={Cookie:admin.cookieName+"="+admin.cookieValue};
 expect((await request.get("/api/admin/session",{headers})).status()).toBe(200);
 expect((await request.delete(path,{headers,data:{confirm:false}})).status()).toBe(400);
 expect((await request.delete(path,{headers,data:{confirm:true}})).status()).toBe(204);
 expect((await request.delete(path,{headers,data:{confirm:true}})).status()).toBe(404);
 expect((await request.post("/api/auth/logout",{headers})).status()).toBe(204);
 expect((await request.get("/api/admin/session",{headers})).status()).toBe(401);
});
