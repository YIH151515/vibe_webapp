import { adminRequest } from "@/lib/server/admin-http";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(request:Request){return adminRequest("session",request);}
