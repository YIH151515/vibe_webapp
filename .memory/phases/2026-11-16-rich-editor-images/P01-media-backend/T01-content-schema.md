# Task: T01 문서 스키마와 기존 본문 호환

## Status: done

## Goal
기존 plain 글을 보존하면서 서식 JSON과 검색 텍스트를 안전하게 왕복하고 schema4를 테스트 DB에 적용한다.

## Decision Summary
- 기존 계약과 테스트 격리를 유지하며 이 Task의 backend foundation만 구현한다.
- 운영 배포는 마지막 Phase까지 수행하지 않는다.

## 실행 맥락과 고정 경계
- Plan: 2026-11-16-rich-editor-images. cwd는 D:/vibeweb/board, 저장소 D:/vibeweb. Node24.13.1 이상<25, Next16.4.6/React19.3.1/TS strict/npm. board/AGENTS.md와 설치된 관련 Next docs를 읽고 구현한다.
- 기존 공개 URL https://app-vibe-board-prod-7b1417.azurewebsites.net, DEX구독7b1417d8-833d-4ba9-a5cd-d27c91a28b83, rg-vibe-board-prod, app-vibe-board-prod-7b1417, SQL sql-vibe-board-7b1417/dbboardprod. 로컬도 운영 DB를 공유한다.
- feature/rich-editor-images 브랜치에서만 구현/커밋한다. 최초 Task에서 현재 main/사용자 변경을 확인해 브랜치를 만든다. 현재 사용자 변경 board/next-env.d.ts와 루트 도구/zip/SQLite를 보존하고 stage하지 않는다. git add . / force push 금지. 지정 파일과 해당 Task만 stage한다.
- P02-T03 전 main push/merge/운영 SQL migration 금지. P02-T02만 새 Blob 자원·최소 역할·설정을 실제 적용한다. 이 Task가 그 둘이 아니면 운영 Azure 자원/DB/Blob을 변경하지 않는다.
- 기존 글 제목1~100/닉네임2~20/비밀번호trim없이8~64 UTF-16, 본문최대10,000, 작성일UTC불변, 검색ASCII만casefold/리터럴LIKE/20개페이지, 기존 관리자 세션과 작성5/10분·비밀번호실패10/10분·관리자실패5/15분 유지.
- 기본 JSON64KiB는 유지. 모든 직접 API 응답 no-store(공개 이미지 캐시만 별도). BoardError/RateLimitError와 ErrorBody를 재사용한다. 추가 코드는 MEDIA_CONFLICT(409), STORAGE_FULL(409)이며 나머지는 기존400/401/403/404/413/415/429/503. rawSQL/Blob에러/비밀번호/토큰/쿠키/원문IP를 로그하지 않는다.
- SQL은 암호화/TLS인증서검증, 앱 limited DML, migration은 로컬 운영자 CLI 전용. 테스트는 NODE_ENV=test/APP_TEST_MODE=1, loopback SQL+board_test_[a-f0-9]{32}와 전용 loopback Azurite만 사용한다. .env.local/운영 endpoint를 테스트에서 읽지 않는다.
- feature flag EDITOR_FEATURE_ENABLED=0 기본값. 0이면 rich 쓰기/세션/업로드503, plain 새글·기존plain수정과 모든 인증된 삭제/게시 이미지 조회는 계속된다. 기존rich글에 legacy plain 수정은 flag와 무관하게409(평문 덮어쓰기로 이미지/서식 유실 금지). 테스트 wrapper는1을 주입한다. 최종 릴리스의 이 flag0 아티팩트가 schema4 호환 rollback 기준이다.
- 과거 schema3 코드는 rich JSON/이미지 연결을 모른다. schema4 적용 후 예전3 ZIP으로 롤백하지 않는다. 글/이미지 데이터 초기화·역migration·SQL/TRUNCATE 금지.
- Validation 명령은 별도 표시 없으면 board cwd. Docker Linux 엔진이 필요하다. 테스트 전용 서버3100/.next-test, 사용자3000 서버는 종료하지 않는다. 타입검사/린트/각 Task의 관련검증 통과 후 Task done/지정 커밋/phase/current 순서로 갱신한다.

### 문서/DTO 고정 계약
- RichDocument={version:1;type:"doc";content:RichBlock[]}. 문서 노드 구조는 Tiptap doc에 최상위 version만 추가한 형태. 서버 canonical JSON에는 src/draftId/previewUrl이 없다.
- Block: paragraph({content?:Inline[]}), heading({attrs:{level:2|3},content?:Inline[]}), bulletList/orderedList({content:listItem[]}, orderedList.attrs.start는1~10000 기본1), blockquote({content:(paragraph|heading|bulletList|orderedList)[]}), image({attrs:{assetId:lowercase UUIDv4;alt:string<=200}}). listItem.content는 paragraph부터 시작하고 뒤에 paragraph/목록만 허용한다.
- Inline: text({text:nonempty string,marks?:Mark[]}) 또는 hardBreak. Mark는 bold/italic/underline/strike 또는 link({attrs:{href:string}}). 같은 mark 중복 거부. link는 trim없는 절대 http/https/mailto, credentials/control chars와2048자초과 거부. renderer는 rel=noopener noreferrer/target=_blank. 임의 HTML/style/event/class/외부 이미지/알 수 없는 노드·속성을400으로 거부한다.
- canonical JSON UTF8<=49152 bytes, 루트포함 노드<=1000, 루트깊이0/최대깊이8, 추출 텍스트 UTF16<=10000, 이미지노드<=5/asset중복금지. 이미지는 텍스트에 포함하지 않고 블록/목록문단/줄바꿈을 LF로 연결한 뒤 문서 바깥 공백만 trim한다. 텍스트trim이 비어도 이미지>=1이면 유효. 영폭문자만으로 빈글 제한을 우회하지 않게 U+200B/U+FEFF는 빈값 판단에서 제외하되 정상본문은 보존한다.
- PostInput={title:string;nickname:string;password:string;content?:string;document?:RichDocument;uploadSessionToken?:string}. document가 있으면 서버 추출 content가 권위값, 없으면 기존 content:string필수/1~10000 plain. 토큰은 strict64lowerhex, body/Authorization에만 사용하고 URL/storage/log 금지.
- Post=PostSummary & {content:string;contentFormat:"plain"|"rich_v1";document:RichDocument|null}. PostSummary={id:number;title:string;nickname:string;createdAt:string}, PostPage={items:PostSummary[];total:number;page:number;pageSize:20;totalPages:number;q:string}는 기존 그대로.
- detail/create/update 응답에 새 키를 추가하므로 기존 tests/service.test.ts, api.spec.ts, board.spec.ts, scripts/verify-live.ts의 Object.keys 기대값도 contentFormat/document를 포함하도록 수정한다.
### SQL version4 전체 계약 (별도 표시가 없으면 NOT NULL)
- board/sql/004-editor-images.sql 1개 migration. 기존001~003은 수정하지 않는다. 기본 시간UTC SYSUTCDATETIME(), 타입 DATETIME2(3).
- posts: content_format VARCHAR(8) DEFAULT 'plain', content_json NVARCHAR(MAX) NULL 추가. CHECK plain이면 content_json NULL/content길이1~10000, rich_v1이면 ISJSON(content_json)=1/content길이0~10000. 기존 content/password_hash/id/created_at 값 보존.
- upload_sessions: id UNIQUEIDENTIFIER PK, token_hash CHAR(64) UNIQUE, client_key CHAR(64), target_post_id BIGINT NULL(FK없음: 삭제 후 취소 세션 유지), author_hash VARCHAR(256) NULL(create시NULL/edit시기존해시), state VARCHAR(10) DEFAULT 'active' CHECK active|consumed|cancelled|expired, file_count INT DEFAULT0 CHECK0..5, input_bytes BIGINT DEFAULT0 CHECK0..20971520, created_at DEFAULTUTC, expires_at. target_post_id와author_hash는 둘다NULL 또는 둘다NOTNULL. expires_at 인덱스.
- image_assets: id UNIQUEIDENTIFIER PK, session_id UNIQUEIDENTIFIER FK upload_sessions(id) NO ACTION, post_id BIGINT NULL FK posts(id) NO ACTION, idempotency_key UNIQUEIDENTIFIER, state VARCHAR(12) CHECK uploading|ready|attached|deleting|soft_deleted|purged, blob_name NVARCHAR(120) UNIQUE, input_sha256 CHAR(64) NULL, input_bytes INT DEFAULT0 CHECK0..5242880, stored_bytes INT DEFAULT0 CHECK0..5242880, charge_bytes BIGINT DEFAULT5242880 CHECK>=0, width INT DEFAULT0/height INT DEFAULT0, blob_write_started BIT DEFAULT0, created_at DEFAULTUTC, lease_until, attached_at NULL, deleted_at NULL, purge_after NULL(시간타입DATETIME2(3)). UNIQUE(session_id,idempotency_key). attached일때만post_id NOTNULL, 다른상태post_id NULL. 인덱스(post_id,state),(state,created_at).
- media_capacity: id TINYINT PK CHECK id=1, occupied_bytes BIGINT DEFAULT0 CHECK0..1073741824. migration에서id1 생성. 예약/실체/삭제보존 용량을 합산하고 SUM(image_assets.charge_bytes)와 일치시킨다.
- media_buckets: kind VARCHAR(8) CHECK session|file, client_key CHAR(64), generation UNIQUEIDENTIFIER, attempts_used INT DEFAULT0/attempts_pending INT DEFAULT0, bytes_used BIGINT DEFAULT0/bytes_pending BIGINT DEFAULT0(모두>=0), started_at/expires_at DATETIME2(3), PK(kind,client_key), expires_at index. 기존rate_buckets는 변경하지 않는다.
- media_reservations: id UNIQUEIDENTIFIER PK, kind VARCHAR(8), client_key CHAR(64), generation UNIQUEIDENTIFIER, bytes_reserved BIGINT DEFAULT0, expires_at, state VARCHAR(8) CHECK pending|finished, received_bytes BIGINT DEFAULT0. (kind,client_key) FK media_buckets NO ACTION. TTL120초 미완료 예약 회수와 세대guard/idempotent finish에 사용한다.
- image_delete_jobs: asset_id UNIQUEIDENTIFIER PK/FK image_assets NO ACTION, available_at DEFAULTUTC, attempts INT DEFAULT0, lease_owner UNIQUEIDENTIFIER NULL, lease_until NULL, last_error_code VARCHAR(40) NULL(정해진 상수만), created_at DEFAULTUTC. 시간은DATETIME2(3), 이미지1개에outbox1개, 완료후job만삭제.
- media_maintenance: name VARCHAR(40) PK, owner UNIQUEIDENTIFIER NULL, lease_until DATETIME2(3) NULL. migration에서name='image-cleanup' 생성.
- UUID는randomUUID, 토큰randomBytes(32).hex, token_hash=SHA256(token). blob_name='images/'+assetId의하이픈제거+'.webp'. 고정생성외Blob경로입력거부. 앱은 새 테이블 DML만, schema_migrations SELECT만. server/schema-version.ts의 EXPECTED_SCHEMA_VERSION=4를health/검증툴에서공유한다.

## Implementation

### I01. schema4와 일반 텍스트/JSON 공존
- 첫 source commit에는 확정 decisions/2026-11-16-rich-editor-images.md, plans/2026-11-16-rich-editor-images.md와 이 Task 청사진을 함께 추적할 수 있다. 상위 phase/current는 검증 후 메모리 동기화 commit에서 갱신한다. 다른 미래 Task/루트 미추적 도구를 일괄 stage하지 않는다.
- Related Files:
  - board/sql/004-editor-images.sql :: migration4 — 위 SQL 전체 계약 생성; new
  - board/src/lib/posts/types.ts :: PostInput/Post/ErrorCode — 공존 DTO/409코드; modify
  - board/src/lib/posts/document.ts :: RichDocument/normalizeDocument/plainToDocument — 브라우저/서버 공통 순수 검사; new
  - board/src/lib/server/validation.ts :: parsePostInput — 서버 추출 텍스트; modify
  - board/src/lib/client/validation.ts :: validatePost — optional content/rich 지원; modify
  - board/src/lib/server/posts.ts :: createPostService — format/document SQL 왕복; modify
  - board/src/lib/server/editor-config.ts :: editorEnabled — 환경 flag; new
#### Details
- **Signatures & Types**:
```typescript
type NormalizedDocument = {document:RichDocument;json:string;text:string;imageIds:string[]};
class DocumentValidationError extends Error {}
normalizeDocument(value:unknown):NormalizedDocument;
plainToDocument(text:string):RichDocument;
type NormalizedPostInput = {title:string;nickname:string;password:string;content:string;contentFormat:"plain"|"rich_v1";document:RichDocument|null;uploadSessionToken?:string};
parsePostInput(value:unknown):NormalizedPostInput;
editorEnabled(env?:NodeJS.ProcessEnv):boolean;
```
- **Data & Schema Fields**: 위 SQL/DTO 계약 전체를 이 Task에서 만든다. MIME/저장소 없이 미디어 테이블은 빈 상태로만 존재한다. document.ts는 Node 전용 라이브러리 없이 동작하고 TextEncoder로 UTF8을 계산한다. 문서 경계 밖 공백만 trim, 텍스트 변경을 발생시키는 HTML 해석은 하지 않는다. plainToDocument는 CRLF→LF/빈 줄/여러 LF를 paragraph+hardBreak로 보존한다.
- **Execution Flow / Logic**:
  1. 현재 main을 확인하고 사용자 next-env 변경을 유지한 채 feature/rich-editor-images 생성. 브랜치가 이미 있으면 해당 목적/이력을 검토하고 계속하며 원격main을 덮어쓰지 않는다.
  2. parsePostInput은 document가 null/undefined면 plain, 유효객체면rich. raw contentFormat 값을 신뢰하지 않는다. title/nickname/password는 기존 정규화 유지. 잘못된 문서 오류는 BoardError VALIDATION_ERROR400/fieldErrors.content로 매핑한다.
  3. service SQL의 SELECT/OUTPUT에 content_format/content_json을 추가하고 mssql.NVarChar(MAX)로 JSON매개변수 전달. Post DTO는 plain이면document:null, rich면검증된문서. 깨진 저장 JSON은 HTML로 fallback하지 않고503 고정 메시지로 응답한다.
  4. rich 쓰기는EDITOR_FEATURE_ENABLED=1일 때만. 이 Task에서는 이미지가 있는 문서의 create/update를503으로 거부한다(아직asset 연결 서비스 미완성). 이미지 없는 rich는 왕복한다. legacy plain 업데이트 대상이rich면409 MEDIA_CONFLICT로 막는다. 실패 시 이전글/날짜/비밀번호를 변경하지 않는다.
  5. 검색은 기존 content 추출문자열에 그대로 실행한다. 목록 DTO/페이지 정렬은 유지. 기존 DTO 키 변화 외 서식이 없는 plain UI는 그대로 작동한다. JSON48KiB 상한과기존요청64KiB를 구분한다.

### I02. health·grants·기존 회귀 함께 갱신
- Related Files:
  - board/src/lib/server/schema-version.ts :: EXPECTED_SCHEMA_VERSION=4; new
  - board/src/app/api/health/route.ts :: GET — schema4 검사; modify
  - board/sql/grant-app-user.sql :: 새7개테이블DML — 운영자 CLI용; modify
  - board/scripts/verify-sql-access.ts :: schema4/권한 검사; modify
  - board/scripts/verify-live.ts :: 새 Post DTO 키 기대; modify
  - board/scripts/run-tests.ts :: EDITOR_FEATURE_ENABLED=1 주입/관련env 제거; modify
  - board/tests/document.test.ts :: 순수 문서/악성노드; new
  - board/tests/service.test.ts, api.spec.ts, board.spec.ts :: DTO/schema4 기대와 호환; modify
#### Details
- **Signatures & Types**: EXPECTED_SCHEMA_VERSION:number=4를 export하여 기존 health와 verify-sql-access에서 동일 값 사용. 현재 health는 maxversion===3, service.test는versions1,2,3 하드코딩이다. 새grant대상은upload_sessions/image_assets/media_capacity/media_buckets/media_reservations/image_delete_jobs/media_maintenance이다.
- **Data & Schema Fields**: 기존43개 테스트의 detail 키는 content/contentFormat/createdAt/document/id/nickname/title가 된다. page/list 요약에는 document를 넣지 않는다.
- **Execution Flow / Logic**:
  1. wrapper의기존 SQL/Admin/Rate sanitization에 EDITOR_/MEDIA_/STORAGE_/AZURITE_를 추가하고 test환경 flag1, cleanup0을 명시한다. 아직Azurite 시작은T02이며이Task에는필요없다.
  2. fresh migration4와version3 seeded DB에upgrade 적용을 테스트하고, 기존plain본문/해시/날짜/id의 byte 동일성과 재실행멱등성을 확인한다.
  3. malformed JSON/초과노드·깊이·48KiB/unsafeURL/임의HTML·unknownattr/중복이미지·이미지없고빈본문을 거부한다. 한글·emoji UTF16경계, plain LF왕복, textonlyrich검색/날짜보존을 확인한다.
  4. image-only 구조검사는통과하되 실제write는503인 과도기 경계를 테스트한다. flag0에서plain은성공/rich는503/기존rich plain덮어쓰기409를 검증한다. prod migration/grants는 실행하지 않는다.


## Acceptance Criteria
- [x] schema3→4 업그레이드 후 기존 id/본문/해시/작성일이 동일하고 plain/rich 텍스트 왕복·검색이 성공한다.
- [x] 잘못된 문서·URL·상한 위반은400이며 flag0의 rich쓰기503/기존rich의 plain덮어쓰기409와 이미지쓰기 과도기503을 검증했다.
- [x] health·grants·기존 DTO 키 기대가 schema4와 일치하고 import/build에서 DB에 접속하지 않는다.
- [x] 기존 동작 회귀와 아래 Validation이 모두 통과하고 비밀·사용자 변경이 stage되지 않았다.

## Validation
- npm run test:all — 기존43개 회귀와 document/upgrade/flag 검사 통과.
- `npm run typecheck` — 성공.
- `npm run lint` — 성공.
- `npm run build` — 성공.
- git diff --check — 성공. 운영 db:migrate/provision 실행 금지.

## Commit Message
```text
feat(board): add compatible rich document storage

Plan: 2026-11-16-rich-editor-images
Phase: P01-media-backend
Task: T01-content-schema

- 기존 plain 글을 보존하면서 서식 JSON과 검색 텍스트를 안전하게 왕복하고 schema4를 테스트 DB에 적용한다.
```

## Progress
- [x] 구현 완료: schema4의 새7개테이블/문서 validator/동시 legacy 덮어쓰기 방지/feature flag/DTO·grants·health 반영.
- [x] 검증 통과: test:all 52개(서비스·보안·문서27/API15/E2E10), typecheck/lint/build, git diff --check.
- SQL Server는 같은 배치의 새 열을 제약에서 바로 참조하면207이 발생했다. 고정문자열 EXEC로 해당 제약의 컴파일만 열 추가 이후로 분리했다. migration은 기존 transaction/applock 안에서 원자적으로 적용된다.
- 테스트 준비 실패는 raw SQL/credentials 없이 code/number만 진단하도록 wrapper를 보완했다. 운영 SQL/Blob/Azure/main에는 변경하지 않았다. Docker 기동 후 소유 테스트 컨테이너를 정리했고 사용자 pad/3000서버는 중지하지 않았다.
- build가 만든 next-env 경로 변경은 이전 파일과 두 import 경로만 달라진 것을 확인한 뒤 이번 생성분만 되돌렸다. 기존 사용자 변경은 미커밋 상태로 보존한다.
- 후속 미디어 회계 참고: mssql BIGINT는 문자열로 반환된다. 바이트 한도/occupied_bytes 연산은 T03에서 안전한 정수 변환을 확인해야 한다. 이번 테스트는 Number 변환 후1GiB 이내 값 경계를 검증했다.
- commit: pending

## Next Task
P01-media-backend/T02-blob-runtime.md
