import { PostDetail } from "@/components/post-detail";
import { routePostId } from "@/lib/posts/route-id";

export default async function PostPage({ params }: { params: Promise<{ id: string }> }): Promise<React.JSX.Element> {
  const id = routePostId((await params).id);
  return <PostDetail key={id} id={id} />;
}
