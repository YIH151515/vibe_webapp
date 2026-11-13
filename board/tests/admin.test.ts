import assert from "node:assert/strict";
import {test} from "node:test";
import {loginAdmin,getAdminSession,revokeAdminSession,deletePostAsAdmin} from "../src/lib/server/admin";
import {sqlFixture} from "./helpers/sql-fixture";
import {hashPassword} from "../src/lib/server/password";
test("admin session survives connections, rejects tampering, expires and revokes",async()=>{
 const f=await sqlFixture();try{
 const now=new Date(),result=await loginAdmin(f.pool,"admin-test-password",now);
 const other=await f.reopen();try{assert.ok(await getAdminSession(other,result.cookieValue,now));}finally{await other.close();}
 assert.equal(await getAdminSession(f.pool,result.cookieValue+"x",now),null);
 assert.equal(await getAdminSession(f.pool,result.cookieValue.slice(1),now),null);
 assert.equal(await getAdminSession(f.pool,result.cookieValue,new Date(now.getTime()+3601000)),null);
 const previous=process.env.ADMIN_SESSION_SECRET;
 try{process.env.ADMIN_SESSION_SECRET="a".repeat(64);assert.equal(await getAdminSession(f.pool,result.cookieValue,now),null);}finally{process.env.ADMIN_SESSION_SECRET=previous;}
 const previousHash=process.env.ADMIN_PASSWORD_HASH;
 try{process.env.ADMIN_PASSWORD_HASH=await hashPassword("replacement-admin-password");assert.equal(await getAdminSession(f.pool,result.cookieValue,now),null);}finally{process.env.ADMIN_PASSWORD_HASH=previousHash;}
 await revokeAdminSession(f.pool,result.cookieValue);
 assert.equal(await getAdminSession(f.pool,result.cookieValue,now),null);
 await assert.rejects(loginAdmin(f.pool,"wrong-password"),{code:"UNAUTHENTICATED"});
 const post=await f.service.create({title:"관리자 삭제",content:"본문",nickname:"작성자",password:"author-password"});
 await deletePostAsAdmin(f.pool,post.id);
 await assert.rejects(f.service.get(post.id),{code:"NOT_FOUND"});
 }finally{await f.close();}
});
