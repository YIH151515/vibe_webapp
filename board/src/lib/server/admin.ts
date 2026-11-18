import type { ConnectionPool } from "mssql";
import type { SessionDto } from "../auth/types";
import type { Principal } from "./auth-principal";
import { parsePostId } from "./validation";
import { deletePostAndDetach } from "./post-media";
export type AdminSession = SessionDto;
export async function deletePostAsAdmin(pool: ConnectionPool, id: number, principal: Principal): Promise<void> {
  parsePostId(String(id)); await deletePostAndDetach(pool, id, principal, true);
}
