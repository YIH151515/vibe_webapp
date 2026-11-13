import { adminRequest } from "@/lib/server/admin-http";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function DELETE(request:Request,context:{params:Promise<{id:string}>}){return adminRequest("delete",request,(await context.params).id);}
