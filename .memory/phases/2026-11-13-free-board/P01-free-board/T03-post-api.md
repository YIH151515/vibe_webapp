# Task: T03 게시글 API

## Status: pending

## Goal
서비스를 JSON HTTP API로 제공하고 잘못된 입력과 권한 오류가 일관된 응답으로 처리되도록 한다.

## Decision Summary
- 비회원 글 비밀번호 권한 확인은 서버가 수행한다.
- 기본 정보·검색·최신순 페이지 나누기·밝은 반응형 화면의 확정 범위를 지킨다.

## Execution Context
- 루트 D:/vibeweb, 앱 D:/vibeweb/board. 명령은 앱 루트에서 실행한다.
- Node 24.x, Next.js 16.x App Router, React 19.x, TypeScript strict, npm.
- 선행 Task에서 공유 DTO와 createPostService(db), getDatabase(), BoardError, 입력 parser를 구현했다.
- 로컬 비회원 게시판이며 댓글·업로드·관리자·배포는 제외한다.
- 완료 후 Task Status, phase.md와 current.md를 갱신하고 관련 파일만 명시적으로 stage하여 지정 메시지로 커밋한다.

## Implementation

### 공통 DTO 및 HTTP 계약
```typescript
type PostInput = { title: string; content: string; nickname: string; password: string };
type PostSummary = { id: number; title: string; nickname: string; createdAt: string };
type Post = PostSummary & { content: string };
type PostPage = { items: PostSummary[]; total: number; page: number; pageSize: 20; totalPages: number; q: string };
type ErrorCode = 'VALIDATION_ERROR' | 'INVALID_PASSWORD' | 'NOT_FOUND' | 'FORBIDDEN' | 'UNSUPPORTED_MEDIA_TYPE' | 'INTERNAL_ERROR';
type ErrorBody = { error: { code: ErrorCode; message: string; fieldErrors?: Record<string,string> } };
```
- GET /api/posts?q=&page=1 → 200 PostPage (직접 반환, data 래퍼 없음).
- POST /api/posts JSON PostInput → 201 Post, Location: /posts/{id}.
- GET /api/posts/{id} → 200 Post.
- PATCH /api/posts/{id} JSON PostInput → 200 Post. 비밀번호는 기존 글 확인용이며 변경하지 않는다.
- DELETE /api/posts/{id} JSON {password:string} → 204 빈 응답.
- 오류: 잘못된 JSON/입력/id/query 400 VALIDATION_ERROR, 비밀번호 불일치 403 INVALID_PASSWORD, Origin 실패 403 FORBIDDEN, 없는 글 404 NOT_FOUND, JSON 아닌 쓰기 요청 415 UNSUPPORTED_MEDIA_TYPE, 예상 못 한 내부 오류 500 INTERNAL_ERROR. 오류 응답은 ErrorBody.
- title/content/nickname은 trim 후 각각 1~100/1~10000/2~20자. 본문 CRLF는 LF 변환. password는 trim 없이 8~64자이며 공백만은 거부. 길이는 JS UTF-16 length.
- q는 trim, 기본 "", 최대 100자. page는 기본 1, 양의 안전 정수만 허용. 같은 q/page 중복은 400. 제목 OR 본문 리터럴 부분 검색, 최신 createdAt DESC/id DESC, 20개, totalPages 최소 1, 초과 페이지는 마지막 페이지로 보정.
- 모든 DTO 필드는 필수/non-null. id는 양의 안전 정수. createdAt은 UTC ISO이고 수정 후에도 유지. 해시·비밀번호는 모든 응답에서 제외.

### I01. Route Handlers와 공통 HTTP 처리
- Related Files:
  - `board/src/app/api/posts/route.ts` :: GET/POST; new
  - `board/src/app/api/posts/[id]/route.ts` :: GET/PATCH/DELETE; new
  - `board/src/lib/server/http.ts` :: readJson/ensureSameOrigin/toErrorResponse; new
  - `board/src/lib/server/{posts,database,validation,errors}.ts` :: 기존 서비스; read-only, 계약 위반 수정만 허용
#### Details
- **Signatures & Types**:
```typescript
// collection route
GET(request: Request): Promise<Response>;
POST(request: Request): Promise<Response>;
// item route
type ItemContext = { params: Promise<{ id: string }> };
GET(request: Request, context: ItemContext): Promise<Response>;
PATCH(request: Request, context: ItemContext): Promise<Response>;
DELETE(request: Request, context: ItemContext): Promise<Response>;
// http helper
readJson(request: Request): Promise<unknown>;
ensureSameOrigin(request: Request): void;
toErrorResponse(error: unknown): Response;
```
- **Data & Schema Fields**: 위 HTTP 계약을 그대로 사용하며 DB schema는 변경하지 않는다. 서비스: createPostService(getDatabase()), list({q,page}), get(id), create(PostInput), update(id,PostInput), remove(id,{password}). 쓰기 메서드 반환은 Promise.
- **Execution Flow / Logic**:
  1. 두 route 파일에 runtime='nodejs', dynamic='force-dynamic'. 모든 응답에 Cache-Control: no-store. params를 await한 뒤 parsePostId 호출한다.
  2. GET 목록은 URLSearchParams를 parseListQuery로 파싱한다. GET 상세는 get 호출. 서비스 DTO만 응답하며 직접 DB row를 직렬화하지 않는다.
  3. POST/PATCH/DELETE는 ensureSameOrigin→Content-Type검사→JSON파싱→필드검증→서비스 호출 순서로 수행한다. Content-Type은 application/json 및 charset 매개변수를 허용한다. 잘못된 body JSON은 400, 다른 Content-Type은 415.
  4. 쓰기 Origin이 있으면 new URL(request.url).origin과 정확히 일치해야 한다. Origin=null 문자열이나 URL 파싱 실패는 403. Origin이 없으면 Sec-Fetch-Site: cross-site를 거부하고 그 외는 로컬 curl/테스트 호환을 위해 허용한다. CORS 허용 헤더나 임의 allowed origins 설정을 추가하지 않는다.
  5. BoardError는 정의된 status/code/fieldErrors로 변환. 예상 못 한 오류는 고정 한국어 메시지 '처리 중 오류가 발생했습니다.'와 500. request body, 비밀번호, hash와 SQL을 응답/로그에 넣지 않는다.
  6. 204는 Response(null,{status:204})로 생성한다. 201 Location은 생성된 id로 만든다. 프레임워크 기본 405 처리를 사용한다.

### I02. 실제 서버 API 통합 검증
- Related Files:
  - `board/playwright.config.ts` :: webServer 및 격리; new
  - `board/tests/api.spec.ts` :: API 통합 테스트; new
  - `board/.gitignore` :: 테스트 DB 경로 제외 필요시; modify
#### Details
Playwright config는 testDir=tests, workers=1, fullyParallel=false, baseURL=http://127.0.0.1:3100, webServer command='npm run dev -- --port 3100', url=baseURL, reuseExistingServer=false, env DATABASE_PATH='./test-results/api-e2e.sqlite'. Next에 환경을 전달하여 사용자 기본 DB와 분리한다. 개발 서버 시작에 필요한 충분한 timeout을 지정한다. Playwright 결과 디렉터리는 제외되며 서버 종료 후 다음 실행은 새 DB로 시작하도록 globalSetup에서 해당 테스트 전용 경로의 sqlite와 -wal/-shm만 정리한다.
- globalSetup은 `board/tests/global-setup.ts`의 default async function globalSetup(): Promise<void>. resolve한 경로가 board/test-results 안인지 확인한 뒤 정확한 세 파일만 force 삭제. 재귀 삭제하지 않는다.
- tests/api.spec.ts는 실제 HTTP request fixture를 사용한다. 각 테스트 고유한 검색 토큰을 사용해 데이터 오염 없이 검증한다. POST→GET→PATCH→DELETE 수명주기, 비밀번호 실패 시 무변경, 입력 경계/숫자 id, malformed JSON, Content-Type, 다른 Origin 차단, 해시 누출 없음, 21개 결과의 다음 페이지, q 보존과 초과 page, 응답 status/cache/location을 검사한다.
- service 테스트는 이 서버나 DB를 사용하지 않는다. API tests만 실행할 때 브라우저 바이너리는 필요 없다.

## Acceptance Criteria
- [ ] 모든 endpoint가 명시된 status와 DTO로 응답한다.
- [ ] 잘못된 비밀번호와 cross-origin 쓰기가 데이터를 변경하지 않는다.
- [ ] API 테스트 DB가 실제 DB와 분리되고 실패해도 서버가 정리된다.

## Validation
- `npm run test:api` — 실제 Next 서버 대상 API 테스트 성공.
- `npm run test:service` — 서비스 회귀 없음.
- `npm run typecheck` 및 `npm run lint` — 성공.
- `npm run build` — 성공.

## Commit Message
```text
feat(board): expose validated post API routes

Plan: 2026-11-13-free-board
Phase: P01-free-board
Task: T03-post-api

- 서비스를 JSON HTTP API로 제공하고 잘못된 입력과 권한 오류가 일관된 응답으로 처리되도록 한다.
```

## Progress
- [ ] 구현 완료
- [ ] 검증 통과
- commit: pending

## Next Task
T04-board-ui.md
