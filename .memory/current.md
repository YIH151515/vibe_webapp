# Current Context

## Active Plan
[자유 게시판 Entra ID 로그인](./plans/2026-11-18-entra-id-login.md)

## Active Phase
[P01 인증과 서버 권한 기반](./phases/2026-11-18-entra-id-login/P01-auth-core/phase.md)

## Active Task
[P01-T03 글·미디어·관리자 서버 권한 전환](./phases/2026-11-18-entra-id-login/P01-auth-core/T03-board-authorization.md)

## Status
- 사용자 추가 요청: 실제 서버 반영과 링크 제공까지 남은 Task를 순서대로 자동 연속 실행한다. 기반만 배포하지 않고 실제 Entra 로그인·게시판 권한·운영 검증까지 마친다. 실제 회사 로그인/MFA 단계는 자동 준비 후 사용자에게 안내한다.
- P01-T01 완료(commit cc6cd9c). done1/6 (P01 1/3, P02 0/3). schema5/설정/principal/SQL opaque세션구현,서비스66개+API18개/typecheck/lint/diffcheck통과. 새schema는일회용SQL에서만검증했으며운영SQL/Entra/Azure/main은변경하지않았다.
- [확정 결정](./decisions/2026-11-18-entra-id-login.md): 전체 게시판 로그인 필수, 동일 Entra tenant Member만, 이름표시/본인글 수정·삭제, 최초 관리자 윤일호만, legacy 보존·열람/관리자삭제, 로컬·운영 모두 실제 SSO.
- tenant69c1e470-4528-435a-a1ae-de98e0aac738, 최초admin oid e8222b20-96f4-4c25-a3af-1f40ebbbec56. 이메일은표시/운영참고이며권한키는tid+oid와Board.Admin역할이다.
- Task순서: SQL5/session → OIDC/fakeissuer → 모든서버소유권 → UI/전체검증 → 별도Entra앱/사전SSO → 닫힌운영전환/실제SSO.
- AUTH_MODEmaintenance(default)|entra만계획. SQL5 호환 maintenance ZIP으로 콘텐츠를먼저닫고 migration/grants/실제Actions 후entra로전환한다. 익명fallback/schema4 ZIP/역migration/데이터초기화금지.
- 현재기록상운영은77fe827/schema4/DEX/B1x1/SQLBasic2GB/기존privateBlob. 실제현재version/글개수는실행에서재확인한다. 인터뷰의운영SQL글개수조회실패로현재0개라고가정할수없다.
- 운영·로컬 DB/Blob공유. 자동테스트는.env.local/실제Entra/운영endpoint를읽지않고전용loopback SQL+Azurite+fakeOIDC 이중/추가guard를사용한다. 실제로컬SSO QA는새3200으로기존사용자3000을보존한다.
- 실제사람의회사SSO/MFA/필요Entra권한은자동우회불가. 자동준비/검토할산출물을완성한뒤정확한브라우저/관리자단계만안내한다. 실제검증이나자체QA정리가안됐으면완료로표시하지않는다.
- 현재feature/entra-id-login은origin/main96edfc50b2dae16b195d1b219d0fcd335c62f55d에서생성했다. main원격push없음. 사용자board/next-env.d.ts dev경로·루트도구/AGENTS/zip/SQLite·3000·Dockerpad 보존/무관stage금지.
- 이전 [웹에디터/이미지 계획](./plans/2026-11-16-rich-editor-images.md)은completed7/7로보존했다. board/docs/entra-runbook.md는이계획실행시생성할예정이다.

## Next Step (IMPORTANT)
P01-T02 완료b47774d. 현재done2/6(P01 2/3),서비스73/API21/type/lint/build통과. 새openid-client6.9.0/서명검증/PKCE/암호화flow/auth HTTP/fakeissuer를구현했고운영의존성audit0. 기존게시판API는여전히옛계약이며아직운영배포하지않았다. 사용자요청대로자동연속실행해T03을읽고모든글/이미지/업로드/관리자서버권한과DTO·fixture를전환한다. 소유권/역할은실제세션SQL에서확인한다. Source스테이징은Task지정파일만,사용자next-env/3000/도구/SQLite보존. 운영변경/mainpush는최종Task경계까지금지한다.
