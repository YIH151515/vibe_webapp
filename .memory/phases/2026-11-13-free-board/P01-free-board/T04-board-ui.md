# Task: T04 게시판 화면과 사용 흐름

## Status: done

## Goal
PC와 모바일에서 검색·글 작성·조회·비밀번호 수정·삭제를 완료할 수 있는 로컬 게시판을 제공한다.

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

### I01. 화면 경로와 클라이언트 API
- Related Files:
  - `board/src/app/page.tsx` :: Home; modify
  - `board/src/app/posts/new/page.tsx` :: NewPostPage; new
  - `board/src/app/posts/[id]/page.tsx` :: PostPage; new
  - `board/src/app/posts/[id]/edit/page.tsx` :: EditPostPage; new
  - `board/src/app/posts/[id]/delete/page.tsx` :: DeletePostPage; new
  - `board/src/app/error.tsx` :: ErrorPage; new
  - `board/src/app/not-found.tsx` :: NotFound; new
  - `board/src/components/{board-list,post-detail,post-form,delete-post-form}.tsx` :: 아래 컴포넌트; new
  - `board/src/lib/client/api.ts` :: API 통신; new
  - `board/src/lib/posts/types.ts` :: 공유 DTO; read-only
#### Details
- **Signatures & Types**:
```typescript
// page wrappers
Home(): React.JSX.Element;
NewPostPage(): React.JSX.Element;
PostPage(props: { params: Promise<{ id:string }> }): Promise<React.JSX.Element>;
EditPostPage(props: { params: Promise<{ id:string }> }): Promise<React.JSX.Element>;
DeletePostPage(props: { params: Promise<{ id:string }> }): Promise<React.JSX.Element>;
// client components
BoardList(): React.JSX.Element;
PostDetail(props: { id: number }): React.JSX.Element;
PostForm(props: { mode:'create'|'edit'; id?:number }): React.JSX.Element;
DeletePostForm(props: { id:number }): React.JSX.Element;
ErrorPage(props: { error: Error & { digest?:string }; reset:()=>void }): React.JSX.Element;
NotFound(): React.JSX.Element;
// client/api.ts
class ApiError extends Error { status:number; code:ErrorCode; fieldErrors?:Record<string,string>; }
listPosts(params: { q:string; page:number }, signal?:AbortSignal): Promise<PostPage>;
getPost(id:number, signal?:AbortSignal): Promise<Post>;
createPost(input:PostInput): Promise<Post>;
updatePost(id:number,input:PostInput): Promise<Post>;
deletePost(id:number,password:string): Promise<void>;
```
- **Data & Schema Fields**: 위 공통 DTO 그대로. 추가 DB 필드는 없다. 목록 URL은 /?q={encoded}&page={n}. 기본 q/page는 생략 가능. 비밀번호는 폼 메모리에만 보관하고 URL/localStorage/sessionStorage/로그에 저장하지 않는다.
- **Execution Flow / Logic**:
  1. 페이지 wrappers는 데이터 저장 모듈을 import하지 않는다. 동적 params를 await하고 양의 안전 정수 id가 아니면 notFound(). 클라이언트 컴포넌트에서 API로 조회한다.
  2. Home은 Suspense로 BoardList를 감싸 useSearchParams의 production build 조건을 충족한다. 목록 데이터는 no-store fetch, URL의 q/page로 로드한다. 잘못된 검색 URL은 API 오류와 초기화 링크를 보여준다.
  3. 검색 폼은 GET 방식 /로 이동하고 page=1로 초기화한다. 페이지 링크는 q를 유지한다. 서버가 초과 page를 보정한 경우 router.replace로 canonical q/page에 맞춘다. 응답 경합은 AbortController로 정리한다.
  4. 목록은 로딩, 실패/재시도, 글 없음, 검색 결과 없음 상태를 각각 표시. 제목 링크, 닉네임, 작성일, 글쓰기 버튼, 전체 건수와 이전/다음 이동을 제공한다.
  5. 상세는 title/content/nickname/createdAt을 보여주고 목록·수정·삭제 링크를 제공한다. 작성일은 Intl.DateTimeFormat ko-KR, Asia/Seoul, YYYY-MM-DD HH:mm으로 고정한다. 본문은 React text child + white-space:pre-wrap/overflow-wrap:anywhere. dangerouslySetInnerHTML은 금지한다.
  6. 작성 폼은 제목/닉네임/input type=password/본문 textarea, 필수 label과 글자 제한을 제공한다. 서버와 동일한 클라이언트 검증을 보조적으로 수행하고 서버가 최종 검증한다. 비밀번호 분실 시 복구 불가 안내. 성공 시 /posts/{id}로 이동.
  7. 수정 폼은 GET으로 기존 공개 필드를 채우고 빈 비밀번호를 요구한다. 제목·본문·닉네임을 수정할 수 있으며 작성일과 비밀번호는 변경하지 않는다. GET 실패 중에는 제출 금지, 성공 시 상세로 이동한다.
  8. 삭제 전용 화면에 글 제목, 복구 불가 안내, 비밀번호와 명시적인 '삭제에 동의합니다' 체크박스를 제공한다. 체크 전 제출 비활성. 성공 시 /로 이동한다. 취소는 상세로 돌아간다.
  9. 요청 중 중복 제출을 막고 fieldErrors/403/404/500을 한국어로 안내한다. 실패 시 입력은 유지하되 비밀번호는 비운다. 삭제된 글의 상세·수정·삭제 화면은 404 안내와 목록 링크를 제공한다.
  10. client API는 Content-Type/JSON 직렬화, encodeURIComponent 검색어, no-store GET, 204 빈 body 처리를 담당한다. 비JSON 응답이나 네트워크 실패는 안전한 메시지로 표시한다.

### I02. 반응형 디자인과 접근성
- Related Files:
  - `board/src/app/globals.css` :: 화면 스타일; modify
  - `board/src/app/layout.tsx` :: 제목/기본 레이아웃; modify
#### Details
밝은 중성 배경, 흰 본문 영역, 선명한 주색 버튼, 최대 너비 960px, 시스템 글꼴을 사용한다. 폭 768px 이상은 표 구조의 목록, 미만은 동일 데이터의 세로 목록을 렌더링한다. 두 표현을 모두 DOM에 둘 경우 CSS로 비활성 표현을 display:none 하여 접근성 트리에 중복 노출되지 않게 한다. 모바일에 가로 스크롤이 생기지 않도록 min-width/긴 단어를 처리한다. label 연결, focus-visible, 키보드 조작, aria-live 오류/상태, loading aria-busy, 버튼 type을 명시한다. 디자인 때문에 필수 동작을 숨기지 않는다.

### I03. 사용자 흐름 검증과 실행 안내
- Related Files:
  - `board/tests/board.spec.ts` :: 브라우저 테스트; new
  - `board/playwright.config.ts` :: Chromium 프로젝트 필요시; modify
  - `board/README.md` :: 최종 사용법; modify
#### Details
기존 테스트 전용 webServer와 DATABASE_PATH 설정을 재사용한다. Chromium만 사용하며 browser 설치는 실행 단계에 npx playwright install chromium으로 수행한다.
- 브라우저 테스트는 1280x800, 390x844에서 고유한 글의 작성→상세→수정 실패→수정 성공→삭제 취소/동의 없음→삭제 성공을 검증한다.
- API fixture로 고유 검색어 포함 21개 글을 준비하고 UI 검색→다음 페이지→q 유지→검색 결과 없음 상태를 검증한다. 실제 사용자 DB와 외부 서버 사용 금지.
- <script> 같은 본문이 텍스트로 보이고 실행되지 않는지, API/페이지에 password_hash가 없는지, 빈 입력/404/네트워크 실패 안내를 검증한다. 모바일에서 scrollWidth<=clientWidth와 글쓰기/검색/수정/삭제 버튼의 가시성을 확인한다.
- README에 Node 요구사항, npm ci/dev/build/start, URL, 기능 범위, 비밀번호 복구 불가, SQLite 경로와 DATABASE_PATH, 테스트 명령과 격리 방식, 서버 종료 후 DB 백업 방법을 명시한다. DB 삭제를 일상 실행 방법에 넣지 않는다.
- 개발 서버를 종료하고 동일 DB의 앱을 재시작하여 작성 글이 유지되는지 확인한다. 사용자 기본 DB 대신 테스트 임시 DB를 지정해 확인한다.
- 완료 시 plan/phase를 completed, current.md Active Task를 없음으로 하고 전체 완료 상태를 기록한다.

## Acceptance Criteria
- [x] PC와 모바일에서 모든 확정 기능이 동작하고 긴 본문에도 가로 스크롤이 없다.
- [x] 검색·페이지 URL·비밀번호 오류·404·빈 목록·삭제 확인 흐름을 제공한다.
- [x] 평문 비밀번호와 hash가 저장소/URL/조회 UI로 유출되지 않는다.
- [x] 최종 검증이 통과하고 실행 안내와 메모리 완료 상태가 일치한다.

## Validation
- `npx playwright install chromium` — 최초 브라우저 준비. 다운로드 제한 시 승인 절차로 재시도.
- `npm run test:service` — 데이터/권한 회귀 없음.
- `npm run test:api` — HTTP 계약 회귀 없음.
- `npm run test:e2e` — PC/모바일 전체 흐름 성공.
- `npm run typecheck` 및 `npm run lint` — 성공.
- `npm run build` — production build 성공.
- 테스트용 DATABASE_PATH로 재시작 영속성 수동 확인 — 기존 글 유지.

## Commit Message
```text
feat(board): complete responsive anonymous board workflows

Plan: 2026-11-13-free-board
Phase: P01-free-board
Task: T04-board-ui

- PC와 모바일에서 검색·글 작성·조회·비밀번호 수정·삭제를 완료할 수 있는 로컬 게시판을 제공한다.
```

## Progress
- [x] 구현 완료
- [x] 검증 통과
- commit: 지정 메시지의 구현 커밋 후 해시 기록

## Execution Result
- 서비스 7개, API 7개, Chromium E2E 7개(PC 1280px / 모바일 390px 및 공통 오류 화면) 총 21개 테스트 통과.
- npm run typecheck / npm run lint / npm run build 모두 종료 코드 0.
- 일반 텍스트 스크립트 미실행, 긴 본문 줄바꿈, 비밀번호 오류 후 입력 유지와 비밀번호 초기화, 삭제 동의·취소, 페이지 검색어 유지·초과 페이지 보정, 404와 네트워크·비JSON 오류 안내를 확인했다.
- 비밀번호/hash가 조회 응답·HTML·URL·localStorage/sessionStorage로 노출되지 않음을 확인했다. 사용자 기본 DB는 만들지 않았다.
- 별도 test-results/restart-* DB로 개발 서버를 실제 종료·재시작한 뒤 동일 글 유지 확인. 같은 DB를 프로덕션 서버에서도 조회하고 PC/모바일 화면을 확인했다. 검증 서버의 3100/3101 포트는 모두 종료했다.
- 수동 재시작 검증 보조 스크립트와 스크린샷은 Git에서 제외된 test-results 안에만 보관한다. 실행: node test-results/verify-restart.mjs (해당 검증 세션의 임시 보조 도구).
- 추가 공통 모듈: components/feedback.tsx와 use-post.ts는 로딩·실패·요청 취소 처리를 재사용한다. lib/client/validation.ts는 폼 보조 검증, lib/posts/format.ts는 한국 시간 표시, route-id.ts는 페이지 ID 검증을 담당한다.
- 필수 표시 기호와 Next의 내부 알림 영역을 구분하도록 브라우저 테스트 선택자를 보강했다. 기능 범위를 늘리는 인접 결함은 발견되지 않았다. 기존 lint 개발 의존성 경고는 README에 유지했다.

## Next Task
없음. Plan과 Phase를 completed로 갱신한다.
