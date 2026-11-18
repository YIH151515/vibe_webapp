import { test, expect } from "./helpers/anonymous-fixture";

const origin = "http://127.0.0.1:3100";
test("auth routes establish a safe cookie session and revoke old cookies on sign-in/logout", async ({ request }) => {
  async function login(actor: string) {
    const start = await request.post("/api/auth/login", { data: { returnTo: "/?q=한글 검색" }, headers: { Origin: origin }, maxRedirects: 0 });
    expect(start.status()).toBe(303); expect(start.headers()["set-cookie"]).toMatch(/HttpOnly.*SameSite=Lax/);
    expect(start.headers()["set-cookie"]).toContain("Path=/"); expect(start.headers()["set-cookie"]).toContain("Max-Age=600");
    expect(start.headers()["set-cookie"]).not.toMatch(/Domain=|; Secure/i);
    const consent = await fetch(start.headers().location, { headers: { Cookie: "oidc_test_user=" + actor }, redirect: "manual" });
    const callback = new URL(consent.headers.get("location")!);
    const result = await request.get(callback.pathname + callback.search, { maxRedirects: 0 });
    expect(result.status()).toBe(303); expect(result.headers().location).toContain("q=%ED%95%9C");
    return result.headers()["set-cookie"].split(";")[0];
  }
  expect((await request.get("/api/auth/session")).status()).toBe(401);
  const old = await login("alice"); const first = await (await request.get("/api/auth/session")).json();
  expect(Object.keys(first).sort()).toEqual(["displayName", "expiresAt", "isAdmin"]); expect(first.isAdmin).toBe(false);
  const current = await login("admin"); expect(current).not.toBe(old);
  expect((await (await request.get("/api/auth/session")).json()).isAdmin).toBe(true);
  expect((await request.get("/api/auth/session", { headers: { Cookie: old } })).status()).toBe(401);
  const blocked = await request.post("/api/auth/logout", { headers: { Origin: "https://example.invalid" } });
  expect(blocked.status()).toBe(403); expect(blocked.headers()["set-cookie"]).toBeUndefined();
  expect((await request.post("/api/auth/logout", { headers: { Origin: origin } })).status()).toBe(204);
  expect((await request.get("/api/auth/session", { headers: { Cookie: current } })).status()).toBe(401);
  expect((await request.post("/api/auth/logout", { headers: { Origin: origin } })).status()).toBe(204);
});

test("login validates Origin, bounded body and safe provider failures without reflecting protocol secrets", async ({ request }) => {
  expect((await request.get("/api/auth/login")).status()).toBe(405);
  expect((await request.post("/api/auth/login", { data: {} })).status()).toBe(403);
  expect((await request.post("/api/auth/login", { data: { password: "not-accepted" }, headers: { Origin: origin } })).status()).toBe(400);
  expect((await request.post("/api/auth/login", { data: "a".repeat(4097), headers: { Origin: origin, "Content-Type": "application/json" } })).status()).toBe(413);
  const start = await request.post("/api/auth/login", { form: { returnTo: "//example.invalid" }, headers: { Origin: origin }, maxRedirects: 0 });
  expect(start.status()).toBe(303);
  const consent = await fetch(start.headers().location, { headers: { Cookie: "oidc_test_user=cancel" }, redirect: "manual" });
  const callback = new URL(consent.headers.get("location")!); callback.searchParams.set("error_description", "private-marker-do-not-reflect");
  const result = await request.get(callback.pathname + callback.search, { maxRedirects: 0 });
  expect(result.status()).toBe(303); expect(result.headers().location).toBe("/login?error=cancelled");
  expect(result.headers()["referrer-policy"]).toBe("no-referrer"); expect(await result.text()).toBe("");
});

test("login flow creation has a persistent source budget and bounded Retry-After", async ({ request }) => {
  for (let index = 0; index < 10; index++) {
    const response = await request.post("/api/auth/login", { data: {}, headers: { Origin: origin }, maxRedirects: 0 });
    expect(response.status()).toBe(303);
  }
  const limited = await request.post("/api/auth/login", { data: {}, headers: { Origin: origin }, maxRedirects: 0 });
  expect(limited.status()).toBe(429); expect(Number(limited.headers()["retry-after"])).toBeGreaterThan(0);
  expect(limited.headers()["cache-control"]).toBe("no-store");
});
