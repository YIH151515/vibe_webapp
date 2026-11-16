import sql, { type ConnectionPool } from "mssql";
import type { Post, PostInput, PostPage, PostSummary } from "../posts/types";
import { BoardError } from "./errors";
import { hashPassword, verifyPassword } from "./password";
import { parseListQuery, parsePasswordInput, parsePostId, parsePostInput } from "./validation";
import type { NormalizedPostInput } from "./validation";
import { normalizeDocument } from "../posts/document";
import { editorEnabled } from "./editor-config";

export interface PostService {
  list(input: { q: string; page: number }): Promise<PostPage>;
  get(id: number): Promise<Post>;
  create(input: PostInput): Promise<Post>;
  update(id: number, input: PostInput): Promise<Post>;
  remove(id: number, input: { password: string }): Promise<void>;
}

type PostRow = {
  id: string | number;
  title: string;
  nickname: string;
  created_at: Date;
  content: string;
  content_format: "plain" | "rich_v1";
  content_json: string | null;
};

function checkId(id: number): void {
  if (typeof id !== "number") {
    throw new BoardError("VALIDATION_ERROR", 400, "올바른 글 번호가 필요합니다.");
  }
  parsePostId(String(id));
}

function notFound(): never {
  throw new BoardError("NOT_FOUND", 404, "글을 찾을 수 없습니다.");
}

function summary(row: PostRow): PostSummary {
  const id = Number(row.id);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Invalid stored post id");
  return { id, title: row.title, nickname: row.nickname, createdAt: row.created_at.toISOString() };
}

function post(row: PostRow): Post {
  if (row.content_format === "plain" && row.content_json === null) {
    return { ...summary(row), content: row.content, contentFormat: "plain", document: null };
  }
  if (row.content_format === "rich_v1" && row.content_json !== null) {
    try {
      const normalized = normalizeDocument(JSON.parse(row.content_json));
      if (normalized.text !== row.content) throw new Error("Invalid content projection");
      return { ...summary(row), content: row.content, contentFormat: "rich_v1", document: normalized.document };
    } catch { /* Stored data is never treated as trusted HTML. */ }
  }
  throw new BoardError("SERVICE_UNAVAILABLE", 503, "본문을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.");
}

const columns = "id, title, nickname, created_at";
const outputColumns = "inserted.id, inserted.title, inserted.nickname, inserted.created_at, inserted.content, inserted.content_format, inserted.content_json";
const lowerAscii = (value: string) => value.replace(/[A-Z]/g, character => character.toLowerCase());
const searchCondition = `WHERE
  TRANSLATE(title COLLATE Latin1_General_100_BIN2,
    N'ABCDEFGHIJKLMNOPQRSTUVWXYZ', N'abcdefghijklmnopqrstuvwxyz')
    LIKE @pattern COLLATE Latin1_General_100_BIN2 ESCAPE N'\\'
  OR TRANSLATE(content COLLATE Latin1_General_100_BIN2,
    N'ABCDEFGHIJKLMNOPQRSTUVWXYZ', N'abcdefghijklmnopqrstuvwxyz')
    LIKE @pattern COLLATE Latin1_General_100_BIN2 ESCAPE N'\\'`;

function postValues(request: sql.Request, input: NormalizedPostInput): sql.Request {
  return request.input("title", sql.NVarChar(100), input.title)
    .input("content", sql.NVarChar(sql.MAX), input.content)
    .input("nickname", sql.NVarChar(20), input.nickname)
    .input("format", sql.VarChar(8), input.contentFormat)
    .input("document", sql.NVarChar(sql.MAX), input.document ? JSON.stringify(input.document) : null);
}

function checkRichWrite(input: NormalizedPostInput): void {
  if (!input.document) return;
  if (!editorEnabled() || normalizeDocument(input.document).imageIds.length) {
    throw new BoardError("SERVICE_UNAVAILABLE", 503, "서식 또는 이미지 저장 기능을 준비 중입니다. 잠시 후 다시 시도해 주세요.");
  }
}

function plainConflict(): never {
  throw new BoardError("MEDIA_CONFLICT", 409, "서식이 있는 글은 서식을 유지하는 에디터로 수정해 주세요.");
}

export function createPostService(pool: ConnectionPool): PostService {
  async function get(id: number): Promise<Post> {
    checkId(id);
    const result = await pool.request().input("id", sql.BigInt, String(id))
      .query<PostRow>(`SELECT ${columns}, content, content_format, content_json FROM dbo.posts WHERE id = @id`);
    return result.recordset[0] ? post(result.recordset[0]) : notFound();
  }

  async function authorize(id: number, password: string): Promise<string> {
    const result = await pool.request().input("id", sql.BigInt, String(id))
      .query<{ password_hash: string }>("SELECT password_hash FROM dbo.posts WHERE id = @id");
    const row = result.recordset[0];
    if (!row) notFound();
    if (!(await verifyPassword(password, row.password_hash))) {
      throw new BoardError("INVALID_PASSWORD", 403, "비밀번호가 일치하지 않습니다.");
    }
    return row.password_hash;
  }

  return {
    get,
    async list(input) {
      if (typeof input.q !== "string" || typeof input.page !== "number") {
        throw new BoardError("VALIDATION_ERROR", 400, "올바른 검색 조건이 필요합니다.");
      }
      const { q, page: requestedPage } = parseListQuery(
        new URLSearchParams({ q: input.q, page: String(input.page) }),
      );
      const pattern = "%" + lowerAscii(q).replace(/[\\%_\[]/g, "\\$&") + "%";
      const transaction = new sql.Transaction(pool);
      await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
      try {
        const count = await new sql.Request(transaction).input("pattern", sql.NVarChar(202), pattern)
          .query<{ total: number }>(`SELECT COUNT(*) AS total FROM dbo.posts ${searchCondition}`);
        const total = count.recordset[0].total;
        const totalPages = Math.max(1, Math.ceil(total / 20));
        const page = Math.min(requestedPage, totalPages);
        const result = await new sql.Request(transaction)
          .input("pattern", sql.NVarChar(202), pattern)
          .input("offset", sql.Int, (page - 1) * 20)
          .query<PostRow>(`SELECT ${columns} FROM dbo.posts ${searchCondition}
            ORDER BY created_at DESC, id DESC OFFSET @offset ROWS FETCH NEXT 20 ROWS ONLY`);
        await transaction.commit();
        return { items: result.recordset.map(summary), total, page, pageSize: 20, totalPages, q };
      } catch (error) {
        await transaction.rollback().catch(() => undefined);
        throw error;
      }
    },
    async create(input) {
      const normalized = parsePostInput(input);
      checkRichWrite(normalized);
      const hash = await hashPassword(normalized.password);
      const result = await postValues(pool.request(), normalized)
        .input("hash", sql.VarChar(256), hash)
        .query<PostRow>(`INSERT INTO dbo.posts (title, content, nickname, password_hash, content_format, content_json)
          OUTPUT ${outputColumns} VALUES (@title, @content, @nickname, @hash, @format, @document)`);
      return post(result.recordset[0]);
    },
    async update(id, input) {
      checkId(id);
      const normalized = parsePostInput(input);
      checkRichWrite(normalized);
      const hash = await authorize(id, normalized.password);
      if (normalized.contentFormat === "plain" && (await get(id)).contentFormat === "rich_v1") plainConflict();
      const result = await postValues(pool.request(), normalized)
        .input("id", sql.BigInt, String(id)).input("hash", sql.VarChar(256), hash)
        .query<PostRow>(`UPDATE dbo.posts SET title = @title, content = @content, nickname = @nickname,
            content_format = @format, content_json = @document
          OUTPUT ${outputColumns} WHERE id = @id AND password_hash = @hash
            AND (@format = 'rich_v1' OR content_format = 'plain')`);
      if (result.recordset[0]) return post(result.recordset[0]);
      // A concurrent conversion to rich must never be overwritten by a legacy writer.
      const current = await get(id);
      if (normalized.contentFormat === "plain" && current.contentFormat === "rich_v1") plainConflict();
      return notFound();
    },
    async remove(id, input) {
      checkId(id);
      const { password } = parsePasswordInput(input);
      const hash = await authorize(id, password);
      const result = await pool.request().input("id", sql.BigInt, String(id))
        .input("hash", sql.VarChar(256), hash)
        .query("DELETE FROM dbo.posts WHERE id = @id AND password_hash = @hash");
      if (result.rowsAffected[0] === 0) notFound();
    },
  };
}
