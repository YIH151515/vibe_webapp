import { getDatabase } from "@/lib/server/database";
import { ensureSameOrigin, toErrorResponse } from "@/lib/server/http";
import { requireApiPrincipal } from "@/lib/server/auth-http";
import { bearer, cancelUploadSession, requireEditor } from "@/lib/server/upload-sessions";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function DELETE(request: Request) {
  try {
    const principal = await requireApiPrincipal(request);
    ensureSameOrigin(request, { requireOrigin: true }); requireEditor();
    await cancelUploadSession(await getDatabase(), bearer(request), principal);
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return toErrorResponse(error); }
}
