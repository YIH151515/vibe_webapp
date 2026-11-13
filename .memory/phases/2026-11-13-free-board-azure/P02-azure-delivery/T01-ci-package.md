# Task: T01 Linux 배포 패키지와 CI

## Status: done

## Goal
운영 비밀값 없이 Linux 실행 패키지를 만들고 main의 전체 검증 성공 후에만 Azure 배포하는 workflow를 준비한다.

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
### I01. standalone 패키지
- Related Files:
  - board/next.config.ts :: 조건부 standalone; modify
  - board/package.json, package-lock.json :: build:azure/package:azure/verify:azure; modify
  - board/scripts/build-azure.mjs :: buildAzure; new
  - board/scripts/package-azure.mjs :: packageAzure; new
  - board/scripts/verify-azure.mjs :: LinuxDocker 검증; new
  - board/tests/package.test.mjs :: ZIP/file/기동 검사; new
  - board/.gitignore :: .deploy/; modify
  - board/src/app/api/health/route.ts :: GET; new
#### Details
- **Signatures & Types**:
```typescript
// script 입출력 계약. mjs에서 같은 구조를 구현한다.
buildAzure():Promise<void>;
packageAzure():Promise<{zipPath:string;sha256:string}>;
verifyAzure():Promise<void>;
GET():Promise<Response>; // /api/health
```
- **Data & Schema Fields**: release ZIP 루트 server.js/package.json/node_modules/.next, .next/static 포함, public이 있으면 public 포함. .env*/SQL스크립트/테스트/SQLite/.git/.memory/스타터킷/운영키는 제외. .deploy/release.json은 {commit:string,sha256:string,nodeMajor:24}이며 비밀값 없음.
- **Execution Flow / Logic**:
  1. NEXT_DEPLOY_STANDALONE=1일 때만 output:standalone, outputFileTracingRoot=board cwd. 기본 로컬 npm run build는 기존형식을 유지해 Windows symlink/junction 이식성 문제를 피한다. build:azure는 Node child process에 플래그를 넣어 next build를 실행하며 실제 Linux에서만 릴리스용으로 사용한다.
  2. package:azure는 .next/standalone의 정해진 runtime 파일과 .next/static/public을 .deploy/staging으로 복사하고 archiver7.0.1 dev dependency로 board.zip을 만든다. 패키징 출력 경로는 앱/.deploy 하위임을 확인한다. 폴더 정리도 검증된 해당 staging만 대상으로 한다.
  3. 경로 필터와 ZIP 검사로 .env/개인키/DB/data/원본이 포함되지 않게 한다. static이 빠지면 실패한다. artifact의 SHA256을 기록한다. SQL나관리자 비밀값을 build/env/config에 bake하지 않는다.
  4. verify:azure는 기존 Docker Linux 엔진의 node:24-bookworm 컨테이너에서 현재 소스를 검증한다. 임시 작업 폴더에는 src/scripts/sql/tests와package/lock/config만 복사하고 node_modules/.next/.env/.git/data를 제외한다. 컨테이너 내부 npm ci→build:azure→package:azure→node --test tests/package.test.mjs를 실행한다. 이 컨테이너는 DB없이패키지검증만 하며 완료 시 소유한 컨테이너와임시파일만 정리한다.
  5. package 테스트는 ZIP경로/필수assets/secret제외를검사하고 child node server.js를HOSTNAME=0.0.0.0/임의PORT로기동한다. root200과실제CSS200을검증한다. SQL없는health는503이어야하고프로세스가죽지않아야한다.
  6. health GET은Node/force-dynamic/no-store, SELECT1과schema_migrations 최신version3을확인해200{status:"ok",version:APP_VERSION??"local"}를반환한다. 실패503{status:"unavailable"}, 상세DB/서버정보는없다. import/build접속금지.

### I02. workflow 계약
- Related Files:
  - .github/workflows/board-azure.yml :: verify/package/deploy jobs; new
  - board/scripts/check-workflow.mjs :: 구문·필수 조건 검사; new
  - board/tests/package.test.mjs :: artifact 회귀; new
  - board/README.md :: 빌드·CI·배포 인증 구분; modify
#### Details
- **Signatures & Types**: checkWorkflow(path:string):void. YAML parser dev dependency yaml2.x를 lockfile에고정. action은실행시각공식repo의지원안정tag를확인하고fullcommitSHA로고정하며comment에tag를기록한다. azure/login은OIDC지원v2이상, azure/webapps-deploy는v3이상으로호환되는공식release를선택한다.
- **Data & Schema Fields**: repo variables AZURE_CLIENT_ID/AZURE_TENANT_ID/AZURE_SUBSCRIPTION_ID/AZURE_WEBAPP_NAME. 여기에는SQL/Admin암호를넣지않는다. OIDC subject=repo:YIH151515/vibe_webapp:ref:refs/heads/main. production용GitHub environment를별도로선언하지않아subject를바꾸지않는다.
- **Execution Flow / Logic**:
  1. pull_request 및 push main, workflow_dispatch. paths는 board/** 및 .github/workflows/board-azure.yml이며, 음수 패턴 !board/docs/** 와 !board/README.md를 뒤에 넣어 문서 전용 완료 커밋이 재배포를 반복하지 않게 한다. permissions 기본contents:read. working-directory=board. ubuntu-latest/Node24, npm cache의lockfile경로 board/package-lock.json.
  2. verify job: npm ci, Chromium with-deps설치, npm run test:all, typecheck/lint, Linux build:azure/package:azure, package.test. Docker가제공된runner에서Testcontainers를사용한다. PR에는Azure자격증명이나운영DB를전달하지않는다.
  3. 성공한동일job의board.zip/release.json을artifact로올린다. ZIP안hidden .next가존재하는지검사하므로upload의숨김파일누락위험을피한다. upload trace 등실패진단은테스트용데이터에한하며운영비밀값없음.
  4. deploy job은needs verify, ref main && event!=pull_request이고4개repo변수가모두설정된때만실행한다. 미설정이면준비단계라skip상태를명시하며성공배포라보고하지않는다. id-token:write는deploy job에만, contents:read 유지. concurrency는production단일그룹/cancel-in-progress=false.
  5. login OIDC→artifact download와SHA256일치검사→azure/webapps-deploy에board.zip전달. startup node server.js는리소스Task에서설정한다. az webapp config appsettings set으로APP_VERSION=배포commit을갱신하되 --output none 사용. 실패시배포성공을기록하지않는다.
  6. 배포후실제기본호스트/api/health의version=배포SHA를시간제한내확인한다. URL은azure리소스반환값을사용하며이름형식으로추정하지않는다. 로그에settings전체·응답쿠키출력금지.
  7. check-workflow는YAMLparse와분기조건/needs/OIDC권한/비밀값미포함/boardcwd/Node24를검사한다. 이번Task는파일과로컬검증까지만하고push/실제배포는후속Task다.

## Acceptance Criteria
- [x] Linux artifact의root/static이정확하고환경파일·데이터가없음.
- [x] DB없는빌드·패키지기동이가능하며health는안전하게503.
- [x] PR검사와main배포의권한·환경·artifact가분리됨.

## Validation
- npm run test:all — 기존SQL/보안/관리자전체회귀.
- npm run typecheck / npm run lint / npm run build — 기본로컬빌드성공.
- npm run verify:azure — 일회용Linux컨테이너의실제패키징·HTTP/assets검증.
- node scripts/check-workflow.mjs — YAML과배포가드검증.
- git diff --check — 성공.

## Commit Message
```text
ci(board): package verified Linux releases for Azure

Plan: 2026-11-13-free-board-azure
Phase: P02-azure-delivery
Task: T01-ci-package

- 운영 비밀값 없이 Linux 실행 패키지를 만들고 main의 전체 검증 성공 후에만 Azure 배포하는 workflow를 준비한다.
```

## Progress
- 실행 보완: 구독 전체 리소스 검색 없이 대상 앱을 지정하도록 비밀이 아닌 AZURE_RESOURCE_GROUP 변수도 추가했다. deploy 가드는 기존4개와 이 변수가 모두 있어야 통과한다.
- [x] 구현 완료
- [x] 검증 통과: 전체42개(서비스19/API13/E2E10), typecheck/lint/build, workflow checker, 실제 Node24 Linux ZIP·HTTP/CSS·503·비밀파일 배제 검사.
- 첫 Linux 검증은 Windows bind mount 대량 파일 I/O 지연으로 소유 컨테이너만 중지했다. 내부 Linux FS에서 빌드하고 ZIP만 교환하도록 개선한 최종 실행은 성공했다.
- commit: 58340f9

## Next Task
P02-azure-delivery/T02-azure-resources.md
