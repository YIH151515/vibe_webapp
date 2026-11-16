import { getDatabase } from "@/lib/server/database";
import { ensureSameOrigin, toErrorResponse } from "@/lib/server/http";
import { getClientKey } from "@/lib/server/request-context";
import { bearer, cancelUploadSession, requireEditor } from "@/lib/server/upload-sessions";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function DELETE(request: Request) {
  try {
    ensureSameOrigin(request, { requireOrigin: true }); requireEditor();
    await cancelUploadSession(await getDatabase(), bearer(request), getClientKey(request));
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return toErrorResponse(error); }
}
