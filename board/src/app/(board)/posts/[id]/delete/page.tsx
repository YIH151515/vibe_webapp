import { DeletePostForm } from "@/components/delete-post-form";
import { routePostId } from "@/lib/posts/route-id";

export default async function DeletePostPage({ params }: { params: Promise<{ id: string }> }): Promise<React.JSX.Element> {
  const id = routePostId((await params).id);
  return <DeletePostForm key={id} id={id} />;
}
