# Task: T01 SQL 저장소와 격리 테스트

## Status: done

## Goal
게시글 저장·조회·API를 비동기 SQL Server로 전환하고 운영 DB를 건드리지 않는 실제 SQL 테스트를 제공한다.

## Decision Summary
- Azure SQL Basic/SQL 인증/동일 운영 DB와 기본 기능 유지라는 확정 결정을 따른다.
- 월50,000원 목표, 관리자 삭제와 공유 요청 제한, GitHub main 자동 배포를 구현한다.

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
### I01. 연결과 migration
- Related Files:
  - board/package.json, package-lock.json :: 의존성/scripts; modify
  - board/src/lib/server/database.ts :: readSqlConfig/openDatabase/getDatabase/closeDatabase; replace SQLite
  - board/src/lib/server/migrations.ts :: migrateDatabase; new
  - board/sql/001-posts.sql :: version1; new
  - board/scripts/migrate.ts :: 명시 CLI; new
  - board/.env.example, README.md :: SQL 설정; modify
#### Details
- **Signatures & Types**:
```typescript
import type {ConnectionPool,config as SqlConfig} from "mssql";
readSqlConfig(env:NodeJS.ProcessEnv,purpose?:"app"|"migration"):SqlConfig;
openDatabase(config:SqlConfig):Promise<ConnectionPool>;
getDatabase():Promise<ConnectionPool>;
closeDatabase():Promise<void>;
migrateDatabase(pool:ConnectionPool):Promise<void>;
```
- **Data & Schema Fields**:
  - dbo.schema_migrations: version INT PK NOT NULL, applied_at DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME().
  - dbo.posts: id BIGINT IDENTITY(1,1) PK CHECK1..9007199254740991; title NVARCHAR(100), content NVARCHAR(MAX), nickname NVARCHAR(20), password_hash VARCHAR(256), created_at DATETIME2(3) DEFAULT SYSUTCDATETIME(). 모든 열 NOT NULL, 외래키 없음. 텍스트 CHECK는 DATALENGTH/2로 UTF-16 최소/최대 길이 검증. IX_posts_created_at_id(created_at DESC,id DESC).
- **Execution Flow / Logic**:
  1. mssql12.7.14, dev @types/mssql12.3.0/@testcontainers/mssqlserver12.2.1을 exact 설치하고 lockfile 갱신한다. 무관한 major는 변경하지 않는다.
  2. 환경변수 검증: port1..65535, pool max5/min0/idle30초, connection/request timeout15초, useUTC/encrypt=true. 기본 인증서 검증을 끄지 않는다. 누락 오류에 실제 설정값을 포함하지 않는다.
  3. globalThis에 지연 연결 Promise를 보관하여 동시 최초 호출을 공유한다. 연결 실패 시 cache를 비워 재시도 가능하게 한다. pool error listener는 비밀값을 로그하지 않는다.
  4. migration은 CLI 전용. transaction과 sp_getapplock(Transaction 소유, key free-board-schema, timeout5000)으로 직렬화하고 version을 같은 transaction에 기록한다. 실패 rollback, 미래 version 거부, 재실행 무변경. 런타임은 DDL하지 않는다.
  5. CLI는 APP_TEST_MODE가 아니고 .env.local이 존재할 때 Node loadEnvFile로 읽되 기존 process env 우선. migration purpose는 SQL_MIGRATION_*를 필수로 요구하고 앱 계정으로 fallback하지 않는다.

### I02. Promise 서비스와 API 동시 전환
- Related Files:
  - board/src/lib/server/posts.ts :: PostService/createPostService; modify
  - board/src/app/api/posts/route.ts :: GET/POST; modify
  - board/src/app/api/posts/[id]/route.ts :: GET/PATCH/DELETE; modify
  - board/src/lib/posts/types.ts :: ErrorCode에 SERVICE_UNAVAILABLE 추가; modify
  - board/src/lib/server/http.ts :: 안전한 DB503 응답; modify
#### Details
- **Signatures & Types**:
```typescript
interface PostService {
 list(input:{q:string;page:number}):Promise<PostPage>;
 get(id:number):Promise<Post>;
 create(input:PostInput):Promise<Post>;
 update(id:number,input:PostInput):Promise<Post>;
 remove(id:number,input:{password:string}):Promise<void>;
}
createPostService(pool:ConnectionPool):PostService;
```
- **Data & Schema Fields**: 공개 DTO 유지. Date→toISOString, BIGINT→검증된 Number. id는 sql.BigInt 입력으로 MAX_SAFE 범위를 지원해 Int 초과를500으로 만들지 않는다. 모든 query는 Request.input으로 타입 지정하며 비밀 열을 공개 projection에 넣지 않는다.
- **Execution Flow / Logic**:
  1. 검색어 ASCII A-Z만 소문자화하고 SQL LIKE의 역슬래시/%/_/[를 escape한다. 열은 TRANSLATE로 ASCII만 변환하고 Latin1_General_100_BIN2를 적용한다. 한 SERIALIZABLE 읽기 transaction에서 count→page보정→동일조건 ORDER BY/OFFSET FETCH를 수행한다.
  2. create는 scrypt 후 INSERT OUTPUT. update/remove는 대상hash 조회→비동기 확인→id+확인hash 조건의 UPDATE OUTPUT/DELETE. hash 계산 동안 SQL lock을 잡지 않는다. 실패403/무대상404/created_at과hash 유지.
  3. API는 await getDatabase와 list/get을 포함한 모든 메서드를 await한다. Promise가 {}로 응답되는 회귀를 막는다. 연결·timeout 오류는503 SERVICE_UNAVAILABLE 고정 메시지, 알 수 없는 오류는500. 기존400/403/404/415 유지한다.

### I03. 테스트 컨테이너와 모든 진입점 격리
- Related Files:
  - board/scripts/run-tests.ts :: runSqlTests; new
  - board/tests/helpers/sql-fixture.ts :: assertTestDatabase/seedPosts; new
  - board/tests/service.test.ts :: SQLite 테스트 교체; modify
  - board/tests/api.spec.ts, board/tests/board.spec.ts :: SQL 회귀; modify
  - board/playwright.config.ts, board/tests/global-setup.ts :: SQL 테스트 설정; modify
#### Details
- **Signatures & Types**:
```typescript
runSqlTests(mode:"service"|"api"|"e2e"|"all"):Promise<number>;
assertTestDatabase(env:NodeJS.ProcessEnv):void;
seedPosts(inputs:PostInput[]):Promise<Post[]>;
```
- **Data & Schema Fields**: MSSQLServerContainer("mcr.microsoft.com/mssql/server:2022-latest").acceptLicense()의 Developer 환경, 임의 강한 암호. getHost/getPort/getUsername/getPassword로 설정하고 새 board_test_<UUIDhex> DB를 만든다.
- **Execution Flow / Logic**:
  1. docker info로 Linux 엔진 확인. 현재 정지 상태이므로 필요하면 기존 Docker Desktop을 Hidden으로 시작해 확인한다. 설치/실행 불가 시 필요한 환경만 요청하고 SQL 검증을 건너뛰거나 운영 DB로 바꾸지 않는다.
  2. wrapper는 운영 .env.local을 로드하지 않고 SQL_*와 APP_TEST_MODE=1을 자식에게 덮어쓴다. migration 후 서비스/Playwright 실행. 실패/종료 시 자식 서버와 pool, 이 실행이 소유한 container만 정리한다.
  3. scripts: test:service/api/e2e/all은 각각 tsx scripts/run-tests.ts <mode>; db:migrate는 tsx scripts/migrate.ts. all은 한 컨테이너 안에서 각 suite별 다른 테스트 DB로 서비스→API→E2E를 직렬 실행한다.
  4. Playwright는127.0.0.1:3100/reuseExistingServer=false, globalSetup은 test증명 검사와 SQL migration만 수행한다. SQLite 파일 삭제 로직은 제거한다. fixture는 테스트DB임을 검증한 뒤 각 test를 별도DB/transaction으로 격리한다.
  5. 기존CRUD/경계/페이지/비밀번호/삭제경합/재접속 보존/비밀값 제외를 SQL에서 검증한다. [ 리터럴 검색과 비ASCII 대소문자, MAX_SAFE id의404, migration2회 무변경, pool 연결 실패 재시도도 포함한다.
  6. seedPosts는 테스트pool의 서비스를 직접 호출하며 운영에서는 실행 불가. 이후 요청 제한에 걸리지 않게21개 글 fixture를 HTTP 작성으로 만들 필요가 없도록 기존 테스트를 변경한다. SQL 없는 import/build 성공도 확인한다.

## Acceptance Criteria
- [x] 비동기 SQL을 통해 기존 HTTP/화면 동작 유지.
- [x] 운영 DB 없이 실제 SQL의 전체 회귀 성공.
- [x] SQLite 파일·미커밋 변경을 보존하고 build는 DB에 접속하지 않음.

## Validation
- docker info --format '{{.OSType}}' — linux; 정지 시 테스트 생략 금지.
- npm run test:all — 실제 SQL 서비스/API/PC·모바일 테스트 성공.
- npm run typecheck / npm run lint / npm run build — 성공, build는 운영 자격증명 불필요.
- git diff --check — 공백 오류 없음.

## Commit Message
```text
feat(board): migrate post storage to Azure SQL

Plan: 2026-11-13-free-board-azure
Phase: P01-cloud-app
Task: T01-sql-storage

- 게시글 저장·조회·API를 비동기 SQL Server로 전환하고 운영 DB를 건드리지 않는 실제 SQL 테스트를 제공한다.
```

## Progress
- [x] 구현 완료
- [x] 검증 통과
- commit: 047adb0

## Execution Result
- Docker Desktop을 Hidden으로 기동했고 Linux 엔진과 공식 SQL Server2022 Developer 이미지를 확인했다.
- mssql12.7.14/@types-mssql12.3.0/Testcontainers12.2.1을 고정 설치했다. 운영 연결은 TLS/인증서 검증 필수이며 테스트 모드는 loopback+고유 board_test_ DB 증명이 필요하다.
- 서비스9개/API7개/PC·모바일E2E7개 총23개 SQL 테스트 통과. typecheck/lint/운영 SQL 자격증명 없는 build도 모두 성공했다.
- SQL 검색의 [, %, _, 역슬래시 및 ASCII 전용 대소문자 처리, BIGINT id, migration 멱등/동시 실행/미래버전 거부, 연결 재시도, 삭제 경합을 검증했다.
- 사용 중인3000포트 개발 서버와 테스트 서버의 .next 폴더 충돌을 확인했다. 필요한 추가 설정 next.config.ts/tsconfig.playwright.json/.gitignore/eslint.config.mjs로 .next-test와 테스트 타입 설정을 분리했다. 사용자 서버는 종료하지 않았다.
- Windows 빌드에서 드라이버 하위 powershell-utils 경로를 Turbopack이 해석하는 오류를 serverExternalPackages:[mssql]로 해결했다. 해당 설정으로 전체 테스트와 빌드를 다시 통과했다.
- 개발 의존성 audit 중간 수준13건(기존 lint와 새 테스트 도구의 archiver/glob 계열), 운영 audit0건. 고정 버전을 강제 downgrade/major 변경하지 않았으며 README에 후속 검토 사항을 기록했다.
- 테스트용 SQL 컨테이너와3100서버를 정리하고 기존 다른 컨테이너는 보존했다. 기존 SQLite와 운영DB에 접속/수정하지 않았다.
- Next 빌드가 바꾼 next-env.d.ts 자동 생성 경로 복원은 자동 검토에서 한 차례 거부됐다. 사용자가 복원 선택1로 명시 승인한 뒤 두 경로만 시작 시점의 .next/dev/types로 복원했고 이 파일은 stage하지 않는다.
- Azure 리소스는 아직 만들지 않았다. 일반 로컬 실행은 후속 구성에서 SQL 환경변수를 제공해야 하며 현재 설정이 없으면503으로 안내한다.

## Next Task
P01-cloud-app/T02-request-security.md
