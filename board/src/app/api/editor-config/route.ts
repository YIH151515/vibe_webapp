import { editorEnabled } from "@/lib/server/editor-config";
import { toErrorResponse } from "@/lib/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(): Promise<Response> {
  try { return Response.json({ enabled: editorEnabled(), maxFileBytes: 5242880, maxImages: 5, maxInputBytes: 20971520 }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return toErrorResponse(error); }
}
