import { test, expect } from "./helpers/client-fixture";
import { getDatabase } from "../src/lib/server/database";
import { createBlobStore } from "../src/lib/server/blob-store";
import { verifyAuthenticatedApi } from "./helpers/authenticated-live-check";
test("live-api authenticated QA preserves media lifecycle and logout denial", async ({request,playwright,principal,baseURL})=>{
 test.setTimeout(180000);const anonymous=await playwright.request.newContext({baseURL,storageState:{cookies:[],origins:[]}});
 try{const result=await verifyAuthenticatedApi({pool:await getDatabase(),store:createBlobStore(process.env),request,anonymous,principal});
 expect(result.checks).toContain("logout/replay-denied");expect(result.checks).toContain("cleanup/retention-accounting");}finally{await anonymous.dispose();}
});
