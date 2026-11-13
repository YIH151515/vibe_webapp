import type { PostInput } from "../posts/types";

export function validatePassword(password: string): string | undefined {
  return password.length < 8 || password.length > 64 || !password.trim()
    ? "비밀번호는 공백만 제외한 8~64자로 입력해 주세요."
    : undefined;
}

export function validatePost(input: PostInput): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const [key, label, min, max] of [
    ["title", "제목", 1, 100],
    ["content", "본문", 1, 10000],
    ["nickname", "닉네임", 2, 20],
  ] as const) {
    const value = (key === "content" ? input[key].replace(/\r\n/g, "\n") : input[key]).trim();
    if (value.length < min || value.length > max) errors[key] = `${label}은(는) ${min}~${max}자로 입력해 주세요.`;
  }
  const password = validatePassword(input.password);
  if (password) errors.password = password;
  return errors;
}
