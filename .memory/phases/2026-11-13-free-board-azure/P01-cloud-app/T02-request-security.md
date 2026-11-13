# Task: T02 HTTPS·IP·반복 요청 제한

## Status: done

## Goal
HTTPS와 로컬의 정상 쓰기는 허용하면서 IP 위조와 동시 요청으로 우회할 수 없는 DB 공유 제한을 구현한다.

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
### I01. 명시 Origin·요청 크기·IP 경계
- Related Files:
  - board/src/lib/server/http.ts :: ensureSameOrigin/readJson/toErrorResponse; modify
  - board/src/lib/server/request-context.ts :: readRequestConfig/getClientKey; new
  - board/src/lib/posts/types.ts :: ErrorCode; modify
  - board/src/lib/server/errors.ts :: RateLimitError; modify
  - board/.env.example :: APP_ORIGIN/REQUEST_IP_MODE/LOCAL_CLIENT_IP/RATE_LIMIT_KEY_SECRET; modify
#### Details
- **Signatures & Types**:
```typescript
ensureSameOrigin(request:Request,options?:{requireOrigin?:boolean}):void;
getClientKey(request:Request):string;
class RateLimitError extends BoardError { retryAfterSeconds:number; }
```
- **Data & Schema Fields**: ErrorCode는 기존 코드에 RATE_LIMITED(429), PAYLOAD_TOO_LARGE(413), 후속 관리자용 UNAUTHENTICATED(401)를 추가한다. SERVICE_UNAVAILABLE는503, INTERNAL_ERROR는500. RATE_LIMIT_KEY_SECRET은 임의32bytes를64hex로 저장한다.
- **Execution Flow / Logic**:
  1. APP_ORIGIN을 strict URL로 검증한다. 예상 Origin은 이 값이며 request.url의 내부HTTP/localhost나 임의 Forwarded로 재구성하지 않는다. Host가 있으면 설정된 host와 일치해야 한다. Origin이 있는 요청은 exact match, Origin=null 문자열/비정규주소는403. Origin 없으면 cross-site Fetch Metadata를 거부하고 requireOrigin=true는 무조건403, 일반 API는 curl 호환을 유지한다.
  2. readJson은 application/json(+charset)만 허용하고64KiB 바이트 상한을 Content-Length 및 stream 누적 둘 다 적용한다. 초과413, 잘못된JSON400. 유효한 최대10000자 본문을 JSON escape해서 전송해도 수용되는지 검증한다.
  3. local모드는 필수 LOCAL_CLIENT_IP만 사용하고 client-ip/x-forwarded-for/x-client-ip 등 입력 헤더를 모두 무시한다. 설정 IP를 바꾸지 않고 재시작한 경우 같은 HMAC을 사용한다.
  4. app-service모드는 WEBSITE_INSTANCE_ID 존재와 HTTPS APP_ORIGIN을 요구하고, 플랫폼이 덮어쓰는 client-ip 헤더만 사용한다. IPv4, IPv4:port, 순수IPv6, [IPv6]:port를 검사해 포트를 제거하고 IP를 정규화한다. node:net.isIP와 IPv6 URL canonicalization을 사용하며 IPv4-mapped IPv6는 IPv4로 통일한다. 쉼표 체인/유효하지 않은 IP/누락은503으로 쓰기를 거부하고 다른 헤더로 fallback하지 않는다.
  5. test모드는 APP_TEST_MODE와 SQL loopback/접두DB 검증 후에만 client-ip를 테스트 식별자로 사용한다. 운영에서는 이 분기를 활성화할 수 없다.
  6. IP 원문을 저장하지 않고 HMAC-SHA256(secret,canonicalIP)의64hex를 반환한다. 서명키는 로컬/운영에서 같게 설정한다. 실제 프런트엔드 header overwrite는 배포 Task에서 검증한다.
  7. toErrorResponse는429에 양의 정수 Retry-After 초를 포함하고 다른 응답과 같이 no-store. 서버 오류에서 SQL·비밀값은 노출하지 않는다.

### I02. SQL 제한 예약
- Related Files:
  - board/sql/002-rate-buckets.sql :: schema version2; new
  - board/src/lib/server/rate-limit.ts :: reserve/finish/withRateLimit; new
  - board/src/app/api/posts/route.ts :: POST 제한; modify
  - board/src/app/api/posts/[id]/route.ts :: PATCH/DELETE 실패 제한; modify
#### Details
- **Signatures & Types**:
```typescript
type RateAction = "post-create"|"post-password"|"admin-login";
type RateReservation = {action:RateAction;clientKey:string;generation:string;finished:boolean};
reserve(pool:ConnectionPool,action:RateAction,clientKey:string,now?:Date):Promise<RateReservation>;
finish(pool:ConnectionPool,reservation:RateReservation,count:boolean):Promise<void>;
withRateLimit<T>(pool:ConnectionPool,action:RateAction,key:string,work:()=>Promise<T>):Promise<T>;
```
- **Data & Schema Fields**: dbo.rate_buckets: action VARCHAR(20), client_key CHAR(64) 복합PK; generation UNIQUEIDENTIFIER; used_count INT DEFAULT0 CHECK>=0; pending_count INT DEFAULT0 CHECK>=0; window_started_at DATETIME2(3); expires_at DATETIME2(3). 모두 NOT NULL, 외래키 없음. expires_at 인덱스. 정책: post-create5/600초, post-password10/600초, admin-login5/900초.
- **Execution Flow / Logic**:
  1. reserve는 SERIALIZABLE transaction + PK UPDLOCK,HOLDLOCK으로 행 조회/생성을 원자적으로 한다. 만료면 generation 교체·카운터0·새 윈도우. used+pending>=limit이면429, 아니면 pending+1 후 commit. 현재 시각은 기본SQL SYSUTCDATETIME, 테스트 주입 now는 HTTP에서 받지 않는다.
  2. finish는 같은 generation일 때만 pending-1하고 count=true이면 used+1한다. 같은 예약 객체의 두 번째finish는 무시한다. 윈도우 경계 후 이전 예약이 새 카운터를 감소시키지 않게 한다. 프로세스 중단으로 남은 pending은 해당 윈도우 만료까지 보수적으로 유지한다.
  3. withRateLimit은 create 성공만 작성 횟수로, post-password/admin-login은 INVALID_PASSWORD/UNAUTHENTICATED로 확인된 비밀번호 실패만 사용 횟수로 기록한다. 그 외 오류/성공은 예약 해제한다. 검증400/없는 글404는 예약 전 확인하여 실패 횟수에 넣지 않는다.
  4. POST: Origin→JSON/필드검증→reserve→create→finish. PATCH/DELETE: Origin→id/입력→대상존재확인→reserve→서비스비밀번호확인/변경→finish. GET에는 제한을 추가하지 않는다. admin-login action은 다음 Task에서 사용한다.
  5. 제한 DB 오류 시 허용으로 fallback하지 않고503으로 처리한다. 트랜잭션은 짧게 유지하고 비밀번호 scrypt 중 lock을 보유하지 않는다. 만료 24시간 지난 행은 요청 시 낮은 빈도로 최대1000개씩 정리한다. 정리 실패는 본 요청의 커밋 결과를 바꾸지 않고 비밀 없는 오류 코드만 남긴다.

### I03. 사용자 안내와 검증
- Related Files:
  - board/src/lib/client/api.ts :: ApiError.retryAfterSeconds; modify
  - board/tests/security.test.ts :: 순수 helper와 SQL 제한 동시성; new
  - board/tests/api.spec.ts, board/tests/board.spec.ts :: 제한/API 회귀; modify
  - board/scripts/run-tests.ts :: 임의 test 키/Origin/IP모드 주입; modify
#### Details
ApiError에 선택 retryAfterSeconds:number를 추가하고 Retry-After의 양의 정수만 파싱한다. 기존 폼은 서버 한국어 메시지로 제한·재시도 대기시간을 안내하며 비밀번호를 지운다. 테스트에서21개 seed는 test DB 서비스 직접 호출, 정상 시나리오는 각기 다른 test client-ip를 사용한다. 제한을 끄는 운영 옵션을 만들지 않는다.
테스트는 HTTPS Origin과 내부HTTP 조합 허용, 다른Host/port/null/missing admin Origin 거부, spoof XFF 무시, IP형태 동치/오류,413,5회작성 후6번째429,10회비밀번호실패 후 차단,성공 비밀번호는 카운터 증가 없음, 병렬20개에서도5개만 허용, 서로 다른pool·재접속 공유, 만료 및 이전예약finish 경계를 확인한다.

## Acceptance Criteria
- [x] 기본 정책의 횟수/시간과429/Retry-After가 정확함.
- [x] 동시 요청·재시작·임의 헤더로 제한을 우회하지 못함.
- [x] 로컬/HTTPS에서 정상 동작하고 기존21개 seed/CRUD 회귀가 유지됨.

## Validation
- npm run test:all — 보안 helper·SQL 동시성·HTTP/브라우저 회귀 성공.
- npm run typecheck / npm run lint / npm run build — 성공.
- git diff --check — 성공.

## Commit Message
```text
feat(board): enforce shared request limits and trusted origins

Plan: 2026-11-13-free-board-azure
Phase: P01-cloud-app
Task: T02-request-security

- HTTPS와 로컬의 정상 쓰기는 허용하면서 IP 위조와 동시 요청으로 우회할 수 없는 DB 공유 제한을 구현한다.
```

## Progress
- [x] 구현 완료
- [x] 검증 통과
- commit: 구현 커밋 후 해시 기록

## Execution Result
- 보안·서비스18개/API10개/PC·모바일 브라우저8개 총36개 테스트 통과. typecheck/lint/production build 모두 종료 코드0.
- APP_ORIGIN 기반 HTTPS 프록시 대응, Host/Origin/필수 관리자 Origin 검증,64KiB 선언·스트림 상한, 최대길이 escape JSON 수용을 확인했다.
- local/app-service/test 신뢰 경계, IP 포트 제거·IPv6·IPv4-mapped 정규화, 임의 forwarded 헤더 무시와 누락 IP의503을 검증했다. 운영에서의 실제 플랫폼 header overwrite는 배포 Task에서 확인한다.
- SQL SERIALIZABLE+UPDLOCK/HOLDLOCK 예약으로 병렬20개 중5개만 허용했다. 다른pool/재접속 공유, 만료 새 generation에 대한 이전finish 무효, 이중finish 방지, 실패/성공 분류·예약 해제와DB장애503을 검증했다.
- API에서작성5회 이후429/Retry-After, 수정·삭제의비밀번호 실패공유10회, 검증400/없는글404 제외, GET유지 확인. UI는대기시간표시와비밀번호초기화/다른입력유지를확인했다.
- tests/helpers/client-fixture.ts를추가해 정상테스트별가상IP를격리하고Playwrightprovide콜백이ReactuseHook으로오인되지않게이름을명시했다. 제한우회용운영옵션은추가하지않았다.
- README와.env.example에필수설정·정책·프로세스중단시예약잔존·정리경계를기록했다. 관리자로그인정책은준비됐으며실제관리자API/UI는다음Task범위다.
- 테스트서버3100과SQL컨테이너를정리하고사용자3000서버및기타컨테이너·SQLite파일은보존했다. 운영DB접속이나Azure리소스작업은수행하지않았다.
- 빌드가생성한next-env.d.ts경로는이전사용자의동일복원승인에따라기존.next/dev/types로복원하고커밋에서제외한다.
- 신규범위밖결함없음. 기존개발의존성경고는변경하지않았다.

## Next Task
P01-cloud-app/T03-admin-moderation.md
