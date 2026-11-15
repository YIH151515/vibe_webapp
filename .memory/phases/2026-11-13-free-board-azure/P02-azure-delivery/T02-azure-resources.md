# Task: T02 Azure 리소스와 최소 권한 설정

## Status: done

## Goal
선택한 구독에 예산 구성을 만들고 앱 SQL 계정·방화벽·OIDC·환경변수를 실제 배포 가능한 상태로 구성한다.

## Decision Summary
- 한국 중부 Linux App Service B1 1개 + Azure SQL Basic2GB, main 자동 배포.
- SQL 비밀번호 인증과 배포 OIDC를 분리하고 Linux에서 만든 검증 artifact만 배포한다.

## 실행 맥락과 공통 계약
- 저장소 D:/vibeweb, 앱 D:/vibeweb/board. 검증 명령의 cwd는 별도 표기가 없으면 board.
- Node24.x(최소24.13.1), Next16.4.6/React19.3.1/TypeScript strict/npm. board/AGENTS.md와 설치된 관련 Next 문서를 먼저 읽는다.
- 기존 SQLite 데이터는 보관하며 이전/삭제하지 않는다. 로컬과 Azure는 같은 운영 Azure SQL을 사용한다. 자동 테스트는 운영 접속을 절대로 사용하지 않는다.
- 미커밋 board/next-env.d.ts는 사용자/Next 생성 변경으로 취급해 덮어쓰거나 무관하게 stage하지 않는다. 기존 스타터킷·도구·zip을 수정하거나 업로드하지 않는다.
- 환경변수 SQL_SERVER/SQL_DATABASE/SQL_USER/SQL_PASSWORD는 서버 전용 필수 문자열, SQL_PORT는 기본1433. encrypt=true, trustServerCertificate=false, useUTC=true.
- SQL_MIGRATION_USER/SQL_MIGRATION_PASSWORD는 명시적 운영자 CLI 전용이며 runtime/배포 workflow에 제공하지 않는다.
- APP_ORIGIN은 프로세스별 단일 정규 주소: Azure의 실제 HTTPS 기본 호스트, 로컬 http://127.0.0.1:3000, 테스트 http://127.0.0.1:3100. 경로/query/credentials/후행 slash 금지.
- APP_TEST_MODE=1은 loopback SQL 호스트 및 board_test_ 접두 DB 이름이 모두 맞을 때만 허용. 이때만 자체 서명 DB 인증서 허용 및 테스트 IP 지정 가능. 운영 SQL과 테스트 모드를 결합하면 시작 거부.
- 테스트 wrapper는 .env.local을 읽지 않고 SQL_*를 새 컨테이너 자격증명으로 덮어쓴다. 운영 DB에 seed/DROP/TRUNCATE를 실행하지 않는다.
- 보안 변수: REQUEST_IP_MODE=local|app-service|test, LOCAL_CLIENT_IP, RATE_LIMIT_KEY_SECRET, ADMIN_PASSWORD_HASH, ADMIN_SESSION_SECRET. 비밀값은 소스·Task·로그·명령행 인수·artifact에 넣지 않는다.
- Task별 관련 파일만 명시적으로 stage하고 지정 메시지로 커밋한다. 검증 성공 뒤 Task/phase/current를 동기화한다. git add . / force push 금지.
- 한 번에 current.md의 Task만 실행한다. 필요한 실행 권한은 도구의 승인 절차를 따르며 기존 사용자 결정을 재확인하지 않는다.

### 공개 데이터/HTTP 계약
```typescript
type PostInput = {title:string;content:string;nickname:string;password:string};
type PostSummary = {id:number;title:string;nickname:string;createdAt:string};
type Post = PostSummary & {content:string};
type PostPage = {items:PostSummary[];total:number;page:number;pageSize:20;totalPages:number;q:string};
type ErrorBody = {error:{code:ErrorCode;message:string;fieldErrors?:Record<string,string>}};
```
모든 필드는 필수/non-null, fieldErrors만 선택이다. 제목/본문/닉네임 trim 후 UTF-16 길이1~100/1~10000/2~20, 본문 CRLF→LF. 비밀번호 trim 없이8~64자, 공백만 거부. 기존 scrypt 형식 유지.
최신 created_at DESC,id DESC/20개. q trim/최대100자, 양의 안전 정수 page/id, 중복 query 거부. 제목 OR 본문 리터럴 검색은 ASCII 대소문자만 무시하고 비ASCII는 동일 문자 비교한다. 빈 결과 page=1,totalPages=1, 초과 page는 마지막으로 보정한다. 날짜는 UTC ISO/수정 후 유지.
GET /api/posts→PostPage, POST→201 Post+Location, GET/PATCH /api/posts/{id}→Post, DELETE→204 빈 본문. 직접 처리 응답은 no-store. 해시/비밀번호를 공개하지 않는다.

## Implementation
### I01. 검토 가능한 인프라와 운영 도구
- Related Files:
  - infra/azure/main.bicep :: resource 선언; new
  - infra/azure/parameters.example.json :: 비밀없는이름/SKU예시; new
  - board/scripts/provision-azure.ps1 :: validate/what-if/apply/상태확인; new
  - board/scripts/provision-sql.ts :: migrate/contained user/grants; new
  - board/sql/grant-app-user.sql :: 권한 template; new
  - board/scripts/verify-sql-access.ts :: verifySqlAccess; new
  - board/package.json :: verify:sql-access/provision 명령; modify
  - board/scripts/set-azure-settings.ps1 :: secret전달·출력억제; new
  - board/docs/azure-runbook.md :: 실제non-secret리소스기록·설정·비용; new
  - board/.env.local :: 운영연결; local-only,절대stage금지
#### Details
- **Signatures & Types**:
```typescript
type AzureNames = {subscriptionId:string;resourceGroup:string;location:"koreacentral";webApp:string;plan:string;sqlServer:string;database:string;deploymentIdentity:string};
type ProvisionOutput = {webAppId:string;defaultHostName:string;sqlFqdn:string;database:string;clientId:string;tenantId:string;subscriptionId:string};
provisionSql(adminPool:ConnectionPool,appUser:string,appPassword:string):Promise<void>;
verifySqlAccess(appPool:ConnectionPool,adminPool:ConnectionPool):Promise<void>;
```
- **Data & Schema Fields**:
  - Bicep매개변수: names, location, SQLadminLogin, @secure SQLadminPassword, @secure SQLappPassword, @secure adminPasswordHash/sessionSecret/rateKeySecret, localPublicIp, deployRoleDefinitionId.
  - Microsoft.Web/serverfarms: Linux(reserved=true), B1 Basic/capacity1; sites: NODE|24-lts,HTTPSOnly,AlwaysOn,minTLS1.2,FTPdisabled,STARTUP=node server.js,HOSTNAME=0.0.0.0. PORT임의고정금지.
  - Microsoft.Sql/servers: TLS최소1.2/publicendpoint, databases Basic/capacity5/maxSizeBytes2147483648, requestedBackupStorageRedundancy='Local',기본PITR7일. paidgeo/LTR/추가감사저장소/AppInsights/도메인/VNet등을자동생성하지않는다.
  - Microsoft.ManagedIdentity/userAssignedIdentities와federatedIdentityCredentials:issuerhttps://token.actions.githubusercontent.com,audienceapi://AzureADTokenExchange,subjectrepo:YIH151515/vibe_webapp:ref:refs/heads/main. Website Contributor 역할은webApp scope에만부여.
  - APIversion은생성시공식resource reference/az provider정보의지원stable을선택하고파일에고정한다. 예:Web2023-12-01,SQL2023-08-01,ManagedIdentity2023-01-31,Authorization2022-04-01을실제지원여부확인후사용.
- **Execution Flow / Logic**:
  1. 먼저파일과명령을완성하고az bicep build로검증한다. az account show/list의non-secret정보로구독을확인한다. 복수구독이면기존선택을유지하고잘못된구독에생성하지않는다. 로그인없음/구독선택불명확/Owner또는역할할당권한부족일때만필요한로그인·선택·권한을요청한다.
  2. 실제B1/Basic가용성과Node24,현재공식소매가/구독견적을확인한다. 기존예상기본24,782원+세금/추가비용과50,000원목표를비교한다. 예산을넘는SKU나region으로침묵대체하지않는다.
  3. 기본이름은rg-vibe-board-prod/asp-vibe-board-prod/dbboardprod와전역고유app/server이름에구독ID기반6hexsuffix. 충돌시숫자증분으로조정하고실제값을runbook에남긴다. 기존동명이리소스는소유태그/구성확인없이변경하지않는다.
  4. secrets는숨김입력또는검증된secure입력에서생성·수집한다. 관리자입력은8~128자/scrypthash만설정,session/rate키32bytes각각생성. AppService설정출력은 --output none; SQL암호를커맨드인수/터미널출력/템플릿일반parameter파일에넣지않는다. 임시secureparameter파일이필요하면repo밖임시경로로접근제한하고finally삭제한다.
  5. 신규 RG와 템플릿을 what-if로 확인한 후 incremental 적용한다. 의도한 추가/설정만 있고 삭제가 없음을 확인한다. 도구의 기본 승인 외 불필요한 재확인 절차를 추가하지 않는다. 중간 실패는 생성된 ID를 기록하고 멱등 재개하며 RG 전체 삭제로 다시 시작하지 않는다.
  6. webApp의 outboundIpAddresses와 possibleOutboundIpAddresses를 조회하고 SQL firewall에 각 실제 IP와 로컬 공개 IP만 등록한다. AllowAllWindowsAzureIps(0.0.0.0)나 전체 범위 규칙을 만들지 않는다. 실행자의 IP는 Azure Portal의 현재 IP 표시 등으로 확인하고 LOCAL_CLIENT_IP에도 같은 값을 설정한다. IP 변경 시 갱신 절차를 기록한다.

### I02. SQL 초기화·런타임 설정·GitHub 변수
- Related Files: 위 script/runbook과 board/.env.example의 계약; modify|read-only
#### Details
- **Data & Schema Fields**: contained user board_app. dbo.posts/rate_buckets/admin_sessions에 필요한 SELECT/INSERT/UPDATE/DELETE, schema_migrations에 SELECT만 허용한다. 앱에 DDL/db_owner/서버 admin을 부여하지 않는다. migration version3까지 적용하고 새 DB의 게시글은0개다.
- **Execution Flow / Logic**:
  1. 운영자 SQL admin 연결로 npm run db:migrate와 provisionSql을 실행한다. CREATE USER/GRANT의 식별자는 고정 allowlist, 비밀번호 문자열은 안전하게 quote하며 SQL 값을 로그하지 않는다. 기존 사용자의 암호를 임의로 교체하지 않는다. 앱 사용자로 SELECT/CRUD 가능, CREATE TABLE 불가를 확인한다. 실제 사용자 게시글로 권한을 검사하지 않는다.
  2. Azure의 SQL_*는 board_app을 사용한다. APP_ORIGIN은 실제 defaultHostName에서 https://로 구성하고 REQUEST_IP_MODE=app-service 및 hash/keys를 설정한다. APP_TEST_MODE/SQL_MIGRATION_*/trustServerCertificate를 운영에 설정하지 않는다. SCM_DO_BUILD_DURING_DEPLOYMENT=false, ENABLE_ORYX_BUILD=false, NODE_ENV=production. SQL admin 비밀값을 App Service에 남기지 않는다.
  3. 로컬 .env.local에는 같은 SQL_*와 hash/keys, APP_ORIGIN=http://127.0.0.1:3000, REQUEST_IP_MODE=local, LOCAL_CLIENT_IP=허용한 실제 공개 IP를 설정한다. 기존 파일이 있으면 무관한 key는 보존하고 관련 key만 변경한다. DATABASE_PATH 폐지를 설명한다.
  4. 사용자 할당 관리 ID의 연합 설정과 webApp scope Website Contributor 역할을 검증한다. Entra 앱 등록이나 장기 client secret은 만들지 않는다. DB 접속은 선택된 SQL 인증을 유지한다.
  5. GitHub 저장소 YIH151515/vibe_webapp의 4개 변수를 설정한다: AZURE_CLIENT_ID/AZURE_TENANT_ID/AZURE_SUBSCRIPTION_ID/AZURE_WEBAPP_NAME. 연결된 GitHub 도구를 우선하고 없으면 인증된 gh/API를 사용한다. 모두 없으면 Repository Settings→Secrets and variables→Actions→Variables의 구체적 4항목 등록을 요청하고 완료를 확인한다. 비밀값을 채팅에 붙여넣게 하지 않는다.
  6. npm script verify:sql-access=tsx scripts/verify-sql-access.ts를 추가한다. 이 도구는 TLS/제한된 앱 권한을 검사하고, 생성한 UUID QA 행과 DDL 검사용 객체만 admin 연결로 정리한다. 운영 게시글이나 스키마를 초기화하지 않는다. 이번 Task는 아직 push/공개 배포하지 않는다. runbook에는 non-secret ID/FQDN/비용/권한/설정 이름만 기록하고 비밀값과 .env.local은 제외한다.


## Acceptance Criteria
- [x] SKU/region/1instance/2GB 및 권한·비용이 확정 구성과 일치한다.
- [x] 운영 DB는 게시글0개/schema3이며 앱 계정은 DDL 권한이 없다.
- [x] 제한된 firewall/TLS/SQL 자격증명/Origin/키/OIDC/repo 변수가 실제 설정됐다.

## Validation
- 루트: az bicep build --file infra/azure/main.bicep — 구문 성공.
- board에서 ./scripts/provision-azure.ps1 -Mode Validate 및 -Mode WhatIf — 의도한 차이만 존재. -Mode Apply 후 -Mode Verify로 SKU/권한/설정 이름을 비밀 노출 없이 검사한다.
- npm run db:migrate — 2회 실행 후 version3/게시글0개/멱등성을 확인한다.
- npm run verify:sql-access — 앱 계정의 CRUD 허용/DDL 거부 확인. 이 검증이 생성한 식별 가능한 QA 행만 정리한다.
- git diff --check / git status --short — secret 설정·로컬 env·무관한 생성 파일이 stage되지 않았다.

## Commit Message
```text
infra(board): provision budget Azure hosting and SQL access

Plan: 2026-11-13-free-board-azure
Phase: P02-azure-delivery
Task: T02-azure-resources

- 선택한 구독에 예산 구성을 만들고 앱 SQL 계정·방화벽·OIDC·환경변수를 실제 배포 가능한 상태로 구성한다.
```

## Progress
- 2026-11-16 재개 검증: Azure Verify, SQL CRUD허용/DDL거부/글0개/schema3, typecheck/lint, Bicep build 통과. 제안한 소스 파일에서 실제 보관 비밀값이 없는 점과 .env.local/.deploy Git 제외를 확인했다. GitHub 로컬 인증은 여전히 없어 사용자 기기 인증을 요청했다. 에이전트의 대화형 로그인 실행은 터미널 접근 거부로 사용할 수 없으며, 시작했던 비대화형 로그인 프로세스는 종료했다.
- [x] Azure·SQL 구현 및 실제 생성 완료. rg-vibe-board-prod / asp-vibe-board-prod / app-vibe-board-prod-7b1417 / sql-vibe-board-7b1417 / dbboardprod / id-vibe-board-github.
- [x] Bicep build, Validate, WhatIf(신규 생성만), Apply, Verify 실제 통과. 한국 중부 Linux B1 x1/Node24, SQL Basic5DTU2GB/Local/PITR7, 정확한IP 방화벽, app scope Website Contributor와 GitHub main OIDC 확인.
- [x] 공식 KRW 소매가 재조회: Linux B1 24.0777원/시간, SQL Basic B 236.8978원/일. 730시간 약24,782원/월(세금 등 별도).
- [x] db:migrate 2회, provision:sql, verify:sql-access -- --expect-empty 통과. 글0개/schema3, 앱CRUD허용/DDL·db_owner거부. QA 행과 자체 검사 객체만 정리했다.
- [x] 기존 로컬3000서버 /api/health=200(status:ok,version:local), 관리자세션=401 확인. 로컬 .env.local 운영SQL 연결 및 Next hash escape 검증.
- [x] typecheck/lint 통과. DPAPI 비밀 보관 및 제한 ACL, 보호 임시 parameter 파일 finally 삭제. 비밀 없는 운영 기록 작성.
- [x] GitHub Actions 변수 실제 등록·조회: 2026-11-16 사용자 GitHub 로그인 후 저장소 write 권한 확인. configure-github.mjs로 비밀 아닌 변수5개(AZURE_RESOURCE_GROUP 포함)를 등록하고 실제 값 재조회 일치를 검증했다.
- [x] 전체 Task 완료: 아직 push/공개 릴리스하지 않았으며 다음 Task에서 진행한다.
- 재개: 사용자가 `git credential-manager github login --username YIH151515 --device`를 본인 PC에서 완료한 후 board에서 `node scripts/configure-github.mjs --check` 및 인수 없이 실행. 남은 조건 통과 후 이 Task를 done으로 커밋하고 P02-T03 진행.
- 구현 보완: 동적 outbound IP loop는 firewall.bicep 모듈로 분리했다. SQL 권한 검사 alias는 예약어를 bracket으로 인용했다. Azure CLI의 plan reserved는 properties.reserved도 처리한다. SQL·암호 원문 오류는 출력하지 않는다.
- commit: a1148a2

## Next Task
P02-azure-delivery/T03-first-release.md
