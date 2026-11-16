# Task: T02 Blob·이미지 처리와 Azurite 격리

## Status: done

## Goal
운영 저장소에 접속하지 않고 private Blob 업로드·스트리밍과 제한된 이미지 변환을 일회용 Azurite/Linux에서 검증한다.

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

### 미디어 API/Storage 계약
- POST /api/upload-sessions JSON{postId?:number,password?:string}→201{token:string,expiresAt:string}. 신규는둘다없음/수정은둘다필수(비밀번호8~64). 세션발급에Authorization불필요, 모든변경requireOrigin=true.
- DELETE /api/upload-sessions/current Authorization:Bearer <token>→204. 본인active를cancelled로, 미연결asset을deleting/outbox로. 없는/다른IP/만료token401, 동일token의취소재송신204.
- POST /api/images/uploads: Authorization Bearer, Idempotency-Key UUIDv4, multipart file정확히1개. 다른field/다중file400, multipart아닌경우415. →201 ImageAssetDto={id:string;url:string;width:number;height:number;bytes:number;inputBytes:number;mimeType:"image/webp"}. 동일key/동일입력sha256의ready재송신200, 다른입력/처리중409. 원본파일명저장금지.
- GET/HEAD /api/images/[id]: attached+부모post존재일때200. Content-Type image/webp/Content-Length/ETag/X-Content-Type-Options nosniff/Cache-Control public,max-age=0,must-revalidate. If-None-Match일치도SQL확인후304. ready/deleting등·삭제부모404/no-store. Range는초기버전에서무시하고전체200, HEADbody없음. Blob404는404/다른장애503.
- BlobStore interface: put(name:string,bytes:Buffer,signal?:AbortSignal):Promise<{etag:string}>; read(name:string,signal?:AbortSignal):Promise<{stream:ReadableStream<Uint8Array>;bytes:number;etag:string}>; head(name:string):Promise<{bytes:number;etag:string}|null>; remove(name:string):Promise<void>(404도성공). put은If-None-Match:*로덮어쓰기금지, upload concurrency1/operation timeout60초이내/유한retry. SQL tx밖에서호출.
- env: EDITOR_FEATURE_ENABLED=0|1(default0), STORAGE_AUTH_MODE=managed-identity|azure-cli|azurite, STORAGE_BLOB_SERVICE_URL, STORAGE_CONTAINER, MEDIA_CLEANUP_ENABLED=0|1(default0), AZURITE_ACCOUNT/AZURITE_KEY(test전용). 운영URL은https://<소문자계정>.blob.core.windows.net/path·credential·query없음, container='board-images'. app-service는managed-identity만/local은azure-cli만. 자동credentialchain탐색금지.
- test는APP_TEST_MODE/SQLguard와http://127.0.0.1:<생성port>/boardtest/account boardtest/container board-test-<32hex>/랜덤base64 key를확인한다. 다른http/외부host/운영endpoint와test혼합거부. @azure/storage-blob12.34.0/@azure/identity4.14.1/sharp0.35.5/testcontainers12.2.1 exact pin. Blob client serviceVersion=2023-11-03으로기본CRUD호환고정.

## Implementation

### I01. Azure/Azurite 저장 어댑터·제한된 이미지 처리
- Related Files:
  - board/src/lib/server/blob-store.ts :: BlobStore/createBlobStore/assertMediaTestStorage; new
  - board/src/lib/server/image-processing.ts :: normalizeImage; new
  - board/src/lib/server/multipart.ts :: readImageFile; new
  - board/package.json, package-lock.json :: 런타임 SDK/sharp 및 dev testcontainers; modify
  - board/next.config.ts :: serverExternalPackages/기존 조건부output 유지; modify
  - board/.env.example :: 새비밀이 아닌설정; modify
#### Details
- **Signatures & Types**:
```typescript
type ImageInput = {bytes:Buffer;mimeType:"image/jpeg"|"image/png"|"image/webp";receivedBytes:number};
type NormalizedImage={bytes:Buffer;inputBytes:number;inputSha256:string;width:number;height:number;mimeType:"image/webp"};
normalizeImage(input:ImageInput,signal?:AbortSignal):Promise<NormalizedImage>;
readImageFile(request:Request,observeReceived:(bytes:number)=>void,signal?:AbortSignal):Promise<ImageInput>;
createBlobStore(env:NodeJS.ProcessEnv):BlobStore;
assertMediaTestStorage(env:NodeJS.ProcessEnv):void;
```
- **Data & Schema Fields**: 위 Storage/env/DTO 계약 사용. blob URL은constructor에서 allowlist 검사, credential은명시된mode만생성. lazy singleton을사용하며 import/build에네트워크/SQL을연결하지않는다. 원문filename은parse후즉시버리고메타데이터/로그에넣지않는다.
- **Execution Flow / Logic**:
  1. npm install --save-exact sharp@0.35.5 @azure/storage-blob@12.34.0 @azure/identity@4.14.1, npm install --save-dev --save-exact testcontainers@12.2.1. mssql외부실행을유지하고 sharp/두AzureSDK도serverExternalPackages에추가한다.
  2. readImageFile은media type/boundary,선언길이·실제stream상한5MiB+64KiB(5308416)를 먼저검사한다. request.formData를무제한직접호출하지않고 bounded bytes로만 Request/formData를생성한다. file정확히1개/다른part0,실제file<=5242880. observable receivedBytes는multipart포함수신총바이트(할당된상한이하).
  3. magic/JPEG-PNG-WebP decode metadata형식이선언MIME와일치해야한다. sharp limitInputPixels=24000000, failOn='error', pages/frame=1, 각축<=10000. max2개 변환slot, 초과503/Retry-After1, abort60초. rotate/resize1920inside/withoutEnlargement/webpquality82/metadata없이출력. 출력5MiB이하/widthheight확인. 손상400/타입415/입력및픽셀상한413.
  4. put은고정UUID경로/If-None-Match:*;같은내용중복을objectoverwrite로해결하지않는다. SDKresponse raw에러는정해진503만외부노출한다. stream은클라이언트취소시abort/close하여B1메모리에전체readbuffer를추가하지않는다.

### I02. SQL+Azurite 격리 fixture와 Linux native 확인
- Related Files:
  - board/scripts/run-tests.ts :: 두컨테이너 lifecycle/환경; modify
  - board/tests/helpers/media-fixture.ts :: 미디어전용fixture; new
  - board/tests/helpers/fake-blob-store.ts :: clock/장애주입Store; new
  - board/tests/blob.test.ts, image-processing.test.ts :: storage/decoder 경계; new
  - board/scripts/build-azure.mjs :: 새env와Azure credential strip; modify
  - board/scripts/verify-azure.mjs, tests/package.test.mjs :: LinuxSDK/native smoke; modify
  - board/playwright.config.ts, tests/admin.spec.ts :: 기존 UI 회귀 검증의 cold compile 대기/삭제 HTTP 상태 확인; modify
#### Details
- **Signatures & Types**:
```typescript
mediaFixture():Promise<{pool:ConnectionPool;store:BlobStore;containerName:string;close():Promise<void>}>;
class FakeBlobStore implements BlobStore { /* put/read/head/remove + clock/지연/장애 주입 */ }
```
- **Data & Schema Fields**: GenericContainer('mcr.microsoft.com/azure-storage/azurite:3.37.0'), blobPort10000만host생성port매핑, command azurite-blob --blobHost 0.0.0.0 --silent --disableTelemetry. AZURITE_ACCOUNTS=boardtest:<생성base64key>. suite마다board-test-<32hex>새container를생성하고private로둔다. storage endpoint는127.0.0.1로고정한다.
- **Execution Flow / Logic**:
  1. 두컨테이너시작은개별성공handle을항상기록하고어느하나실패해도성공한소유컨테이너만finally정리한다. 사용자pad/개발서버를중지하지않는다. 기존NODE_ENV=test와.env.local배제유지,SQL/Storage/test둘다guard.
  2. 서비스테스트각fixture는새SQLDB+새Azuritecontainer를가지고close에서해당container/DB만정리한다. 서버/API/E2E suite도각각새DB/container다. stdout/trace에실제운영credentials를넣지않는다.
  3. JPEG/PNG투명도/WebP/EXIForientation/메타데이터제거/최대값/손상/가짜MIME/다중프레임/SVG거부/픽셀폭탄/abort·변환동시성/길이없는stream상한을테스트한다. private read는SDK만되고anonymousGET은실패해야한다.
  4. Azurite는soft delete/undelete를지원하지않으므로그API를가짜로성공시켰다고주장하지않는다. FakeBlobStore에보존모델을두고T04의7일회계테스트에사용한다. Azure계정을통합테스트대신사용하지않는다.
  5. Linux package.test는압축푼runtime에서별도node로require sharp/두SDK를성공시키고테스트용1pxPNG를WebP변환해native.node/libvips추적을검사한다. root200/CSS200/SQL없는health503및secret파일배제기존검사유지. build-env는SQL_/ADMIN_/RATE_LIMIT_/MEDIA_/STORAGE_/AZURITE_/EDITOR_와AZURE_CLIENT_/AZURE_TENANT_를제거한다.
  6. SDKruntime에필요한의존성내부data폴더까지무조건배제하여깨지면패키지필터를프로젝트소스/루트데이터제외로한정한다. src/scripts/sql/tests/.env와원본DB/키는여전히ZIP에없어야한다.


## Acceptance Criteria
- [x] JPEG/PNG/WebP가 메타데이터 없는 제한된 WebP로 변환되고 손상·위장·다중프레임·body/픽셀 상한 위반이 거부된다.
- [x] 전용 Azurite private 파일은 SDK로 왕복하고 익명으로 읽히지 않으며 운영 endpoint/test 혼합을 거부한다.
- [x] Linux ZIP에서 sharp native 변환과 두 Azure SDK import, root/CSS/503 검사가 성공한다.
- [x] 기존 동작 회귀와 아래 Validation이 모두 통과하고 비밀·사용자 변경이 stage되지 않았다.

## Validation
- npm run test:all — 두 일회용 컨테이너에서 기존+미디어 runtime 검사 성공.
- `npm run typecheck` — 성공.
- `npm run lint` — 성공.
- `npm run build` — 성공.
- npm run verify:azure — 실제 Linux native sharp/SDK·독립 ZIP 실행 성공.
- git diff --check — 성공.

## Commit Message
```text
feat(media): add bounded image processing and private blob storage

Plan: 2026-11-16-rich-editor-images
Phase: P01-media-backend
Task: T02-blob-runtime

- 운영 저장소에 접속하지 않고 private Blob 업로드·스트리밍과 제한된 이미지 변환을 일회용 Azurite/Linux에서 검증한다.
```

## Progress
- [x] 구현 완료
- [x] 검증 통과
- commit: pending

## Execution Notes
- 최종 검증: npm run test:all 전체60개(서비스/보안/문서/미디어35 + API15 + E2E10), typecheck/lint/build, npm run verify:azure(Linux Node24.22.3, ZIP native/SDK/root/CSS/health503), git diff --check 통과. 소유 SQL/Azurite 컨테이너 정리 완료. next-env.d.ts의 기존 사용자 dev 경로 변경은 보존하고 stage하지 않았다.
- 공통 60초 deadline/5MiB 상한은 `board/src/lib/server/media-limits.ts`로 분리했다. 변환 슬롯 초과 503에도 Retry-After: 1을 전달하도록 BoardError의 선택적 retryAfterSeconds와 공통 HTTP 응답을 확장했다. 기존 429 계약은 유지했다.
- 설치된 storage-blob 12.34.0은 serviceVersion 생성자 옵션을 제공하지 않는다. 공개 newPipeline 정책에서 서명 전에 x-ms-version=2023-11-03을 고정하고 테스트 container 생성에도 같은 정책을 사용했다. 존재하지 않는 옵션을 타입 우회로 전달하지 않았다.
- 아직 route에서 참조하지 않는 SDK가 standalone에서 빠지므로 Next에 포함된 nodeFileTrace로 세 런타임 진입점과 package.json을 추가 추적했다. dependency 내부 data는 허용하되 프로젝트 src/scripts/sql/tests/data, 환경 파일과 키는 배제했다. 기존 verify-azure 실행기는 수정 없이 강화된 package.test를 실행한다.
- APNG acTL/animated WebP chunk를 decode 전에 검사한다. 테스트 WebP 두 frame은 색을 다르게 구성해 encoder가 한 frame으로 합치지 못하게 했다.
- 운영 Azure/SQL/Blob에는 접속하거나 설정을 적용하지 않았다. Linux 검증 ZIP은 로컬 검증용이며 배포하지 않았다.
- Windows의 첫 route compile 동안 기존 5초 UI assertion이 두 차례 시간 초과했다(관리자 DELETE가 pending, 글 상세 이동도 첫 요청에서 pending). 기존 30초 test budget은 유지하고 assertion 대기를 15초로 조정했다. 관리자 삭제는 HTTP 204까지 확인한 뒤 기존 완료 메시지를 검사하도록 회귀 검증을 강화했다. 기능 코드는 바꾸지 않았다.

## Next Task
P01-media-backend/T03-media-api.md
