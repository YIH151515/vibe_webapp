import { getDatabase } from "./database";
import { BoardError } from "./errors";
import { ensureSameOrigin, readJson, toErrorResponse } from "./http";
import { requireApiPrincipal } from "./auth-http";
import { forbidden } from "./auth-principal";
import { deletePostAsAdmin } from "./admin";
import { parsePostId } from "./validation";
export async function adminRequest(action: "login" | "logout" | "session" | "delete", request: Request, id?: string): Promise<Response> {
  try {
    const principal = await requireApiPrincipal(request);
    if (action !== "session") ensureSameOrigin(request, { requireOrigin: true });
    if (action === "login" || action === "logout") throw new BoardError("NOT_FOUND", 404, "사용하지 않는 로그인 경로입니다.");
    if (!principal.isAdmin) throw forbidden();
    if (action === "session") return Response.json({ displayName: principal.displayName, isAdmin: principal.isAdmin, expiresAt: principal.expiresAt.toISOString() }, { headers: { "Cache-Control": "no-store" } });
    const body = await readJson(request);
    if (!body || typeof body !== "object" || Array.isArray(body) || (body as { confirm?: unknown }).confirm !== true || Object.keys(body).some(key => key !== "confirm"))
      throw new BoardError("VALIDATION_ERROR", 400, "삭제 동의가 필요합니다.");
    await deletePostAsAdmin(await getDatabase(), parsePostId(id ?? ""), principal);
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return toErrorResponse(error); }
}
