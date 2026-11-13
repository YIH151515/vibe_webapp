import { getDatabase } from "@/lib/server/database";
import { ensureSameOrigin, readJson, toErrorResponse } from "@/lib/server/http";
import { createPostService } from "@/lib/server/posts";
import { parsePasswordInput, parsePostId, parsePostInput } from "@/lib/server/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ItemContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: ItemContext): Promise<Response> {
  try {
    const id = parsePostId((await context.params).id);
    const post = createPostService(getDatabase()).get(id);
    return Response.json(post, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: ItemContext): Promise<Response> {
  try {
    ensureSameOrigin(request);
    const input = parsePostInput(await readJson(request));
    const id = parsePostId((await context.params).id);
    const post = await createPostService(getDatabase()).update(id, input);
    return Response.json(post, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: ItemContext): Promise<Response> {
  try {
    ensureSameOrigin(request);
    const input = parsePasswordInput(await readJson(request));
    const id = parsePostId((await context.params).id);
    await createPostService(getDatabase()).remove(id, input);
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error);
  }
}
