# Current Context

## Active Plan
[웹 에디터와 이미지 업로드](./plans/2026-11-16-rich-editor-images.md)

## Active Phase
[P01 이미지 백엔드와 수명 관리](./phases/2026-11-16-rich-editor-images/P01-media-backend/phase.md)

## Active Task
[P01-T03 업로드 소유권·공유 제한·글/파일 API](./phases/2026-11-16-rich-editor-images/P01-media-backend/T03-media-api.md)

## Status
- P01-T02 완료 (commit: d8bb41e), T03 구현 시작 준비 완료
- done: 2/7 (P01 2/4, P02 0/3)
- feature/rich-editor-images에서 문서/schema4/DTO/feature flag/기존글 호환 구현 완료. 운영 SQL·Azure·main 배포는 변경하지 않았다.
- 전체60개(서비스·문서·보안·미디어35/API15/E2E10), typecheck/lint/build, verify:azure, git diff --check 통과. Linux ZIP의 sharp native 변환/두 Azure SDK import/root/CSS/health503 확인. 소유 SQL/Azurite 테스트 컨테이너 정리 완료.
- schema4는 일회용 SQL에서만 검증했다. 현재 브랜치를 운영 SQL3에 연결해 사용하려고 migration을 앞당기지 않는다.
- Tiptap3.34.0 + private Azure Blob + 5MiB/장·5장/글·20MiB/글, 전체 추적 용량1GiB
- 이전 Azure 공개 운영 계획은 completed 6/6으로 보존: [기존 계획](./plans/2026-11-13-free-board-azure.md)
- 기존 공개 앱은 마지막 검증 배포57fda56f9e28dbc33971323dd804b2268cee5a55, DEX/rg-vibe-board-prod/B1x1/SQLBasic2GB. 현 상태는 실행 전 재확인한다.
- 로컬은 운영 SQL을 참조한다. 운영 Blob은 아직 도입 전이다. 테스트는 NODE_ENV=test + APP_TEST_MODE=1 + loopback SQL + 전용 Azurite endpoint/container/임시 key를 강제한다. .env.local은 테스트에서 읽지 않는다.
- private Blob 어댑터/제한 multipart/sharp 변환/장애주입·7일보존 fake 준비 완료. storage-blob 12.34.0에는 serviceVersion 생성자 옵션이 없어 mediaStoragePipeline 공개 정책으로 x-ms-version=2023-11-03을 고정한다. getBlobStore는 lazy이며 import/build 때 저장소에 연결하지 않는다.
- Windows cold route compile의 5초 UI timeout은 assertion 15초(기존 test budget30초 유지)와 관리자 삭제 HTTP204 확인으로 보강했다. 테스트 전용3100/.next-test만 사용했으며 사용자3000 서버는 보존했다.
- 사용자 next-env.d.ts 미커밋 변경/루트 도구/기존 SQLite는 보존한다.
- 추가 선택은 기존 사용자 지시에 따라 권고안으로 정했다. 부족한 실제 인증·권한만 실행 단계에서 요청한다.

## Next Step (IMPORTANT)
P01-T03 청사진 한 개를 읽고 업로드 세션/소유권/공유 제한/이미지 업로드·조회 API와 글 연결을 구현한다. T02의 readImageFile/normalizeImage/getBlobStore 및 mediaFixture/FakeBlobStore를 재사용한다. 현재 feature 브랜치를 유지하고 next-env.d.ts 사용자 변경을 보존한다. SQL BIGINT 반환값은 문자열일 수 있으므로 byte/capacity 연산에서 안전한 숫자 변환이 필요하다. 운영 migration·main push·Azure 변경은 하지 않는다. 운영 Blob 준비는 P02-T02, 운영 schema4와 공개 활성화는 마지막 P02-T03에서만 수행한다.
