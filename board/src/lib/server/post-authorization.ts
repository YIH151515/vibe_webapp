import sql, { type ConnectionPool } from "mssql";
import { BoardError } from "./errors";
import { verifyPassword } from "./password";

export async function authorizePostPassword(pool: ConnectionPool, id: number, password: string): Promise<string> {
  const result = await pool.request().input("id", sql.BigInt, String(id))
    .query<{ password_hash: string }>("SELECT password_hash FROM dbo.posts WHERE id=@id");
  const row = result.recordset[0];
  if (!row) throw new BoardError("NOT_FOUND", 404, "글을 찾을 수 없습니다.");
  if (!await verifyPassword(password, row.password_hash)) throw new BoardError("INVALID_PASSWORD", 403, "비밀번호가 일치하지 않습니다.");
  return row.password_hash;
}
