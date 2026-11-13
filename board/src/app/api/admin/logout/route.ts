import { adminRequest } from "@/lib/server/admin-http";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function POST(request:Request){return adminRequest("logout",request);}
