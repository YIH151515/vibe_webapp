import { headers } from "next/headers";
import { requirePagePrincipal } from "@/lib/server/auth-page";
export const dynamic="force-dynamic";
export default async function BoardLayout({children}:{children:React.ReactNode}){
 await requirePagePrincipal((await headers()).get("x-board-return-to")??"/");
 return children;
}
