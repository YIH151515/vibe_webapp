# Current Context

## Active Plan
[웹 에디터와 이미지 업로드](./plans/2026-11-16-rich-editor-images.md)

## Active Phase
[P02 에디터 UI와 Azure 공개](./phases/2026-11-16-rich-editor-images/P02-editor-delivery/phase.md)

## Active Task
[P02-T03 이미지 에디터 공개와 운영 인계](./phases/2026-11-16-rich-editor-images/P02-editor-delivery/T03-live-release.md)

## Status
- 최종 릴리스 준비에서 확인할 항목: rich 저장 payload는 document만 전송하고 values.content의 이전 평문을 제외한다. 현재 post-editor.tsx가 values 전체를 펼쳐 긴 기존 본문과 document가 중복되어64KiB를 넘을 수 있다. P02-T03에서 이 한정된 client 수정과 큰 rich 문서의 편집 회귀를 추가한 뒤 flag1 배포한다. flag0 호환 baseline의 일반 글 경로에는 영향 없다.
- 사용자 요청(2026-11-16): 에디터·이미지 업로드까지 완성한 뒤 운영에 배포하고 URL을 안내한다(선택1). 남은 Task를 순서대로 자동 연속 실행하며, P02-T03의 안전한 schema4 전환/Actions 배포/실제 QA까지 완료한다. 기반 코드만 먼저 배포하는 선택은 하지 않았다.
- P02-T02 완료 (commit: 6d7b5d9). Azure private Blob/역할/비활성 설정과 검증 rollback ZIP 준비 완료. P02-T03 실행 중
- done: 6/7 (P01 4/4, P02 2/3)
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
P02-T03 청사진대로 긴 문서 payload 보완, 운영 QA 도구와 격리 검증, schema4 전환, main Actions 배포, flag0/flag1 실제 검증·정리·운영 인계를 순서대로 완료한다. 검증된 schema4 호환 ZIP은 board/.deploy/compat-schema4에 보관. 운영 SQL은 아직3이며 flags0이다. 사용자 승인으로 자동 연속 실행한다.
