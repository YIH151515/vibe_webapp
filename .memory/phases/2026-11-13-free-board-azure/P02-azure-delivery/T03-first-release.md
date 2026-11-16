# Task: T03 최초 공개와 운영 인계

## Status: in_progress

## Goal
검증된 main 코드를 지정한 GitHub 저장소에 처음 올려 실제 Azure HTTPS 배포를 완료하고 운영 방법과 완료 증거를 남긴다.

## Decision Summary
- 대상 remote는 https://github.com/YIH151515/vibe_webapp.git, 배포 브랜치는 main.
- 기존 이력을 보존하고 강제 push하지 않는다. 실제 배포가 성공해야 완료한다.

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

### I01. 검토·원격 연결·최초 배포
- Related Files:
  - board/scripts/verify-live.ts :: verifyLive; new
  - board/package.json :: verify:live=tsx scripts/verify-live.ts; modify
  - board/docs/azure-runbook.md :: 실제URL/배포SHA/run/검증/운영절차; modify
  - board/README.md :: 공개 운영·로컬 시작·테스트·운영DB 경계; modify
  - .github/workflows/board-azure.yml :: 필요시 실제 배포 실패 수정; modify
  - .memory/plans/2026-11-13-free-board-azure.md와 현재 phase/Task/current :: 완료 동기화; modify
  - 기존 remote/branch refs :: main과origin 연결; operational mutation
#### Details
- **Signatures & Types**:
```typescript
type LiveCheck = {url:string;expectedCommit:string;allowQaWrites:boolean};
verifyLive(input:LiveCheck):Promise<{deployedCommit:string;checks:string[];qaPostIds:number[];retryAfterSeconds?:number}>;
```
- **Data & Schema Fields**: 실행 기록에는 앱 URL/배포SHA/Actions run URL/SKU/DB명/검증 결과만 저장. 비밀번호/서명쿠키/연결 문자열/원문 IP/DB 데이터 덤프를 저장하지 않는다. admin 비밀번호는 숨김입력 또는 process stdin으로만 받고 쿠키는 이 검증 프로세스 메모리에만 보관한다.
- **Execution Flow / Logic**:
  1. 먼저 검증 script와 runbook을 완성하고 test DB로 smoke 도구를 검증한다. 로컬 서비스/API/E2E/type/lint/build와 Linux artifact 검증이 성공한 상태인지 확인하고 변경이 있으면 관련 검증만 다시 실행한다.
  2. git status/diff와 git ls-files로 staged·tracked·배포 ZIP을 검토한다. 실제 .env/DB/인증서/비밀값과 루트 도구·zip이 포함되지 않았는지 확인한다. 기존 next-env.d.ts 미커밋 변경은 원인 확인 없이 복원하거나 섞지 않는다.
  3. git ls-remote로 원격을 다시 확인한다. 비어 있으면 로컬 master를 main으로 이름 변경하고 origin을 지정 주소로 설정한다. 기존main이 있으면 이력을 확인해 보존한다. 원격에 새로운 이력이 있으면 fetch 후 안전한 통합을 수행하고 충돌 해결을 검증한다. force push/기존 브랜치 삭제 금지.
  4. 실행 도구 추가 등 push 전 준비 커밋이 필요하면 Plan/Phase/Task 헤더를 포함한 별도 준비 커밋을 만든다. 지정 완료 커밋은 실제 검증 성공 후 남긴다. 사용자 GitHub 인증이 없을 때만 로그인 절차를 요청하고 토큰을 채팅/파일에 받지 않는다.
  5. main을 정상 push하고 실제Actions run의 verify→artifact→OIDC→deploy→health 결과를 기다린다. 인증401/RBAC403이면 최소 app scope 역할·federated subject를 수정하고, SQL 연결 실패는 방화벽/TLS/권한을 먼저 확인한다. 기본SKU를 비싼SKU로 바꾸거나 SQL인증서를 꺼서 해결하지 않는다.
  6. 실제 defaultHostName을 사용해 HTTPS200/health.status ok/health.version=배포한코드SHA/정적CSS200을 확인한다. 문서 전용 후속 커밋SHA와 실행 artifactSHA가 다를 수 있음을 기록하고 배포SHA를 HEAD로 추정하지 않는다.

### I02. 공개 환경 검증과 QA 데이터 정리
- Related Files: board/scripts/verify-live.ts :: HTTPS CRUD·세션·프록시·재시작; new
#### Details
- **Data & Schema Fields**: QA 제목은 [deployment-check:<UUID>] 접두어, 닉네임은 deploy-check. 생성한 id를 메모리에 별도로 기록하고 해당 id/접두어가 일치한 행만 작성자 또는 관리자 경로로 삭제한다. 기존 글을 테스트 대상으로 선택하지 않는다.
- **Execution Flow / Logic**:
  1. health/비JSON 오류 등 읽기 검증을 먼저 한다. 명시적으로 이 검증 도구가 생성한 QA 글로 작성→조회→잘못된 비밀번호로 무변경→수정→작성일유지→삭제404를 확인한다. 평문/해시가 응답에 없고 HTTPS Origin은 통과하며 다른Origin은403인지 확인한다.
  2. 관리자 로그인으로 Secure/HttpOnly/SameSite 쿠키, 삭제 동의 거부, 관리자 삭제, 로그아웃 후 이전 쿠키401을 확인한다. 키나 운영 비밀번호를 검증 목적으로 실제 교체하지 않는다.
  3. 플랫폼 client-ip 신뢰는 서로 다른 임의 client-ip/x-forwarded-for/x-client-ip 헤더로 같은 출발지 요청을 보내 제한 기록이 같은 HMAC key에 누적되는지 운영자 SQL의 제한된 조회로 확인한다. 원문 IP나 쿠키는 기록하지 않는다. 플랫폼이 덮어쓰지 않거나 헤더가 없으면 공개 운영을 완료로 처리하지 않고 IP 추출만 수정·재검증한다.
  4. 실제429 확인은 별도 검증 출발지 또는 새 QA 윈도우에서 정책대로 요청하고 Retry-After를 확인한다. 생성되는 최대5개 QA 글은 같은 UUID로 추적해 모두 삭제한다. 이미 일반 활동이 있는 IP의 제한 카운터를 초기화/조작하지 않는다. 검증으로 요청자가 일시 제한되면 남은 Retry-After와 적용 범위를 안내하며 임의로 제한을 끄지 않는다.
  5. 관리자 세션을 로그아웃하기 전에 모든 소유 QA 글을 정리한다. 중간 실패 시 생성id와 안전한 정리 방법을 비밀 없이 남기고 무관한 글은 건드리지 않는다. 운영 DB를 reset/TRUNCATE하거나 테스트 suite를 운영URL에 향하게 하지 않는다.
  6. 별도 QA 글 한 개를 작성하고 az webapp restart 후 health.version과 글 유지 여부를 확인한 뒤 해당 글을 삭제한다. 인스턴스를 scale-out하거나 DB를 다시 만드는 방법으로 재시작 검증을 대체하지 않는다.
  7. 실제 공개 URL을 Chromium1280/390px로 확인하고 기존 화면·관리자·검색·긴 본문·비밀번호 안내를 확인한다. 검증을 위해 시작한 로컬 서버/컨테이너는 모두 종료하고 운영 App Service는 실행 상태로 유지한다.

### I03. 운영 인계와 완료 상태
- Related Files: board/docs/azure-runbook.md, board/README.md, 관련 .memory 문서; modify
#### Details
- **Execution Flow / Logic**:
  1. 실제 URL·구독/RG/app/DB의 non-secret 이름·main/배포SHA/run URL·SKU/예상요금·현재 과금 확인 위치를 기록한다. 월50,000원은 강제 과금 차단이 아니라 목표다.
  2. 로컬 .env.local도 운영 글을 변경한다는 점, test 명령은 Docker 일회용DB라는 점, SQL 비밀번호/adminhash/session키 변경 순서와 세션 무효화, 로컬IP 및 AppService출발IP 변화 시 firewall 갱신을 설명한다.
  3. SQL Basic의 실제 PITR 보존7일/로컬중복제거 백업 설정을 확인한다. 백업 복원은 별도DB와 비용/대상 확인이 필요한 운영 절차이며 이번 Task에서 불필요한 복원 리소스를 생성하지 않는다.
  4. 롤백은 이전 검증된 ZIP과SHA로 앱만 재배포한다. additive schema를 유지하고 운영DB 삭제/역migration은 수행하지 않는다. 로그 조회 예시는 az webapp log tail이며 body/cookie/암호를 로그하지 않는다.
  5. 완료 커밋을 지정 메시지로 남기고 Task done/phase3/3, plan completed, current Active Task 없음/completed로 동기화한다. 메모리 커밋이 추가되면 실행 코드는 바뀌지 않으며 문서 갱신만으로 재배포를 반복하지 않는다.

## Acceptance Criteria
- [ ] 실제 GitHub main workflow와 Azure HTTPS 게시판이 배포SHA로 검증됨.
- [ ] 공개 CRUD·관리자·프록시IP·제한·재시작 영속성과 QA 정리 완료.
- [ ] 비밀값 없이 운영 문서와 전체 completed 포인터가 실제 상태와 일치함.

## Validation
- npm run test:all / npm run typecheck / npm run lint / npm run build / npm run verify:azure — 배포 전 변경분을 포함한 성공 기록.
- node scripts/check-workflow.mjs — 실제 OIDC/분기/권한 설정 일치.
- npm run verify:live -- --url <실제HTTPS주소> --commit <배포SHA> --qa-writes — 이 Task에서 scripts/verify-live.ts와 package script를 추가. 비밀번호 인수는 받지 않는다.
- az webapp show/config 및 GitHub Actions run — 실제SKU/B1인스턴스1/SQLBasic2GB와 배포 성공 확인.
- git diff --check / git status --short — 실행 관련 변경이 커밋되고 기존 무관한 파일·자동 생성 변경은 보존됨.

## Commit Message
```text
deploy(board): publish and verify the Azure board

Plan: 2026-11-13-free-board-azure
Phase: P02-azure-delivery
Task: T03-first-release

- 검증한 main 릴리스를 Azure에 공개하고 운영 안내와 완료 상태를 기록한다.
```

## Progress
- verify-live.ts와 격리 SQL API smoke를 추가했다. 자신이 만든 UUID QA 글 최대5개만 사용하고 정리하며, 실제 SQL HMAC 버킷·쿠키·재시작·브라우저 검증을 포함한다. 관리자 비밀번호는 stdin만 받는다.
- 검증 중 발견한 환경 격리 결함 수정: 운영 .env.local 추가 후 Next dev가 테스트 관리자 hash에 간섭했다. run-tests.ts에 NODE_ENV=test를 지정해 Next의 공식 환경파일 규칙에 따라 .env.local을 제외했다. 테스트 SQL 접속은 loopback/board_test_ guard로 계속 격리돼 운영 DB에는 테스트가 실행되지 않았다.
- 원격 저장소는 빈 상태이며, Git 이력 경로 검사에서 환경파일/DB/zip/개인키 파일이 없는 점을 확인했다. master→main 전환 및 origin 연결 완료.
- 배포 전 전체43개(서비스19/API14/E2E10), typecheck/lint/build, Linux ZIP 기동·CSS·health503·비밀파일 배제와 workflow 검사 통과. CLI 진입부는 Playwright CJS 변환과도 호환되도록 직접 실행 경로 비교로 분리했다.
- 최초 준비 commit/push: 5e63d1fcc85579f94bfb29e78b097ae7874be303 (main→origin/main). 강제 push 없이 기존 이력을 보존했다. Actions https://github.com/YIH151515/vibe_webapp/actions/runs/43777374241 진행 중.
- 첫 run은 verify/패키징 모두 성공 후 OIDC AADSTS700213으로 로그인 실패했다. 실제 assertion이 immutable owner/repo ID 형식임을 공식 문서와 GitHub API(owner355682187/repo1456296194)로 확인해 Azure 연합 subject/Bicep/운영검사를 해당 저장소 main 한정 형식으로 갱신했다. 역할 범위와 SQL 인증/TLS는 유지했다.
- [ ] 구현 완료
- [ ] 검증 통과
- commit: pending

## Next Task
없음. 실제 배포 검증과 QA 정리 후 전체 completed로 기록한다.
