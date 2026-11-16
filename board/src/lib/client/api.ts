import type { ErrorBody, ErrorCode, Post, PostInput, PostPage } from "../posts/types";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly fieldErrors?: Record<string, string>,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { ...init, cache: "no-store" });
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw new ApiError(0, "INTERNAL_ERROR", "연결하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
  if (response.status === 204 && response.ok) return undefined as T;
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new ApiError(response.status, "INTERNAL_ERROR", "응답을 확인하지 못했습니다. 다시 시도해 주세요.");
  }
  if (!response.ok) {
    const body = data as Partial<ErrorBody> | null;
    const error = body?.error;
    if (error && typeof error.message === "string" && typeof error.code === "string") {
      const rawRetry = response.headers.get("retry-after");
      const retry = rawRetry && /^[1-9][0-9]*$/.test(rawRetry) && Number.isSafeInteger(Number(rawRetry))
        ? Number(rawRetry) : undefined;
      throw new ApiError(response.status, error.code, error.message, error.fieldErrors, retry);
    }
    throw new ApiError(response.status, "INTERNAL_ERROR", "처리 중 오류가 발생했습니다.");
  }
  return data as T;
}

function json(method: string, data: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) };
}

export function listPosts(params: { q: string; page: number }, signal?: AbortSignal): Promise<PostPage> {
  return request("/api/posts?" + new URLSearchParams({ q: params.q, page: String(params.page) }), { signal });
}

export function getPost(id: number, signal?: AbortSignal): Promise<Post> {
  return request(`/api/posts/${id}`, { signal });
}

export function createPost(input: PostInput, signal?: AbortSignal): Promise<Post> {
  return request("/api/posts", { ...json("POST", input), signal });
}

export function updatePost(id: number, input: PostInput, signal?: AbortSignal): Promise<Post> {
  return request(`/api/posts/${id}`, { ...json("PATCH", input), signal });
}

export function deletePost(id: number, password: string): Promise<void> {
  return request(`/api/posts/${id}`, json("DELETE", { password }));
}
