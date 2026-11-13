# Current Context

## Active Plan
[자유 게시판 Azure 공개 운영](./plans/2026-11-13-free-board-azure.md)

## Active Phase
[P01 SQL·공개 운영 보안](./phases/2026-11-13-free-board-azure/P01-cloud-app/phase.md)

## Active Task
[P01-T01 SQL 저장소와 격리 테스트](./phases/2026-11-13-free-board-azure/P01-cloud-app/T01-sql-storage.md)

## Status
- 계획 완료, 구현 시작 전
- P01-T01 구현 시작 준비 완료
- done: 0/6
- 선행 조건: Docker Linux 엔진 기동 필요 (CLI 설치됨, 현재 엔진 연결 실패)
- 기존 로컬 게시판 계획은 completed 상태로 보존

## Next Step (IMPORTANT)
P01-T01 청사진을 읽고 Docker Linux 엔진을 확인한 뒤 board/src/lib/server/database.ts와 posts.ts 및 격리 SQL 테스트를 함께 전환한다. 운영 DB나 기존 SQLite 파일은 변경하지 않는다. 한 번에 현재 Task만 실행한다.
