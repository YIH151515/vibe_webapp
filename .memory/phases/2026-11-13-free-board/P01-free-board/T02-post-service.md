# Task: T02 게시글 저장 서비스

## Status: done

## Goal
SQLite 영구 저장, 입력 검증과 비밀번호 기반 수정·삭제를 화면 없이 검증할 수 있게 만든다.

## Decision Summary
- Node 내장 SQLite와 crypto를 사용한다. 실제 데이터와 테스트 DB를 분리한다.
- 제목/본문/닉네임은 정규화하고 비밀번호는 원문 그대로 해시한다.

## Execution Context
- 작업 루트: D:/vibeweb. 앱 루트: D:/vibeweb/board. 검증 명령은 별도 언급이 없으면 앱 루트에서 실행한다.
- Node 24.x, Next 16.x App Router, React 19.x, TypeScript strict, npm. 기존 .agents, examples, skill-project-main 및 zip은 변경하지 않는다.
- 비회원 로컬 게시판이며 댓글·이미지·회원·관리자·배포는 제외한다.
- 완료 시 이 Task Status를 done으로 변경하고 phase.md 진행률 및 current.md를 다음 작업으로 갱신한다. 커밋은 이번 Task와 관련 메모리 파일만 명시적으로 stage한다. git add . 금지.

## Implementation

### Shared Data Contract
모든 아래 필드는 명시적으로 nullable이라고 쓰인 경우 외에는 필수이며 null을 허용하지 않는다.
```typescript
type PostInput = { title: string; content: string; nickname: string; password: string };
type PostSummary = { id: number; title: string; nickname: string; createdAt: string };
type Post = PostSummary & { content: string };
type PostPage = { items: PostSummary[]; total: number; page: number; pageSize: 20; totalPages: number; q: string };
type ErrorCode = 'VALIDATION_ERROR' | 'INVALID_PASSWORD' | 'NOT_FOUND' | 'FORBIDDEN' | 'UNSUPPORTED_MEDIA_TYPE' | 'INTERNAL_ERROR';
type ErrorBody = { error: { code: ErrorCode; message: string; fieldErrors?: Record<string, string> } };
```
- id: SQLite의 양의 안전 정수. createdAt: UTC ISO 문자열. 화면 표시는 Asia/Seoul 기준 YYYY-MM-DD HH:mm.
- 제목/본문/닉네임: trim 후 JS UTF-16 length 기준 각각 1~100/1~10000/2~20자. CRLF 본문은 LF로 정규화한 뒤 길이를 검사한다.
- 비밀번호: trim/정규화 없이 원문 그대로 8~64자. 공백만인 비밀번호는 거부한다. 수정 시 기존 비밀번호만 사용하고 변경하지 않는다.
- q: 기본 빈 문자열, trim하여 100자 이하. 페이지: 기본 1, 정규식 ^[1-9][0-9]*$에 맞는 안전한 정수만 허용한다. id도 동일하게 검사한다.
- 검색: 제목 OR 본문의 리터럴 부분 문자열. SQL LIKE에서 %, _, 역슬래시를 escape한다. SQLite 기본 LIKE의 ASCII 대소문자 무시 정책을 따른다.
- 정렬: created_at DESC, id DESC. 페이지 크기 20 고정. totalPages는 최소 1, 초과 페이지는 마지막 페이지로 보정한다. 빈 목록은 page=1,total=0,totalPages=1.


### I01. 스키마와 저장소
- Related Files:
  - `board/src/lib/posts/types.ts` :: 공유 DTO; new
  - `board/src/lib/server/database.ts` :: openDatabase/getDatabase; new
  - `board/src/lib/server/posts.ts` :: createPostService; new
  - `board/src/lib/server/errors.ts` :: BoardError; new
#### Details
- **Signatures & Types**:
```typescript
openDatabase(path: string): DatabaseSync;
getDatabase(): DatabaseSync;
class BoardError extends Error {
  code: ErrorCode;
  status: number;
  fieldErrors?: Record<string, string>;
  constructor(code: ErrorCode, status: number, message: string, fieldErrors?: Record<string,string>);
}
interface PostService {
  list(input: { q: string; page: number }): PostPage;
  get(id: number): Post;
  create(input: PostInput): Promise<Post>;
  update(id: number, input: PostInput): Promise<Post>;
  remove(id: number, input: { password: string }): Promise<void>;
}
createPostService(db: DatabaseSync): PostService;
```
- **Data & Schema Fields**: posts: id INTEGER PRIMARY KEY AUTOINCREMENT; title TEXT NOT NULL; content TEXT NOT NULL; nickname TEXT NOT NULL; password_hash TEXT NOT NULL; created_at TEXT NOT NULL. 모든 열은 NULL 불가, 외래키 없음. id는 DB 생성, created_at은 new Date().toISOString(). 인덱스 posts_created_at_id(created_at DESC,id DESC). 초기 PRAGMA user_version=1.
- **Execution Flow / Logic**:
  1. getDatabase는 지연 초기화하고 globalThis에 연결을 보관하여 개발 중 중복 연결을 방지한다. import 시 열지 않는다. DATABASE_PATH는 절대/상대 경로를 지원하며 상대 경로는 board cwd 기준이다. 부모 폴더를 생성한다. :memory:는 파일로 취급하지 않는다.
  2. 연결마다 WAL, busy_timeout=5000을 설정한다. user_version=0이면 테이블/인덱스 생성과 version 설정을 트랜잭션으로 처리한다. version>1은 데이터를 보존하며 시작 오류 처리한다. :memory:의 journal_mode 차이는 허용한다.
  3. SQL 매개변수를 바인딩하고 공개 DTO 열을 명시 선택한다. SELECT * 결과나 password_hash를 공개 DTO에 spread하지 않는다.
  4. list는 같은 읽기 트랜잭션에서 count와 보정된 page의 SELECT를 실행한다. LIKE 메타문자를 escape하고 count/목록에 동일 조건을 사용한다. summary에는 본문을 포함하지 않는다.
  5. get은 대상이 없으면 NOT_FOUND/404. create는 검증과 hash 생성 후 저장하여 공개 Post를 반환한다.
  6. update/remove는 id와 입력 검증→대상과 hash 조회→비동기 비밀번호 확인→id와 확인한 hash를 WHERE에 포함하여 수정/삭제한다. 실패 시 403 INVALID_PASSWORD와 무변경. 확인 중 삭제된 글은 404. created_at과 hash는 수정하지 않는다.
  7. DB 오류는 상위에 전파하고 HTTP 계층이 500으로 변환한다. SQL이나 hash를 사용자 오류에 포함하지 않는다.

### I02. 입력 검증과 비밀번호
- Related Files:
  - `board/src/lib/server/validation.ts` :: parsePostInput/parsePasswordInput/parseListQuery/parsePostId; new
  - `board/src/lib/server/password.ts` :: hashPassword/verifyPassword; new
#### Details
- **Signatures & Types**:
```typescript
parsePostInput(value: unknown): PostInput;
parsePasswordInput(value: unknown): { password: string };
parseListQuery(params: URLSearchParams): { q: string; page: number };
parsePostId(raw: string): number;
hashPassword(password: string): Promise<string>;
verifyPassword(password: string, encoded: string): Promise<boolean>;
```
입력 JSON 객체의 필수 필드가 문자열인지 검사한다. 배열/null/타입 변환/누락은 VALIDATION_ERROR/400. 알 수 없는 키는 무시한다. 필드별 한국어 오류는 fieldErrors에 넣는다. query의 q/page 중복은 400, 다른 키는 무시한다.
scrypt는 N=16384,r=8,p=1,keylen=64,maxmem=64MiB, salt=randomBytes(16). 저장 형식 scrypt$16384$8$1$saltHex$keyHex. verify는 형식과 고정 매개변수/길이를 엄격히 검사하고 잘못된 형식은 false로 처리한다. 복원한 같은 길이 Buffer를 timingSafeEqual로 비교한다. 로그에도 평문을 남기지 않는다.
서버 모듈은 UI에서 import하지 않는다. SQLite 의존 코드를 공유 types에 섞지 않는다. 테스트 실행을 위해 Next 전용 런타임 의존성을 피한다.

### I03. 서비스 통합 테스트
- Related Files: `board/tests/service.test.ts` :: node:test 시나리오; new
#### Details
Node test + assert, os.tmpdir 내 임시 디렉터리 DB를 사용하고 finally에서 close/cleanup한다. 검증: CRUD, 재open 영속성, 비밀번호 실패 시 무변경, 수정 후 작성일/hash 유지, 평문과 다른 hash와 동일 비밀번호의 서로 다른 salt, DTO에 비밀 열 없음, 입력 경계와 타입/공백/CRLF, 빈 목록, 21개 이상 페이지/초과 페이지, 동일 시각 id 내림차순, 제목/본문 검색과 %/_/역슬래시 리터럴 검색, SQL 주입 형태 문자열, 없는 id. 실제 데이터와 Next 서버는 사용하지 않는다.

## Acceptance Criteria
- [x] 데이터 계약대로 CRUD/검색/페이지 나누기가 동작한다.
- [x] 재open으로 영속성을 확인하고 공개 DTO에 비밀값이 없다.
- [x] 비밀번호 실패 시 수정·삭제되지 않고 테스트 DB만 변경된다.

## Validation
- `npm run test:service` — 서비스 검증 성공.
- `npm run typecheck` — 타입 오류 없음.
- `npm run lint` — lint 오류 없음.
- `npm run build` — 사용자 DB를 생성하지 않고 성공.

## Commit Message
```text
feat(board): add persistent post service and password verification

Plan: 2026-11-13-free-board
Phase: P01-free-board
Task: T02-post-service

- SQLite 영구 저장, 입력 검증과 비밀번호 기반 수정·삭제를 화면 없이 검증할 수 있게 만든다.
```

## Progress
- [x] 구현 완료
- [x] 검증 통과
- commit: 5cc246a

## Execution Result
- 서비스 테스트 7개 통과: CRUD/영속성, 해시와 비밀값 제외, 입력 경계, query/id, 검색/페이지, 비밀번호 확인 중 삭제, 스키마 버전.
- npm run typecheck / npm run lint / npm run build 모두 종료 코드 0.
- 테스트는 os.tmpdir의 개별 임시 DB를 닫고 정리했으며 board/data 디렉터리 미생성을 확인했다.
- 비밀번호와 숫자 ID 끝의 줄바꿈 거부를 회귀 테스트로 고정했다.
- node:sqlite의 알려진 ExperimentalWarning 외 신규 경고나 범위 밖 결함 없음.

## Next Task
T03-post-api.md
