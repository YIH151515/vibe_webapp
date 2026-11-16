# Phase: P01 이미지 백엔드와 수명 관리
- Date: 2026-11-16
- Status: in_progress

## Tasks
| Task | Status | Summary | Blueprint |
| :--- | :--- | :--- | :--- |
| T01 | done ✅ | 문서·미디어 SQL 스키마와 기존 본문 호환 | [T01](./T01-content-schema.md) |
| T02 | in_progress 🔵 | Blob/sharp·제한 body·일회용 Azurite | [T02](./T02-blob-runtime.md) |
| T03 | pending | 업로드 소유권·공유 제한·글/파일 API | [T03](./T03-media-api.md) |
| T04 | pending | outbox·정리 worker·장애/보존 회계 | [T04](./T04-cleanup-worker.md) |

## Progress
- done: 1/4 (active: T02)
- T01 commit: aa6ac86 / 전체52개(서비스27·API15·E2E10), typecheck/lint/build 통과.

## Completion
T04까지 검증/커밋 후 P02-T01로 전진한다. 운영 SQL/Blob은 이 Phase에서 변경하지 않는다.
