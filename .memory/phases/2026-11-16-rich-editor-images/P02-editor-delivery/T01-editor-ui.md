# Task: T01 Tiptap 작성·수정과 이미지 저장 UX

## Status: done

## Goal
PC와 모바일에서 서식/이미지를 편집해 저장하고 기존 plain 글과 실패 시 초안을 잃지 않으며 안전한 상세를 표시한다.

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

### I01. Tiptap 에디터와 안전한 상세 렌더러
- Related Files:
  - board/src/components/rich-editor.tsx :: RichEditor — 클라이언트편집; new
  - board/src/components/editor-toolbar.tsx :: EditorToolbar — 한국어버튼; new
  - board/src/components/rich-content.tsx :: RichContent — React요소상세; new
  - board/src/lib/posts/editor-document.ts :: editor draft/저장직렬화; new
  - board/src/components/post-form.tsx :: PostEditor — 본문분리/feature gate; modify
  - board/src/components/post-detail.tsx :: plain/rich분기; modify
  - board/src/app/globals.css :: editor/toolbar/rich-content; modify
  - board/src/app/api/editor-config/route.ts :: GET — runtime flag/한도; new
  - board/package.json, package-lock.json :: Tiptap exact deps; modify
#### Details
- **Signatures & Types**:
```typescript
type DraftImage={draftId:string;file:File;previewUrl:string;alt:string;uploaded?:ImageAssetDto;uploadedSessionToken?:string};
type EditorDraft={json:JSONContent;images:Map<string,DraftImage>};
RichEditor(props:{initial:RichDocument;disabled:boolean;onChange:(draft:EditorDraft)=>void;errorId?:string}):React.JSX.Element;
RichContent(props:{document:RichDocument}):React.JSX.Element;
serializeForSave(draft:EditorDraft):RichDocument;
GET():Promise<Response>; // {enabled:boolean,maxFileBytes:5242880,maxImages:5,maxInputBytes:20971520}
```
- **Data & Schema Fields**: 위 문서/DTO/API 계약. npm exact @tiptap/core/@tiptap/pm/@tiptap/react/@tiptap/starter-kit/@tiptap/extension-image 모두3.34.0. React19peer지원확인값이다. 이Task에서는NodeSDK를클라이언트에import하지않는다.
- **Execution Flow / Logic**:
  1. useEditor는client component/immediatelyRender:false,커스텀한국어툴바+StarterKit. heading2/3만,code/codeBlock/horizontalRule비활성. StarterKit3에이미있는link/underline/history를중복추가하지않는다. link는openOnClick:false와공통URL검사를적용한다.
  2. 에디터내image attrs는assetId/draftId/alt/previewUrl를허용할수있으나서버로보낼때정확히assetId/alt만직렬화한다. Tiptap가자동생성한link target/rel/class:null, orderedList type:null 등은허용되는canonical필드만추출하여전달한다. 알수없는실제문서노드를침묵삭제하지말고저장오류로표시한다.
  3. 파일선택/drop/clipboard-image는같은추가기능을사용한다. format/5MiB/5장/20MiB를먼저검사하고초과는기존본문유지/명확한오류. 외부HTML의img자동수집을차단한다. 업로드는아직하지않고ObjectURL로preview. 이미지alt선택적200자,선택이미지제거/위·아래이동버튼으로키보드정렬지원.
  4. RichContent는허용노드별React switch/textchildren만사용한다. image src=/api/images/<assetId>,alt,loading=lazy,width/height는문서에서임의style로받지않는다. plain은기존.post-content 문자열/pre-wrap유지,rich는white-space:normal/img max-width100%/height:auto/긴링크wrap.
  5. editor-config는Node/force-dynamic/no-store/환경flag만읽고DB/Blob접속없음. PostForm은설정로딩중기다린다. flag0일때plain입력은기존textarea,rich수정은안내와읽기전용문서(삭제링크유지),flag1일때신규/수정모두에디터.
  6. 본문label은role=textbox/aria-multiline/editorid를연결,오류aria-describedby/aria-invalid,툴바button type=button/aria-label/aria-pressed. 한글composition중문서교체/성급한글자수자르기/blur를유발하지않는다. character상한은공통schema로최종검증한다.

### I02. 저장 시 업로드 pipeline·실패 재시도
- Related Files:
  - board/src/lib/client/media-api.ts :: issue/upload/cancel; new
  - board/src/lib/client/api.ts :: PostInput/JSONcaller호환; modify
  - board/src/lib/client/validation.ts :: editor본문검증; modify
  - board/src/components/post-form.tsx :: submit — 세션/업로드/본문원자저장; modify
  - board/tests/editor.spec.ts :: PC/390·IME/미디어flow; new
  - board/tests/board.spec.ts, admin.spec.ts :: 본문입력selector/기존기능; modify
#### Details
- **Signatures & Types**:
```typescript
issueUploadSession(input:{postId?:number;password?:string},signal?:AbortSignal):Promise<{token:string;expiresAt:string}>;
uploadImage(file:File,token:string,idempotencyKey:string,signal?:AbortSignal):Promise<ImageAssetDto>;
cancelUploadSession(token:string,signal?:AbortSignal):Promise<void>;
```
- **Data & Schema Fields**: FormData를 사용하되 Content-Type은 직접 지정하지 않고 브라우저 boundary를 사용한다. Authorization/Idempotency-Key header만 사용, fetch same-origin credentials. token/Files/previewURL은 React memory/ref에만 보관한다. secret/token을 localStorage/sessionStorage/URL/analytics에 전달하지 않는다.
- **Execution Flow / Logic**:
  1. title/nickname/password·문서초안을검증한후신규이미지가있을때만세션발급. edit이면postId/password전달해기존권한검사. 직전의유효session/동일draftfile은같은idempotencyKey로재시도하고이미uploaded인파일은재전송하지않는다.
  2. 최대5개를순차upload,진행상태aria-live표시/submit중복방지. ready이미지의서버URL은게시전404이므로화면의ObjectURLpreview를저장완료까지유지한다. 모든새image에assetId가생긴후serialize/normalizeDocument로검사→create/update(document,token).
  3. 새파일이없고기존첨부만편집하는경우token불필요. 중간실패시문서/File를유지,비밀번호만초기화하고기존ApiError 400/401/403/409/413/415/429/503 메시지·재시도시간표시. 만료/취소/선택집합변경으로기존세션을재사용못하면새세션/새idempotency키로현재선택파일만다시올린다.
  4. 에디터에서파일제거시ObjectURL을해제하고submitted되지않은asset은기존session의미사용파일로남겨최종consume/취소/24h정리한다. 취소/언마운트는AbortController로요청중단+best-effort세션취소,토큰만료경쟁401은UX전체오류로확대하지않는다. 서버cleanup이최종보장이다.
  5. 성공시비밀번호/Files/session/previewURL정리후기존 router.push상세로이동한다. 생성날짜/작성자비밀번호/관리자UI동작유지.
  6. 테스트는파일선택·PNG붙여넣기·drop·5장초과·큰파일·손상응답·최초실패후재시도·동일파일중복전송방지·취소ObjectURL해제·기존plain수정변환·다른postasset거부·직접HTML스크립트비실행·PC/모바일/keyboard/한글composition을확인한다. page.getByLabel(/^본문/)가textarea라고가정한기존테스트는textbox locator로갱신하고plain fallback도별도검사한다.


## Acceptance Criteria
- [x] 서식·이미지가 PC1280/모바일390에서 새로고침·수정 후 유지되고 기존 plain 글의 줄바꿈과 검색이 보존된다.
- [x] 선택/drop/paste·한글 IME·키보드·파일 한도·진행 표시·오류 재시도·ObjectURL 정리를 검증했다.
- [x] 임시 preview URL과 token이 저장 문서/URL/storage에 섞이지 않고 실제 업로드는 저장 시에만 실행된다.
- [x] 기존 동작 회귀와 아래 Validation이 모두 통과하고 비밀·사용자 변경이 stage되지 않았다.

## Validation
- npm run test:all — 기존회귀+editor/IME/drop/paste/retry/ownership/UI 성공.
- `npm run typecheck` — 성공.
- `npm run lint` — 성공.
- `npm run build` — 성공.
- npm run verify:azure — Tiptap client정적파일/native/독립runtime 검증 성공.
- git diff --check — 성공.

## Commit Message
```text
feat(board): replace textareas with an accessible rich image editor

Plan: 2026-11-16-rich-editor-images
Phase: P02-editor-delivery
Task: T01-editor-ui

- PC와 모바일에서 서식/이미지를 편집해 저장하고 기존 plain 글과 실패 시 초안을 잃지 않으며 안전한 상세를 표시한다.
```

## Progress
- [x] 구현 완료
- [x] 검증 통과
- commit: pending

## Next Task
P02-editor-delivery/T02-azure-storage.md

## Execution Notes
- 검증: test:all90개 후 기존 plain 변환 경계와 HTML paste를 추가하여 test:e2e20개 성공(서비스54/API17/E2E20 총91개), typecheck/lint/build/verify:azure/diff check 통과. PC1280/390 화면을 직접 확인했다.
- PostEditor를 별도 post-editor.tsx로 분리해 초기 게시글 loading과 편집/업로드 상태를 분리했다. 선택 파일/토큰/URL은 memory/ref만 사용한다. 파일은 저장 시에만 순차 업로드하며 실패 후 이미 완료한 파일을 재전송하지 않는다.
- successful JSON의 media/session DTO도 검증하여 잘못된 200 응답을 업로드 cache에 저장하지 않는다. src/previewUrl/draftId/토큰은 canonical 문서에서 제거한다.
- 이미지 제거 시 ObjectURL을 해제하고 Undo에서는 memory File로 새 URL을 만든다. 명시적 이미지 편집은 closeHistory로 분리한다. 외부 HTML 이미지 parsing/input rule은 차단했다.
- 공유 isSafeLink를 server allowlist와 toolbar에 함께 사용한다. 기존 이미지의 원본 크기는 client DTO에 없으므로 server의 20MiB 초과 409 메시지도 명확하게 했다.
- 파일 input의 숨김 CSS와 기존 textbox selector를 보강했다. StarterKit 내장 link/underline/history를 중복 설치하지 않았다. 운영 미배포/SQL 미변경.
