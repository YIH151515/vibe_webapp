import { PostForm } from "@/components/post-form";
import { routePostId } from "@/lib/posts/route-id";

export default async function EditPostPage({ params }: { params: Promise<{ id: string }> }): Promise<React.JSX.Element> {
  const id = routePostId((await params).id);
  return <PostForm key={id} mode="edit" id={id} />;
}
