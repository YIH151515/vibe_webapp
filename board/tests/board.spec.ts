import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "./helpers/client-fixture";
import { seedPosts } from "./helpers/sql-fixture";
import { closeDatabase } from "../src/lib/server/database";

test.afterAll(() => closeDatabase());

const password = "browser-password";

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
}

for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
  test.describe(`${viewport.width}px`, () => {
    test.use({ viewport });

    test("create, safely render, reject wrong password, edit and delete with consent", async ({ page, request }) => {
      const title = `브라우저-${randomUUID()}`;
      const content = '<script>window.__boardInjected=true</script>\n' + "긴본문".repeat(200);
      await page.goto("/");
      await expect(page.getByRole("link", { name: "글쓰기", exact: true })).toBeVisible();
      await page.getByRole("link", { name: "글쓰기", exact: true }).click();
      await page.getByRole("button", { name: "글 등록", exact: true }).click();
      await expect(page.locator("main").getByRole("alert")).toContainText("입력 내용을 확인");
      await expect(page.getByRole("textbox", { name: /^제목/ })).toBeFocused();
      await page.getByRole("textbox", { name: /^제목/ }).fill(title);
      await page.getByLabel(/^닉네임/).fill("브라우저작성자");
      await page.getByLabel(/^비밀번호/).fill(password);
      await page.getByRole("textbox", { name: /^본문/ }).fill(content);
      await page.getByRole("button", { name: "글 등록", exact: true }).click();
      await expect(page).toHaveURL(/\/posts\/\d+$/);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
      await expect(page.locator(".post-content")).toHaveText(content, { useInnerText: true });
      expect(await page.evaluate(() => "__boardInjected" in window)).toBe(false);
      expect(await page.content()).not.toContain("password_hash");
      expect(await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }))).not.toContain(password);
      expect(page.url()).not.toContain(password);
      const id = Number(new URL(page.url()).pathname.split("/").pop());
      const publicPost = await (await request.get(`/api/posts/${id}`)).json();
      expect(Object.keys(publicPost).sort()).toEqual(["content", "contentFormat", "createdAt", "document", "id", "nickname", "title"]);
      const date = await page.locator("article time").getAttribute("datetime");
      await noOverflow(page);
      await page.screenshot({ path: `test-results/board-post-${viewport.width}.png`, fullPage: true });
      await expect(page.getByRole("link", { name: "글 수정", exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: "글 삭제", exact: true })).toBeVisible();
      await page.getByRole("link", { name: "글 수정", exact: true }).click();
      await expect(page.getByRole("textbox", { name: /^제목/ })).toHaveValue(title);
      await expect(page.getByLabel(/^비밀번호/)).toHaveValue("");
      await page.getByRole("textbox", { name: /^제목/ }).fill(title + "-수정");
      await page.getByLabel(/^비밀번호/).fill("wrong-password");
      await page.getByRole("button", { name: "수정 저장" }).click();
      await expect(page.locator("main").getByRole("alert")).toHaveText("비밀번호가 일치하지 않습니다.");
      await expect(page.getByLabel(/^비밀번호/)).toHaveValue("");
      await expect(page.getByRole("textbox", { name: /^제목/ })).toHaveValue(title + "-수정");
      await page.getByLabel(/^비밀번호/).fill(password);
      await page.getByRole("button", { name: "수정 저장" }).click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(title + "-수정");
      await expect(page.locator("article time")).toHaveAttribute("datetime", date!);
      await page.getByRole("link", { name: "글 삭제", exact: true }).click();
      await expect(page.getByRole("button", { name: "글 삭제", exact: true })).toBeDisabled();
      await page.getByRole("link", { name: "취소", exact: true }).click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(title + "-수정");
      await page.getByRole("link", { name: "글 삭제", exact: true }).click();
      await page.getByLabel(/^비밀번호/).fill("wrong-password");
      await page.getByLabel("삭제에 동의합니다").check();
      await page.getByRole("button", { name: "글 삭제", exact: true }).click();
      await expect(page.locator("main").getByRole("alert")).toHaveText("비밀번호가 일치하지 않습니다.");
      await expect(page.getByLabel(/^비밀번호/)).toHaveValue("");
      await page.getByLabel(/^비밀번호/).fill(password);
      await noOverflow(page);
      await page.getByRole("button", { name: "글 삭제", exact: true }).click();
      await expect(page).toHaveURL("http://127.0.0.1:3100/");
      expect((await request.get(`/api/posts/${id}`)).status()).toBe(404);
      for (const suffix of ["", "/edit", "/delete"]) {
        await page.goto(`/posts/${id}${suffix}`);
        await expect(page.getByRole("heading", { level: 1 })).toHaveText("글을 찾을 수 없습니다");
        await expect(page.getByRole("link", { name: "목록으로", exact: true })).toBeVisible();
      }
    });

    test("search, paginate and correct an overflow page without losing the query", async ({ page, principal }) => {
      const token = randomUUID();
      await seedPosts(Array.from({ length: 21 }, (_, i) => ({
        title: `${token}-${i}`, content: "일반 텍스트", nickname: "테스트작성자", password,
      })), principal);
      await page.goto("/");
      await page.getByRole("searchbox", { name: "제목과 본문 검색" }).fill(token);
      await page.getByRole("button", { name: "검색", exact: true }).click();
      await expect(page.locator(".count")).toHaveText("총 21개의 글");
      const visibleList = page.locator(viewport.width < 768 ? ".mobile-list" : ".desktop-list");
      await expect(visibleList.locator(".post-title-link")).toHaveCount(20);
      await expect(page.locator(viewport.width < 768 ? ".desktop-list" : ".mobile-list")).toBeHidden();
      await noOverflow(page);
      await page.screenshot({ path: `test-results/board-list-${viewport.width}.png`, fullPage: true });
      await page.getByRole("link", { name: "다음 →" }).click();
      await expect(page).toHaveURL(new RegExp("q=" + token + "&page=2$"));
      await expect(visibleList.locator(".post-title-link")).toHaveCount(1);
      await expect(page.getByRole("link", { name: "← 이전" })).toBeVisible();
      await page.goto(`/?q=${token}&page=99`);
      await expect(page).toHaveURL(new RegExp("q=" + token + "&page=2$"));
      await expect(visibleList.locator(".post-title-link")).toHaveCount(1);
      await page.getByRole("searchbox", { name: "제목과 본문 검색" }).fill(randomUUID());
      await page.getByRole("button", { name: "검색", exact: true }).click();
      await expect(page.getByRole("heading", { name: "검색 결과가 없습니다" })).toBeVisible();
      expect(new URL(page.url()).searchParams.has("page")).toBe(false);
      await page.screenshot({ path: `test-results/board-${viewport.width}.png`, fullPage: true });
    });

    test("malformed addresses, missing pages and network failures show a way back", async ({ page }) => {
      await page.goto("/?page=01");
      await expect(page.locator("main").getByRole("alert")).toContainText("검색 주소가 올바르지 않습니다");
      await expect(page.getByRole("link", { name: "목록으로", exact: true })).toBeVisible();
      await page.goto("/posts/not-a-number");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("페이지를 찾을 수 없습니다");
      await page.route("**/api/posts?*", route => route.abort());
      await page.goto("/");
      await expect(page.locator("main").getByRole("alert")).toContainText("연결하지 못했습니다");
      await page.unroute("**/api/posts?*");
      await page.getByRole("button", { name: "다시 시도" }).click();
      await expect(page.locator(".count")).toContainText("개의 글");
      await noOverflow(page);
    });
  });
}

test("empty board and non-JSON failures are understandable", async ({ page }) => {
  await page.route("**/api/posts?*", route => route.fulfill({
    json: { items: [], total: 0, page: 1, pageSize: 20, totalPages: 1, q: "" },
  }));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "아직 등록된 글이 없습니다" })).toBeVisible();
  await page.unroute("**/api/posts?*");
  await page.route("**/api/posts?*", route => route.fulfill({ status: 502, contentType: "text/html", body: "<h1>Proxy error</h1>" }));
  await page.reload();
  await expect(page.locator("main").getByRole("alert")).toContainText("응답을 확인하지 못했습니다");
});

test("rate limit feedback includes wait time and clears only the password", async ({ page, request }) => {
  const data = { title: "제한 안내", content: "본문", nickname: "작성자", password };
  const response = await request.post("/api/posts", { data });
  expect(response.status()).toBe(201);
  const { id } = await response.json();
  await page.goto(`/posts/${id}/edit`);
  await expect(page.getByRole("textbox", { name: /^제목/ })).toHaveValue(data.title);
  await page.route(`**/api/posts/${id}`, async route => {
    if (route.request().method() !== "PATCH") return route.continue();
    await route.fulfill({
      status: 429, headers: { "Retry-After": "60" },
      json: { error: { code: "RATE_LIMITED", message: "요청이 많습니다. 60초 후 다시 시도해 주세요." } },
    });
  });
  await page.getByRole("textbox", { name: /^제목/ }).fill("유지할 제목");
  await page.getByLabel(/^비밀번호/).fill(password);
  await page.getByRole("button", { name: "수정 저장" }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText("60초");
  await expect(page.getByRole("textbox", { name: /^제목/ })).toHaveValue("유지할 제목");
  await expect(page.getByLabel(/^비밀번호/)).toHaveValue("");
});
