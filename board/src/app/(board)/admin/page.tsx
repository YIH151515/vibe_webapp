import { AdminPanel } from "@/components/admin-panel";
import {requirePagePrincipal} from "@/lib/server/auth-page";
export default async function AdminPage(){const principal=await requirePagePrincipal("/admin");return principal.isAdmin?<AdminPanel/>:<section className="feedback"><h1>접근 권한이 없습니다</h1><p>게시판 관리자만 이용할 수 있습니다.</p></section>;}
