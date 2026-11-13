"use client";

import { useEffect, useState } from "react";
import { getPost } from "@/lib/client/api";
import type { Post } from "@/lib/posts/types";

export function usePost(id?: number) {
  const [attempt, setAttempt] = useState(0);
  const key = `${id}:${attempt}`;
  const [result, setResult] = useState<{ key: string; post?: Post; error?: unknown }>({ key: "" });
  useEffect(() => {
    if (id === undefined) return;
    const controller = new AbortController();
    getPost(id, controller.signal).then(
      post => { if (!controller.signal.aborted) setResult({ key, post }); },
      error => { if (!controller.signal.aborted) setResult({ key, error }); },
    );
    return () => controller.abort();
  }, [id, key]);
  return {
    post: result.key === key ? result.post : undefined,
    error: result.key === key ? result.error : undefined,
    loading: id !== undefined && result.key !== key,
    retry: () => setAttempt(value => value + 1),
  };
}
