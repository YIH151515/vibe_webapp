import { mkdir, rm } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

export default async function globalSetup(): Promise<void> {
  const root = resolve("test-results");
  const database = resolve(root, "api-e2e.sqlite");
  if (!database.startsWith(root + sep)) {
    throw new Error("테스트 DB 경로가 허용된 디렉터리 밖입니다.");
  }
  await mkdir(dirname(database), { recursive: true });
  for (const suffix of ["", "-wal", "-shm"]) {
    await rm(database + suffix, { force: true });
  }
}
