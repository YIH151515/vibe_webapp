# Task: T03 세션 기반 이미지 업로드·게시 API

## Status: done

## Goal
소유한 이미지와 글만 연결/삭제하고 공개 읽기·토큰·출발지/건수/바이트/전체 용량 제한을 SQL과 Blob에서 검증한다.

## Decision Summary
- 파일 수명과 데이터 소유권은 SQL 상태로 결정하고 Blob I/O는 트랜잭션 밖에서 처리한다.
- 새 기능으로 기존 공개 비회원 정책/운영 데이터를 손상시키지 않는다.

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
### 미디어 API/Storage 계약
- POST /api/upload-sessions JSON{postId?:number,password?:string}→201{token:string,expiresAt:string}. 신규는둘다없음/수정은둘다필수(비밀번호8~64). 세션발급에Authorization불필요, 모든변경requireOrigin=true.
- DELETE /api/upload-sessions/current Authorization:Bearer <token>→204. 본인active를cancelled로, 미연결asset을deleting/outbox로. 없는/다른IP/만료token401, 동일token의취소재송신204.
- POST /api/images/uploads: Authorization Bearer, Idempotency-Key UUIDv4, multipart file정확히1개. 다른field/다중file400, multipart아닌경우415. →201 ImageAssetDto={id:string;url:string;width:number;height:number;bytes:number;inputBytes:number;mimeType:"image/webp"}. 동일key/동일입력sha256의ready재송신200, 다른입력/처리중409. 원본파일명저장금지.
- GET/HEAD /api/images/[id]: attached+부모post존재일때200. Content-Type image/webp/Content-Length/ETag/X-Content-Type-Options nosniff/Cache-Control public,max-age=0,must-revalidate. If-None-Match일치도SQL확인후304. ready/deleting등·삭제부모404/no-store. Range는초기버전에서무시하고전체200, HEADbody없음. Blob404는404/다른장애503.
- BlobStore interface: put(name:string,bytes:Buffer,signal?:AbortSignal):Promise<{etag:string}>; read(name:string,signal?:AbortSignal):Promise<{stream:ReadableStream<Uint8Array>;bytes:number;etag:string}>; head(name:string):Promise<{bytes:number;etag:string}|null>; remove(name:string):Promise<void>(404도성공). put은If-None-Match:*로덮어쓰기금지, upload concurrency1/operation timeout60초이내/유한retry. SQL tx밖에서호출.
- env: EDITOR_FEATURE_ENABLED=0|1(default0), STORAGE_AUTH_MODE=managed-identity|azure-cli|azurite, STORAGE_BLOB_SERVICE_URL, STORAGE_CONTAINER, MEDIA_CLEANUP_ENABLED=0|1(default0), AZURITE_ACCOUNT/AZURITE_KEY(test전용). 운영URL은https://<소문자계정>.blob.core.windows.net/path·credential·query없음, container='board-images'. app-service는managed-identity만/local은azure-cli만. 자동credentialchain탐색금지.
- test는APP_TEST_MODE/SQLguard와http://127.0.0.1:<생성port>/boardtest/account boardtest/container board-test-<32hex>/랜덤base64 key를확인한다. 다른http/외부host/운영endpoint와test혼합거부. @azure/storage-blob12.34.0/@azure/identity4.14.1/sharp0.35.5/testcontainers12.2.1 exact pin. Blob client serviceVersion=2023-11-03으로기본CRUD호환고정.

## Implementation

### I01. 세션·요청/바이트·용량 예약
- Related Files:
  - board/src/lib/server/media-limits.ts :: reserveMediaRequest/finishMediaRequest; new
  - board/src/lib/server/upload-sessions.ts :: issueUploadSession/readUploadSession/cancelUploadSession; new
  - board/src/lib/server/media-service.ts :: createMediaService/uploadImage; new
  - board/src/lib/server/post-authorization.ts :: authorizePostPassword — 기존authorize추출; new
  - board/src/lib/server/posts.ts :: 기존authorize를위공통함수로치환; modify
  - board/src/app/api/upload-sessions/route.ts, upload-sessions/current/route.ts :: 발급/취소; new
  - board/src/app/api/images/uploads/route.ts :: POST; new
#### Details
- **Signatures & Types**:
```typescript
type MediaReservation={id:string;kind:"session"|"file";clientKey:string;generation:string;bytesReserved:number};
reserveMediaRequest(pool:ConnectionPool,kind:"session"|"file",clientKey:string,now?:Date):Promise<MediaReservation>;
finishMediaRequest(pool:ConnectionPool,reservation:MediaReservation,receivedBytes:number):Promise<void>;
authorizePostPassword(pool:ConnectionPool,id:number,password:string):Promise<string>; // 기존해시반환
type UploadSession={id:string;expiresAt:Date;targetPostId:number|null;authorHash:string|null};
issueUploadSession(pool:ConnectionPool,clientKey:string,input:{postId?:number;password?:string}):Promise<{token:string;expiresAt:string}>;
readUploadSession(pool:ConnectionPool,token:string,clientKey:string,now?:Date):Promise<UploadSession>;
cancelUploadSession(pool:ConnectionPool,token:string,clientKey:string):Promise<void>;
createMediaService(pool:ConnectionPool,store:BlobStore):{uploadImage(request:Request,clientKey:string):Promise<{status:200|201;asset:ImageAssetDto}>};
type ImageInput={bytes:Buffer;mimeType:"image/jpeg"|"image/png"|"image/webp";receivedBytes:number};
type NormalizedImage={bytes:Buffer;inputBytes:number;inputSha256:string;width:number;height:number;mimeType:"image/webp"};
readImageFile(request:Request,observeReceived:(bytes:number)=>void,signal?:AbortSignal):Promise<ImageInput>;
normalizeImage(input:ImageInput,signal?:AbortSignal):Promise<NormalizedImage>;
```
- **Data & Schema Fields**: 위 SQL/API 계약 전체. session=5회/600초/bytes0, file=20회/600초/bytes52428800, 예약파일bytes5308416(5MiB+64KiB), session TTL900초. 실제파일입력합계20MiB/세션5개, 글참조최종5개/합20MiB도별도검사한다.
- **Execution Flow / Logic**:
  1. Origin→flag→input형식→getClientKey→media예약→세션/권한 순서. 세션발급은new/edit구조를검증한다. edit대상없는글404,기존 post-password 제한으로비밀번호오답403/실패카운트. 해시는복사하되원문보관금지. media session실패시도도예산을소모한다.
  2. media예약은SERIALIZABLE+UPDLOCK/HOLDLOCK로used+pending/bytes한도를검사하고세대/예약id를SQL에저장한다. finish는state=pending및generation조건부로한번만반영한다. 모든시도1회를used에반영,수신body실측bytes(최대예약값)를used에더하고차액반납. 만료/끊긴예약은120초뒤회수하되전체예약바이트를보수적으로소모처리한다. 새윈도우에이전finish가영향주지않게한다.
  3. token은strict64hex→SHA256조회→같은HMAC/source·active·expires검증. 잘못된token401,없는edit글404,동일cancelledtoken의취소재시도204. 다른사람세션과소비한세션으로upload는401/409. token을서버로그/URL/error필드에포함하지않는다.
  4. Idempotency-Key UUID를검사한다. 모든입력시도는요청예산을소모하되이미있는(session,key)는capacity를중복예약하지않는다. ready재송신은읽어확인한입력sha256동일시기존DTO200/상이409. uploading재송신은409+Retry-After1. 컨텐츠HASH가안맞으면기존Blob을덮어쓰지않는다.
  5. 새로운asset은SQL짧은tx에서capacity row→session→asset 순서로잠그고5MiB charge_bytes를예약/asset uploading생성/lease120초. 처음body를해석한뒤input_bytes/session input한도20MiB를확인,디코딩오류면Blob쓰기전예약/세션count회수하고asset purged. 파일은T02 read/normalize사용.
  6. Blob쓰기직전에blob_write_started=1을SQL확정하고put(60초deadline,tx밖)을실행한다. 성공후세션/lease/state를재검사하여ready로전환,차지5MiB를실제출력bytes로조정한다. 시간초과/DB마감실패는이미쓴파일존재를단정하지않고deleting/outbox로보내며미확정capacity를조기에반납하지않는다. 작업이늦게완료돼도ready상태를되살리지않는다.
  7. upload 호출 전체에 동일한60초 AbortSignal을 적용해 body/디코딩/Blob/확정 단계의 총 실행 시간을 제한한다. constructor/import에서Blob·SQL I/O금지. 정해진오류만외부노출,성공후File/Buffer참조를놓는다. 응답URL은asset ready일때도URL만반환(실제GET은attached전404)하며UI는로컬preview를유지해야한다.

### I02. 본문/이미지 연결·삭제와 공개 읽기
- Related Files:
  - board/src/lib/server/post-media.ts :: persistPostWithMedia/deletePostAndDetach; new
  - board/src/lib/server/posts.ts :: create/update/remove — SQL tx와asset원자연결; modify
  - board/src/lib/server/admin.ts :: deletePostAsAdmin — 공통삭제사용; modify
  - board/src/app/api/posts/route.ts, posts/[id]/route.ts :: context전달; modify
  - board/src/app/api/images/[id]/route.ts :: GET/HEAD; new
#### Details
- **Signatures & Types**:
```typescript
type PostMutationContext={clientKey:string;uploadSessionToken?:string};
persistPostWithMedia(pool:ConnectionPool,id:number|null,input:NormalizedPostInput,context:PostMutationContext|undefined,expectedPasswordHash?:string):Promise<Post>;
deletePostAndDetach(pool:ConnectionPool,id:number,expectedPasswordHash?:string):Promise<void>;
getPublishedImage(pool:ConnectionPool,store:BlobStore,id:string,request:Request,headOnly?:boolean):Promise<Response>;
```
- **Data & Schema Fields**: ready파일은제출session소유여야하고대상create(null)/edit(id)가같아야한다. 기존attached는같은post만허용한다. 5개중복제외및원본input_bytes합20MiB. session/부모삭제경쟁시state·author_hash조건으로재검사한다.
- **Execution Flow / Logic**:
  1. 기존작성자password scrypt는SQL tx밖에서검증하고expectedHash를안쪽UPDATE/DELETE조건으로재검사한다. 관리자route의쿠키인증뒤에만expectedHash없이공통삭제를호출한다. HTTP입력에서admin boolean을받지않는다.
  2. 모든미디어수정tx의잠금순서는capacity id1→관련session UUID정렬→post id→asset UUID정렬→outbox다. Blob I/O/hash계산을잠금중실행하지않는다. 데드락/DB오류는전체rollback/503이다.
  3. create/update는문서·본문·asset참조·session consumed를하나의tx에서확정한다. 다른postasset/만료/다른IP/변경된author_hash는409,게시글본문은그대로유지한다. unused ready파일/수정에서빠진attached는post_id=NULL/deleting/outbox로같은tx에넣는다.
  4. 작성자/관리자삭제도연결이미지deleting/outbox,대상active sessions cancelled로만든후posts삭제한다. FK때문에posts부터삭제하지않는다. 대상을잃은asset은공개GET즉시404,Blob물리삭제는T04가재시도한다.
  5. routes는body64KiB정책유지,getClientKey/context전달,기존create/post-password withRateLimit 유지. no-image rich의T01 임시503을제거하고실제미디어검사로대체한다.
  6. GET/HEAD는UUID형식검사후attached/부모존재→Blobread/head 순서. GET은SDKstream을Response에연결하고ETag는SQL관계검사후에만304. 임시파일은token을알아도공개되지않는다.

### I03. 경계·권한·원자성 검증
- Related Files:
  - board/tests/media.test.ts :: SQL예약/링크·경쟁; new
  - board/tests/media-api.spec.ts :: HTTPmultipart/세션/조회; new
  - board/tests/admin.test.ts, admin-api.spec.ts :: 이미지삭제경로; modify
  - board/tests/helpers/media-fixture.ts :: Blob 장애fixture; modify
#### Details
- 실제SQL+Azurite로세션발급/수정오답·만료·다른IP·취소·소비재사용·없는post를검사한다. media제한은새가상IPv6를쓴다.
- 동일key중복/다른body/DB마감실패/Blob성공후SQL오류/취소와upload완료경쟁/5장·20MiB·전역1GiB동시예약/50MiB·20회·5세션경계/이전세대finish를검사한다. 테스트clock은함수DI만,HTTP에서임의시각/작은운영limit받지않는다.
- 두post를만들어한글이미지참조를다른글에연결하려는시도409/원문무변경. 글수정·작성자삭제·관리자삭제가outbox를남기고Blob장애여도관련없는글에영향없는지확인한다.
- JPEG multipart→WebP DTO→본문attach→GET200/HEAD빈본문/ETag304→detach후304아닌404. pending은404,외부URI는입력거부,순수plain동작은이전대로성공한다.


## Acceptance Criteria
- [x] 세션/출발지/비밀번호/다른 글 소유권이 검증되고 업로드 중복·취소·원자 연결 실패가 부분 게시를 남기지 않는다.
- [x] 병렬 요청에서도 세션5/파일20·50MiB/글5장·20MiB/전체1GiB를 넘지 않으며 이전 세대 finish가 새 카운터를 바꾸지 않는다.
- [x] attached만200/HEAD/304이며 임시·제거 파일은404이고, 작성자·관리자 삭제가 같은 outbox 경로를 사용한다.
- [x] 기존 동작 회귀와 아래 Validation이 모두 통과하고 비밀·사용자 변경이 stage되지 않았다.

## Validation
- npm run test:all — 세션·upload·공개읽기·원자연결/삭제·동시제한과 기존회귀 성공.
- `npm run typecheck` — 성공.
- `npm run lint` — 성공.
- `npm run build` — 성공.
- git diff --check — 성공. 운영URL에자동suite를향하게하지않음.

## Commit Message
```text
feat(media): bind uploads to posts with durable ownership and quotas

Plan: 2026-11-16-rich-editor-images
Phase: P01-media-backend
Task: T03-media-api

- 소유한 이미지와 글만 연결/삭제하고 공개 읽기·토큰·출발지/건수/바이트/전체 용량 제한을 SQL과 Blob에서 검증한다.
```

## Progress
- [x] 구현 완료
- [x] 검증 통과
- commit: pending

## Next Task
P01-media-backend/T04-cleanup-worker.md

## Execution Notes
- SQL BIGINT는 safeBytes로 검사한다. media-transactions의 capacity 선행 잠금으로 모든 미디어 변경을 직렬화하고 Blob/비밀번호 hash I/O는 밖에서 수행한다.
- 기존 media-limits.ts의 decoder deadline과 순환 의존성을 피하기 위해 요청 예약은 media-rate-limit.ts로 분리했다. 공개 조회는 published-images.ts로 분리했다.
- 요청 전체 deadline은 SQL 지연도 포함해 호출자에게 60초 이내 실패를 전달한다. 완료가 늦은 작업은 signal 확인 후 ready 승격을 금지하고 보수적 용량/outbox를 유지한다.
- 검증: test:all 69개 통과 후 deadline/취소 검증을 추가하여 test:service 43개 통과(API17/E2E10 기존 통과), typecheck/lint/build/diff check 통과. 운영/사용자 next-env 변경 없음.
