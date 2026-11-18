import { getDatabase } from "@/lib/server/database";
import { ensureSameOrigin, readJson, toErrorResponse } from "@/lib/server/http";
import { createPostService } from "@/lib/server/posts";
import { parsePostId, parsePostInput } from "@/lib/server/validation";
import { requireApiPrincipal } from "@/lib/server/auth-http";
import { getAccountKey } from "@/lib/server/auth-principal";
import type { PostInput } from "@/lib/posts/types";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type ItemContext = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: ItemContext): Promise<Response> {
  try {
    const principal = await requireApiPrincipal(request);
    const post = await createPostService(await getDatabase()).get(parsePostId((await context.params).id), principal);
    return Response.json(post, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return toErrorResponse(error); }
}
export async function PATCH(request: Request, context: ItemContext): Promise<Response> {
  try {
    const principal = await requireApiPrincipal(request); ensureSameOrigin(request, { requireOrigin: true });
    const id = parsePostId((await context.params).id), input = await readJson(request); parsePostInput(input);
    const post = await createPostService(await getDatabase()).update(id, input as PostInput, { principal, clientKey: getAccountKey(principal) });
    return Response.json(post, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return toErrorResponse(error); }
}
export async function DELETE(request: Request, context: ItemContext): Promise<Response> {
  try {
    const principal = await requireApiPrincipal(request); ensureSameOrigin(request, { requireOrigin: true });
    const id = parsePostId((await context.params).id), input = await readJson(request);
    await createPostService(await getDatabase()).remove(id, input as { confirm: true }, principal);
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return toErrorResponse(error); }
}
