import { getDatabase } from "@/lib/server/database";
import { getBlobStore } from "@/lib/server/blob-store";
import { ensureSameOrigin, toErrorResponse } from "@/lib/server/http";
import { getClientKey } from "@/lib/server/request-context";
import { createMediaService } from "@/lib/server/media-service";
import { requireEditor } from "@/lib/server/upload-sessions";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    ensureSameOrigin(request, { requireOrigin: true }); requireEditor();
    const result = await createMediaService(await getDatabase(), getBlobStore()).uploadImage(request, getClientKey(request));
    return Response.json(result.asset, { status: result.status, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return toErrorResponse(error); }
}
