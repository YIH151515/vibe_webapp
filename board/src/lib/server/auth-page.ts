import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { SessionDto } from "../auth/types";
import { readAuthConfig } from "./auth-config";
import { authCookieNames } from "./auth-http";
import { safeReturnTo } from "./auth-flow";
import { readAppSession } from "./auth-session";
import { getDatabase } from "./database";
import type { Principal } from "./auth-principal";
async function readPrincipal():Promise<Principal|null>{
 const config=readAuthConfig();if(config.mode!=="entra")return null;
 const entries=(await cookies()).getAll(authCookieNames(config.origin).session);
 if(entries.length!==1||entries[0].value.length!==64||!/^[a-f0-9]{64}$/.test(entries[0].value))return null;
 return readAppSession(await getDatabase(),entries[0].value,config);
}
export async function requirePagePrincipal(returnTo:string):Promise<Principal>{
 const principal=await readPrincipal();
 if(!principal)redirect("/login?returnTo="+encodeURIComponent(safeReturnTo(returnTo)));
 return principal;
}
export async function readOptionalPageSession():Promise<SessionDto|null>{
 try{const p=await readPrincipal();return p?{displayName:p.displayName,isAdmin:p.isAdmin,expiresAt:p.expiresAt.toISOString()}:null;}
 catch{return null;}
}
