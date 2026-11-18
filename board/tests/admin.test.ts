import assert from "node:assert/strict";
import {test} from "node:test";
import {deletePostAsAdmin} from "../src/lib/server/admin";
import {sqlFixture} from "./helpers/sql-fixture";
import {createTestActor,createTestSession} from "./helpers/auth-fixture";
import {revokeAppSession} from "../src/lib/server/auth-session";
test("Board.Admin requires a current SQL session and deletion revokes after logout",async()=>{
 const f=await sqlFixture();try{
 const admin=(await createTestSession(f.pool,createTestActor({isAdmin:true}))).principal;
 const post=await f.service.create({title:"관리자 삭제",content:"본문"},f.context);
 await assert.rejects(deletePostAsAdmin(f.pool,post.id,f.principal),{code:"FORBIDDEN"});
 await deletePostAsAdmin(f.pool,post.id,admin);
 await assert.rejects(f.service.get(post.id,f.principal),{code:"NOT_FOUND"});
 await revokeAppSession(f.pool,admin);
 await assert.rejects(deletePostAsAdmin(f.pool,post.id,admin),{code:"UNAUTHENTICATED"});
 }finally{await f.close();}
});
