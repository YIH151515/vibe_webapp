"use client";
import { Failure, Loading } from "./feedback";
import { usePost } from "./use-post";
import { PostEditor } from "./post-editor";

export function PostForm({ mode, id }: { mode: "create" | "edit"; id?: number }): React.JSX.Element {
  const { post, loading, error, retry } = usePost(mode === "edit" ? id : undefined);
  if (mode === "edit") {
    if (loading) return <Loading />;
    if (error || !post) return <Failure error={error} retry={retry} />;
  }
  return <PostEditor key={id ?? "new"} mode={mode} initial={post} />;
}
