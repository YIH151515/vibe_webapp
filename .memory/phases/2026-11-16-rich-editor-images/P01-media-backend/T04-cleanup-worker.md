# Task: T04 미사용 이미지 정리와 보존 용량 회계

## Status: done

## Goal
취소·만료·삭제 이미지를 재시도 가능한 worker로 정리하고 soft delete7일 동안 전체1GiB 한도를 정확히 유지한다.

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

### I01. 정리 worker와 7일 용량 회계
- Related Files:
  - board/src/lib/server/media-cleanup.ts :: runMediaCleanup/startMediaCleanup; new
  - board/src/instrumentation.ts :: register — Node/운영에서루프시작; new
  - board/scripts/media-cleanup.ts :: readonly/apply CLI; new
  - board/package.json :: media:cleanup; modify
#### Details
- **Signatures & Types**:
```typescript
type CleanupResult={claimed:number;deleted:number;retained:number;releasedBytes:number;failed:number};
runMediaCleanup(pool:ConnectionPool,store:BlobStore,options?:{now?:Date;limit?:number;owner?:string}):Promise<CleanupResult>;
startMediaCleanup(dependencies:{getPool:()=>Promise<ConnectionPool>;getStore:()=>BlobStore}):()=>void;
register():Promise<void>;
```
- **Data & Schema Fields**: 위 schema전체. outbox.available_at/lease_owner/lease_until/attempts, asset.deleted_at/purge_after/charge_bytes, capacity와같은잠금순서사용. DB현재UTC가기준이며clock주입은테스트용함수인수뿐이다.
- **Execution Flow / Logic**:
  1. media_maintenance image-cleanup의lease를SQL조건부로5분획득한다. 이미다른worker가보유하면결과0을반환한다. 10분interval/첫기동비동기tick,한번에최대100개,overlap방지/globalThis중복기동방지/unref. 종료시timer와처리중abort만정리한다.
  2. active만료세션은expired로,미연결ready/uploading은created_at24시간경과+lease만료후deleting/outbox로획득한다. cancel/삭제outbox는즉시대상. 글 저장과동일한capacity→session→post→asset잠금/조건부state변경으로연결파일을취득하지못하게한다.
  3. job당고유 lease2분,Blobremove는SQL tx밖/60초deadline. 성공/404면asset soft_deleted/deleted_at=현재/purge_after=현재+7일,job삭제. write시작여부불명확/작성중파일도7일tombstone와charge를유지하여늦은Blob완료를즉시용량반환으로놓치지않는다. 이보존기간미연결객체의늦은등장을주기head/remove로재정리하되purge_after를매번연장하지않는다.
  4. Blob쓰기전에확정실패한asset(blob_write_started=0/해당작업완료확실)은purged/charge0/용량반납가능. 그외soft_deleted는7일경과후Blobhead가없고연결없음을재검사한tx에서purged/charge0/capacity차감한다. late파일이존재하면remove후새삭제성공시점부터7일보존한다. Azure soft delete의비용도한도에포함한다.
  5. 에러는attempts증가/available_at=now+min(3600,60*2^min(attempts,6))초,jobs lease해제,last_error_code=정해진BLOB_UNAVAILABLE|DB_UNAVAILABLE|LEASE_LOST로만남긴다. source/body/error문자열을그대로저장하지않는다. 삭제실패로post본문을복구하거나다른post의파일을삭제하지않는다.
  6. 끝난media_reservations는24h뒤최대100행씩삭제한다. active asset이참조하는session/asset metadata는삭제하지않는다. 임의container목록전체에대한delete sweep는금지한다.
  7. instrumentation은NEXT_RUNTIME=nodejs/WEBSITE_INSTANCE_ID존재/MEDIA_CLEANUP_ENABLED=1/APP_TEST_MODE!=1일때만동적import로시작한다. register는SQL/Blob tick완료를await하지않고서버준비를지연시키지않는다. import/build/Edge/local기동에서네트워크접속하지않는다. 실패로그는고정코드만,보드읽기까지프로세스를죽이지않는다.
  8. 한 tick은 최대100건 또는4분 중 먼저 도달할 때 중지한다. job 완료는 자신의 lease_owner가 여전히 일치할 때만 SQL 확정하고, 전체 lease를 잃으면 새 job 취득을 중지한다. soft_deleted 재확인은 lease_until이 빠른 순으로 선택하고 다음 확인을24시간 뒤로 미뤄 앞100건만 반복하는 기아를 막는다. purged는30일 뒤, 참조 없는 세션과 완료 예약은 보존기간 후 각각 최대100건만 지우며 FK/진행 중 참조를 확인한다. 만료된 media_buckets도24시간 경과·예약 참조 없음일 때만 정리한다.

### I02. 안전한 수동 실행·장애/보존 테스트
- Related Files:
  - board/scripts/media-cleanup.ts :: CLIargument/환경guard; new
  - board/tests/media-cleanup.test.ts :: 24h/7일·lease경쟁·장애; new
  - board/tests/helpers/fake-blob-store.ts :: soft delete/late completion; modify
  - board/tests/package.test.mjs :: 기동시운영정리미실행; modify
  - board/README.md :: 수동정리/test/운영경계; modify
#### Details
- **Signatures & Types**: npm script media:cleanup='tsx scripts/media-cleanup.ts'. argv --apply(없으면dry-run), --limit 1..100. 출력은상기CleanupResult 집계JSON뿐,이미지목록·자격증명출력금지.
- **Data & Schema Fields**: local CLI는.env.local을명시적으로읽되Blobmode=azure-cli/정확한운영URL-container및SQL서버를검사한다. --apply를주지않으면queue개수만조회하고lease/카운터/Blob을수정하지않는다. 테스트함수호출은전용fixture/config이며.env.local을읽지않는다.
- **Execution Flow / Logic**:
  1. clock주입FakeBlobStore로23h59m/24h·6d23h/7d경계,soft delete실제보존용량,동시 cleanup와attach/두worker/expiredlease/프로세스재기동을검증한다.
  2. Azurite3.x는soft delete/undelete가미지원이다. Azurite통합은실제삭제/404/outbox만검증하고7일보존비용/복구모델은fake clock검증으로분리한다. 운영Azure로자동테스트를대체하지않는다.
  3. Blobdeletetimeout/SQL마감실패후재시도/404멱등/늦은put재등장/차감두번방지/용량1GiB경계를확인한다. attached asset은한번도remove 호출되지않아야한다.
  4. Linux패키지기동SQL없는health503에서cleanup이네트워크로기동되지않아야하며,cleanupdisabled일때Node프로세스가timer때문에종료불가하지않게한다.


## Acceptance Criteria
- [x] 미연결 초안만24시간 후 정리되고 첨부된 이미지에는 삭제 호출이 발생하지 않는다.
- [x] 삭제 보존7일 전에 용량을 반환하지 않으며 중복/이전 lease/Blob 실패 후에도 두 번 차감하거나 파일을 놓치지 않는다.
- [x] 자동 worker는 Azure Node runtime에만 기동하고 CLI dry-run은 DB/Blob/lease를 수정하지 않는다.
- [x] 기존 동작 회귀와 아래 Validation이 모두 통과하고 비밀·사용자 변경이 stage되지 않았다.

## Validation
- npm run test:all — cleanup clock/fault/경쟁 및 모든HTTP/브라우저회귀 성공.
- `npm run typecheck` — 성공.
- `npm run lint` — 성공.
- `npm run build` — 성공.
- npm run verify:azure — instrumentation/native/기존독립기동 검사 통과.
- git diff --check — 성공. 운영 media:cleanup --apply는 이Task에서실행하지않음.

## Commit Message
```text
feat(media): reconcile expired uploads and deleted image storage

Plan: 2026-11-16-rich-editor-images
Phase: P01-media-backend
Task: T04-cleanup-worker

- 취소·만료·삭제 이미지를 재시도 가능한 worker로 정리하고 soft delete7일 동안 전체1GiB 한도를 정확히 유지한다.
```

## Progress
- [x] 구현 완료
- [x] 검증 통과
- commit: pending

## Next Task
P02-editor-delivery/T01-editor-ui.md

## Execution Notes
- 검증: test:all 77개 성공 후 purged metadata 30일 경계를 보강하여 test:service 51개 성공(API17/E2E10 포함 총78개), typecheck/lint/build/Linux verify:azure/diff check 통과. 운영 cleanup --apply 미실행.
- 유지보수 lease5분/job lease2분/한 tick100건·4분 I/O budget, 10분 unref loop를 구현했다. Blob I/O는 SQL 밖에서 수행한다.
- late object는 remove 전에 durable outbox를 다시 만들고 다음 tick에서 삭제한다. remove 성공 뒤 DB 마감 실패에도 새 7일 보존을 잃지 않게 하며, 없는 파일 HEAD만으로 보존을 연장하지 않는다.
- trust된 assetIds 선택 필터를 미리 포함해 마지막 공개 QA가 자신이 만든 파일만 정리하도록 했다. HTTP에서 clock/필터/limit override를 받지 않는다.
- T03의 prewrite purged에도 deleted_at/purge_after를 기록해 30일 후 metadata GC가 가능하게 했다. GC 기준은 용량을 반환한 purge_after이다.
- CLI dry-run의 DB 불변/Blob 무변경, 실제 Azurite 삭제와 fake 7일 보존을 분리 검증했다. instrumentation은 Azure Node/명시 flag에서만 시작한다.
