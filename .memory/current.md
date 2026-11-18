# Current Context

## Active Plan
[자유 게시판 Entra ID 로그인](./plans/2026-11-18-entra-id-login.md)

## Active Phase
[P02 화면과 실제 Entra 운영 전환](./phases/2026-11-18-entra-id-login/P02-entra-delivery/phase.md)

## Active Task
[P02-T02 Entra 앱·역할·설정과 사전 로그인](./phases/2026-11-18-entra-id-login/P02-entra-delivery/T02-entra-provisioning.md)

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
P02-T01 source a9dd971 완료. done4/6(P01 3/3, P02 1/3). test:all서비스77/API21/E2E28,타입/lint/build/workflow/diff,Linux패키지1개검증성공. T02 blueprint를읽고운영현황/권한을재확인한뒤별도prod/local Entra앱·역할·90일secret/DPAPI·local설정·실제SSO사전검증·schema5maintenance기준ZIP을준비한다. 아직운영SQL/Azure/Entra/main변경없음. 현재board.zip은커밋전검증용(HEAD9a39006기준metadata)이므로운영기준ZIP으로사용금지; 소스a9dd971이커밋된뒤정확한commit으로재빌드해야한다. 사용자3000/next-env/루트도구보존. 실제회사로그인/MFA만사람이수행하며자동연속배포요청유지.
