import { getDatabase } from "@/lib/server/database";
import { ensureSameOrigin, readJson, toErrorResponse } from "@/lib/server/http";
import { createPostService } from "@/lib/server/posts";
import { parseListQuery, parsePostInput } from "@/lib/server/validation";
import { getClientKey } from "@/lib/server/request-context";
import { withRateLimit } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const query = parseListQuery(new URL(request.url).searchParams);
    const result = await createPostService(await getDatabase()).list(query);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    ensureSameOrigin(request);
    const input = parsePostInput(await readJson(request));
    const key = getClientKey(request);
    const pool = await getDatabase();
    if (input.document) ensureSameOrigin(request, { requireOrigin: true });
    const post = await withRateLimit(pool, "post-create", key, () => createPostService(pool).create(input, { clientKey: key }));
    return Response.json(post, {
      status: 201,
      headers: { "Cache-Control": "no-store", Location: `/posts/${post.id}` },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
