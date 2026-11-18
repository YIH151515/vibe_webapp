# Task: T03 글·미디어·관리자 서버 권한 전환

## Status: done

## Goal
직접 API와 이미지 요청까지 실제 앱 세션을 요구하고, 기존 비밀번호 대신 SQL 계정 소유권으로 글/업로드를 원자적으로 관리한다.

## Decision Summary
- tenant69c1e470-4528-435a-a1ae-de98e0aac738의 Member만 접근. Board.Admin만 타인/legacy 삭제, 타인 수정은 관리자도 금지.
- DTO·서비스·모든호출부·service/API fixture를 한 번에 전환한다. UI 입력 제거와브라우저회귀는다음Task이며 이Task에서UI는새타입에맞는최소호출수정만한다.

## 실행 맥락과 이전 기반
- Plan2026-11-18-entra-id-login, feature/entra-id-login, cwd D:/vibeweb/board, Node24/Next16/TS strict. 자동테스트전용SQL/Azurite/fakeOIDC만 사용/.env.local미사용. 운영 SQL/Entra/Azure/main 변경금지. 사용자next-env/3000/Dockerpad/루트도구보존·명시파일만stage.
- schema5: board_users(tenant_id,object_id PK,display_name1..256); auth_sessions(id_hash64hex PK,tenant_id,object_id,display_name,is_admin,app_origin,client_id,created_at,expires_at,revoked_at); posts author_tenant_id/author_object_id nullable pair FK board_users, nicknameNVARCHAR256, ownerNULL이면기존password_hash NOT NULL/ownerNOT NULL이면password_hash NULL. upload_sessions owner_tenant_id/owner_object_id/auth_session_hash nullable all-or-none, auth FK NO CASCADE; 계정업로드author_hash NULL. 기존 media원장/job/lease/soft7일 유지.
- Principal={tenantId:string;objectId:string;displayName:string;isAdmin:boolean;sessionHash:string;expiresAt:Date}, SessionDto={displayName,isAdmin,expiresAt:ISO}. authconfig AUTH_MODEmaintenance|entra, defaultmaintenance; entra설정검증/SQL readAppSession 후만principal발급. cookieprod __Host-board_session/localboard_session opaque64hex이며 DBhash만저장. app_origin/client_id/tenant/expiry/revoked 검증필수.
- 락 순서는 capacity→auth_session→upload_session→post→asset. auth-session.assertSessionInTransaction(tx,principal,requireAdmin?)는 SQL 현재세션/역할을 UPDLOCK,HOLDLOCK으로 다시확인한다. revokeAppSession은동일capacitytransaction으로앱세션취소+해당업로드cancel+미attachedasset outbox를처리한다.

## Implementation

### I01. API principal gate와 DTO
- Related Files:
  - board/src/lib/server/auth-http.ts :: requireApiPrincipal/requireActivePrincipal; modify
  - board/src/lib/auth/types.ts :: SessionDto; read-only
  - board/src/lib/posts/types.ts :: PostInput/Post/PostSummary; modify
  - board/src/lib/server/validation.ts, board/src/lib/client/validation.ts :: 새Post입력검증; modify
  - board/src/app/api/posts/route.ts, posts/[id]/route.ts :: read/write gate; modify
  - board/src/app/api/editor-config/route.ts, images/[id]/route.ts, images/uploads/route.ts, upload-sessions/route.ts, upload-sessions/current/route.ts :: 모든 진입점; modify
#### Details
- **Signatures & Types**:
```typescript
requireApiPrincipal(request:Request):Promise<Principal>;
requireActivePrincipal(pool:ConnectionPool,principal:Principal):Promise<void>;
type PostInput={title:string;content?:string;document?:RichDocument|null;uploadSessionToken?:string};
type NormalizedPostInput={title:string;content:string;contentFormat:'plain'|'rich_v1';document:RichDocument|null;uploadSessionToken?:string};
type PostSummary={id:number;title:string;nickname:string;createdAt:string;canEdit:boolean;canDelete:boolean};
type Post=PostSummary&{content:string;contentFormat:'plain'|'rich_v1';document:RichDocument|null};
type PostMutationContext={principal:Principal;clientKey:string};
```
- **입력**: title1..100/content1..10000 또는기존RichDocument validation/JSON64KiB유지, document있으면서버추출content권위값, uploadSessionToken64hex. 허용키title/content/document/uploadSessionToken만. password/nickname/author_* 등클라이언트identity 필드400으로거부. 서버는검증된principal.displayName을생성글 nickname에저장하고수정시기존게시작성자표시/날짜를보존한다.
- **HTTP 순서**: requireApiPrincipal→strict Origin(모든변경requireOrigin:true)→id/body검증→service. 미로그인/없는·만료·취소cookie401/UNAUTHENTICATED, 역할/owner403/FORBIDDEN, 없는글404, malformed400/413/415, conflict409기존코드, 설정/maintenance/SQL503. 만료cookie를익명쓰기fallback으로취급하지않는다. proxy헤더·X-MS-CLIENT-PRINCIPAL/bodyclaim 무시. API는HTMLredirect대신ErrorBody/no-store, HEAD이미지도같은status/헤더에서body없음.
- **읽기**: requireActivePrincipal은sessionHash로 현재DB 세션·origin/client/expiry를재확인해프로그램직접서비스호출도실세션필수. canEdit=ownerpairNOTNULL+현재tid/oid일치, canDelete=canEdit||현재isAdmin. 내부tenant/oid/hash/role 원문은글DTO에추가하지않는다. PostPage 기존 total/page/pageSize20/q 계약유지.
- **quota**: getAccountKey(principal)=HMAC RATE_LIMIT_KEY_SECRET(JSON ['board-user-v1',tid,oid]); HTTP외부에서전달받지않는다. 글5/600초·세션5/600초·파일20/600초·50MiB 기간유지, 서로다른계정같은IP는독립/동일계정다른session·IP는공유. 익명OIDC로그인은기존신뢰IP기반oidc-login10/600초. 기존post-password/admin-login rate행은초기화하지않고더이상새권한에사용하지않는다.

### I02. 글 변경과 삭제의 SQL 권한
- Related Files:
  - board/src/lib/server/posts.ts :: PostService/createPostService/row DTO; modify
  - board/src/lib/server/post-media.ts :: persistPostWithMedia/deletePostAndDetach; modify
  - board/src/lib/server/post-authorization.ts :: 비밀번호 경로 제거/owner helper; modify
  - board/src/lib/server/admin.ts, admin-http.ts :: Board.Admin 삭제; modify
  - board/src/app/api/admin/login/route.ts, logout/route.ts, session/route.ts, posts/[id]/route.ts :: 기존우회폐쇄; modify
#### Details
- **Signatures & Types**:
```typescript
interface PostService {
 list(input:{q:string;page:number},principal:Principal):Promise<PostPage>;
 get(id:number,principal:Principal):Promise<Post>;
 create(input:PostInput,context:PostMutationContext):Promise<Post>;
 update(id:number,input:PostInput,context:PostMutationContext):Promise<Post>;
 remove(id:number,input:{confirm:true},principal:Principal):Promise<void>;
}
persistPostWithMedia(pool:ConnectionPool,id:number|null,input:NormalizedPostInput,context:PostMutationContext):Promise<Post>;
deletePostAndDetach(pool:ConnectionPool,id:number,principal:Principal,asAdmin?:boolean):Promise<void>;
deletePostAsAdmin(pool:ConnectionPool,id:number,principal:Principal):Promise<void>;
```
- **생성/수정**: mediaTransaction의capacity뒤assertSessionInTransaction. 생성은principal의userFK+nickname+password_hashNULL, 수정은ownerpair일치SQL WHERE가최종권한이며이전name/created_at은유지한다. legacy ownerNULL는403, 타인403(관리자도동일). 기존비밀번호해시·author_hash 조건으로비교하지않는다. parsePostInput과service에서필요한동일검증을유지하되비밀번호해싱호출제거.
- **삭제**: 본인DELETE /api/posts/{id} JSON{confirm:true}, owner일치필수. 관리자DELETE /api/admin/posts/{id} JSON{confirm:true}, DBsession.is_admin을같은transaction에서재검증. missing404/미동의400/권한403. parent삭제와 active sessioncancel/assetoutbox는기존capacity락순서와원자성을보존한다. 관리자도본인아닌글수정endpoint는없다.
- **기존admin인증**: board_admin쿠키/ADMIN_PASSWORD_HASH/ADMIN_SESSION_SECRET로권한을얻는함수·publicexports를제거한다. 기존POST /api/admin/login, /logout은새앱세션게이트후404 NOT_FOUND JSON으로폐쇄하고맞는비밀번호도인증불가. /api/admin/session은현재앱세션+관리자역할확인 후SessionDto200/일반계정403. 실제logout은/api/auth/logout만. legacyadmin_sessions와비밀설정자료를운영DB에서삭제하지않는다.
- **권한race**: service에서한차례owner확인했다는이유로transaction내조건을생략하지않는다. 앱세션취소/만료·역할회수SQL값과글삭제/업로드완료경합을테스트한다. 생성/수정결과DTOpermission은현재검증한principal에서산출한다.

### I03. 업로드/이미지/정리의 인증
- Related Files:
  - board/src/lib/server/upload-sessions.ts :: parse/issue/read/cancel; modify
  - board/src/lib/server/media-service.ts :: createMediaService/uploadImage의 principal; modify
  - board/src/lib/server/published-images.ts :: getPublishedImage의 principal와private캐시; modify
  - board/src/lib/server/media-cleanup.ts :: 기존worker/GC호환; modify if required
  - board/src/lib/client/api.ts, media-api.ts, admin-api.ts :: 새계약에맞는함수type만전환; modify
  - board/src/components/post-editor.tsx, post-detail.tsx, post-form.tsx, delete-post-form.tsx, admin-panel.tsx :: type오류를없애는최소호출조정; modify
#### Details
- **Signatures & Types**:
```typescript
issueUploadSession(pool:ConnectionPool,principal:Principal,input:{postId?:number}):Promise<{token:string;expiresAt:string}>;
readUploadSession(pool:ConnectionPool,token:string,principal:Principal):Promise<{id:string;expiresAt:Date;targetPostId:number|null;ownerTenantId:string;ownerObjectId:string;authSessionHash:string}>;
cancelUploadSession(pool:ConnectionPool,token:string,principal:Principal):Promise<void>;
uploadImage(request:Request,principal:Principal):Promise<{status:200|201;asset:ImageAssetDto}>;
getPublishedImage(pool:ConnectionPool,store:BlobStore,id:string,request:Request,principal:Principal,headOnly?:boolean):Promise<Response>;
```
- **발급/인증**: POST /api/upload-sessions body{} 또는{postId}, unknownpassword400. 세션15분/기존count/input/capacity보존. auth_session_hash=currentprincipal.sessionHash 및 ownerpair를 기록하고client_key는계정키. postId있으면같은transaction에서원글소유권검사(legacy/타인403). 다른계정·같은계정다른앱세션·legacytoken·만료·로그아웃token은401, 같은유효앱세션의cancel재전송은204. consume/cancel상태계약은유지한다.
- **업로드 전체**: 최초body검증전앱인증. 매 SQL phase/reservation/write-started/finalize/replay에서같은active앱세션/owner/upload상태를재검증, deadline/compensation/outbox/5MiB보수예약/sharp병렬2·시간제한유지. 이미시작한Blob쓰기는로그아웃후완료되어도ready로부활시키지않고삭제outbox에남긴다. response lost retry key/SHA idempotence는동일세션에서만동작한다.
- **최종글연결**: 새readyasset은해당account+appsession+target post의현재uploadsession에서만가져온다. retained attachedasset은현재수정글에속하면과거로그인세션이발급한것이어도유지가능. 타인글/다른draft session참조409, SQL미디어원장기존정합성유지.
- **공개이미지→사내이미지**: requireActivePrincipal을UUID/부모SQL/Blob/ETag전에호출. 로그인Member는모든게시이미지읽기가능, draft/deleting/없는부모404. Cache-Control:'private,no-store', nosniff/imagewebp/ETag/ContentLength유지. 인증+현재SQL상태확인후에만If-None-Match304, 미로그인conditional/HEAD도401no-store. Range는여전히전체200. 로그아웃후공유cache로이미지반환하지않는다.
- **cleanup**: worker는trusted내부실행이며사용자세션없이계속작동한다. legacydraft도기존24h/expiry규칙으로정리. 앱세션expire가첨부이미지삭제사유는아니다. 삭제상태/7일charge보류/늦게나타난파일/outbox/GC/assetIds trusted filter를보존한다. auth_session FK를지우려고upload를임의sweep하지않는다.

### I04. 전체 호출부와 테스트 전환
- Related Files:
  - board/tests/helpers/auth-fixture.ts, sql-fixture.ts, media-fixture.ts, client-fixture.ts :: 실제테스트세션/actor일관성; modify
  - board/tests/service.test.ts, media.test.ts, media-cleanup.test.ts, admin.test.ts, security.test.ts :: 새서비스signature/권한/기존수명회귀; modify
  - board/tests/api.spec.ts, admin-api.spec.ts, media-api.spec.ts, auth-api.spec.ts :: 직접401/403/owner/DTO; modify
  - board/tests/authorization.test.ts, authorization-api.spec.ts :: 교차계정·race·legacy; new
  - board/tests/helpers/authenticated-live-check.ts :: 격리환경전용계정API통합검증; new
  - board/tests/live-api.spec.ts, live-media-api.spec.ts :: obsolete password verifier 호출을새API통합검증으로교체; modify
  - board/tests/board.spec.ts, editor.spec.ts, admin.spec.ts :: 새로운seed/DTO signature에필요한타입수정만; modify
#### Details
- TestActor는같은test의request/browser에공유하되appsession별opaquecookie는별도발급가능. 일반기능APIfixture는guard된createAppSession을사용, auth protocol tests만issuer로그인한다. anonymous전용context는쿠키없는별도객체로만든다. fixtureendpoint/header를app에추가하지않는다.
- seedPosts는principal/context필수, 기존비회원seed는격리DB에서만SQLparameter로ownerNULL/passwordhash를직접넣는seedLegacyPosts함수로분리한다. 운영스크립트나앱요청에legacy쓰기우회를만들지않는다.
- tests: Alice/Bob/Admin/legacy/read/write/delete·UIpermissionDTO·같은이름다른oid·1/21/256자Entra이름·이름변경소유권유지·JWT/header/bodyidentity위조·로그아웃중put·병렬delete/attach·quota다른계정동일IP/같은계정다른IP·drafttoken세션결합·conditional이미지401·SQLfault503·password/admincookie우회불가.
- 삭제된비밀번호기능의옛검증은newaccount권한검증으로교체하되본문/서식/SQL LIKE리터럴·페이지/작성일/에러/이미지변환·capacity/outbox/보존·관리자동의회귀를삭제하지않는다. 아직UI전환전이므로브라우저전체는다음Task에서검증하며현재모든TS파일은새DTO로컴파일되어야한다.
- 기존test:api는live-api.spec.ts/live-media-api.spec.ts도실행한다. 이들이옛password/admincookie 검증자를호출한채남으면항상401로실패한다. 이번Task에서격리전용 verifyAuthenticatedApi(input:{pool:ConnectionPool;store:BlobStore;request:APIRequestContext;anonymous:APIRequestContext;principal:Principal}):Promise<{checks:string[]}> helper로교체해ownprefix글생성/수정/업로드/권한/관리자동의/삭제·cleanup·logoutreplay를검증한다. helper첫줄에SQL/Azurite/fakeissuer guard, production URL거부, 현재자체ID만정리한다. 원래미디어/재시도/원장검사대신단순smoke로줄이지않는다. 실제회사SSO/화면/운영restart검증자를만드는것은다음Task다.
- E2E파일은아직브라우저assertion을완료했다고보고하지않지만typed seedPosts의추가principal인자/제거된PostInput필드에따른컴파일오류는지금고친다. 테스트파일을tsconfig에서제외하거나any로기능검증을무력화하지않는다.

## Acceptance Criteria
- [x] 모든콘텐츠API/이미지는401/403를정확히반환하고서비스/transaction이계정권한을강제한다.
- [x] legacy보존·수정금지/관리자삭제, 계정별quota, 업로드세션/로그아웃경합과미디어수명회귀가통과한다.
- [x] 비밀번호/admincookie/identityheader/body주입우회가없고private이미지캐시·DTO비밀제외를검증했다.
- [x] 서비스/API회귀와type/lint가통과하며운영변경없음.

## Validation
- `npm run test:service`, `npm run test:api` — 모든기존/신규계정권한·race회귀통과.
- `npm run typecheck`, `npm run lint`, `git diff --check` — UI최소호출조정포함성공.
- `rg -n 'loginAdmin|authorizePostPassword|board_admin' src` — 신규권한경로에서사용0; 폐쇄테스트/명시제거호환참조만허용.
- git staged diff에서.env/사용자next-env/테스트키/루트도구제외.

## Commit Message
```text
feat(auth): enforce account ownership across board and media APIs

Plan: 2026-11-18-entra-id-login
Phase: P01-auth-core
Task: T03-board-authorization

- require active Member sessions and transactional owner or admin checks
- retire password bypasses and protect uploads, images and account quotas
```

## Progress
- [x] 구현 완료
- [x] 검증 통과
- commit: this source commit

## Next Task
P02-entra-delivery/T01-identity-ui.md. P01 completed3/3로동기화후포인터전진.

## Execution Evidence
- 서비스77/API21/typecheck/lint/diffcheck 통과. 각 테스트는 전용 SQL/Azurite/fake issuer만 사용했다.
- posts.ts/PostMutationContext는 검증된 Principal을 필수로 받으며, post-media.ts와 media-service.ts는 `assertSessionInTransaction(tx, principal)`로 각 저장 단계의 현재 SQL 권한을 확인한다. nickname/password 입력은400이며 nickname은 생성시 세션에서 가져온다.
- upload-sessions.ts는 account+auth-session에 토큰을 결합한다. 로그아웃 경합/병렬 attach-delete/원장·보존 회귀를 검증했다. 이미지 캐시는private,no-store이고 조건부 요청도 인증부터 한다.
- 알아야 할 점: capacity→auth→upload→post→asset 락 순서를 지킨다. attached 이미지와 legacy 글/비밀번호 해시는 보존한다. 실제 Entra/운영 SQL/main에는 아직 적용하지 않았다.
- 함께 처리한 인접 사항: 인증 fixture가 만드는 세션 때문에 protocol 테스트 개수 단정이 달라지는 문제는 emptySqlFixture로 분리했다. 앱 변경이나 테스트 우회는 추가하지 않았다. 범위 밖 발견 특이사항 없음. UI비밀번호 제거/운영 검증자는 다음 Task이다.
