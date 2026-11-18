import { editorEnabled } from "@/lib/server/editor-config";
import { toErrorResponse } from "@/lib/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { requireApiPrincipal } from "@/lib/server/auth-http";
export async function GET(request: Request): Promise<Response> {
  try { await requireApiPrincipal(request); return Response.json({ enabled: editorEnabled(), maxFileBytes: 5242880, maxImages: 5, maxInputBytes: 20971520 }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return toErrorResponse(error); }
}
