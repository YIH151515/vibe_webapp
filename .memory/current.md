# Current Context

## Active Plan
[자유 게시판 Entra ID 로그인](./plans/2026-11-18-entra-id-login.md)

## Active Phase
[P02 화면과 실제 Entra 운영 전환](./phases/2026-11-18-entra-id-login/P02-entra-delivery/phase.md)

## Active Task
[P02-T03 닫힌 운영 전환과 실제 로그인 검증](./phases/2026-11-18-entra-id-login/P02-entra-delivery/T03-private-release.md)

## Status
- 사용자 요청: 실제 서버 반영과 링크 제공까지 자동 연속 실행. 새버전 운영배포는 아직이며 실제회사로그인/MFA가 필수로 남았다.
- done4/6. P01완료3/3: SQL5/session cc6cd9c, OIDC b47774d, 서버권한8bc9c2b. P02-T01 UI/페이지보호/실제QA도구 a9dd971 완료. T02시작포인터 c62339c5eadfa61ff61083912801aa79de383072(고정baseline source).
- T02 작업트리: provision-entra/set-entra-settings/entra-common/check-entra-env/verify-entra-registration 도구, infra/azure/entra.parameters.example.json, docs/entra-runbook.md, entra-provisioning.test.ts 구현. 아직실제SSO검증미완료라T02완료소스커밋없음.
- 실제두Entra앱등록/Member acct/정확한redirect/최초Board.Admin·소유자윤일호만확인. prod client5fc11fd1-1c26-48b9-9cef-ea5785fffbb2, local395f9a9a-5abc-4534-8539-eb653bc956ff. tenant69c1e470-4528-435a-a1ae-de98e0aac738/adminoid e8222b20-96f4-4c25-a3af-1f40ebbbec56.
- 각90일secret 만료2027-02-16 UTC/서로다른암호화키는Git무시 board/.deploy/entra-login.dpapi에사용자DPAPI로보관. 공개IDs/keyId/expiry는entra-resources.json. 기존LOCALAPPDATA/VibeBoard/azure-prod.dpapi불변. 비밀출력/argv/소스포함금지.
- ARM인증5key만merge/다른설정readback보존확인. .env.local local5key만추가/수정, APP_ORIGIN3000보존, 양쪽AUTH_MODEmaintenance. 구운영코드77fe827는이key를사용하지않으므로아직콘텐츠보호전환전이다.
- 운영: DEX7b1417d8-833d-4ba9-a5cd-d27c91a28b83 / rg-vibe-board-prod / app-vibe-board-prod-7b1417 / B1Linuxx1 / SQLBasic2GB / 기존privateBlob·SharedKeyOff·TLS1.2·soft7일. URL https://app-vibe-board-prod-7b1417.azurewebsites.net . health77fe827b4ca69cfc9a82cf79688133a1e72ba920정상.
- 운영SQL수동SELECT: schema4/글1/이미지6(attached1,purged2,soft_deleted3)/occupied=charged71864. 기존운영자IP와현재118.235.73.99가달라최소단일rule board-118-235-73-99만추가후읽기성공. 다른방화벽/DB자료/SQLmigration/grants/mainpush미변경. 원본snapshot은최종전환직전다시취득해야한다.
- schema5닫힌baseline: 고정Gitarchive source c62339c5eadfa61ff61083912801aa79de383072에서Linux검증/재빌드. board/.deploy/entra-schema5-maintenance/board.zip와release.json. SHA256 aa1eebf1a659fb5ee65a7202adb8844281146f69c3b7d1545d10d1964435fd4d/node24일치. 다른board.zip검증용을운영baseline으로혼용금지.
- test:all 서비스81/API21/E2E28, PS강화AST·합성dotenv4개, type/lint/build/diff, 독립Linux패키지1성공. 자동테스트는격리SQL/Azurite/fakeOIDC만사용. .env.local/실제SSO/운영endpoint는자동테스트에서읽지않는다.
- 실제사전SSO: SQL없는3200브라우저10분대기중사용자에게직접회사로그인/MFA를안내/비동기질문. 실제Member/Admin결과없이종료되어미완료다. 브라우저/3200은정리됨. token/claims/query/trace/HAR저장없음. 실제로컬/운영앱QA는아직0글/0이미지/0업로드세션이다.
- 사용자3000/next-env의두.next/dev/types경로/루트.agents/.codeburn/AGENTS/README/zip/SQLite·Dockerpad보존. 새T02소스·메모리는미커밋작업트리로보존. Git원격main은96edfc50b2dae16b195d1b219d0fcd335c62f55d, push없음. gh는현재PATH에없으므로최종Task에서공식CLI/GCM-REST준비필요(PAT채팅요청금지).

## Next Step (IMPORTANT)
T02 source90bb2cc 완료, done5/6. 실제사전SSO재시도73649 exit0 tenantMatches/member/admin=true, Code/PKCE/nonce/signature/최초관리자OID/Board.Admin확인. 현재사전검사3200는정리됐다. 마지막T03청사진을읽고닫힌baseline→원본snapshot→SQL5/grants→Actions/SHA→Entra enable→실제로컬3200/운영SSO·자체QA·정리를수행한다. 운영코드/SQL은여전히77fe827/schema4이며구상태기록은참고하고실제재확인한다. 총실제QA2글/3이미지/3업로드세션한도, 기존3000/next-env/도구보존, secret/log/trace/HAR금지. 사용자요청한운영배포까지자동연속한다.
