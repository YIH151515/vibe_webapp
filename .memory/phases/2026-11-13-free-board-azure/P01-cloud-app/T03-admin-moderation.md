# Task: T03 관리자 세션과 글 삭제

## Status: done

## Goal
관리자가 비밀번호로 로그인해 작성자 비밀번호 없이 글을 삭제하고 로그아웃·만료 후 권한이 사라지게 한다.

## Decision Summary
- 기본 게시글 동작과 SQL 인증을 유지하며 공개 운영 보안을 추가한다.
- 제한 기록과 관리자 세션은 같은 SQL DB에서 공유한다.

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
### I01. 관리자 세션
- Related Files:
  - board/sql/003-admin-sessions.sql :: version3; new
  - board/src/lib/server/admin.ts :: 로그인·서명·세션 조회/취소; new
  - board/src/lib/server/password.ts :: 기존 scrypt 재사용; read-only
  - board/src/lib/posts/types.ts :: ErrorCode UNAUTHENTICATED(401); modify
  - board/scripts/admin-password.ts :: 비밀 입력 hash 도구; new
  - board/.env.example :: 관리자 hash/서명키; modify
#### Details
- **Signatures & Types**:
```typescript
type AdminSession = {expiresAt:string};
loginAdmin(pool:ConnectionPool,password:string):Promise<{cookieValue:string;session:AdminSession}>;
getAdminSession(pool:ConnectionPool,cookieValue:string|undefined):Promise<AdminSession|null>;
revokeAdminSession(pool:ConnectionPool,cookieValue:string|undefined):Promise<void>;
deletePostAsAdmin(pool:ConnectionPool,id:number):Promise<void>;
```
- **Data & Schema Fields**: dbo.admin_sessions: id_hash CHAR(64) PK, created_at DATETIME2(3) DEFAULT SYSUTCDATETIME(), expires_at DATETIME2(3), 모두 NOT NULL. expires_at 인덱스. 세션 원문은 DB에 저장하지 않는다.
- **Execution Flow / Logic**:
  1. ADMIN_PASSWORD_HASH는 기존 scrypt 형식, ADMIN_SESSION_SECRET는32bytes/64hex 필수. 누락은 관리자 API503, 기존 게시글 GET 등은 불필요하게 막지 않는다. 비밀번호 입력은 문자열8~128자이며 trim하지 않고 공백만 거부한다. 최대128자는 관리자 전용이며 작성자 제한64자와 혼동하지 않는다.
  2. 관리자비밀번호는 기존 verifyPassword로 확인한다. 오답은401 UNAUTHENTICATED 고정 메시지. 실제 password/hash를 응답하지 않는다. 로그인 실패는 T02 admin-login 제한5/15분을 사용한다.
  3. 로그인 성공 시 randomBytes32의sid, 현재UTC iat초, exp=iat+3600, HMAC-SHA256 서명을 생성한다. 쿠키 형식 sidHex.iat.exp.signatureHex. MAC에는 버전문자열/APP_ORIGIN/ADMIN_PASSWORD_HASH도 포함하여 origin 또는hash/키 교체 시 기존세션을 무효화한다.
  4. DB에는 SHA256(sid)와 만료만 저장한다. 쿠키 parser는 정확한4개필드/hex길이/안전정수/exp-iat=3600/미래iat허용오차30초를 검사하고 timingSafeEqual로 서명을 비교한다. DB세션이 존재하고 아직 만료 전이어야 한다. SQL오류는503, 위조/없는세션/만료는401로 구분한다.
  5. 쿠키 board_admin: HttpOnly/Path=/ /SameSite=Strict/Domain 없음/Max-Age3600. Secure는 APP_ORIGIN이HTTPS면true. 로그아웃은 유효sid DB행을 삭제하고 항상 같은속성Max-Age0으로 쿠키 제거한다. 탈취 토큰 재사용도 로그아웃 후401. 만료24시간 지난 세션을 최대1000개씩 정리한다.
  6. deletePostAsAdmin은 검증한id의DELETE를 매개변수로 실행하고0행이면404. 관리자 route의 인증 후에만 호출한다.
  7. npm run admin:password 도구는 터미널 숨김입력 또는 stdin으로 비밀번호를 읽고 scrypt hash만 반환한다. 비밀번호를 명령 인수로 받지 않는다. 이후 운영 설정값은 비밀 관리 경로로 전달한다.

### I02. 관리자 API와 화면을 함께 완성
- Related Files:
  - board/src/app/api/admin/login/route.ts :: POST; new
  - board/src/app/api/admin/session/route.ts :: GET; new
  - board/src/app/api/admin/logout/route.ts :: POST; new
  - board/src/app/api/admin/posts/[id]/route.ts :: DELETE; new
  - board/src/app/admin/page.tsx, board/src/components/admin-panel.tsx :: AdminPage/AdminPanel; new
  - board/src/lib/client/admin-api.ts :: 로그인/세션/삭제/로그아웃; new
  - board/src/app/globals.css, layout.tsx :: 최소 관리자 진입 링크·스타일; modify
#### Details
- **Signatures & Types**:
```typescript
AdminPage():React.JSX.Element;
AdminPanel():React.JSX.Element;
adminLogin(password:string):Promise<AdminSession>;
adminSession():Promise<AdminSession>;
adminLogout():Promise<void>;
adminDeletePost(id:number):Promise<void>;
```
- **Data & Schema Fields**: POST login JSON{password:string}→200{expiresAt:string}+Set-Cookie; GET session→200{expiresAt:string} 또는401; POST logout→204; DELETE admin/posts/{id} JSON{confirm:true}→204. 기존 ErrorBody/no-store, 추가401/429/503. 로그인 외 비밀번호 제출하지 않는다.
- **Execution Flow / Logic**:
  1. Node runtime/force-dynamic 유지. 관리자POST/DELETE는 ensureSameOrigin(requireOrigin=true)→JSON64KiB검사→서버세션권한검증→변경. GET session도cache하지 않는다. logout은 세션없어도Origin확인 후204/쿠키삭제.
  2. /admin은 처음 세션확인 중 표시,401이면비밀번호폼. 성공하면 기존목록API를 이용한 최신순/검색/페이지 목록과 글별삭제 버튼·로그아웃을 표시한다.
  3. 선택한글의 제목과복구불가안내·동의체크박스·명시적삭제확인을 보여준다. 확인 전 요청을 보내지 않고 진행 중 중복제출을 막는다. 성공 후 목록재조회와 성공안내, 마지막페이지도보정.404는이미삭제안내,401은로그인상태해제,429는대기시간,503은재시도안내.
  4. 로그인 오류마다 비밀번호를비우고URL/storage/log에넣지않는다. 세션쿠키는JS로읽지않고same-origin fetch credentials를사용한다. 모바일390px와키보드/label/aria-live를 지원한다.

### I03. 회귀·권한 검증
- Related Files:
  - board/tests/admin.test.ts :: 서명/DB 세션/시각 경계; new
  - board/tests/admin.spec.ts :: 실제 API와PC/모바일UI; new
  - board/scripts/run-tests.ts :: service/admin*.test 및Playwright선택 갱신; modify
  - board/README.md :: 관리자 설정·교체·동일운영DB 주의; modify
#### Details
API테스트에는브라우저가필요없는admin-api.spec.ts로분리해도되지만test:api가api.spec.ts와admin-api.spec.ts를둘다실행하도록선택을명시한다. test:e2e는board.spec.ts와admin.spec.ts,service는service/security/admin.test.ts를실행한다.
검증: 미인증삭제401·행유지,로그인실패5회/6번째429,정상로그인·Secure/HttpOnly/SameSite/Path,변조/절단/만료토큰,로그아웃토큰재사용불가,키·비밀번호hash변경무효,다른pool세션인식,Origin누락/다른Origin403,삭제동의없음400,권한있는삭제204/없는글404,PC/모바일로그인→취소→삭제→로그아웃. 시각은서버helper에테스트clock을주입하고HTTP에임의시각입력은만들지않는다. seed/세션/제한정리는일회용DB에만한다.

## Acceptance Criteria
- [x] 작성자비밀번호없이관리자만삭제가능하며로그아웃·만료·변조쿠키는거부됨.
- [x] 로그인제한/쿠키속성/Origin/삭제확인이서버와화면에서검증됨.
- [x] PC·모바일관리자흐름과기존게시판전체회귀통과.

## Validation
- npm run test:all — SQL세션·보안·관리자API와브라우저테스트포함성공.
- npm run typecheck / npm run lint / npm run build — 성공.
- npm run admin:password — 테스트전용입력으로hash출력·평문미출력확인.

## Commit Message
```text
feat(board): add authenticated admin moderation

Plan: 2026-11-13-free-board-azure
Phase: P01-cloud-app
Task: T03-admin-moderation

- 관리자가 비밀번호로 로그인해 작성자 비밀번호 없이 글을 삭제하고 로그아웃·만료 후 권한이 사라지게 한다.
```

## Progress
- [x] 구현 완료
- [x] 검증 통과: test:all 41개(서비스19/API12/E2E10), typecheck/lint/build, stdin hash 도구.
- commit: 70826b4

## Next Task
P02-azure-delivery/T01-ci-package.md
