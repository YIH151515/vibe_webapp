import sql from "mssql";
import {test,expect} from "./helpers/client-fixture";
import {getDatabase} from "../src/lib/server/database";
import {createBlobStore} from "../src/lib/server/blob-store";
import {verifyLiveEntra} from "../scripts/verify-live-entra";
test("live-api session verifier completes own browser QA and retention cleanup",async({context,principal,baseURL})=>{
 test.setTimeout(180000);const pool=await getDatabase();await pool.request().input("sid",sql.Char(64),principal.sessionHash).query("UPDATE dbo.auth_sessions SET is_admin=1 WHERE id_hash=@sid");
 const result=await verifyLiveEntra({url:baseURL!,expectedCommit:process.env.APP_VERSION??"local",allowQaWrites:true,expectAdmin:true,qaProfile:"local-smoke"},{context,operatorPool:pool,store:createBlobStore(process.env),restart:async()=>{}});
 expect(result.remainingQaPostIds).toEqual([]);expect(result.remainingQaAssetIds).toEqual([]);expect(result.checks).toContain("logout/replay-denied");
});
