import { request } from "./api";
import type { SessionDto } from "../auth/types";
export const appSession=()=>request<SessionDto>("/api/auth/session",{credentials:"same-origin"});
export const appLogout=()=>request<void>("/api/auth/logout",{method:"POST",credentials:"same-origin"});
