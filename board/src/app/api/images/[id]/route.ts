import { getDatabase } from "@/lib/server/database";
import { getBlobStore } from "@/lib/server/blob-store";
import { toErrorResponse } from "@/lib/server/http";
import { getPublishedImage } from "@/lib/server/published-images";
import { requireApiPrincipal } from "@/lib/server/auth-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  try { const principal = await requireApiPrincipal(request); return await getPublishedImage(await getDatabase(), getBlobStore(), (await context.params).id, request, principal); }
  catch (error) { return toErrorResponse(error); }
}
export async function HEAD(request: Request, context: Context) {
  try { const principal = await requireApiPrincipal(request); return await getPublishedImage(await getDatabase(), getBlobStore(), (await context.params).id, request, principal, true); }
  catch (error) {
    const response = toErrorResponse(error);
    return new Response(null, { status: response.status, headers: response.headers });
  }
}
