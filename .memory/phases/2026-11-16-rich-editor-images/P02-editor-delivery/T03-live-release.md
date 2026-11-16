# Task: T03 이미지 에디터 공개와 운영 인계

## Status: in_progress

## Goal
schema4 호환 릴리스와 실제 이미지 게시·수정·재시작·삭제·정리를 검증하고 운영 안내와 전체 completed 상태를 남긴다.

## Decision Summary
- 기존 운영 데이터를 지우지 않고 한정된 own QA만 사용한다.
- 실제 Actions/managed identity/Blob/SQL 공개 검증이 끝나야 완료한다.

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
### 미디어 API/Storage 계약
- POST /api/upload-sessions JSON{postId?:number,password?:string}→201{token:string,expiresAt:string}. 신규는둘다없음/수정은둘다필수(비밀번호8~64). 세션발급에Authorization불필요, 모든변경requireOrigin=true.
- DELETE /api/upload-sessions/current Authorization:Bearer <token>→204. 본인active를cancelled로, 미연결asset을deleting/outbox로. 없는/다른IP/만료token401, 동일token의취소재송신204.
- POST /api/images/uploads: Authorization Bearer, Idempotency-Key UUIDv4, multipart file정확히1개. 다른field/다중file400, multipart아닌경우415. →201 ImageAssetDto={id:string;url:string;width:number;height:number;bytes:number;inputBytes:number;mimeType:"image/webp"}. 동일key/동일입력sha256의ready재송신200, 다른입력/처리중409. 원본파일명저장금지.
- GET/HEAD /api/images/[id]: attached+부모post존재일때200. Content-Type image/webp/Content-Length/ETag/X-Content-Type-Options nosniff/Cache-Control public,max-age=0,must-revalidate. If-None-Match일치도SQL확인후304. ready/deleting등·삭제부모404/no-store. Range는초기버전에서무시하고전체200, HEADbody없음. Blob404는404/다른장애503.
- BlobStore interface: put(name:string,bytes:Buffer,signal?:AbortSignal):Promise<{etag:string}>; read(name:string,signal?:AbortSignal):Promise<{stream:ReadableStream<Uint8Array>;bytes:number;etag:string}>; head(name:string):Promise<{bytes:number;etag:string}|null>; remove(name:string):Promise<void>(404도성공). put은If-None-Match:*로덮어쓰기금지, upload concurrency1/operation timeout60초이내/유한retry. SQL tx밖에서호출.
- env: EDITOR_FEATURE_ENABLED=0|1(default0), STORAGE_AUTH_MODE=managed-identity|azure-cli|azurite, STORAGE_BLOB_SERVICE_URL, STORAGE_CONTAINER, MEDIA_CLEANUP_ENABLED=0|1(default0), AZURITE_ACCOUNT/AZURITE_KEY(test전용). 운영URL은https://<소문자계정>.blob.core.windows.net/path·credential·query없음, container='board-images'. app-service는managed-identity만/local은azure-cli만. 자동credentialchain탐색금지.
- test는APP_TEST_MODE/SQLguard와http://127.0.0.1:<생성port>/boardtest/account boardtest/container board-test-<32hex>/랜덤base64 key를확인한다. 다른http/외부host/운영endpoint와test혼합거부. @azure/storage-blob12.34.0/@azure/identity4.14.1/sharp0.35.5/testcontainers12.2.1 exact pin. Blob client serviceVersion=2023-11-03으로기본CRUD호환고정.

## Implementation

### I01. 배포 검증 도구와 호환 baseline
- Related Files:
  - board/scripts/verify-live-media.ts :: verifyLiveMedia — 운영QA전용; new
  - board/scripts/verify-live-media.ps1 :: DPAPI→stdin wrapper; new
  - board/package.json :: verify:live-media; modify
  - board/tests/live-media-api.spec.ts :: verifier의격리smoke; new
  - board/scripts/verify-live.ts :: 기존새DTO/본문호환 유지; read-only
  - board/src/lib/server/media-cleanup.ts :: trustedCLI용assetIds선택필터; modify
  - .github/workflows/board-azure.yml, board/scripts/check-workflow.mjs :: 필요시미디어환경/검증갱신; modify
#### Details
- **Signatures & Types**:
```typescript
type LiveMediaCheck={url:string;expectedCommit:string;allowQaWrites:boolean;expectEditorEnabled:boolean};
type LiveMediaResult={deployedCommit:string;checks:string[];remainingQaPostIds:number[];remainingQaAssetIds:string[]};
verifyLiveMedia(input:LiveMediaCheck,dependencies:{adminPassword:string;operatorPool:ConnectionPool;store:BlobStore;restart:()=>Promise<void>}):Promise<LiveMediaResult>;
```
- **Data & Schema Fields**: QA prefix='[editor-check:<UUID>]', nickname deploy-check,own ids/asset/session/file는프로세스메모리에서추적. 관리자pw는stdin만, DPAPI wrapper가기존%LOCALAPPDATA%/VibeBoard/azure-prod.dpapi에서복호화해pipeline전달한다. passwd를argv/env/trace에넣지않는다. 실행기록은URL/배포SHA/ActionsURL/검사이름/own잔여id만허용.
- **Execution Flow / Logic**:
  1. 스크립트를먼저완성하고loopback SQL+Azurite에서smoke검증. HTTPS외URL은assertTestDatabase/assertMediaTestStorage와정확한3100origin일때만허용한다. 시간조작/작은용량limit를운영HTTP에노출하지않는다.
  2. 현재featurebranch전부type/lint/test/build/Linux artifact검증,origin/main새이력fetch/안전통합,git diff/ls-files/이력과ZIP에서.env·DB·key·실제비밀값·루트도구제외확인. 미커밋next-env는보존. 강제push/브랜치삭제금지.
  3. featurebranch의준비커밋/원격push/필요한PR CI는허용하며PR에Azure/운영데이터를주지않는다. GCM/API인증은기존configure-github/github-release도구패턴을재사용하고토큰출력금지. 기존main자동배포는아직실행하지않는다.
  4. Azure blob/IAM/TLS/retention7·인스턴스1/SQLBasic2GB 확인, 실제 APP_VERSION/host를 읽는다. .deploy/compat-schema4/board.zip과 release.json의 SHA256/코드 버전 및 Azure CLI 관리 권한을 먼저 확인한다. EDITOR_FEATURE_ENABLED=0/MEDIA_CLEANUP_ENABLED=0을 명시하고 전체 준비가 끝난 때에만 운영 db:migrate2회→provision:sql→verify:sql-access(schema4)를 실행한다. 기존 글의 id/날짜/content/해시 비교는 운영자 메모리에서만 하며 글0개를 가정하지 않는다.
  5. 바로feature를main에정상통합/commit/push하고실제Actions verify→artifact→OIDC→ZIP→health schema4/versionSHA일치까지기다린다. 현재OIDC는 repo:YIH151515@355682187/vibe_webapp@1456296194:ref:refs/heads/main. SQL3이전 health와4전환사이잠깐503은전환시간으로기록하고장기간중간상태에서Task를종료하지않는다.
  6. flag0 baseline에서 plain 공개 읽기/작성 호환, rich쓰기·upload503, 임시파일 비공개와 managed identity 역할/설정을 검증한다. 실제 런타임 Blob put은 flag1의 다음 QA에서 확인한다. 검증된 ZIP/release.json/SHA/성공 run을 schema4 minimum rollback으로 보관한다. schema3 ZIP을 선택하지 않는다. GitHub artifact 보존14일이며 baseline은 만료 전에 안전하게 보관한다.
  6a. migration 후 CI/OIDC/배포가 실패하면 DB를 되돌리지 말고 준비된 .deploy/compat-schema4/board.zip을 az webapp deploy --resource-group rg-vibe-board-prod --name app-vibe-board-prod-7b1417 --src-path .deploy/compat-schema4/board.zip --type zip --output none 으로 복구한다. flag0/APP_VERSION=그 manifest commit을 적용하고 health/일반글을 회복한 뒤 원인을 해결한다. 이 수동 회복을 최종 Actions 성공으로 대체하지 않는다.
  7. 그다음EDITOR_FEATURE_ENABLED=1/MEDIA_CLEANUP_ENABLED=1로바꾸고실제serverruntimeflag/health을확인한다. 서버config는dynamic,no-store이므로flag를clientbuild에NEXT_PUBLIC으로bake하지않는다. 기존B1/SQL가격등급변경으로문제를숨기지않는다.

### I02. 실제 공개 이미지 검증과 제한된 정리
- Related Files:
  - board/scripts/verify-live-media.ts :: own QA scenarios; new
  - board/tests/editor.spec.ts, media-api.spec.ts, live-media-api.spec.ts :: 운영시나리오의격리선검증; modify
#### Details
- **Signatures & Types**: runMediaCleanup 옵션에assetIds?:string[]를추가할때trustedCLI/테스트에서만사용하며기본worker와동일상태/시간/lease규칙을유지한다. 운영검증은자신이생성한UUID목록을넘기고다른이미지를sweep하지않는다.
- **Data & Schema Fields**: 문서/업로드API는위계약. live출발지의기존제한윈도우를읽기검사하고여유가없으면자연만료까지기다리거나정확한Retry-After을보고한다. counter을초기화하지않는다. 이미지검증자체는글최대3개/이미지최대5개/세션최대5개로설계해기존verify-live의5글전체시나리오와연달아돌리지않는다.
- **Execution Flow / Logic**:
  1. root/실제CSS/healthversion/editor-config/기존plain보여짐을읽기검사한다. 실제운영글을수정테스트로사용하지않는다.
  2. 자신의신규QA글에로컬생성PNG/JPEG를file선택/붙여넣기·drop중적어도한경로로업로드, 서식·이미지·검색텍스트·날짜·새로고침을검사한다. 별도격리E2E에서는세입력방식을모두검사한다. assetURL은앱경유, Blobanonymous직접403, draft공개404이어야한다.
  3. 자신의다른QA글/다른session로이미지참조를옮기는시도409/원문무변경, 타인token·잘못된password·다른Origin·이미지위장/상한검사를필요한최소회수로확인한다. private token/원문IP와이미지파일은기록하지않는다.
  4. 글을수정하며기존이미지유지/제거/새이미지추가, 제거파일appGET404/삭제outbox와charge보류을검사한다. ownfiltercleanup후AzureSoftDelete의해당 Blob 이름에대해deleted marker를제한조회하여7일보존설정을확인한다. 실제로7일을시간조작하거나복원DB를만들지않는다.
  5. 별도ownQA이미지글을남긴채az webapp restart→healthversion/config→동일post/이미지bytes/서식/세션·제한보존을검증한다. Chromium1280/390px에서툴바/긴문장/이미지크기/검색/수정/비밀번호안내/관리자삭제를확인한다.
  6. 관리자쿠키로동의없는삭제400→ownQA관리자삭제204→관련app이미지404→owncleanup,outbox/soft-deletecharge정상→logout/이전 cookie401. 중간실패도finally에서ownid+UUID가일치하는것만작성자/관리자경로로정리한다. 미정리id와안전한방법만표시하고계획을완료로하지않는다.
  7. 임시서버/테스트컨테이너을정리하고AppService는Running유지. 실제sourceheaders의위조방지는기존계약을유지하며업로드token도동일HMAC출발지에묶이는점을확인한다. 실제429가생기면범위/만료시간을KST로안내한다.

### I03. 운영 인계·commit·포인터 완료
- Related Files:
  - board/docs/images-runbook.md, board/docs/azure-runbook.md, board/README.md :: 실제증거/복구/비용; modify
  - .memory/plans/2026-11-16-rich-editor-images.md 및 해당phase/task/current :: 완료; modify
#### Details
- **Signatures & Types**: 완료기록에는실제URL/호환baseline SHA/artifact해시/성공Actions run/활성flag/이미지저장계정·컨테이너·roleScope/cleanup집계/QA정리만허용한다.
- **Data & Schema Fields**: 삭제된ownQA바이너리는7일soft-delete로보존될수있으며occupied_bytes에도남는다. 이를물리파일전부즉시삭제되었다고보고하지않는다. DB복원시Blobundelete대상과asset.metadata 상태를함께확인하는절차, 1GiB업로드만중단·기존글계속, 과금목표와실제제한차이를문서화한다.
- **Execution Flow / Logic**:
  1. 비용·로컬운영SQL/Blob공유·자격증명/역할/운영cleanup·임시24h/soft7일·장애재시도·safe CLI를기록한다. 토큰/파일명/이미지dump/암호를운영기록에넣지않는다.
  2. 롤백은schema4호환baseline ZIP+SHA검증·flag0에서rich쓰기중지·기존문서읽기유지, 동일metadata/Blob를보존한다. 이전schema3로되돌리거나DB를초기화하지않는다.
  3. 최종검증성공후아래완료commit, Taskdone/phase3/3/전체7/7/current completed를동기화한다. 완료문서만 있는 commit은기존paths제외로재배포하지않는다. 완료HEAD와실제배포SHA가다르면명확히구분한다.


## Acceptance Criteria
- [ ] 실제 main Actions/health SHA와 schema4 flag0 baseline·flag1 활성화가 일치하고 런타임 private Blob 접근이 성공한다.
- [ ] 자기 QA로 서식·이미지·수정·검색·재시작·관리자 삭제·출발지/소유권을 검증하고 다른 운영 글은 변경하지 않았다.
- [ ] QA 글·노출 이미지·삭제 작업 정리를 확인하고 soft-delete7일 보존 용량/재시도와 실행 중 App 상태를 기록했다.
- [ ] 운영·비용·복구·비밀 없는 증거 및 전체7/7 completed 포인터가 실제 상태와 일치한다.
- [ ] 기존 동작 회귀와 아래 Validation이 모두 통과하고 비밀·사용자 변경이 stage되지 않았다.

## Validation
- `npm run test:all` — 새 변경을 포함한 전체 회귀 성공.
- `npm run typecheck` — 성공.
- `npm run lint` — 성공.
- `npm run build` — 성공.
- `npm run verify:azure` — Linux 패키지 검증 성공.
- node scripts/check-workflow.mjs — 기존OIDC/최소권한/PR격리동작유지.
- `./scripts/provision-images.ps1 -Mode Verify` — 실제 Blob 정책/역할 검증 성공.
- `npm run verify:sql-access` — schema4 제한 SQL 계정 검증 성공.
- ./scripts/verify-live-media.ps1 -Commit <실제배포40hexSHA> — stdin인증/공개자기QA검증·정리성공.
- GitHub Actions 실제run과 /api/health.version, editor-config활성flag 일치.
- git diff --check / git status --short — source커밋완료/무관변경보존/secret배제.

## Commit Message
```text
deploy(board): publish and verify rich editor image uploads

Plan: 2026-11-16-rich-editor-images
Phase: P02-editor-delivery
Task: T03-live-release

- schema4 호환 릴리스와 실제 이미지 게시·수정·재시작·삭제·정리를 검증하고 운영 안내와 전체 completed 상태를 남긴다.
```

## Progress
- [ ] 구현 완료
- [ ] 검증 통과
- commit: pending

## Next Task
없음. 공개 QA와 안전한 정리 후 전체 completed.

## Execution Notes
- 릴리스 준비: rich payload에서 중복 평문 content를 제외하고9,000자/교차서식 문서 수정 회귀를 추가했다. JSON64KiB 한도는 유지한다.
- verify-live-media 도구와 DPAPI→stdin wrapper를 구현했다. 격리 smoke에서 실제 Chromium과 SQL/Azurite로 own QA·수정·관리자·정리를 검증했다.
- 전체93개(서비스54/API18/E2E21), typecheck/lint/workflow 검사 통과. 운영 SQL 전환/Actions/실제 Blob 검증은 아직 완료 전이며 이 준비 커밋으로 완료를 주장하지 않는다.
