"use client";
import { ApiError } from "@/lib/client/api";
import { Failure, Loading } from "./feedback";
import { usePost } from "./use-post";
import { PostEditor } from "./post-editor";

export function PostForm({ mode, id, authorName }: { mode: "create" | "edit"; id?: number; authorName?: string }): React.JSX.Element {
  const { post, loading, error, retry } = usePost(mode === "edit" ? id : undefined);
  if (mode === "edit") {
    if (loading) return <Loading />;
    if (error || !post) return <Failure error={error} retry={retry} />;
    if (!post.canEdit) return <Failure error={new ApiError(403,"FORBIDDEN","본인이 작성한 글만 수정할 수 있습니다.")} />;
  }
  return <PostEditor key={id ?? "new"} mode={mode} initial={post} authorName={authorName} />;
}
