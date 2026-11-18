import { getDatabase } from "@/lib/server/database";
import { ensureSameOrigin, readJson, toErrorResponse } from "@/lib/server/http";
import { requireApiPrincipal } from "@/lib/server/auth-http";
import { issueUploadSession, parseSessionInput, requireEditor } from "@/lib/server/upload-sessions";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    const principal = await requireApiPrincipal(request);
    ensureSameOrigin(request, { requireOrigin: true }); requireEditor();
    const input = parseSessionInput(await readJson(request));
    const result = await issueUploadSession(await getDatabase(), principal, input);
    return Response.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return toErrorResponse(error); }
}
