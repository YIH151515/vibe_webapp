import {test,expect} from "./helpers/anonymous-fixture";
import sql from "mssql";
import sharp from "sharp";
import {getDatabase} from "../src/lib/server/database";
import {createTestActor,createTestSession} from "./helpers/auth-fixture";
import {seedPosts,seedLegacyPosts} from "./helpers/sql-fixture";
const origin="http://127.0.0.1:3100";
for(const width of [1280,390])test("real protocol login form and logout protect navigation "+width,async({page,context})=>{
 await page.setViewportSize({width,height:844});
 await page.goto("/posts/new");await expect(page).toHaveURL(/\/login\?returnTo=/);
 await expect(page.locator('input[type="password"]')).toHaveCount(0);
 await page.screenshot({path:"test-results/login-"+width+".png",fullPage:true});
 await page.getByRole("button",{name:"회사 계정으로 로그인"}).click();
 await expect(page).toHaveURL(origin+"/posts/new");
 await expect(page.locator(".user-name")).toHaveText("테스트 사용자");
 await expect(page.getByRole("link",{name:"관리자",exact:true})).toHaveCount(0);
 const cookies=await context.cookies(),session=cookies.find(cookie=>cookie.name==="board_session");expect(session?.httpOnly).toBe(true);
 await page.getByRole("button",{name:"로그아웃",exact:true}).click();await expect(page).toHaveURL(origin+"/login");
 await page.goBack();await expect(page.locator('input[name="title"]')).toHaveCount(0);
 expect((await context.request.get("/api/posts")).status()).toBe(401);
});
test("other owners and legacy pages show permission notices without forms",async({page,context})=>{
 const pool=await getDatabase(),alice=await createTestSession(pool,createTestActor()),bob=await createTestSession(pool,createTestActor());
 const [post]=await seedPosts([{title:"他人の非公開編集",content:"본문"}],alice.principal);
 const [legacy]=await seedLegacyPosts(pool,[{title:"기존 글 보존",content:"원본",nickname:"이전 작성자"}]);
 await context.addCookies([{name:bob.cookieName,value:bob.cookieValue,url:origin,httpOnly:true,sameSite:"Lax"}]);
 for(const id of [post.id,legacy]){
  await page.goto("/posts/"+id);await expect(page.getByRole("link",{name:"글 수정",exact:true})).toHaveCount(0);await expect(page.getByRole("link",{name:"글 삭제",exact:true})).toHaveCount(0);
  await page.goto("/posts/"+id+"/edit");await expect(page.getByRole("heading",{name:"접근 권한이 없습니다"})).toBeVisible();await expect(page.locator('input[name="title"]')).toHaveCount(0);
  await page.goto("/posts/"+id+"/delete");await expect(page.getByLabel("삭제에 동의합니다")).toHaveCount(0);
 }
 await page.goto("/admin");await expect(page.getByRole("heading",{name:"접근 권한이 없습니다"})).toBeVisible();await expect(page.getByRole("button",{name:"삭제 실행"})).toHaveCount(0);
});
for(const length of [1,21,256])test("long account names fit mobile navigation "+length,async({page,context})=>{
 const session=await createTestSession(await getDatabase(),createTestActor({displayName:"윤".repeat(length)}));
 await context.addCookies([{name:session.cookieName,value:session.cookieValue,url:origin,httpOnly:true,sameSite:"Lax"}]);await page.setViewportSize({width:390,height:844});await page.goto("/posts/new");
 await expect(page.locator(".user-name")).toHaveText("윤".repeat(length));expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
 await expect(page.locator('input[name="nickname"],input[type="password"]')).toHaveCount(0);
 await page.screenshot({path:"test-results/account-name-"+length+".png",fullPage:true});
});
test("expired sessions keep the File draft and offer an explicit sign-in retry",async({page,context})=>{
 const pool=await getDatabase(),actor=createTestActor(),session=await createTestSession(pool,actor);
 await context.addCookies([{name:session.cookieName,value:session.cookieValue,url:origin,httpOnly:true,sameSite:"Lax"}]);await page.goto("/posts/new");
 await page.getByRole("textbox",{name:/^제목/}).fill("유지할 초안");await page.getByRole("textbox",{name:/^본문/}).fill("본문 유지");
 const image=await sharp({create:{width:20,height:20,channels:3,background:"blue"}}).png().toBuffer();await page.getByLabel("이미지 선택",{exact:true}).setInputFiles({name:"draft.png",mimeType:"image/png",buffer:image});
 await pool.request().input("hash",sql.Char(64),session.principal.sessionHash).query("UPDATE dbo.auth_sessions SET revoked_at=SYSUTCDATETIME() WHERE id_hash=@hash");
 await page.getByRole("button",{name:"글 등록",exact:true}).click();await expect(page.getByRole("link",{name:"새 창에서 다시 로그인"})).toBeVisible();await expect(page.getByRole("textbox",{name:/^제목/})).toHaveValue("유지할 초안");
 await expect(page.locator(".editor-body img")).toHaveAttribute("src",/^blob:/);
 const replacement=await createTestSession(pool,actor);await context.addCookies([{name:replacement.cookieName,value:replacement.cookieValue,url:origin,httpOnly:true,sameSite:"Lax"}]);
 await page.getByRole("button",{name:"글 등록",exact:true}).click();await expect(page).toHaveURL(/\/posts\/\d+$/);await expect(page.locator(".rich-content")).toContainText("본문 유지");
});
