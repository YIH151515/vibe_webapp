# Current Context

## Active Plan
[웹 에디터와 이미지 업로드](./plans/2026-11-16-rich-editor-images.md)

## Active Phase
[P01 이미지 백엔드와 수명 관리](./phases/2026-11-16-rich-editor-images/P01-media-backend/phase.md)

## Active Task
[P01-T02 Blob·이미지 처리와 Azurite 격리](./phases/2026-11-16-rich-editor-images/P01-media-backend/T02-blob-runtime.md)

## Status
- P01-T01 완료 (commit: aa6ac86), T02 구현 시작 준비 완료
- done: 1/7 (P01 1/4, P02 0/3)
- feature/rich-editor-images에서 문서/schema4/DTO/feature flag/기존글 호환 구현 완료. 운영 SQL·Azure·main 배포는 변경하지 않았다.
- 전체52개(서비스·문서·보안27/API15/E2E10), typecheck/lint/build, git diff --check 통과. 소유 SQL 테스트 컨테이너 정리 완료.
- schema4는 일회용 SQL에서만 검증했다. 현재 브랜치를 운영 SQL3에 연결해 사용하려고 migration을 앞당기지 않는다.
- Tiptap3.34.0 + private Azure Blob + 5MiB/장·5장/글·20MiB/글, 전체 추적 용량1GiB
- 이전 Azure 공개 운영 계획은 completed 6/6으로 보존: [기존 계획](./plans/2026-11-13-free-board-azure.md)
- 기존 공개 앱은 마지막 검증 배포57fda56f9e28dbc33971323dd804b2268cee5a55, DEX/rg-vibe-board-prod/B1x1/SQLBasic2GB. 현 상태는 실행 전 재확인한다.
- 로컬은 운영 SQL을 참조한다. Blob은 아직 도입 전이다. 테스트는 NODE_ENV=test + loopback SQL이며 T02에서 일회용 Azurite와 추가 guard를 도입한다.
- 사용자 next-env.d.ts 미커밋 변경/루트 도구/기존 SQLite는 보존한다.
- 추가 선택은 기존 사용자 지시에 따라 권고안으로 정했다. 부족한 실제 인증·권한만 실행 단계에서 요청한다.

## Next Step (IMPORTANT)
P01-T02 청사진 한 개를 읽고 private Blob 어댑터·sharp 이미지 변환·제한된 multipart body·Azurite 격리 fixture와 Linux native 패키지 검증을 구현한다. 현재 feature 브랜치를 유지하고 next-env.d.ts 사용자 변경을 보존한다. SQL BIGINT 반환값은 문자열일 수 있으므로 후속 byte/capacity 연산에서 안전한 숫자 변환이 필요하다. 운영 migration·main push·Azure 변경은 하지 않는다. 운영 Blob 준비는 P02-T02, 운영 schema4와 공개 활성화는 마지막 P02-T03에서만 수행한다.
