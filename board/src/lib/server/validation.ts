import { DocumentValidationError, normalizeDocument, type RichDocument } from "../posts/document";
import { BoardError } from "./errors";

function invalid(fieldErrors: Record<string, string>): never {
  throw new BoardError(
    "VALIDATION_ERROR",
    400,
    "입력 내용을 확인해 주세요.",
    fieldErrors,
  );
}

function objectInput(value: unknown): Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) {
    invalid({ form: "올바른 입력 객체가 필요합니다." });
  }
  return value as Record<string, unknown>;
}

function text(
  value: unknown,
  field: string,
  label: string,
  min: number,
  max: number,
): string {
  if (typeof value !== "string") {
    invalid({ [field]: `${label}을(를) 문자열로 입력해 주세요.` });
  }
  const normalized = (field === "content" ? value.replace(/\r\n/g, "\n") : value).trim();
  if (normalized.length < min || normalized.length > max) {
    invalid({ [field]: `${label}은(는) ${min}~${max}자로 입력해 주세요.` });
  }
  return normalized;
}

export function parsePasswordInput(value: unknown): { password: string } {
  const { password } = objectInput(value);
  if (
    typeof password !== "string" ||
    password.length < 8 ||
    password.length > 64 ||
    password.trim().length === 0
  ) {
    invalid({ password: "비밀번호는 공백만 제외한 8~64자로 입력해 주세요." });
  }
  return { password };
}

export type NormalizedPostInput = {
  title: string; content: string;
  contentFormat: "plain" | "rich_v1"; document: RichDocument | null; uploadSessionToken?: string;
};

export function parsePostInput(value: unknown): NormalizedPostInput {
  const input = objectInput(value);
  if (Object.keys(input).some(key => !["title", "content", "document", "uploadSessionToken"].includes(key))) invalid({ form: "허용되지 않은 입력 항목입니다." });
  let content: string, document: RichDocument | null = null;
  if (input.document !== undefined && input.document !== null) {
    try {
      const normalized = normalizeDocument(input.document);
      document = normalized.document;
      content = normalized.text;
    } catch (error) {
      if (error instanceof DocumentValidationError) invalid({ content: error.message });
      throw error;
    }
  } else content = text(input.content, "content", "본문", 1, 10000);
  if (input.uploadSessionToken !== undefined && (typeof input.uploadSessionToken !== "string" ||
    !/^[a-f0-9]{64}$/.test(input.uploadSessionToken) || input.uploadSessionToken.length !== 64)) {
    invalid({ content: "이미지 업로드 세션을 확인해 주세요." });
  }
  return {
    title: text(input.title, "title", "제목", 1, 100),
    content, contentFormat: document ? "rich_v1" : "plain", document,
    ...(input.uploadSessionToken !== undefined ? { uploadSessionToken: input.uploadSessionToken as string } : {}),
  };
}

function positiveInteger(raw: string, field: string): number {
  if (raw !== raw.trim() || !/^[1-9][0-9]*$/.test(raw) || !Number.isSafeInteger(Number(raw))) {
    invalid({ [field]: "양의 안전한 정수를 입력해 주세요." });
  }
  return Number(raw);
}

export function parsePostId(raw: string): number {
  if (typeof raw !== "string") {
    invalid({ id: "올바른 글 번호가 필요합니다." });
  }
  return positiveInteger(raw, "id");
}

export function parseListQuery(params: URLSearchParams): { q: string; page: number } {
  for (const field of ["q", "page"]) {
    if (params.getAll(field).length > 1) {
      invalid({ [field]: "같은 검색 조건을 여러 번 지정할 수 없습니다." });
    }
  }
  const q = (params.get("q") ?? "").trim();
  if (q.length > 100) {
    invalid({ q: "검색어는 100자 이하로 입력해 주세요." });
  }
  return { q, page: positiveInteger(params.get("page") ?? "1", "page") };
}
