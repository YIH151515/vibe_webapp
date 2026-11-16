import { BoardError } from "./errors";

export function editorEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.EDITOR_FEATURE_ENABLED ?? "0";
  if (value === "0") return false;
  if (value === "1") return true;
  throw new BoardError("SERVICE_UNAVAILABLE", 503, "에디터 설정을 확인해 주세요.");
}
