# Task: T02 운영·로컬 Entra 앱과 안전한 전환 준비

## Status: in_progress

## Goal
별도 운영/로컬 앱 등록·Member claim·최초관리자역할·정확한redirect·비밀설정을 준비하고 실제 사전 SSO/닫힌 schema5 복구 ZIP을 확보한다. 운영 SQL5와main배포는아직수행하지않는다.

## Decision Summary
- 실제Entra설정생성은이Task에서허용되며기존GitHub배포ID/Blob identity/등급은변경하지않는다. 구독Owner와디렉터리앱/역할관리권한을혼동하지않는다.
- 로그인암호/MFA는사람이직접입력한다. 자동준비를완료한뒤실제브라우저단계만안내하고실로그인미완료를성공으로꾸미지않는다.

## 실행 맥락과 고정 경계
- Plan2026-11-18-entra-id-login, feature/entra-id-login, cwd D:/vibeweb/board. 전체앱/SQL테스트는이미feature소스에서schema5로통과했다. 운영은아직schema4이며마지막기록77fe827,실제health/HEAD/resource는읽기로재확인한다. 새코드의currentbranch를운영SQL4에로컬서버로붙여서migration을앞당기지않는다.
- subscription7b1417d8-833d-4ba9-a5cd-d27c91a28b83(DEX), tenant69c1e470-4528-435a-a1ae-de98e0aac738, RG rg-vibe-board-prod, app app-vibe-board-prod-7b1417, B1Linuxx1, SQL sql-vibe-board-7b1417.database.windows.net/dbboardprod Basic2GB, Blob stvibeboardimg7b1417/board-images private/TLS1.2/SharedKeyOff/soft7일 유지.
- 최초관리자userOID e8222b20-96f4-4c25-a3af-1f40ebbbec56(윤일호/ih.yoon@dexconsulting.net)만. 현재Azure로그인과tenant를재확인하고다르면임의다른user로대체하지않는다.
- 사용자3000/next-env/루트도구/Dockerpad보호. 자동테스트는fakeissuer/SQL/Azurite only,실제사전SSO는수동도구와별도3200이며trace/HAR/secret로그금지. 운영SQL읽기도실제대상확인후manual도구에서만한다.

## Implementation

### I01. 전용 Entra provisioning
- Related Files:
  - board/scripts/provision-entra.ps1 :: Inspect/Apply/Verify; new
  - infra/azure/entra.parameters.example.json :: 비밀없는명세; new
  - board/docs/entra-runbook.md :: IDs/역할/권한/오류조치; new
  - board/scripts/provision-azure.ps1 :: 기존whole-template Apply의auth설정소실방지; modify
#### Details
- **Signatures & Types**:
```powershell
param([ValidateSet('Inspect','Apply','Verify')][string]$Mode='Inspect')
```
- **리소스명세**: Application displayName='vibe-board-entra-prod' 및 'vibe-board-entra-local', signInAudience='AzureADMyOrg', Web confidential client, implicitGrant idToken/accessToken 발급false, publicClient 허용false. optionalClaims.idToken=[{name:'acct',source:null,essential:true,additionalProperties:[]}]. scopes요청openid profile만, User.Read/Graph데이터/메일/파일/offline_access/APIapppermission추가금지.
- **앱역할**: 두app모두appRoles=[{id:'b804ef25-9734-4e12-87e3-b8ea76c73353',allowedMemberTypes:['User'],displayName:'Board administrator',description:'Delete board posts as administrator',isEnabled:true,value:'Board.Admin'}]. ServicePrincipal을각app에생성/확인하고appRoleAssignmentRequired=false(사내일반Member는역할없이접근). appRoleAssignedTo는위userOID에위roleID만할당한다. 역할없는사내Member는일반사용자다. 디렉터리전체관리자/tenantpolicy/Guest계정/그룹을수정하지않는다.
- **Redirect**: prod Web redirectUri 정확히 https://app-vibe-board-prod-7b1417.azurewebsites.net/api/auth/callback 한개; local Web 정확히 http://127.0.0.1:3000/api/auth/callback 과 http://127.0.0.1:3200/api/auth/callback 두개. wildcard/외부host/추정URI금지. Graph/manifest의HTTP127등록가능성과실제read-back을검증한다. 미지원이면기능기본origin계약과등록을함께맞출검토를하되한쪽만localhost로몰래바꾸지않는다.
- **Inspect**: 계정/tenant/현재앱설정중AUTH_MODE·clientID·redirect같은비밀아닌값·등록충돌·기존프로비저닝metadata를읽는다. AzureCLI Graph와ARM access token은메모리로받고출력하지않는다. 디렉터리읽기실패를권한부여요청으로즉시확대하지않고어느API/역할이부족한지안전한에러코드로분류한다.
- **Apply**: 공식MicrosoftGraph의applications/servicePrincipals/appRoleAssignedTo API를사용한다. 생성한객체objectId/appId/SPid/roleAssignmentid를즉시비밀없는 .deploy/entra-resources.json에기록하여재실행시id기반멱등처리한다. name충돌만으로타인이만든app를수정/secretreset하지않고소유자/기록/명세일치확인. 최초관리자를appowner로명시하고추가소유자/다른권한은자동부여하지않는다. 한쪽생성실패시다른자원을삭제/계정권한확대하지말고완료된IDs와남은조치기록.
- **권한미달**: 실제등록·역할할당요청의403/consent관리자요구를증거로남기되raw Graph body/token은로그하지않는다. 검토가능한명세/스크립트/확정된resourceIDs를먼저완성한후필요한디렉터리관리자조치만안내한다. 사용자에게client secret/회사비밀번호/MFA를채팅으로달라고하지않는다.
- **기존whole Apply**: 현재main.bicep는앱settings를전체기술하므로새auth설정소실위험이있다. provision-azure.ps1의Apply전에현재앱에AUTH_MODE/ENTRA_CLIENT_ID가있으면기존whole-template경로를중단하고전용설정도구사용을안내한다(ReadOnly/Verify는유지). 이Task에서main.bicep전체배포를실행하지않는다. 장래전체인프라변경은auth설정보존을포함해별도계획한다.

### I02. 비밀 생성·보관과 환경별 설정
- Related Files:
  - board/scripts/set-entra-settings.ps1 :: Maintenance/Enabled/Verify; new
  - board/.env.example :: 정확한env/비밀보관안내; modify
  - board/docs/entra-runbook.md :: secret수명/교체/세션scope/비용; modify
  - board/.env.local :: local-only관련key만변경,stage금지
#### Details
- **Envs**: AUTH_MODE=maintenance|entra, ENTRA_TENANT_ID=고정tenant, ENTRA_CLIENT_ID=환경별appId, ENTRA_CLIENT_SECRET=환경별secret, AUTH_ENCRYPTION_KEY=환경별random32bytes/64hex. APP_ORIGIN/STORAGE/SQL/ADMIN/RATE_LIMIT/EDITOR/MEDIA/APP_VERSION 등기존무관key는보존한다. 운영/로컬secret/key를공유하지않는다.
- **secret수명**: 각Entraapp에90일client password를한개생성, secretText는생성응답에서메모리로만받는다. app passwordcredential keyId/만료시각은기록가능, secretText는로그/argv/문서/소스에넣지않는다. 재실행시보관된미만료secret을재사용하고무조건재생성하거나타인의password를삭제하지않는다. 암호화키rotation은진행중10분flow만재시도시키고기존앱세션을자동무효화한다고주장하지않는다.
- **보관**: 기존 %LOCALAPPDATA%/VibeBoard/azure-prod.dpapi는수정하지않는다. 새자격증명은사용자DPAPI로암호화하여workspace안Git무시 board/.deploy/entra-login.dpapi에저장한다. 별도metadata에는비밀없음. 파일경로를ZIP/테스트복사대상에넣지않는다. local.env에는localsecret만dotenv형식으로정확히기록하고unrelatedline/기존scrypt달러escape를보존,파싱roundtrip은동등boolean만출력한다.
- **ARM 설정**: 새스크립트는ARM bearer를메모리로취득해기존appsettings dictionary를메모리로읽고관련5key만merge PUT한다. secret값을azCLI argv/temp plaintextfile/stdout에넣지않고Invoke-RestMethod body와응답은출력하지않는다. 이전SQL/관리자/rate키를수집해다른서비스로보내거나교체하지않는다. production AUTH_MODE는이Task에서maintenance만허용한다(구코드는이key를쓰지않으므로아직보호전환아님). Enabled는다음releaseTask에서health/schema5/실제검증baseline확인후에만실행한다.
- **비용**: 새AppService/SQL/VNet/KeyVault/유료EntraSKU를자동생성하지않는다. 기존요금등급을유지하며SSO/role직접user할당에필요하지않은P1그룹기능/조건부접근정책변경은추가하지않는다. 조건부접근/MFA/동의정책은조직것을따른다.

### I03. 실제 사전 SSO·운영 SQL 읽기·복구 baseline
- Related Files:
  - board/scripts/verify-entra-registration.ts, verify-entra-registration.ps1 :: SQL없는preflightOIDC; new
  - board/tests/entra-provisioning.test.ts :: 명세/설정보존/도구guard; new
  - board/docs/entra-runbook.md :: 실제증거/제약; modify
#### Details
- **Signatures & Types**:
```typescript
verifyEntraRegistration(config:EntraConfig,options:{port:3200;timeoutMs:number}):Promise<{tenantMatches:boolean;member:boolean;admin:boolean;checks:string[]}>;
```
- localconfidential app만사용하고3200가비어있는지확인,다른서버점유시종료하지않는다. 사전도구는SQL을전혀쓰지않으며loopback3200에일시callback을띄워OIDC공통client/claimvalidator로실제Code+PKCE/state/nonce를검증한다. flow는메모리에10분보관하고정해진redirect만사용한다. 별도preflight브라우저cookie로현재SQL앱세션과섞이지않게한다. 사용자실제SSO/MFA직접실행전까지진행률/열린URL만안내하고callback query/토큰/claims원문/브라우저trace저장금지. Member0/올바른tid/oid/Board.Admin확인후위boolean결과만기록,서버/browser정리.
- 이preflight는실제새게시판앱SSO/글쓰기성공을대체하지않는다. 다음Task의SQL5전환후실제앱3200와운영사이트에서다시검증한다. 정상로그인을사람이완료하지못하면Task를done하지않고구체적인브라우저단계/외부권한을안내한다.
- 운영 SQL 연결은manual readonlyguard로고정server/db/encryption을확인하고SELECT MAX(version), COUNT(posts),기존원장합계같은집계만읽는다. 인터뷰조회실패원인은코드/name/number같은bounded식별자만진단한다. SQL 방화벽이원인이면기존trusted firewall스크립트의현재운영자출발지한정규칙/이름/기존허용범위를확인하고최소rule만준비한다. 실제연결차단이확인된경우기존trusted firewall명명rule을현재운영자단일공인IP로갱신하는최소ARM변경은허용한다(DB자료/스키마쓰기는여전히금지). 전체IP허용/AllowAzureServices신설/방화벽끄기를대안으로쓰지않는다. 쓰기/migration/grants는금지다.
- source구현commit을고정하고전체test/type/lint/build/verify:azure를실행한다. 검증된ZIP/release.json을 .deploy/entra-schema5-maintenance/에복사하고source40hex/실제SHA256/nodeMajor24를대조·기록한다. 새코드AUTH_MODEmaintenance에서SQL없어도/login/CSS200·보호root/API503임을독립패키지에서확인한다. sourcecommit과artifact가다르면다시생성한다. DB를5로바꾸기전이닫힌artifact와ARM배포권한이준비되어야한다.
- Verify는2앱의실제tenant/audience/정확한Webredirects/optionalacct/role/최초userassignment/앱소유자와설정값/secret만료(값출력없음)를읽기로검사한다. 앱role/group추가·삭제같은관계없는변경을수행하지않는다.

## Acceptance Criteria
- [x] 운영/로컬별도앱·정확한redirect/acct/Board.Admin과최초윤일호할당,비밀분리/보관/설정보존을실제확인했다.
- [ ] 사전실제OIDC에서올바른Member/Admin을확인했거나미완료사람단계/권한을명확히보고하고done을보류했다.
- [x] 운영SQL4연결읽기/실제글개수및원장확인, schema5maintenance복구ZIP/해시준비완료.
- [x] 운영migration/mainpush/타자원권한확대없고회귀/패키지검사통과.

## Validation
- PowerShell AST parse scripts/provision-entra.ps1,set-entra-settings.ps1,verify-entra-registration.ps1 — 성공.
- `./scripts/provision-entra.ps1 -Mode Inspect` → Apply → Verify — 지정2앱/최소역할만생성/확인. 비밀출력0.
- `./scripts/set-entra-settings.ps1 -Mode Maintenance` 및 -Mode Verify — 관련값만적용/확인.
- `./scripts/verify-entra-registration.ps1` — 실제사람SSO/Member/Admin검증,비밀없는결과; 실패면외부권한/동의/MFA단계해결전완료금지.
- `npm run test:all`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run verify:azure`, `git diff --check` — 전부성공.
- 기존운영health/version/schema4유지, source/artifacthash일치 및staged diff 비밀없음확인.

## Commit Message
```text
infra(auth): provision separate Entra clients and admin role

Plan: 2026-11-18-entra-id-login
Phase: P02-entra-delivery
Task: T02-entra-provisioning

- prepare tenant Member claims, initial Board.Admin and isolated client secrets
- verify real preflight SSO and preserve a schema5 maintenance recovery package
```

## Progress
- [x] 구현 완료
- [ ] 검증 통과
- commit: pending

## Next Task
P02-entra-delivery/T03-private-release.md. 운영SQL5전환과mainpush는마지막Task에서만허용.

## Execution Checkpoint — 실제 SSO 미완료
- prod client5fc11fd1-1c26-48b9-9cef-ea5785fffbb2 / applicationfd5a5ae5-2eeb-460e-b85e-76c54363bc6d / SP727f50c5-7631-4e58-b09c-6ede14ba1ee4 생성·Verify성공.
- local client395f9a9a-5abc-4534-8539-eb653bc956ff / applicationc4bf10b9-c180-4fd9-af4b-2b29c836fb94 / SP6b7b2d10-2e74-4d36-8e4b-76eb7162dcea 생성·Verify성공. 두앱소유자/Board.Admin은확정윤일호OID만. 정확한127.0.0.1 callback도readback성공.
- 각각90일secret(2027-02-16 UTC만료)과서로다른암호화키를생성, .deploy/entra-login.dpapi에사용자DPAPI보관. 기존azure-prod.dpapi보존. 공개metadata .deploy/entra-resources.json. 비밀값출력/argv/새평문temp파일없음.
- Maintenance/Verify성공. ARM5key만merge및unrelatedreadback동일, .env.local은local5key만변경/APP_ORIGIN3000보존, Nextdotenvroundtrip성공. AUTH_MODEmaintenance는아직구운영코드77fe827에서보호전환을뜻하지않는다.
- 운영자출발지118.235.73.99가옛허용목록에없어ELOGIN/ESOCKET읽기실패. 기존명명규칙의board-118-235-73-99 단일IP만추가한뒤실제SELECT성공. SQLschema4/글1/asset6(attached1,purged2,soft_deleted3)/occupied=charged71864. 데이터·스키마·grants쓰기없음.
- 운영Node24-lts/alwaysOn/FTPSDisabled/B1/SQLBasic2GB/privateBlob/SharedKeyOff/TLS1.2/soft7일검증. 현재사용자Contributor배포권한확인. verify:image-access성공. 기존runtimeMI/배포UAMI불변.
- test:all 서비스81/API21/E2E28통과, 강화된PS AST·dotenv4개별테스트도통과. typecheck/lint/build/diffcheck성공. 실제secret/key와9개신규소스내용대조로secret포함0확인. 사용자next-env두dev타입경로/3000프로세스보존.
- 정확한Git archive source c62339c5eadfa61ff61083912801aa79de383072에서독립Linux verify:azure 재빌드·패키지1검증성공. 기준 .deploy/entra-schema5-maintenance/board.zip 및release.json, SHA256 aa1eebf1a659fb5ee65a7202adb8844281146f69c3b7d1545d10d1964435fd4d, nodeMajor24일치. source는임시작업트리복사가아닌고정Gitarchive다.
- 실제 SQL없는preflight3200브라우저를열어사용자에게MFA직접진행을안내하고비동기질문했다. 10분대기후실제Member/Admin결과없이종료되어완료로표시하지않는다. 요청이나token/claims/trace/HAR를저장하지않았다. 3200/브라우저는도구가정리했고다른서버는종료하지않았다.
- 신규코드/스크립트/문서는작업트리에보존(아직T02완료커밋없음). 다음사용자준비시에preflight재시도, true booleans실증거가확인된뒤에만완료커밋/포인터전진. 운영SQL5/mainpush/새버전배포미실행.
- 추가발견: 현재shell PATH에gh없음. 최종Task에서Git로그인/GCM을활용한안전한REST또는공식portable CLI를준비하며사용자에게PAT를채팅으로요구하지않는다.
