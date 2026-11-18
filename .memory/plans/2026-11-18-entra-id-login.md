# Plan: 자유 게시판 Entra ID 로그인

- Date: 2026-11-18
- Status: completed
- Decisions: [확정 결정](../decisions/2026-11-18-entra-id-login.md)
- Branch: feature/entra-id-login (첫 Task 실행 시 생성; 계획 단계에서는 변경하지 않음)

## Goal
운영과 로컬에 실제 단일 테넌트 Entra 로그인을 붙인다. 사내 Member만 글/이미지를 읽고 작성하며, 본인 글만 수정·삭제한다. 윤일호만 최초 Board.Admin이고 기존 비회원 글은 보존·열람/관리자 삭제만 허용한다. 실제 SSO·역할·재시작·자기 QA 정리와 main Actions 배포까지 검증해야 완료한다.

## Phases
| Phase | Status | Summary | Blueprint |
| :--- | :--- | :--- | :--- |
| P01 | done ✅ | SQL5·세션/OIDC·서버 소유권과 보호 경계 | [P01](../phases/2026-11-18-entra-id-login/P01-auth-core/phase.md) |
| P02 | done ✅ | 화면 전환·Entra 실제 등록·비공개 운영 전환 | [P02](../phases/2026-11-18-entra-id-login/P02-entra-delivery/phase.md) |

## Task roadmap
| 순서 | Task | 주요 결과/파일 |
| :--- | :--- | :--- |
| 1 | P01-T01 identity-schema | 005 SQL, users/sessions/login attempts, additive nullable owner, auth config/principal/session, grants/SQL 테스트 |
| 2 | P01-T02 oidc-login | openid-client Code+PKCE, login/callback/session/logout, 일회용 encrypted flow, 격리 fake issuer/로그 보호 |
| 3 | P01-T03 board-authorization | 모든 API·이미지·글/업로드/관리자 서비스의 세션·계정 소유권·계정별 quota 전환, API/서비스 회귀 |
| 4 | P02-T01 identity-ui | 로그인/사용자 메뉴·작성자 표시·비밀번호 제거·legacy 권한 UI·페이지 보호·E2E/패키지/실제 검증 도구 전환 |
| 5 | P02-T02 entra-provisioning | 운영/로컬 별도 Entra 앱·acct·Board.Admin·정확한 callback·secret/설정·실제 사전 SSO·maintenance baseline |
| 6 | P02-T03 private-release | SQL5 전환·닫힌 baseline·main Actions·운영/로컬 실제 SSO/이미지 QA·복구/문서·completed6/6 |

## 물리적 마일스톤
P01은 가짜 서명 issuer와 일회용 SQL/Azurite만으로 인증·권한 경계를 검증하는 서버 기반이다. P02는 그 계약에 화면을 붙이고 실제 Entra 권한/사람의 MFA가 필요한 외부 연동·공개 전환을 수행한다. 모델/서비스/API를 쪼개어 빌드가 깨지는 중간 상태를 만들지 않고, T03에서 해당 서비스/DTO/모든 호출부·fixture를 원자적으로 바꾼다.

## 공통 경계
- 기존 DEX subscription7b1417d8-833d-4ba9-a5cd-d27c91a28b83/tenant69c1e470-4528-435a-a1ae-de98e0aac738/RG rg-vibe-board-prod/B1x1/SQLBasic2GB/Blob stvibeboardimg7b1417/board-images 유지.
- 현재 배포 기록77fe827/schema4는 실행 전 재확인. 기존 글 개수는 이번 인터뷰에서 조회 실패했으므로0개라고 가정하지 않는다. DB/글/파일/카운터 초기화·역migration·force push 금지.
- 사용자 next-env.d.ts 미커밋 dev 경로·루트 도구·AGENTS/zip/SQLite·기존3000 서버·Docker pad 보존. git add . 금지. 각 Task 지정 파일과 해당 memory만 stage.
- 계획 산출물은 .memory만. 실행은 첫 Task에서 새 브랜치, 설치/코드/Entra 변경/운영 SQL5/main push는 각 Task 권한 범위에서만 수행.
- 자동 테스트는 .env.local/실제Entra/운영SQL·Blob를 읽지 않는다. 기존 loopback SQL board_test_32hex + Azurite 이중 guard에 loopback fake OIDC issuer guard를 추가한다.
- 실제 개발은 실제 Entra. 기존3000을 종료하지 않고 실제 새 앱 QA는3200을 사용한다. 로컬/운영 별도 client ID·secret과 origin으로 세션을 구분한다.
- 운영 secret/code/state/token/cookie/PKCE/실제 사용자 글/원문IP/파일명은 로그/trace/문서/ZIP에 넣지 않는다. Next dev callback URL logging과 Azure HTTP query logging도 확인한다.

## 최종 고정 계약
- OIDC issuer=https://login.microsoftonline.com/<tenant>/v2.0, scopes openid profile, acct=0 필수, tid+oid를 사용자 키로 사용, roles의 Board.Admin만 관리자로 인정.
- AUTH_MODE=maintenance|entra, 미설정 기본maintenance. maintenance는 보호 콘텐츠503/로그인 안내200/health기존계약을 제공하며 익명 허용 모드는 없다. entra의 설정·DB 오류도 fail-closed.
- 세션은 SQL 해시 저장·opaque 쿠키·최대1시간/ID token exp 이내, flow10분 일회용 AES-256-GCM. 회사 전체 SSO 로그아웃은 하지 않는다.
- HTTP: 로그인 페이지 /login, POST /api/auth/login, GET /api/auth/callback, GET /api/auth/session, POST /api/auth/logout. callback/query 이외 변경은 strict Origin, API401/403 JSON, protected page→/login. health와 필요한 static만 익명 예외.
- 새 PostInput은 title/content 또는document/uploadSessionToken만. nickname은 서버의 Entra 이름, password 없음. 소유권이 없는 legacy는수정403/본인삭제403, 관리자삭제가능. Post와PostSummary에는 요청자별 canEdit/canDelete를 추가하고 내부oid/tid/hash는 반환하지 않는다.
- 이미지 조회도 인증필수/private,no-store. 업로드token은 계정+발급앱세션+origin/clientID와 결합. IP공유회사 직원의 quota는계정별로 기존숫자/기간을 유지한다.

## 안전한 운영 전환
T02의 외부 연동 준비에서 실제 사용자 사전 로그인/Member/Admin claim과 SQL 연결·역할 권한을 확인하고, 새 코드의 schema5 호환 maintenance ZIP/해시를 확보한다. T03은 DB없이도닫히는maintenance baseline을먼저배포해옛비회원쓰기경합을막은뒤, 기존자료snapshot→SQL5 migration/grants→보존비교→main Actions 순으로수행한다. baseline이SQL4와맞지않는짧은동안health503일수있으며SQL5후health200으로회복한다. health는익명유지하므로CI는SSO없이검사할수있다. 마지막에AUTH_MODEentra로전환하고실제로컬/운영로그인·자기QA를확인한다. 실패시schema5호환maintenance ZIP으로복구하며익명공개/schema4 ZIP으로되돌리지않는다.

Entra 실제 로그인·MFA는 사람의 동작이 필요할 수 있다. 필요한 자동 준비/검증/브라우저를 모두 마련한 뒤 해당 단계만 사용자에게 안내한다. 비밀번호/MFA코드 전달이나 자동 우회를 요구하지 않는다. 사람 단계가 미완료면 Task/plan을 completed로 표시하지 않는다.

## Verification / Definition of Done
- [x] 순차6개 Task와 typecheck/lint/전체 서비스·API·E2E/Linux ZIP/워크플로 검증 통과.
- [x] 잘못된서명/tenant/aud/acct/nonce/state·중복 callback·logout 재사용·만료·타인권한·직접API/이미지 차단 검증.
- [x] 기존글/이미지/날짜 보존, legacy 수정 차단, 본인/관리자 삭제·이미지원장/정리/용량 보존.
- [x] 운영/로컬 Entra 별도 앱·최초Admin역할·실제 SSO/MFA·브라우저1280/390·재시작 확인.
- [x] main Actions SHA와 health/schema5 일치·AUTH_MODE=entra, 최종 schema5 maintenance rollback/secret 교체/역할회수 절차 기록.
- [x] 자체QA만 정리·미정리id없음·사용자변경/서버보존·plan/phase/current completed6/6 동기화.

## Adjacent findings
이번 계획 밖에서 확정한 별도 결함 없음. 비밀번호 API/author_hash·20자작성자·public 이미지캐시·익명테스트/배포검증은 인증 변경에 필수라 위 Task에 포함한다. 개발 의존성 major 업데이트, 별도 감사 시스템/사용자관리 UI, 사용자 루트 도구 정리는 포함하지 않는다.

## Completion — 2026-11-18
전체6/6 완료. T03 ef2d0dc, 실제배포 ba5e3bb223272c112b074bc0c1ec45567c419a63 / main Actions44262468755 success / SQL5 / AUTH_MODEentra. 실제두앱SSO·자체QA정리·운영재시작·원본보존·임시FW삭제 완료. 상세증거와 실계정 검증한계는 board/docs/entra-runbook.md 참조.
