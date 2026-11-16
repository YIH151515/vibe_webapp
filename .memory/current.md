# Current Context

## Active Plan
[웹 에디터와 이미지 업로드](./plans/2026-11-16-rich-editor-images.md)

## Active Phase
[P02 에디터 UI와 Azure 공개](./phases/2026-11-16-rich-editor-images/P02-editor-delivery/phase.md)

## Active Task
[P02-T02 private Blob·앱ID·권한·배포 준비](./phases/2026-11-16-rich-editor-images/P02-editor-delivery/T02-azure-storage.md)

## Status
- 사용자 요청(2026-11-16): 에디터·이미지 업로드까지 완성한 뒤 운영에 배포하고 URL을 안내한다(선택1). 남은 Task를 순서대로 자동 연속 실행하며, P02-T03의 안전한 schema4 전환/Actions 배포/실제 QA까지 완료한다. 기반 코드만 먼저 배포하는 선택은 하지 않았다.
- P02-T01 완료 (commit: e47dce5), P02-T02 구현 시작 준비 완료
- done: 5/7 (P01 4/4, P02 1/3)
- feature/rich-editor-images에서 문서/schema4/DTO/feature flag/기존글 호환 구현 완료. 운영 SQL·Azure·main 배포는 변경하지 않았다.
- 서비스·문서·보안·미디어·정리·editor54/API17/E2E20 총91개, typecheck/lint/build, verify:azure, git diff --check 통과. Linux ZIP의 sharp native 변환/두 Azure SDK import/root/CSS/health503/editor-config(flag0) 확인. 소유 SQL/Azurite 테스트 컨테이너 정리 완료.
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
P02-T02 청사진을 읽고 Azure private Blob/앱 system assigned identity/최소 container 역할/설정/비용·복구 문서를 준비한다. Tiptap3.34.0 UI와 저장 시 업로드/취소/재시도/안전한 renderer 완료. 사용자 전체 배포 승인에 따라 남은 Task를 자동 연속 실행한다. 운영 schema4 migration·main push·기능 활성화는 마지막 P02-T03에서만 한다. 현재 feature 브랜치와 next-env.d.ts 사용자 변경을 보존한다. GitHub 인증 정상, 원격 main은 마지막 조회8a646ae637631f8ee9cbe95e862fb37633532704f(실제 원문은 최종 fetch로 재확인). 운영 health는57fda56f9e28dbc33971323dd804b2268cee5a55/Running을 읽기로 확인했다.
