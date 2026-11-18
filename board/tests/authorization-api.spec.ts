import {test,expect} from "./helpers/client-fixture";
test("all content routes reject missing sessions before parsing and ignore injected identities",async({playwright,baseURL})=>{
 const anonymous=await playwright.request.newContext({baseURL,storageState:{cookies:[],origins:[]},extraHTTPHeaders:{Origin:baseURL!,"X-MS-CLIENT-PRINCIPAL":"forged",Cookie:"board_admin=forged"}});
 try{
  for(const path of ["/api/posts","/api/posts/1","/api/editor-config","/api/images/invalid","/api/admin/session"]){const response=await anonymous.get(path);expect(response.status()).toBe(401);expect(response.headers()["cache-control"]).toBe("no-store");}
  for(const path of ["/api/posts","/api/images/uploads","/api/upload-sessions","/api/admin/login"]){expect((await anonymous.post(path,{data:{}})).status()).toBe(401);}
  expect((await anonymous.patch("/api/posts/1",{data:{}})).status()).toBe(401);
  expect((await anonymous.delete("/api/posts/1",{data:{confirm:true}})).status()).toBe(401);
  const head=await anonymous.head("/api/images/invalid");expect(head.status()).toBe(401);expect((await head.body()).length).toBe(0);
 }finally{await anonymous.dispose();}
});
test("identity injection and absent Origin are rejected for authenticated writes",async({request})=>{
 for(const field of ["nickname","password","author_tenant_id","author_object_id","isAdmin"]){expect((await request.post("/api/posts",{data:{title:"위조",content:"본문",[field]:"forged"}})).status()).toBe(400);}
 expect((await request.post("/api/posts",{headers:{Origin:""},data:{title:"제목",content:"본문"}})).status()).toBe(403);
});
