import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { test, expect, type Page } from "./helpers/client-fixture";

const origin = "http://127.0.0.1:3100";
async function png() { return sharp({ create: { width: 80, height: 40, channels: 4, background: { r: 30, g: 80, b: 180, alpha: 0.5 } } }).png().toBuffer(); }
async function fields(page: Page, title: string) {
  await page.getByRole("textbox", { name: /^제목/ }).fill(title);

  await expect(page.getByRole("textbox", { name: /^본문/ })).toBeVisible();
}
const selectedFile = async () => ({ name: "local-only.png", mimeType: "image/png", buffer: await png() });

test("large existing rich document saves without duplicating its plain projection", async ({ page, request }) => {
  const document = { version: 1, type: "doc", content: [{ type: "paragraph", content: Array.from({ length: 300 }, (_, index) => ({ type: "text", text: "가".repeat(30), ...(index % 2 ? {} : { marks: [{ type: "bold" }] }) })) }] };
  const created = await request.post("/api/posts", { headers: { Origin: origin }, data: { title: "긴 문서",   document } });
  expect(created.status()).toBe(201); const post = await created.json();
  try {
    await page.goto(`/posts/${post.id}/edit`); await fields(page, "긴 문서 제목 변경");
    const saved = page.waitForRequest(req => req.method() === "PATCH" && req.url().endsWith(`/api/posts/${post.id}`));
    await page.getByRole("button", { name: "수정 저장", exact: true }).click();
    const payload = (await saved).postDataJSON(); expect(payload).not.toHaveProperty("content");
    expect(Buffer.byteLength(JSON.stringify(payload))).toBeLessThan(65536);
    await expect(page).toHaveURL(new RegExp(`/posts/${post.id}$`));
    const current = await (await request.get(`/api/posts/${post.id}`)).json();
    expect(current.content).toBe(post.content); expect(current.createdAt).toBe(post.createdAt);
  } finally { await request.delete(`/api/posts/${post.id}`, { headers: { Origin: origin }, data: { confirm: true } }); }
});

for (const width of [1280, 390]) test(`rich images survive save/reload/edit and detach at ${width}px`, async ({ page, request }) => {
  test.setTimeout(90000); await page.setViewportSize({ width, height: 844 });
  const title = `에디터 ${randomUUID()}`; let uploads = 0;
  page.on("request", req => { if (req.method() === "POST" && new URL(req.url()).pathname === "/api/images/uploads") uploads++; });
  await page.goto("/posts/new"); await fields(page, title);
  const body = page.getByRole("textbox", { name: /^본문/ });
  await body.fill("서식 본문 한글"); await body.press("ControlOrMeta+a"); await page.getByRole("button", { name: "굵게", exact: true }).click();
  await expect(page.locator(".editor-body strong")).toHaveText("서식 본문 한글");
  await page.getByLabel("이미지 선택", { exact: true }).setInputFiles(await selectedFile());
  await expect(page.locator(".editor-body img")).toHaveCount(1); expect(uploads).toBe(0);
  await page.getByLabel("이미지 1 설명", { exact: true }).fill("첫 이미지");
  await page.getByRole("button", { name: "이미지 1 위로", exact: true }).click();
  await expect(page.locator(".editor-body img")).toHaveAttribute("src", /^blob:/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({ path: `test-results/editor-${width}.png`, fullPage: true });
  await page.getByRole("button", { name: "글 등록", exact: true }).click();
  await expect(page).toHaveURL(/\/posts\/\d+$/); const id = Number(new URL(page.url()).pathname.split("/").pop());
  await expect(page.locator(".rich-content strong")).toHaveText("서식 본문 한글");
  await expect(page.locator(".rich-content img")).toHaveAttribute("alt", "첫 이미지");
  const firstUrl = await page.locator(".rich-content img").getAttribute("src"); expect(uploads).toBe(1);
  const post = await (await request.get(`/api/posts/${id}`)).json();
  expect(post.contentFormat).toBe("rich_v1"); expect(post.content).toContain("서식 본문 한글");
  expect(JSON.stringify(post.document)).not.toMatch(/blob:|previewUrl|draftId|"src"/);
  expect(await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }))).not.toMatch(/blob:|token|editor-password/);
  await page.reload(); await expect(page.locator(".rich-content img")).toBeVisible();
  await page.getByRole("link", { name: "글 수정", exact: true }).click();
  await fields(page, title + " 수정"); await page.getByLabel("이미지 선택", { exact: true }).setInputFiles(await selectedFile());
  await page.getByRole("button", { name: "수정 저장", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(title + " 수정");
  await expect(page.locator(".rich-content img")).toHaveCount(2); expect(uploads).toBe(2);
  const secondUrl = await page.locator(".rich-content img").nth(1).getAttribute("src");
  expect((await (await request.get(`/api/posts/${id}`)).json()).createdAt).toBe(post.createdAt);
  await page.getByRole("link", { name: "글 수정", exact: true }).click(); await fields(page, title + " 제거");
  await page.getByRole("button", { name: "이미지 1 제거", exact: true }).click();
  await page.getByRole("button", { name: "수정 저장", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(title + " 제거");
  expect((await request.get(firstUrl!)).status()).toBe(404); expect((await request.get(secondUrl!)).status()).toBe(200); expect(uploads).toBe(2);
  expect((await request.delete(`/api/posts/${id}`, { headers: { Origin: origin }, data: { confirm: true } })).status()).toBe(204);
});

test("selection, clipboard and drop share limits and keep the current draft", async ({ page }) => {
  await page.goto("/posts/new"); await fields(page, "입력 경로 검증");
  await page.getByRole("textbox", { name: /^본문/ }).fill("그대로 유지할 본문");
  const file = await selectedFile(); await page.getByLabel("이미지 선택", { exact: true }).setInputFiles(file);
  const bytes = Array.from(file.buffer);
  for (const kind of ["paste", "drop"] as const) await page.locator(".editor-body").evaluate((element, { bytes, kind }) => {
    const transfer = new DataTransfer(); transfer.items.add(new File([Uint8Array.from(bytes)], "clipboard.png", { type: "image/png" }));
    const rect = element.getBoundingClientRect();
    const event = kind === "paste" ? new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }) : new DragEvent("drop", { dataTransfer: transfer, bubbles: true, cancelable: true, clientX: rect.left + 12, clientY: Math.max(4, rect.top + 12) });
    element.dispatchEvent(event);
  }, { bytes, kind });
  await expect(page.locator(".editor-body img")).toHaveCount(3);
  await page.locator(".editor-body").evaluate(element => {
    const transfer = new DataTransfer(); transfer.setData("text/html", '<p onclick="window.__clipboardScript=true">HTML 안전<script>window.__clipboardScript=true</script><img src="https://external.invalid/image.png" onerror="window.__clipboardScript=true"></p>');
    element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }));
  });
  await expect(page.locator(".editor-body img")).toHaveCount(3);
  expect(await page.evaluate(() => "__clipboardScript" in window)).toBe(false);
  await page.getByLabel("이미지 선택", { exact: true }).setInputFiles([file, file, file]);
  await expect(page.locator("main").getByRole("alert")).toContainText("최대 5장"); await expect(page.locator(".editor-body img")).toHaveCount(3);
  await page.getByLabel("이미지 선택", { exact: true }).setInputFiles({ name: "large.png", mimeType: "image/png", buffer: Buffer.alloc(5242881) });
  await expect(page.locator("main").getByRole("alert")).toContainText("5MiB");
  await page.getByLabel("이미지 선택", { exact: true }).setInputFiles({ name: "unsafe.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg/>") });
  await expect(page.locator("main").getByRole("alert")).toContainText("JPEG, PNG, WebP");
  await expect(page.locator(".editor-body")).toContainText("그대로 유지할 본문");
});

test("post-save failure retains uploaded file and draft; retry does not upload twice", async ({ page, request }) => {
  test.setTimeout(60000); let failed = false, uploads = 0;
  await page.route("**/api/posts", async route => {
    if (route.request().method() === "POST" && !failed) { failed = true; await route.fulfill({ status: 503, json: { error: { code: "SERVICE_UNAVAILABLE", message: "저장 재시도 검증" } } }); }
    else await route.continue();
  });
  page.on("request", req => { if (new URL(req.url()).pathname === "/api/images/uploads") uploads++; });
  await page.goto("/posts/new"); await fields(page, "실패 후 초안 보존");
  await page.getByRole("textbox", { name: /^본문/ }).fill("재시도할 본문");
  await page.getByLabel("이미지 선택", { exact: true }).setInputFiles(await selectedFile());
  await page.getByRole("button", { name: "글 등록", exact: true }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText("저장 재시도 검증");

  await expect(page.locator(".editor-body img")).toHaveAttribute("src", /^blob:/); expect(uploads).toBe(1);
   await page.getByRole("button", { name: "글 등록", exact: true }).click();
  await expect(page).toHaveURL(/\/posts\/\d+$/); expect(uploads).toBe(1);
  const id = Number(new URL(page.url()).pathname.split("/").pop());
  await request.delete(`/api/posts/${id}`, { headers: { Origin: origin }, data: { confirm: true } });
});

for (const responseKind of ["html", "shape"]) test(`malformed ${responseKind} upload response preserves File and retries with the same request key`, async ({ page, request }) => {
  let firstKey: string | undefined, retryKey: string | undefined;
  await page.route("**/api/images/uploads", async route => {
    const key = route.request().headers()["idempotency-key"];
    if (!firstKey) {
      firstKey = key;
      if (responseKind === "html") await route.fulfill({ status: 503, contentType: "text/html", body: "unavailable" });
      else await route.fulfill({ status: 200, json: { ok: true } });
    }
    else { retryKey = key; await route.continue(); }
  });
  await page.goto("/posts/new"); await fields(page, "업로드 재시도");
  await page.getByLabel("이미지 선택", { exact: true }).setInputFiles(await selectedFile());
  await page.getByRole("button", { name: "글 등록", exact: true }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText("응답을 확인하지 못했습니다");
  await expect(page.locator(".editor-body img")).toHaveCount(1);
   await page.getByRole("button", { name: "글 등록", exact: true }).click();
  await expect(page).toHaveURL(/\/posts\/\d+$/); expect(retryKey).toBe(firstKey);
  const id = Number(new URL(page.url()).pathname.split("/").pop()); await request.delete(`/api/posts/${id}`, { headers: { Origin: origin }, data: { confirm: true } });
});

test("removal, undo and navigation revoke ObjectURLs without uploading a draft", async ({ page }) => {
  await page.addInitScript(() => {
    const original = URL.revokeObjectURL.bind(URL);
    (window as unknown as { revoked: number }).revoked = 0;
    URL.revokeObjectURL = url => { (window as unknown as { revoked: number }).revoked++; original(url); };
  });
  let uploads = 0; page.on("request", req => { if (new URL(req.url()).pathname === "/api/images/uploads") uploads++; });
  await page.goto("/posts/new"); await fields(page, "초안 취소"); await page.getByLabel("이미지 선택", { exact: true }).setInputFiles(await selectedFile());
  const preview = await page.locator(".editor-body img").getAttribute("src");
  await page.getByRole("button", { name: "이미지 1 제거", exact: true }).click(); await expect(page.locator(".editor-body img")).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { revoked: number }).revoked)).toBeGreaterThan(0);
  await page.getByRole("button", { name: "실행 취소", exact: true }).click();
  await expect(page.locator(".editor-body img")).toHaveCount(1); expect(await page.locator(".editor-body img").getAttribute("src")).not.toBe(preview);
  await page.getByRole("link", { name: "취소", exact: true }).click(); await expect(page).toHaveURL(origin + "/"); expect(uploads).toBe(0);
  expect(await page.evaluate(() => (window as unknown as { revoked: number }).revoked)).toBeGreaterThan(1);
});

test("IME composition and keyboard formatting preserve Korean text", async ({ page, request }) => {
  await page.goto("/posts/new"); await fields(page, "한글 조합"); const body = page.getByRole("textbox", { name: /^본문/ });
  await body.focus();
  await body.evaluate(element => {
    element.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }));
    document.execCommand("insertText", false, "한글 조합 입력");
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertCompositionText", data: "한글 조합 입력", isComposing: true }));
    element.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "한글 조합 입력" }));
  });
  await expect(body).toContainText("한글 조합 입력"); await body.press("ControlOrMeta+a");
  await page.getByRole("button", { name: "굵게", exact: true }).focus(); await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "굵게", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "글 등록", exact: true }).click(); await expect(page).toHaveURL(/\/posts\/\d+$/);
  await expect(page.locator(".rich-content")).toContainText("한글 조합 입력");
  const id = Number(new URL(page.url()).pathname.split("/").pop()); await request.delete(`/api/posts/${id}`, { headers: { Origin: origin }, data: { confirm: true } });
});

test("disabled editor keeps plain textarea and makes rich edits read-only", async ({ page, request }) => {
  await page.route("**/api/editor-config", route => route.fulfill({ json: { enabled: false, maxFileBytes: 5242880, maxImages: 5, maxInputBytes: 20971520 } }));
  await page.goto("/posts/new"); await fields(page, "일반 입력 유지");
  const body = page.getByRole("textbox", { name: /^본문/ }); expect(await body.evaluate(element => element.tagName)).toBe("TEXTAREA");
  await body.fill("첫 줄\n둘째 줄"); await page.getByRole("button", { name: "글 등록", exact: true }).click(); await expect(page).toHaveURL(/\/posts\/\d+$/);
  const plainId = Number(new URL(page.url()).pathname.split("/").pop()); expect((await (await request.get(`/api/posts/${plainId}`)).json()).contentFormat).toBe("plain");
  const rich = await (await request.post("/api/posts", { headers: { Origin: origin }, data: { title: "서식 글",   document: { version: 1, type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "보존할 서식" }] }] } } })).json();
  await page.goto(`/posts/${rich.id}/edit`); await expect(page.getByRole("heading", { level: 1 })).toHaveText("서식 편집이 일시 중지되었습니다");
  await expect(page.getByRole("textbox", { name: /^본문/ })).toHaveCount(0); await expect(page.getByRole("link", { name: "글 삭제", exact: true })).toBeVisible();
  for (const id of [plainId, rich.id]) await request.delete(`/api/posts/${id}`, { headers: { Origin: origin }, data: { confirm: true } });
});

test("editing a legacy plain post preserves blank lines, search text and creation date", async ({ page, request }) => {
  const title = `기존 글 ${randomUUID()}`, content = "첫 줄\n\n둘째 줄 한글";
  const created = await (await request.post("/api/posts", { headers: { Origin: origin }, data: { title, content, } })).json();
  await page.goto(`/posts/${created.id}/edit`); await fields(page, title);
  await expect(page.getByRole("textbox", { name: /^본문/ })).toHaveText(content, { useInnerText: true });
  await page.getByRole("button", { name: "수정 저장", exact: true }).click(); await expect(page).toHaveURL(new RegExp(`/posts/${created.id}$`));
  const updated = await (await request.get(`/api/posts/${created.id}`)).json();
  expect(updated.content).toBe(content); expect(updated.createdAt).toBe(created.createdAt); expect(updated.contentFormat).toBe("rich_v1");
  const found = await (await request.get("/api/posts?q=" + encodeURIComponent("둘째 줄 한글"))).json();
  expect(found.items.some((item: { id: number }) => item.id === created.id)).toBe(true);
  await request.delete(`/api/posts/${created.id}`, { headers: { Origin: origin }, data: { confirm: true } });
});
