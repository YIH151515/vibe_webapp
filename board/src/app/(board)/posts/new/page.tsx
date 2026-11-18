import { PostForm } from "@/components/post-form";

import {requirePagePrincipal} from "@/lib/server/auth-page";
export default async function NewPostPage(): Promise<React.JSX.Element> {
  const principal=await requirePagePrincipal("/posts/new"); return <PostForm mode="create" authorName={principal.displayName} />;
}
