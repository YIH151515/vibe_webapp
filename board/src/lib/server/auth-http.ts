import { readAuthConfig, authUnavailable } from "./auth-config";
import { beginLogin, finishLogin } from "./auth-flow";
import { cleanupAuthState, readAppSession, revokeAppSession } from "./auth-session";
import { unauthorized, type Principal } from "./auth-principal";
import { getDatabase } from "./database";
import { BoardError } from "./errors";
import { ensureSameOrigin, toErrorResponse } from "./http";
import { getClientKey } from "./request-context";
import { withRateLimit } from "./rate-limit";
export { requireActivePrincipal } from "./auth-session";

export async function requireApiPrincipal(request: Request): Promise<Principal> {
  const config = readAuthConfig();
  if (config.mode !== "entra") throw authUnavailable();
  const cookie = readCookie(request, authCookieNames(config.origin).session);
  if (!cookie || cookie.length !== 64 || !/^[a-f0-9]{64}$/.test(cookie)) throw unauthorized();
  const principal = await readAppSession(await getDatabase(), cookie, config);
  if (!principal) throw unauthorized();
  return principal;
}

export function authCookieNames(origin: string) {
  const prefix = new URL(origin).protocol === "https:" ? "__Host-" : "";
  return { session: prefix + "board_session", flow: prefix + "board_flow" };
}
export function readCookie(request: Request, name: string): string | undefined {
  const source = request.headers.get("cookie") ?? ""; if (source.length > 8192) return undefined;
  const values = source.split(";").map(value => value.trim()).filter(value => value.startsWith(name + "="));
  return values.length === 1 ? values[0].slice(name.length + 1) : undefined;
}
function serializeCookie(origin: string, name: string, value: string, seconds: number) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.max(0, Math.floor(seconds))}${origin.startsWith("https:") ? "; Secure" : ""}`;
}
function redirect(location: string): Response { return new Response(null, { status: 303, headers: { Location: location, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } }); }
function invalid(): never { throw new BoardError("VALIDATION_ERROR", 400, "로그인 요청을 확인해 주세요."); }
async function loginInput(request: Request): Promise<string> {
  const type = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (!["application/json", "application/x-www-form-urlencoded"].includes(type ?? "")) throw new BoardError("UNSUPPORTED_MEDIA_TYPE", 415, "로그인 요청 형식을 확인해 주세요.");
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || !Number.isSafeInteger(Number(declared)))) invalid();
  if (declared !== null && Number(declared) > 4096) throw new BoardError("PAYLOAD_TOO_LARGE", 413, "로그인 요청이 너무 큽니다.");
  const reader = request.body?.getReader(); let length = 0; const chunks: Uint8Array[] = [];
  try {
    if (reader) while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > 4096) { await reader.cancel().catch(() => undefined); throw new BoardError("PAYLOAD_TOO_LARGE", 413, "로그인 요청이 너무 큽니다."); }
      chunks.push(chunk.value);
    }
    if (declared !== null && Number(declared) !== length) invalid();
    const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, length));
    const form = type === "application/x-www-form-urlencoded" ? new URLSearchParams(text) : undefined;
    if (form && (form.getAll("returnTo").length > 1 || [...form.keys()].some(key => key !== "returnTo"))) invalid();
    const data = form ? Object.fromEntries(form) : JSON.parse(text);
    if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).some(key => key !== "returnTo") ||
      (data.returnTo !== undefined && typeof data.returnTo !== "string")) invalid();
    return data.returnTo ?? "/";
  } catch (error) { if (error instanceof BoardError) throw error; return invalid(); }
  finally { reader?.releaseLock(); }
}

export async function authRequest(action: "login" | "callback" | "session" | "logout", request: Request): Promise<Response> {
  let clear: string | undefined;
  try {
    const config = readAuthConfig(), names = authCookieNames(config.origin);
    if (action === "login" || action === "logout") ensureSameOrigin(request, { requireOrigin: true });
    if (action === "logout") clear = serializeCookie(config.origin, names.session, "", 0);
    if (config.mode !== "entra") throw authUnavailable();
    const value = readCookie(request, names.session);
    if (action === "login") {
      const returnTo = await loginInput(request), pool = await getDatabase();
      const result = await withRateLimit(pool, "oidc-login", getClientKey(request), () => beginLogin(pool, config, readCookie(request, names.flow), returnTo));
      await cleanupAuthState(pool);
      const response = redirect(result.authorizationUrl); response.headers.append("Set-Cookie", serializeCookie(config.origin, names.flow, result.browserCookie, 600)); return response;
    }
    if (action === "callback") {
      const host = request.headers.get("host"); if (host && host.toLowerCase() !== new URL(config.origin).host) throw unauthorized();
      const url = new URL(config.callbackUrl); url.search = new URL(request.url).search;
      const pool = await getDatabase(), result = await finishLogin(pool, config, url, readCookie(request, names.flow));
      try { const previous = await readAppSession(pool, value, config); if (previous) await revokeAppSession(pool, previous); }
      catch (error) { await revokeAppSession(pool, result.principal).catch(() => undefined); throw error; }
      const response = redirect(result.returnTo);
      response.headers.append("Set-Cookie", serializeCookie(config.origin, names.session, result.cookieValue, Math.min(3600, (result.principal.expiresAt.getTime() - Date.now()) / 1000)));
      return response;
    }
    const pool = await getDatabase(), principal = await readAppSession(pool, value, config);
    if (action === "logout") {
      if (principal) await revokeAppSession(pool, principal); await cleanupAuthState(pool);
      return new Response(null, { status: 204, headers: { "Set-Cookie": clear!, "Cache-Control": "no-store" } });
    }
    if (!principal) throw unauthorized();
    return Response.json({ displayName: principal.displayName, isAdmin: principal.isAdmin, expiresAt: principal.expiresAt.toISOString() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (action === "callback" && !(error instanceof BoardError && error.status === 503)) {
      const cancelled = error instanceof BoardError && error.message === "로그인을 취소했습니다.";
      return redirect("/login?error=" + (cancelled ? "cancelled" : error instanceof BoardError && error.status === 403 ? "denied" : "failed"));
    }
    const response = toErrorResponse(error); if (clear) response.headers.append("Set-Cookie", clear); return response;
  }
}
