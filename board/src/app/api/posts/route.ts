import { getDatabase } from "@/lib/server/database";
import { ensureSameOrigin, readJson, toErrorResponse } from "@/lib/server/http";
import { createPostService } from "@/lib/server/posts";
import { parseListQuery, parsePostInput } from "@/lib/server/validation";
import { requireApiPrincipal } from "@/lib/server/auth-http";
import { getAccountKey } from "@/lib/server/auth-principal";
import { withRateLimit } from "@/lib/server/rate-limit";
import type { PostInput } from "@/lib/posts/types";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request): Promise<Response> {
  try {
    const principal = await requireApiPrincipal(request);
    const result = await createPostService(await getDatabase()).list(parseListQuery(new URL(request.url).searchParams), principal);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return toErrorResponse(error); }
}
export async function POST(request: Request): Promise<Response> {
  try {
    const principal = await requireApiPrincipal(request); ensureSameOrigin(request, { requireOrigin: true });
    const input = await readJson(request); parsePostInput(input);
    const key = getAccountKey(principal), pool = await getDatabase();
    const post = await withRateLimit(pool, "post-create", key, () => createPostService(pool).create(input as PostInput, { principal, clientKey: key }));
    return Response.json(post, { status: 201, headers: { "Cache-Control": "no-store", Location: "/posts/" + post.id } });
  } catch (error) { return toErrorResponse(error); }
}
