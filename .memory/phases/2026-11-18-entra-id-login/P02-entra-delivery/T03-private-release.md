# Task: T03 비공개 운영 전환과 실제 SSO 인계

## Status: in_progress

## Goal
검증된 닫힌 패키지로 기존 공개 서비스를 전환하고 SQL5/main Actions/운영·로컬 실제 Entra 로그인과자체QA를마친뒤전체6/6완료를기록한다.

## Decision Summary
- fail-open/비밀번호우회/schema4 ZIP rollback/데이터초기화금지. maintenance는콘텐츠503이나login/CSS와schema일치health는정상이다.
- 실제Member/Admin/회사SSO/MFA는위조하지않고사람이직접수행한다. 미완료사람단계·잔여QA가있으면완료로표시하지않는다.

## 실행 맥락과 고정 계약
- Plan2026-11-18-entra-id-login/feature/entra-id-login, cwd D:/vibeweb/board, Node24/Next16/React19/TSstrict. 최초관리자tid69c1e470-4528-435a-a1ae-de98e0aac738/oid e8222b20-96f4-4c25-a3af-1f40ebbbec56, roles의Board.Admin만관리자. 일반Member만사내읽기, ownertid+oid본인글만수정/삭제,legacy읽기/관리자삭제만.
- DEX subscription7b1417d8-833d-4ba9-a5cd-d27c91a28b83, RG rg-vibe-board-prod, app app-vibe-board-prod-7b1417, URLhttps://app-vibe-board-prod-7b1417.azurewebsites.net. B1x1/SQLBasic2GB/sql-vibe-board-7b1417.database.windows.net/dbboardprod/privateBlob stvibeboardimg7b1417/board-images 유지.
- 현재배포/SQL/실제글개수는읽기로재확인. 이전77fe827/schema4/글0개는과거기록이며현재로가정하지않는다. 사용자next-env/3000/루트도구/SQLite/Dockerpad보존. gitadd./reset/forcepush금지. 자동테스트는SQL/Azurite/fakeOIDC 격리만, 실계정테스트와분리한다.
- schema5=board_users(tenant_id,object_id PK/display_name), auth_sessions(id_hash,tid,oid,name,is_admin,origin,client_id,created/expires<=1h,revoked), oidc_login_attempts(state/browser hashes,encryptedproof,client/origin/returnTo,expiry10min), posts nullableownerpair/passwordNULL신규계정글/legacyhash보존, uploadsessions nullableowner/authsessionFK. 업로드·logout락순서capacity→auth→upload→post→asset.
- AUTH_MODE=maintenance|entra, 기본maintenance. ENTRA_TENANT_ID/clientID/clientSECRET/AUTH_ENCRYPTION_KEY 서버전용, 운영/로컬별도앱. API401/403/no-store, page/loginredirect, maintenance503, 이미지private/no-store+인증후ETag, health최소status/version익명.
- .deploy/entra-schema5-maintenance/board.zip 및release.json은직전Task에서검증/보관한source40hex/SHA256/node24아티팩트다. 기존schema4 ZIP을복구에사용하지않는다. secret/key는별도DPAPI/.env/ARM에만존재한다.

## Implementation

### I01. 최종 준비·닫힌 전환·Actions
- Related Files:
  - board/scripts/release-entra.ps1 :: Inspect/Maintenance/DeployBaseline/Enable/Verify; new
  - .github/workflows/board-azure.yml, board/scripts/check-workflow.mjs :: health/배포가드필요시갱신; modify
  - board/scripts/verify-sql-access.ts :: schema5 제한계정검증; read-only/필요시modify
  - board/scripts/github-release.mjs, verify-entra-registration.ps1 :: 실제run/사전검증; read-only
  - board/docs/entra-runbook.md :: 전환순서/실제증거/복구; modify
#### Details
- **Signatures & Types**:
```powershell
param([ValidateSet('Inspect','Maintenance','DeployBaseline','Enable','Verify')][string]$Mode='Inspect',
 [ValidatePattern('^[a-f0-9]{40}$')][string]$Commit)
```
- **준비**: 전체test/type/lint/build/Linux패키지와check-workflow, diff/status/history/ZIP secret배제를검사한다. 원격main최신fetch/정상통합하며무관한사용자변경은stage하지않는다. 릴리스준비source를feature에커밋/push하는것은허용하지만이Task의SQL/닫힌baseline준비전에는mainpush금지.
- T02의실제사전SSO Member/Admin·역할/redirect/secret보관/운영SQL읽기·ARM배포권한·닫힌ZIP해시가모두유효해야한다. 3200사용가능여부와사용자실제로그인가능한브라우저를준비한다. 비밀로그없는실제사람단계가미준비이면공개서비스를중간전환하지말고그단계부터완료한다.
- **cutover순서(중요)**: (1) AUTH_MODEmaintenance를명시·설정보존검사; (2) schema5maintenance ZIP/hash/manifest확인후실제app에배포하고APP_VERSION=baselinecommit 설정; (3) /login/CSS200 및글/API/이미지503으로공개차단확인; 이때SQL은아직4라health503일수있다; (4) 운영자pool로기존post의id/title/nickname/content/content_json/format/hash/createdAt을메모리에만snapshot, schema5 migrate2회→provision:sql→verify:sql-access; (5) 기존행/날짜/이미지참조보존+새ownerNULL을메모리로비교하고schema5health200/versionbaseline검증. 새세션/계정쓰기는아직허용하지않는다.
- **변경한순서의이유**: maintenance는SQL없이도콘텐츠를닫을수있으므로DB전환전에먼저닫아동시옛비회원쓰기/스냅샷경합을막는다. 이전계획의SQL후close보다이순서를우선한다. health503는이짧은스키마전환동안만허용하며시작/복구시각을기록한다. 실패시DB초기화/역migration/익명버전으로되돌리지말고닫힌baseline에서forwardfix한다.
- **정상배포**: feature를main에정상FF/merge/push하고실제GitHubActions verify→artifactSHA검증→OIDC→ZIP→health5/versioncommit 일치까지기다린다. 현OIDCsubject repo:YIH151515@355682187/vibe_webapp@1456296194:ref:refs/heads/main/issuerGitHub/audienceapi://AzureADTokenExchange와기존최소배포권한유지. PR에운영SQL/secret주입금지. health는익명유지라새회사SSO를CI가자동로그인할필요없다.
- **실패**: CI/배포/설정오류면schema5maintenance ZIP과APP_VERSIONbaseline으로복구해콘텐츠를닫고health만회복한다. 수동baseline배포를정상최종Actions성공으로대체하지않고원인해결후실제run성공까지진행한다. USER/login실패때AUTH_MODE를anonymous로바꾸는옵션은없다.
- **최종baseline**: 성공run에서실제artifactZIP/manifest를다운로드해SHA/commit/node24와대조하고 .deploy/entra-schema5-maintenance를그패키지로갱신,이전준비패키지도보존한다. 다운로드14일보존과별개로로컬ZIP/manifest를안전보관한다. rollback시mode maintenance와같은SQL5를쓴다.
- **Enable**: health/version/schema5/정확한등록/secret설정/다운로드baseline이확인된때만set-entra-settings -Mode Enabled(AUTH_MODEentra)를실행한다. EDITOR_FEATURE_ENABLED/MEDIA_CLEANUP_ENABLED는기존1유지,BlobsystemID/SQL/rate/adminlegacy비밀교체금지. 익명/login/CSS200·protectedpage303/API401·health200부터확인한다.

### I02. 운영·로컬 실제 로그인과 제한된 QA
- Related Files:
  - board/scripts/verify-live-entra.ts, verify-live-entra.ps1 :: 사람SSO/자체QA/프로필제한; modify
  - board/tests/live-api.spec.ts, live-media-api.spec.ts, auth.spec.ts :: 검증자회귀; modify if required
  - board/docs/entra-runbook.md :: 실제실행체크와미검증범위; modify
#### Details
- **Signatures & Types**: 기존LiveEntraInput에 qaProfile?:'local-smoke'|'production-full' 추가. local은정확한http127.0.0.1:3200(실제local등록), prod은정확한AzureHTTPS, test만이중/issuerguard후3100. expectedCommit40hex필수. BrowserContext session을그대로context.request가사용하고cookie/token을export하지않는다.
- **로컬실제앱**: 운영SQL5준비후현재검증source를3200에서실행한다. childenv APP_ORIGIN3200/APP_VERSIONsourceSHA/로컬Entra앱자격증명을주입하고일반.env.local의3000기본값을불필요하게바꾸지않는다. 기존사용자3000을죽이지않고본인이시작한3200 PID만finally정리한다. rawNextcallback쿼리/stdout를중계하지말고고정체크만출력한다. local은실제회사SSO→Member/Admin SessionDto→자기글1개/이미지1개 작성·조회·수정·삭제·logout를확인한다.
- **운영실제앱**: 독립browser context에서회사로그인/MFA를사용자가직접수행한다. 실제tenant/Member/Admin은검증된세션/등록증거로확인한다. 로그인창은코드를준비한후열고기다리며채팅으로암호/코드요구·자동MFA우회·legacyadminPWfallback은금지한다. 사람이완료하지않으면현재포인터를유지하고어디까지준비됐는지/브라우저동작만안내한다.
- **생성상한**: local1글/1이미지, prod1글/최대2이미지, 두환경총2글/3이미지/발급uploadsession3회이내. prefix '[entra-check:<UUID>]'·실제현재oid·메모리ownid만추적,생성후keep/add/detach를prod에서검사한다. 같은계정quota는공유하므로남은정상window를읽기로확인하고429면정확Retry-After자연만료까지대기한다. 테스트때문에계정ID/rate키/counter를리셋하지않는다.
- **실제검사**: anonymouspage/글list/detail/API/image401·no-store, 로그인후파일선택/서식/검색/작성일·1/256자표시이름/이미지폭/toolbar/관리링크/PC1280모바일390, rawidentity/PWbody400, 원본Blob직접익명차단, 게시이미지ETag/HEAD인증먼저, 이미지제거404, 실제azwebapprestart후같은세션·문서·이미지bytes유지, admin동의없는삭제400/동의204, logout이전cookie/API/image401. 회사전체로그아웃을호출하지않는다.
- **권한테스트범위**: 실제윤일호Admin과로컬/운영로그인은직접확인한다. 일반Member/Guest/타tenant/타owner검사는가짜서명issuer와SQLfixture로검증하고추가실제계정없으면실계정까지테스트했다고보고하지않는다. 기존실제타인/legacy글을수정테스트로쓰지않고보존비교만한다.
- **정리**: finally에서도ownprefix+ownid+현재계정일치확인후API삭제. 자체sessionhash로확인한assetUUID만runMediaCleanup(assetIds)로정리한다. 삭제공개404→logout후401, outbox/lease/7일softdeleted/charge보류를검증하고물리파일완전삭제라고보고하지않는다. 응답유실시SQL메모리로ownUUID/owner조건을조회해자체글만복구·삭제. 미정리ID가있으면이를남기고정리완료전Taskdone금지.
- **운영상태**: AppServiceRunning과마지막health/version/authmode/실제등록role/최소권한을확인. 기존SQL자료/카운터·첨부파일·다른사람세션을검증편의로초기화하지않는다. role회수/퇴사즉시반영을주장하지않고최대1시간session또는해당sessionrevocation절차를검증/안내한다.

### I03. 인계와 완료 동기화
- Related Files:
  - board/README.md, docs/azure-runbook.md, docs/images-runbook.md, docs/entra-runbook.md :: 실제운영/복구/제약/secret교체; modify
  - .memory/plans/2026-11-18-entra-id-login.md, 해당phase/task, .memory/current.md :: 실제완료; modify
#### Details
- 기록가능: URL/실제배포SHA/ActionsURL/schema/authmode/별도appID·SPID·role/만료시각/복구ZIPSHA/자체QA집계/미검증범위/사용자보호여부. 비밀·원문claim/token/cookie/code/state·사용자내용을남기지않는다.
- 인계필수: Member와Guest차이/이메일권한판정금지, Entra앱역할추가·회수와1시간session한계/해당세션강제취소, 로컬도실데이터공유/별도appsecret, clientsecret90일교체(새secret검증후이전key삭제,다른앱secret혼동금지), 암호화키교체flow재시도, callback/query로그보호, auth설정소실방지, maintenance복구/SQL역migration금지, Blobsoft7일/용량/기존비용등급유지.
- 모든필수검증과자기QA정리후Taskdone/지정커밋,phase3/3(총P013/3+P023/3=6/6),plancompleted/currentActive없음을동기화한다. source완료SHA와문서만의HEAD가다르면구분한다. README/docs/.memory완료커밋은현재workflowpaths예외로재배포하지않는다. 완료문서도정상main통합/push해보관하며force금지.

## Acceptance Criteria
- [ ] SQL5/실제main Actions/healthSHA와AUTH_MODEentra·서로다른운영·로컬실제SSO/Admin이일치한다.
- [ ] 미로그인콘텐츠비공개·계정권한·이미지·재시작·1280/390·logout과기존자료보존을확인했다.
- [ ] ownQA글/공개이미지/삭제job정리·softdeletecharge보류·AppRunning·사용자변경/서버보호를기록했다.
- [ ] secret회전/계정권한한계/SQL5maintenancebaseline/실제증거문서와전체completed6/6포인터가일치한다.
- [ ] 아래전체검증성공,사람SSO/필요외부권한미완료나미정리ID를완료로표시하지않았다.

## Validation
- `npm run test:all`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run verify:azure` — 최신변경포함전체통과.
- `node scripts/check-workflow.mjs` — PR격리/OIDC/아티팩트검증/익명최소health유지.
- `./scripts/provision-entra.ps1 -Mode Verify`, `./scripts/set-entra-settings.ps1 -Mode Verify` — 실제두앱/role/설정/비밀만료확인.
- `npm run verify:sql-access` — schema5/앱DML/DDL·db_owner거부,검증행만정리.
- `./scripts/release-entra.ps1 -Mode Verify -Commit <실제40hex>` — hash/health/mode/익명보호확인.
- `./scripts/verify-live-entra.ps1 -Commit <실제40hex> -Environment Local`, 이어서 -Environment Production — 실제사람SSO·자기QA·정리성공;실제계정암호없음.
- GitHub실제run success + /api/health.statusok/version정확일치,모드entra/API무쿠키401/login200.
- `git diff --check`, `git status --short` — source/doc커밋완료/무관변경보존/secret제외/소유프로세스정리.

## Commit Message
```text
deploy(auth): publish and verify private Entra board access

Plan: 2026-11-18-entra-id-login
Phase: P02-entra-delivery
Task: T03-private-release

- transition through a closed schema5 baseline and verified main Actions deployment
- validate real local and production SSO, owned media cleanup and recovery handoff
```

## Progress
- [ ] 구현 완료
- [ ] 검증 통과
- commit: pending

## Next Task
없음. 실제SSO/정리/문서검증후전체completed6/6.
