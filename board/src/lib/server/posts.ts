import sql, { type ConnectionPool } from "mssql";
import type { Post, PostInput, PostPage, PostSummary } from "../posts/types";
import { BoardError } from "./errors";
import { parseListQuery, parsePostId, parsePostInput } from "./validation";
import type { NormalizedPostInput } from "./validation";
import { postPermissions, type OwnedRow } from "./post-authorization";
import { requireActivePrincipal } from "./auth-session";
import type { Principal } from "./auth-principal";
import { persistPostWithMedia, deletePostAndDetach, type PostMutationContext } from "./post-media";
import { normalizeDocument } from "../posts/document";
import { editorEnabled } from "./editor-config";

export interface PostService {
  list(input: { q: string; page: number }, principal: Principal): Promise<PostPage>;
  get(id: number, principal: Principal): Promise<Post>;
  create(input: PostInput, context: PostMutationContext): Promise<Post>;
  update(id: number, input: PostInput, context: PostMutationContext): Promise<Post>;
  remove(id: number, input: { confirm: true }, principal: Principal): Promise<void>;
}

type PostRow = OwnedRow & {
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

function summary(row: PostRow, principal: Principal): PostSummary {
  const id = Number(row.id);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Invalid stored post id");
  return { id, title: row.title, nickname: row.nickname, createdAt: row.created_at.toISOString(), ...postPermissions(row, principal) };
}

function post(row: PostRow, principal: Principal): Post {
  if (row.content_format === "plain" && row.content_json === null) {
    return { ...summary(row, principal), content: row.content, contentFormat: "plain", document: null };
  }
  if (row.content_format === "rich_v1" && row.content_json !== null) {
    try {
      const normalized = normalizeDocument(JSON.parse(row.content_json));
      if (normalized.text !== row.content) throw new Error("Invalid content projection");
      return { ...summary(row, principal), content: row.content, contentFormat: "rich_v1", document: normalized.document };
    } catch { /* Stored data is never treated as trusted HTML. */ }
  }
  throw new BoardError("SERVICE_UNAVAILABLE", 503, "본문을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.");
}

const columns = "id, title, nickname, created_at, author_tenant_id, author_object_id";
const lowerAscii = (value: string) => value.replace(/[A-Z]/g, character => character.toLowerCase());
const searchCondition = `WHERE
  TRANSLATE(title COLLATE Latin1_General_100_BIN2,
    N'ABCDEFGHIJKLMNOPQRSTUVWXYZ', N'abcdefghijklmnopqrstuvwxyz')
    LIKE @pattern COLLATE Latin1_General_100_BIN2 ESCAPE N'\\'
  OR TRANSLATE(content COLLATE Latin1_General_100_BIN2,
    N'ABCDEFGHIJKLMNOPQRSTUVWXYZ', N'abcdefghijklmnopqrstuvwxyz')
    LIKE @pattern COLLATE Latin1_General_100_BIN2 ESCAPE N'\\'`;

function checkRichWrite(input: NormalizedPostInput): void {
  if (!input.document) return;
  if (!editorEnabled()) {
    throw new BoardError("SERVICE_UNAVAILABLE", 503, "서식 또는 이미지 저장 기능을 준비 중입니다. 잠시 후 다시 시도해 주세요.");
  }
}

export function createPostService(pool: ConnectionPool): PostService {
  async function get(id: number, principal: Principal): Promise<Post> {
    await requireActivePrincipal(pool, principal);
    checkId(id);
    const result = await pool.request().input("id", sql.BigInt, String(id))
      .query<PostRow>(`SELECT ${columns}, content, content_format, content_json FROM dbo.posts WHERE id = @id`);
    return result.recordset[0] ? post(result.recordset[0], principal) : notFound();
  }

  return {
    get,
    async list(input, principal) {
      await requireActivePrincipal(pool, principal);
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
        return { items: result.recordset.map(row => summary(row, principal)), total, page, pageSize: 20, totalPages, q };
      } catch (error) {
        await transaction.rollback().catch(() => undefined);
        throw error;
      }
    },
    async create(input, context) {
      const normalized = parsePostInput(input);
      checkRichWrite(normalized);
      return persistPostWithMedia(pool, null, normalized, context);
    },
    async update(id, input, context) {
      checkId(id);
      const normalized = parsePostInput(input);
      checkRichWrite(normalized);
      return persistPostWithMedia(pool, id, normalized, context);
    },
    async remove(id, input, principal) {
      checkId(id);
      if (!input || input.confirm !== true || Object.keys(input).some(key => key !== "confirm")) throw new BoardError("VALIDATION_ERROR", 400, "삭제 동의가 필요합니다.");
      await deletePostAndDetach(pool, id, principal);
    },
  };
}
