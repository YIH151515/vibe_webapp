export type PostInput = {
  title: string;
  content: string;
  nickname: string;
  password: string;
};

export type PostSummary = {
  id: number;
  title: string;
  nickname: string;
  createdAt: string;
};

export type Post = PostSummary & { content: string };

export type PostPage = {
  items: PostSummary[];
  total: number;
  page: number;
  pageSize: 20;
  totalPages: number;
  q: string;
};

export type ErrorCode =
  | "VALIDATION_ERROR"
  | "INVALID_PASSWORD"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "INTERNAL_ERROR"
  | "SERVICE_UNAVAILABLE"
  | "RATE_LIMITED"
  | "PAYLOAD_TOO_LARGE"
  | "UNAUTHENTICATED";

export type ErrorBody = {
  error: {
    code: ErrorCode;
    message: string;
    fieldErrors?: Record<string, string>;
  };
};
