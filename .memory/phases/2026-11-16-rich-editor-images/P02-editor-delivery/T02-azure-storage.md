# Task: T02 private Blob 인프라와 배포 준비

## Status: done

## Goal
기존 공개 앱을 유지하면서 private Blob·앱 system identity·최소 data 역할과 비활성 설정을 실제 준비한다.

## Decision Summary
- 확정된 무료 에디터·private Blob 구성만 추가하며 기존 게시판과 운영 DB 경계를 유지한다.
- 실제 공개 활성화와 운영 SQL migration은 마지막 Task로 묶는다.

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

### I01. 검토 가능한 Blob/IAM 인프라
- Related Files:
  - infra/azure/images.bicep :: storage/container/data역할; new
  - infra/azure/images.parameters.example.json :: nonsecret예시; new
  - infra/azure/main.bicep :: app systemidentity/새appsettings desiredstate; modify
  - board/scripts/provision-images.ps1 :: Validate/WhatIf/Apply/Verify; new
  - board/scripts/provision-azure.ps1 :: image설정보존/identity검증; modify
#### Details
- **Signatures & Types**:
```typescript
type ImageInfraOutput={storageAccount:string;blobServiceUrl:string;container:string;runtimePrincipalId:string;operatorPrincipalId:string};
```
- **Data & Schema Fields**: Bicep resourceGroup scope/고정koreacentral. StorageV2 Standard_LRS/Hot/HTTPSonly/minimumTlsVersionTLS1_2/allowBlobPublicAccess=false/allowSharedKeyAccess=false/publicNetworkAccessEnabled, 암호화기본. 계정stvibeboardimg7b1417와private board-images, Blob및container deleteRetentionPolicy enabled7일/isVersioningEnabled=false. API는공식지원stable2023-05-01(Storage),2022-04-01(Authorization)사용전provider/build확인한다.
- **Execution Flow / Logic**:
  1. 먼저파일/명령을완성하고az bicep build/Validate/WhatIf로검토한다. active구독DEX id7b1417d8-833d-4ba9-a5cd-d27c91a28b83/RG소유태그확인. 이름충돌은자신의태그/구성으로증명된자원만재사용,다른자원수정금지. 실제B1/SQL비용과새HotLRS/거래·송신요금을재조회해50,000원목표비교. 목표초과SKU/다른region으로묵시대체하지않는다.
  2. AppService의기존identity를읽어보존하고 az webapp identity assign --identities '[system]'으로system-assigned를추가한다. user-assigned GitHub id-vibe-board-github/clientId de9e7f82-b0f8-40f8-94c7-025ea350d37c를앱identity로추가하지않는다. runtime principal을조회후Bicep매개변수로전달한다.
  3. images.bicep는새Storage자원과runtime/localoperator 컨테이너scope Storage Blob Data Contributor(ba92f5b4-2d11-453d-a403-e96b0029c9fe)만선언한다. 현재localoperator objectId는az ad signed-in-user show로얻고Entra앱/장기secret/account key/SAS는만들지않는다. roleassignment이름은scope/principal/role guid로멱등.
  4. WhatIf에삭제/관계없는SQL/플랜변경이없을때Incremental Apply. main.bicep에는app.identity SystemAssigned를반영하되SQL/application전체를다시배포하여부작용을만들지않는다. 새이미지배포는images.bicep만사용한다.
  5. main.bicep에는imageStorageAccountName(기본빈문자열),editorFeatureEnabled/mediaCleanupEnabled(bool기본false)매개변수와조건부STORAGE_*설정을추가한다. provision-azure.ps1은기존이미지설정이있으면선별조회해전달하여향후전체Apply가스토리지설정을지우지않게한다. APP_VERSION과기존SQL/admin/rate설정도보존한다. 값전체를로그하지않는다.
  6. Verify는privateanonymousread거부/TLS/SharedKeyoff/retention7/versioningoff/sameB1x1/SQLBasic2GB불변/정확한data역할scope/배포OIDCsubject repo:YIH151515@355682187/vibe_webapp@1456296194:ref:refs/heads/main 유지여부를검사한다.

### I02. 설정·운영 도구와 schema4 호환 baseline 준비
- Related Files:
  - board/scripts/set-image-settings.ps1 :: nonsecret image설정; new
  - board/scripts/verify-image-access.ts :: 읽기 전용 컨테이너/RBAC검사; new
  - board/package.json :: verify:image-access; modify
  - board/.env.example :: 이미지설정정의; modify
  - board/docs/images-runbook.md :: 실제리소스/설정/복원/비용; new
  - board/scripts/build-azure.mjs, tests/package.test.mjs :: runtimeflag빌드에 포함하지 않음확인; modify
  - board/.env.local :: 관련key만변경(local-only,stage금지)
#### Details
- **Signatures & Types**:
```typescript
verifyImageAccess(client:ContainerClient):Promise<{containerReadable:boolean;private:boolean}>;
```
- **Data & Schema Fields**: Azure STORAGE_AUTH_MODE=managed-identity, STORAGE_BLOB_SERVICE_URL=실제output, STORAGE_CONTAINER=board-images, EDITOR_FEATURE_ENABLED=0, MEDIA_CLEANUP_ENABLED=0(마지막릴리스에서1). local은azure-cli/동일url-container/EDITOR_FEATURE_ENABLED=0/cleanup0. .env.local의무관한값을보존하고scrypt의달러escape규칙을훼손하지않는다.
- **Execution Flow / Logic**:
  1. endpoint/container/flags는nonsecret이지만az appsettings set --output none으로다룬다. SQL/admin/rate키를새스크립트가수집·교체하지않는다. credential추가/GitHub추가secret없음. source와.env.local에accountkey를넣지않는다.
  2. verify:image-access는 AzureCliCredential로 ContainerClient.getProperties를 읽고, 같은 컨테이너의 익명 HEAD(restype=container)가403/404임을 검사한다. 이 Task에서는 Blob에 파일을 쓰지 않는다. schema4 용량 원장이 아직 없으므로 추적되지 않은 soft-delete 파일을 만들지 않기 위해서다. 실제 runtime put/read/delete는 다음 Task의 SQL에 등록된 own QA로 검증한다.
  3. 실제managed identity data접속은아직schema3운영app에새route가없으므로이Task에서성공했다고거짓보고하지않는다. role/config검증과localdata검증만완료하고실제runtime이미지QA는다음Task에서한다.
  4. 운영 SQL4 migration/grants/media capacity/새 worker 기동은 하지 않는다. 현재 앱 schema3 health는 계속200이어야 한다. feature 브랜치 전체 test/build/verify:azure로 schema4 호환 ZIP을 준비하고 검증된 board.zip/release.json을 .deploy/compat-schema4/에 복사해 둔다. manifest SHA256과 포함된 코드 commit을 확인한다. 이 폴더는 Git 제외다. 다음 Task의 전환 실패 시 이 flag0 패키지로 읽기/일반 글 서비스를 회복할 수 있어야 한다. 정상 main flag0 성공 아티팩트를 최종 rollback baseline으로 채택한다.
  5. sourcebranch작업을검증/커밋후포인터를P02-T03으로옮긴다. 새리소스명·ID·비용·역할·접속방법만기록하고원문IP/암호/cookie는기록하지않는다.


## Acceptance Criteria
- [x] 지정 RG에 private HotLRS/TLS/SharedKeyOff/soft delete7일과 컨테이너 범위 런타임·로컬 data 역할이 실제 존재한다.
- [x] 기존 B1·SQL3·공개 health는 유지되고 파일 쓰기/운영 migration 없이 로컬 컨테이너 조회와 익명 거부만 검증했다.
- [x] 비활성 이미지 설정과 검증된 schema4 전환 실패 회복용 ZIP/SHA가 준비됐고 실제 비용·역할·설정이 기록됐다.
- [x] 기존 동작 회귀와 아래 Validation이 모두 통과하고 비밀·사용자 변경이 stage되지 않았다.

## Validation
- 루트 `az bicep build --file infra/azure/images.bicep --stdout` — 성공.
- 루트 `az bicep build --file infra/azure/main.bicep --stdout` — 성공.
- `./scripts/provision-images.ps1 -Mode Validate` — 실제 템플릿 검증 성공.
- `./scripts/provision-images.ps1 -Mode WhatIf` — 지정한 새 자원/역할/설정만 변경.
- `./scripts/provision-images.ps1 -Mode Apply` — 해당 변경만 적용.
- `./scripts/provision-images.ps1 -Mode Verify` — 실제 정책과 역할 검증 성공.
- npm run verify:image-access — 로컬 data 토큰으로 컨테이너 속성 조회/익명 접근 거부 성공, Blob 쓰기 없음.
- `npm run test:all` — feature branch 전체 회귀 성공.
- `npm run typecheck` — 성공.
- `npm run lint` — 성공.
- `npm run build` — 성공.
- `npm run verify:azure` — 독립 Linux ZIP 검증 성공.
- 기존공개 /api/health statusok/version기존배포SHA — 운영SQL3유지.
- git diff --check / git status --short — .env.local/비밀값stage안됨.

## Commit Message
```text
infra(media): provision private blob storage and runtime access

Plan: 2026-11-16-rich-editor-images
Phase: P02-editor-delivery
Task: T02-azure-storage

- 기존 공개 앱을 유지하면서 private Blob·앱 system identity·최소 data 역할과 비활성 설정을 실제 준비한다.
```

## Progress
- [x] 구현 완료
- [x] 검증 통과
- commit: 6d7b5d9

## Next Task
P02-editor-delivery/T03-live-release.md

## Execution Notes
- 실제 적용 완료: stvibeboardimg7b1417 / board-images / private Hot LRS / TLS1.2 / SharedKeyOff / Blob+container soft-delete7 / versioningOff. runtime system principal=c622583d-88b1-45c2-b335-fe576e2ab599, operator=e8222b20-96f4-4c25-a3af-1f40ebbbec56. 두 principal에 컨테이너 범위 data contributor만 추가했다.
- images/main Bicep build, 실제 Validate/WhatIf/Apply/Verify 통과. WhatIf의 기존 SQL/앱/플랜 Ignore는 무변경으로 분리하며 Delete와 관계없는 Modify/Create는 거부한다. main 전체 배포는 실행하지 않았다.
- 앱·로컬 이미지 설정0 적용 후 기존 SQL3 health/version57fda56f9e28dbc33971323dd804b2268cee5a55 정상. 운영 migration/Blob 파일 쓰기 없음. local 컨테이너 속성 조회/익명 거부 검증 성공.
- 익명 HEAD의 기본 서비스 버전은 Azure에서409를 반환했다. 공식 응답 계약에 맞춰2023-11-03을 명시하고401도 허용한다. 인증된 getProperties private 및 ARM 정책 검증과 함께 판단한다. 보안 정책을 바꾸지 않았다.
- 전체91개(서비스54/API17/E2E20), typecheck/lint/build/diff check 통과. 동일 source commit의 복구용 ZIP을 증명하기 위해 구현을 먼저 커밋한 뒤 verify:azure를 수행하고, 완료/다음 포인터는 그 결과 이후 별도 문서 커밋에서 확정한다.

- Linux verify:azure 성공 후 검증 ZIP 보관: .deploy/compat-schema4/board.zip, source6d7b5d9238db9cb2d7977db93ab9f4709aea9528, SHA2562dd907e71cbf2f24bb959c4d185f208b731f91d4ea36b37910309f9b0ea96c4a. manifest/실제 hash 일치 확인.
