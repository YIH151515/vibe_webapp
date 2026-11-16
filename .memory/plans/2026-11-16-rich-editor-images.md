# Plan: 자유 게시판 웹 에디터와 이미지 업로드

- Date: 2026-11-16
- Status: completed
- Decisions: [확정 결정](../decisions/2026-11-16-rich-editor-images.md)
- Branch: feature/rich-editor-images (실행 T01에서 생성; 계획 단계에서는 생성하지 않음)

## Goal
Tiptap3 MIT 에디터로 작성/수정하고, private Azure Blob의 JPEG/PNG/WebP 입력(5MiB/장·5장/글·합20MiB)을 안전한 WebP로 게시한다. 기존 일반 텍스트 글/검색/비밀번호/관리자 삭제를 보존하며 미사용·삭제 파일과1GiB 용량을 관리한다. 운영 공개 검증까지 마쳐야 완료한다.

## Phases
| Phase | Status | Summary | Blueprint |
| :--- | :--- | :--- | :--- |
| P01 | completed | 문서 스키마·이미지 저장·API·정리 수명 관리 | [P01](../phases/2026-11-16-rich-editor-images/P01-media-backend/phase.md) |
| P02 | completed | 에디터 UI·Azure Blob 인프라·공개 릴리스 | [P02](../phases/2026-11-16-rich-editor-images/P02-editor-delivery/phase.md) |

## Task roadmap
| 순서 | Task | 주요 파일/결과 |
| :--- | :--- | :--- |
| 1 | P01-T01 content-schema | 004 SQL, document.ts, posts/types/validation, schema-version, grants/기존 DTO 테스트 |
| 2 | P01-T02 blob-runtime | blob-store/image-processing/multipart, Azurite test wrapper, native sharp Linux package 검사 |
| 3 | P01-T03 media-api | 세션/토큰·건수/바이트/용량 예약, upload/GET API, 글/관리자와 asset 원자 연결 |
| 4 | P01-T04 cleanup-worker | SQL outbox/lease·24h 초안/7일 보존·instrumentation·CLI |
| 5 | P02-T01 editor-ui | Tiptap/한국어 툴바·메모리 미리보기·저장 pipeline·상세 React 렌더러·접근성 |
| 6 | P02-T02 azure-storage | Bicep Blob/앱 system identity/data RBAC, 새 설정·운영 도구·schema4 비활성 rollback 아티팩트 준비 |
| 7 | P02-T03 live-release | coordinated schema4/main/CI, flag0 baseline→1 활성화, 실제 이미지 QA·재시작/삭제·인계 |

## Milestone를 나눈 이유
P01은 파일과 글이 별도 시스템이어도 고아 파일·소유권 오류·동시 용량 우회 없이 동작하는 백엔드 경계다. P02는 그 계약으로 UI를 완성하고 실제 Azure 인증/권한/배포를 검증하는 경계다. 단순 UI 버튼별 Phase는 만들지 않는다. 각 Task는 단독 관련 검증이 통과하는 생산 단위로 구성한다.

## Rollout / rollback
- 구현/검증은 feature 브랜치. 미완성 소스를 main 자동 배포하지 않는다. P02-T02는 새 Blob/IAM/설정만 적용하며 운영 SQL은 여전히3이다.
- P02-T03에서 전체 준비 후 schema4 적용→main push와 실제 CI/OIDC 배포를 연속 수행한다. 기존 B1의 짧은 전환 시간은 허용한다. 먼저 EDITOR_FEATURE_ENABLED=0으로 호환 baseline을 검증/보관한 뒤1로 활성화한다.
- flag0에서도 기존rich 조회/이미지 읽기/인증된 삭제는 가능하고 rich 쓰기는503이다. legacy plain 수정으로rich를 덮어쓰면409이다. 이전schema3 아티팩트는 rollback 대상이 아니다. DB 역migration/전체 초기화를 하지 않는다.
- 운영/로컬은 같은 SQL/Blob. 테스트는 NODE_ENV=test와 SQL+Azurite 이중 guard. 비밀/파일이 .env/Git/artifact에 섞이지 않게 한다.

## Verification / 비용
- 기존43개 회귀를 새 DTO로 갱신하고 문서/XSS·이미지 형식·동시 예약·권한·저장소 장애·정리 경쟁·PC1280/390px·IME·Linux sharp/Blob SDK를 추가 검증한다.
- Azurite는 실제 soft delete/undelete를 지원하지 않는다. Azure를 테스트 대체 대상으로 삼지 않고 clock 주입 fake store로7일 회복/용량 회계를 검사한다. 실제 Azure에서는 own QA와 정책/삭제 marker를 제한적으로 확인한다.
- 같은 DEX/RG/KoreaCentral에 Hot LRS private Blob1개. 활성/예약/삭제보존 포함1GiB. 월50,000원 목표/기존B1·SQL 유지, 저장·트랜잭션·송신 비용은 실제 생성 전 재조회한다.
- Tiptap3.34.0은 React19 peer를 확인했다. Azure SDK/identity/sharp Node engines는24 호환을 npm 메타데이터로 확인했다. 설치는 실행 단계에서 exact pin한다. Azurite3.37.0 태그 가용성은 실행 때 검사한다.

## Definition of Done
- [x] 7개 Task와 모든 격리 회귀/빌드 통과.
- [x] 기존 plain 글 무변경·검색·비밀번호·관리자 정책 유지, 서식/이미지 신규·수정·상세 PC/모바일 성공.
- [x] 운영 Blob private/TLS/SharedKeyOff/컨테이너 범위 앱ID·로컬 역할, soft delete7일 확인.
- [x] SQL/Blob 실패·중복·정리 경쟁·byte/capacity 한도, QA 자기 데이터만 정리.
- [x] 실제 main Actions 성공 SHA, 이미지 새로고침/재시작/수정/삭제/정리와 rollback baseline 기록.
- [x] plan/phase/current completed, 비밀 없이 운영 기록과 비용/복원 절차 갱신.

## Adjacent findings
이번 범위 밖에서 새로 발견한 별도 결함 없음. schema3 health 고정값/일반 텍스트 DTO/관리자 직접 DELETE/JSON64KiB는 이 기능을 위해 반드시 함께 바꿀 부분으로 Task에 포함했다. 기존 개발 의존성 경고의 major 갱신, 사용자 next-env 변경/루트 도구 정리는 포함하지 않는다.

## Completion
전체7/7 완료. 실제 운영 commit77fe827b4ca69cfc9a82cf79688133a1e72ba920, Actions43826431986 success. SQL4/두flag1, private Blob와 실제 이미지·브라우저·재시작·관리자·정리 검증 성공. Task 완료 문서a264b3f와 이후 포인터 문서는 재배포하지 않는다. baseline/396bytes7일 보존/복구·비용·한계는 board/docs/images-runbook.md에 기록했다. Active Task 없음.
