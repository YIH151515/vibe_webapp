# Task: T01 SQL5와 계정 세션 기반

## Status: done

## Goal
기존 schema4 자료를 보존하면서 계정/로그인 트랜잭션/세션/nullable 소유권을 추가하고, 아직 기존 라우트에 연결하지 않은 인증 설정·세션 모듈을 독립 검증한다.

## Decision Summary
- tenant+oid가 소유권이며 이름/메일은 인증 키가 아니다. 세션은 SQL 해시/최대1시간, maintenance 또는 entra만 있고 익명 허용 모드는 없다.
- 이 Task에서는 운영 변경/새 로그인 호출/기존 서비스 인증 교체를 하지 않는다. additive migration으로 기존 테스트와 API가 계속 컴파일되어야 한다.

## 실행 경계
- cwd D:/vibeweb/board, Node24.13.1 이상<25/Next16.4.6/React19.3.1/TS strict/npm. board/AGENTS.md와 설치된 Next docs를 따른다.
- Plan2026-11-18-entra-id-login. 현재 branch/HEAD/status/origin을 읽고 origin/main을 fetch만 한 뒤 feature/entra-id-login을 현재 검증된 main 이력에서 정상 생성한다. dirty next-env.d.ts와 루트 도구/AGENTS/zip/SQLite를 보호하고 git add . / reset/강제push/브랜치삭제 금지. 기존 사용자3000와 Docker pad 서버를 종료하지 않는다.
- 현재 운영 기록77fe827/schema4/DEX subscription7b1417d8-833d-4ba9-a5cd-d27c91a28b83. 운영 SQL은 로컬 .env.local과 공유된다. 테스트는 .env.local을 읽지 않고 기존 NODE_ENV=test/APP_TEST_MODE1/loopback SQL board_test_32hex + 전용 loopback Azurite guard를 사용한다. 이 Task에서 운영 migration/Entra/Azure 설정/main push 금지.
- secret/password/token/code/state/cookie/원문IP/실제글/파일명은 로그/stage 금지. 사용자 next-env는 빌드가 정확히 .next/dev/types→.next/types만 변경했을 때만 사전 내용으로 복원하고 뜻밖의 변경은 보존한다. 빌드/테스트를 동시에 돌려 이 파일을 경합시키지 않는다.

## Implementation

### I01. additive identity schema
- Related Files:
  - board/sql/005-entra-identity.sql :: migration5; new
  - board/src/lib/server/schema-version.ts :: EXPECTED_SCHEMA_VERSION=5; modify
  - board/src/lib/server/migrations.ts :: migrateDatabase; read-only
  - board/sql/grant-app-user.sql :: 신규3테이블 DML과 기존 권한; modify
  - board/scripts/verify-sql-access.ts :: schema5/신규테이블 권한; modify
  - board/tests/identity-schema.test.ts :: 보존·제약·migration; new
  - board/tests/service.test.ts, api.spec.ts :: schema version 기대값만 이 Task에 맞게; modify
#### Details
- **Signatures & Types**: migrateDatabase(pool:ConnectionPool):Promise<void>의 기존 잠금/transaction/순서 검사를 유지한다. SQL의 새 열을 같은 batch에서 제약/인덱스로 참조하면 dynamic EXEC로 컴파일 시점을 분리한다(004의 기존 패턴).
- **Data & Schema Fields**:
  - dbo.board_users: tenant_id UNIQUEIDENTIFIER NOT NULL, object_id UNIQUEIDENTIFIER NOT NULL, display_name NVARCHAR(256) NOT NULL, created_at DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(), updated_at DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(); PK(tenant_id,object_id), 이름 DATALENGTH/2 1..256. 이메일/비밀번호/권한을 이 테이블에 저장하지 않는다.
  - dbo.auth_sessions: id_hash CHAR(64) PK, tenant_id/object_id UNIQUEIDENTIFIER NOT NULL FK board_users, display_name NVARCHAR(256) NOT NULL, is_admin BIT NOT NULL, app_origin NVARCHAR(256) NOT NULL, client_id UNIQUEIDENTIFIER NOT NULL, created_at/expires_at DATETIME2(3) NOT NULL, revoked_at DATETIME2(3) NULL DEFAULT NULL. hex 해시/이름길이/expires>created/expires<=DATEADD(hour,1,created) 제약, expires_at 인덱스, 계정+revoked/expires 인덱스, UNIQUE(id_hash,tenant_id,object_id). 원문쿠키/Entra token 저장 금지.
  - dbo.oidc_login_attempts: state_hash CHAR(64) PK, browser_hash CHAR(64) NOT NULL, client_id UNIQUEIDENTIFIER NOT NULL, app_origin NVARCHAR(256) NOT NULL, return_to NVARCHAR(2048) NOT NULL, secret_cipher VARBINARY(2048) NOT NULL, crypto_key_id CHAR(16) NOT NULL, created_at DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(), expires_at DATETIME2(3) NOT NULL; hex/name/수명10분 제약과 expires 인덱스. secret_cipher의 version1/AES-GCM/IV/tag/암호문은 T02가 채운다. 소비는 DELETE...OUTPUT으로 일회성이고 consumed 상태 열은 없다.
  - dbo.posts: author_tenant_id/author_object_id UNIQUEIDENTIFIER NULL DEFAULT NULL, 두 열 모두NULL 또는 모두NOT NULL/FK board_users. 기존 nickname NVARCHAR(20)→NVARCHAR(256), CK_posts_nickname 1..256, password_hash VARCHAR(256)→NULL 허용. 새 CK_posts_author: legacy=owner둘다NULL+password_hash NOT NULL 또는 계정글=owner둘다NOT NULL+password_hash IS NULL. 기존 행 nickname/content/content_json/format/created_at/password_hash를 update하지 않는다. author_tenant_id,author_object_id,created_at,id 인덱스.
  - dbo.upload_sessions: owner_tenant_id/owner_object_id UNIQUEIDENTIFIER NULL, auth_session_hash CHAR(64) NULL. 셋 모두NULL=legacy 또는 셋 모두NOT NULL+author_hash IS NULL=계정업로드. owner FK board_users와복합FK(auth_session_hash,owner_tenant_id,owner_object_id)→auth_sessions(id_hash,tenant_id,object_id)(NO CASCADE)로앱세션/소유자일치도강제한다. auth_session_hash/state 인덱스. 기존 CK_upload_sessions_target을 교체: target NULL이면 author_hash NULL; target NOT NULL이면 기존 author_hash NOT NULL 또는 새 owner pair NOT NULL. 기존행/기존author_hash 보존. T03까지 기존 발급이 계속 가능하게 한다.
  - CK_rate_buckets_action은 기존3개값을 보존하고 'oidc-login'을 추가한다. 기존 rate 행/미디어 원장/asset/job 상태·charge를 지우지 않는다. 새 identity 테이블은 처음에는 비어 있어야 한다.
- **Execution Flow / Logic**: 전용 SQL fixture에서4까지만 적용→plain/rich/attached/ready/legacy upload/rate/admin rows seed→005 두 번 및 동시 migrate→원래 열을 바이트/날짜로 비교한다. password 조건·partial owner·고아FK·잘못된이름/해시/만료를 SQL이 거부해야 한다. limited app는3테이블 DML허용/DDL·db_owner거부를 확인하고 운영용 CLI는 여기서 실제 실행하지 않는다.

### I02. 설정과 서버 principal
- Related Files:
  - board/src/lib/auth/types.ts :: SessionDto; new
  - board/src/lib/server/auth-config.ts :: readAuthConfig/assertTestOidc; new
  - board/src/lib/server/auth-principal.ts :: Principal/claims/account key; new
  - board/.env.example :: 비밀 없는 새env 설명; modify
  - board/tests/auth-config.test.ts :: 설정/claim guards; new
#### Details
- **Signatures & Types**:
```typescript
type Principal={tenantId:string;objectId:string;displayName:string;isAdmin:boolean;sessionHash:string;expiresAt:Date};
type SessionDto={displayName:string;isAdmin:boolean;expiresAt:string};
type EntraConfig={mode:'entra';origin:string;tenantId:string;clientId:string;clientSecret:string;issuer:string;callbackUrl:string;encryptionKey:Buffer;cryptoKeyId:string};
type AuthConfig={mode:'maintenance';origin:string}|EntraConfig;
readAuthConfig(env?:NodeJS.ProcessEnv):AuthConfig;
assertTestOidc(env:NodeJS.ProcessEnv):void;
validateEntraClaims(claims:Record<string,unknown>,config:EntraConfig):{tenantId:string;objectId:string;displayName:string;isAdmin:boolean;tokenExpiresAt:Date};
getAccountKey(principal:Pick<Principal,'tenantId'|'objectId'>,env?:NodeJS.ProcessEnv):string;
```
- **Data & Schema Fields**: AUTH_MODE=maintenance|entra(defaultmaintenance), ENTRA_TENANT_ID는69c1e470-4528-435a-a1ae-de98e0aac738 고정, ENTRA_CLIENT_ID UUID, ENTRA_CLIENT_SECRET 길이8..1024/비어있음금지, AUTH_ENCRYPTION_KEY64lowerhex. origin은기존APP_ORIGIN의길이256이하canonicalorigin이며WEBSITE에서는HTTPS, 로컬비WEBSITE에서는http127.0.0.1:3000 또는3200만허용한다. issuer는tenant에서고정추론, callback=origin+'/api/auth/callback'. 운영의임의issuer env는허용하지않는다. maintenance는OIDC비밀없이최소mode/origin만반환하고호출자가mode를먼저구분한다. entra설정누락/오류는BoardError503이다.
- **Test overrides**: APP_TEST_MODE1에서는assertTestDatabase/assertMediaTestStorage를동시에확인한다. test일때만 TEST_OIDC_ISSUER=http://127.0.0.1:<allocatedPort>, TEST_OIDC_CLIENT_ID UUID/TEST_OIDC_CLIENT_SECRET랜덤을허용하고APP_ORIGIN은3100이다. WEBSITE가없어야하며issuer metadata/token/JWKS각endpoint는같은loopbackorigin이어야한다. redirect를따라실제Entra/외부로접속하지않는다. 운영의TEST_OIDC_*나가짜endpoint설정은503으로거부한다. wrapper는상속AUTH_/ENTRA_/TEST_OIDC_를지운뒤테스트값만주입한다.
- **Claims**: 라이브러리가서명/issuer/aud/expiry를검증한뒤tid정확일치, oid는0이아닌GUID(UUID버전제한없음/canonical lowercase), acct는0또는'0'만, name은trim후1..256자/제어문자없음, exp는미래정수를요구한다. roles누락은일반사용자이며존재하면최대32개/각128자이하string[]만허용한다. 정확한Board.Admin만관리자다. Member불일치403, token구조/재사용401, 설정/기반시설오류503.
- **계정 제한 키**: HMAC-SHA256(RATE_LIMIT_KEY_SECRET, JSON.stringify(['board-user-v1',canonicalTid,canonicalOid])). session/메일/클라이언트identity/IP값은사용하지않는다. 기존getClientKey는익명로그인시작용으로보존한다.

### I03. opaque 세션과 트랜잭션 재검사
- Related Files:
  - board/src/lib/server/auth-session.ts :: create/read/assert/revoke/cleanup; new
  - board/src/lib/server/media-transactions.ts :: 기존 capacity lock 순서; read-only
  - board/tests/auth-session.test.ts :: 실제SQL 다중연결/만료/취소; new
#### Details
- **Signatures & Types**:
```typescript
createAppSession(pool:ConnectionPool,identity:{tenantId:string;objectId:string;displayName:string;isAdmin:boolean;tokenExpiresAt:Date},config:EntraConfig,now?:Date):Promise<{cookieValue:string;principal:Principal}>;
readAppSession(pool:ConnectionPool,cookieValue:string|undefined,config:EntraConfig,now?:Date):Promise<Principal|null>;
assertSessionInTransaction(tx:sql.Transaction,principal:Principal,requireAdmin?:boolean):Promise<void>;
revokeAppSession(pool:ConnectionPool,principal:Principal):Promise<void>;
cleanupAuthState(pool:ConnectionPool,now?:Date):Promise<{flows:number;sessions:number}>;
```
- **Logic**: randomBytes32를64hex cookie로만들고DB에는SHA256만저장한다. users는UPDLOCK/HOLDLOCK upsert로최신표시이름을기록하지만과거post작성자표시를바꾸지않는다. session은이번에검증한이름/role을snapshot하고expires=min(SQLnow+1h,tokenExp)로저장한다. 원문token은public DTO에서제외한다. read는cookie형식/hash/SQL미취소·미만료/origin/clientId/tid일치를요구하고DB오류503을익명으로취급하지않는다.
- **락 순서**: 모든미디어변경/로그아웃은capacity→auth_session→upload_session→post→asset순서다. assertSessionInTransaction은DBsession UPDLOCK/HOLDLOCK으로현재identity/origin/clientId/만료/role을재검사하며request의오래된isAdmin만신뢰하지않는다. read-only session조회는capacity독점락없이수행한다.
- **revoke**: 같은capacity transaction에서revoked_at을설정하고해당auth_session_hash의active upload session을cancelled로바꾼다. 미attached uploading/ready asset은queueDeletion으로보내지만게시글/attached이미지는삭제하지않는다. T01기존upload는앱세션연결이없어기존회귀에영향없다. T03의inflight uploader는매SQL단계session을재확인하므로취소후ready부활을막는다. 락전/후logout의완료순서는각각정상적으로선형화된다.
- **cleanup**: 만료flow를최대100개삭제, 취소/만료appsession은만료후30일이지났고upload_session FK참조가없는것만최대100개삭제한다. users자동삭제는없다. auth-login/logout의best-effort bounded cleanup 또는trustedCLI만호출하며고정오류코드만출력하고주업무결과를덮지않는다. 요청마다무제한큰테이블scan하지않는다.
- **Tests**: 두연결간지속성/랜덤token/잘못된cookie/만료·취소·다른origin/client/tid거부, 이름1/256자·기존20자경계, 오래된admincontext권한거부, authDB오류503, logouttoken재사용거부, cleanup의uploadFK보존.

## Acceptance Criteria
- [x] schema4→5의모든기존열자료보존과멱등/동시성/제약/최소권한검사가통과했다.
- [x] maintenance기본닫힘/격리issuer만override/정확한claim·session검증/비밀없는로그를확인했다.
- [x] 기존route는아직새인증에연결하지않았고nullable확장후기존회귀와새코어검사가통과한다.
- [x] 지정파일/Task만커밋하고사용자변경·실행서버·운영리소스를보존했다.

## Validation
- `npm run test:service` — schema/session/guard와기존service통과, 소유Docker fixture자동정리.
- `npm run test:api` — schema5health기대값갱신후기존API통과. 운영업그레이드완료로보고하지않는다.
- `npm run typecheck`, `npm run lint`, `git diff --check` — 전부성공.
- Git status/명시staged diff에.env/DB/key/루트도구/사용자next-env가없는지확인.

## Commit Message
```text
feat(auth): add Entra identity schema and server sessions

Plan: 2026-11-18-entra-id-login
Phase: P01-auth-core
Task: T01-identity-schema

- preserve schema4 data while adding account ownership and hashed app sessions
- validate fail-closed auth configuration and transactional session revocation
```

## Progress
- [x] 구현 완료
- [x] 검증 통과
- commit: pending

## Next Task
P01-auth-core/T02-oidc-login.md. Task done/지정커밋 후 phase/current를 갱신한다.

## Execution Notes
- feature/entra-id-login을원격main96edfc50b2dae16b195d1b219d0fcd335c62f55d에서생성했다. 운영SQL/Entra/Azure/main은변경하지않았다.
- schema5추가migration과세션/claim/설정코어를구현했다. 원문opaque쿠키는반환만하고DB에는SHA256만저장한다. 업로드소유자와앱세션을복합FK로결합하고logout은같은capacity락안에서해당draft만취소/outbox처리한다.
- schema4→5의기존plain/rich글·날짜·해시·attached/ready이미지·업로드·rate/admin행을그대로보존,동시/반복migration·제약·DB실효DML/DDL거부를격리SQL에서검증했다.
- 최종서비스66개(기존54+추가12), API18개, typecheck/lint/diffcheck통과. 마지막길이/제어문자보강후서비스66개와type/lint를재검증했다. API는새core모듈과연결하지않았으며그18개결과를유지한다. APIhealth는APP_VERSION기대값만있어api.spec.ts코드변경은필요하지않았다.
- 새GUID/hex키/쿠키는정규식과정확한길이를함께검사하고마지막LF/제어문자회귀도추가했다. 기존이미지UUID정규식의LF검사결과는false(거부)였으므로기존결함으로보고하지않고미디어코드도수정하지않았다. 이번범위밖에서확정한별도결함은특이사항없음.
- 실제JWT서명/nonce/PKCE/OIDC callback과API인증연결은다음Task이후다. validateEntraClaims는이미라이브러리로검증한claims만받는후속필터이며이함수만으로token인증을했다고보지않는다.
- 테스트소유SQL/Azurite정리완료, 사용자next-env의.next/dev/types경로/3000/Dockerpad/루트도구와기존SQLite보존. .env.local을테스트에서읽지않았고별도운영migration/제한계정CLI도실행하지않았다.
