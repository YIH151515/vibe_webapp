import type { DatabaseSync } from "node:sqlite";
import type { Post, PostInput, PostPage, PostSummary } from "../posts/types";
import { BoardError } from "./errors";
import { hashPassword, verifyPassword } from "./password";
import { parseListQuery, parsePasswordInput, parsePostId, parsePostInput } from "./validation";

export interface PostService {
  list(input: { q: string; page: number }): PostPage;
  get(id: number): Post;
  create(input: PostInput): Promise<Post>;
  update(id: number, input: PostInput): Promise<Post>;
  remove(id: number, input: { password: string }): Promise<void>;
}

function checkId(id: number): void {
  if (typeof id !== "number") {
    throw new BoardError("VALIDATION_ERROR", 400, "올바른 글 번호가 필요합니다.");
  }
  parsePostId(String(id));
}

function notFound(): never {
  throw new BoardError("NOT_FOUND", 404, "글을 찾을 수 없습니다.");
}

const publicColumns = "id, title, nickname, created_at AS createdAt";
const searchCondition = "WHERE title LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\'";

export function createPostService(db: DatabaseSync): PostService {
  function get(id: number): Post {
    checkId(id);
    const post = db.prepare(`SELECT ${publicColumns}, content FROM posts WHERE id = ?`)
      .get(id) as Post | undefined;
    return post ?? notFound();
  }

  async function authorize(id: number, password: string): Promise<string> {
    const row = db.prepare("SELECT password_hash FROM posts WHERE id = ?").get(id);
    if (!row) notFound();
    const hash = row.password_hash as string;
    if (!(await verifyPassword(password, hash))) {
      throw new BoardError("INVALID_PASSWORD", 403, "비밀번호가 일치하지 않습니다.");
    }
    return hash;
  }

  return {
    get,
    list(input) {
      if (typeof input.q !== "string" || typeof input.page !== "number") {
        throw new BoardError("VALIDATION_ERROR", 400, "올바른 검색 조건이 필요합니다.");
      }
      const { q, page: requestedPage } = parseListQuery(
        new URLSearchParams({ q: input.q, page: String(input.page) }),
      );
      const pattern = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
      const bindings = [pattern, pattern];
      db.exec("BEGIN");
      try {
        const total = db.prepare(`SELECT count(*) AS total FROM posts ${searchCondition}`)
          .get(...bindings)!.total as number;
        const totalPages = Math.max(1, Math.ceil(total / 20));
        const page = Math.min(requestedPage, totalPages);
        const items = db.prepare(`
          SELECT ${publicColumns} FROM posts ${searchCondition}
          ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?
        `).all(...bindings, 20, (page - 1) * 20) as PostSummary[];
        db.exec("COMMIT");
        return { items, total, page, pageSize: 20, totalPages, q };
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    async create(input) {
      const normalized = parsePostInput(input);
      const hash = await hashPassword(normalized.password);
      const result = db.prepare(`
        INSERT INTO posts (title, content, nickname, password_hash, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(normalized.title, normalized.content, normalized.nickname, hash, new Date().toISOString());
      return get(Number(result.lastInsertRowid));
    },
    async update(id, input) {
      checkId(id);
      const normalized = parsePostInput(input);
      const hash = await authorize(id, normalized.password);
      const result = db.prepare(`
        UPDATE posts SET title = ?, content = ?, nickname = ?
        WHERE id = ? AND password_hash = ?
      `).run(normalized.title, normalized.content, normalized.nickname, id, hash);
      if (result.changes === 0) notFound();
      return get(id);
    },
    async remove(id, input) {
      checkId(id);
      const { password } = parsePasswordInput(input);
      const hash = await authorize(id, password);
      const result = db.prepare("DELETE FROM posts WHERE id = ? AND password_hash = ?").run(id, hash);
      if (result.changes === 0) notFound();
    },
  };
}
