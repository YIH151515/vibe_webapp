# Task: T01 로그인 화면과 계정 기반 작성·검증 도구

## Status: done

## Goal
비밀번호 없는 회사 계정 게시판 화면을 완성하고, 서버 보호된 페이지·이미지/권한 UI·브라우저회귀·로그인된 실제 검증 도구를 준비한다.

## Decision Summary
- 운영/로컬 모두 실제 OIDC, 사내Member만 열람. Entra이름은서버값, 본인수정/삭제와Admin삭제를DTOpermission으로표시한다.
- 로그인되지 않은 페이지에는 글을 렌더하지 않으며 API는이미401/403를강제한다. 운영 SQL/Entra/Azure/main 변경은아직하지않는다.

## 실행 맥락과 고정 계약
- Plan2026-11-18-entra-id-login/feature/entra-id-login, cwd D:/vibeweb/board, Next16.4.6/React19/Node24/TSstrict. 설치Next docs의proxy/cookies/headers/redirect/cache/logging을읽는다. 사용자3000/next-env dev경로/루트도구/SQLite/Dockerpad보호, test3100/.next-test만사용.
- 자동테스트는loopback SQL board_test_32hex/Azurite/fakeOIDC guards 및 NODE_ENVtest/APP_TEST_MODE1, .env.local/운영endpoint/실제Entra금지. 실제일반로컬은운영SQL을공유하므로임의개발identity우회금지.
- API: POST /api/auth/login(formreturnTo,Origin)→303Entra, GET callback→303safeReturnTo, GETsession→SessionDto{displayName,isAdmin,expiresAt}/401, POSTlogout→204. AUTH_MODEmaintenance(default)는보호콘텐츠503/로그인안내200/health최소계약이고entra에서만실로그인. OIDC설정오류도failclosed.
- PostInput={title,content?또는document?,uploadSessionToken?}, password/nickname주입400. PostSummary={id,title,nickname,createdAt,canEdit,canDelete}; Post는content/contentFormat/document추가. legacycanEditfalse/canDeleteAdmin만. DELETE{confirm:true}; uploadissue{}또는{postId}, 이미지private,no-store/인증후ETag.

## Implementation

### I01. 페이지 보호와 사용자 메뉴
- Related Files:
  - board/src/proxy.ts :: proxy/matcher/안전한return path/maintenance; new
  - board/src/lib/server/auth-page.ts :: requirePagePrincipal/readOptionalPageSession; new
  - board/src/app/login/page.tsx :: Entra로그인/오류/maintenance; new
  - board/src/app/(board)/layout.tsx :: authenticated Server Component gate; new
  - board/src/app/page.tsx → board/src/app/(board)/page.tsx :: 목록; move
  - board/src/app/posts/new/page.tsx → board/src/app/(board)/posts/new/page.tsx :: 작성; move
  - board/src/app/posts/[id]/page.tsx → board/src/app/(board)/posts/[id]/page.tsx :: 상세; move
  - board/src/app/posts/[id]/edit/page.tsx → board/src/app/(board)/posts/[id]/edit/page.tsx :: 수정; move
  - board/src/app/posts/[id]/delete/page.tsx → board/src/app/(board)/posts/[id]/delete/page.tsx :: 삭제; move
  - board/src/app/admin/page.tsx → board/src/app/(board)/admin/page.tsx :: 관리; move
  - board/src/app/layout.tsx, globals.css :: 사내문구/메뉴/상태반응형; modify
  - board/src/components/user-menu.tsx :: 이름/관리링크/로그아웃; new
#### Details
- **Signatures & Types**:
```typescript
requirePagePrincipal(returnTo:string):Promise<Principal>;
readOptionalPageSession():Promise<SessionDto|null>;
UserMenu({session}:{session:SessionDto|null}):React.JSX.Element;
```
- **페이지 순서**: root layout은브랜드/사용자메뉴만, optional session은표시용이며권한근거가아니다. (board)/layout에서await cookies()/requirePagePrincipal의DB유효세션검사후에만children을반환한다. 없거나만료면redirect('/login?returnTo='+encodedSafePath). 반환후RSCdata/컴포넌트캐시를사용자간공유하지않고dynamic/no-store를선언한다. client컴포넌트의API401은draft를유지하고재로그인링크를제공하며무한자동redirect/retry를하지않는다.
- **Proxy**: Node기본runtime, runtime옵션명시금지(설치Next16규칙). API는절대로그인HTMLredirect하지않고기존route게이트에맡긴다. '/','/posts/:path*','/admin/:path*' 페이지에는 클라이언트가보낸x-board-return-to를삭제/덮어쓰고request.nextUrl의pathname+search만안전한returnTo로전달한다. (board)layout도safeReturnTo로재검증. matcher는상수이며정적assets/login/api를잘못차단하지않는다. maintenance또는잘못된entra설정이면보호페이지는비밀없는HTML503/Retry-After60/no-store로응답하고SQL조회없이닫는다. Proxy만으로권한검사를끝내지않는다.
- **로그인**: 서버에서mode확인, entra면회사계정으로로그인button의same-origin POST form(returnTo hidden)만제공. username/password/MFA입력폼직접구현금지. 로그인취소/권한없음/실패를고정한국어문구로표시, query의error_description/code/state/returnTo를그대로HTML에출력하지않는다. maintenance/설정오류는준비중안내+로그인버튼비활성, 로그인페이지/CSS는빌드/DB없어도200으로열린다.
- **메뉴**: SessionDto만clientprop, oid/tid/sessionhash/token은보내지않는다. 이름+로그아웃, isAdmin일때만관리링크. POSTlogout성공시router.replace('/login')+refresh, 이전페이지돌아가도페이지/이미지API재조회에401. 회사다른앱로그아웃엔드포인트호출안함.
- **권한없는 HTML 화면**: 일반Member가/admin또는타인/legacy수정URL로오면콘텐츠없는권한안내패널만보이고입력/관리controls없다. 데이터변경의실제HTTP거부는API403으로검증한다. Next불안정experimental authInterrupts를새로도입할필요없다.

### I02. 작성/상세/관리자 UI의 비밀번호 제거
- Related Files:
  - board/src/components/post-editor.tsx, post-form.tsx :: 제목/본문·로그인작성자; modify
  - board/src/components/post-detail.tsx, use-post.ts, delete-post-form.tsx :: canEdit/canDelete/confirm; modify
  - board/src/components/admin-panel.tsx :: 로그인폼제거/역할기반목록·삭제; modify
  - board/src/lib/client/api.ts, media-api.ts, admin-api.ts :: credentials/새DTO; modify
  - board/src/lib/client/auth-api.ts :: app session/logout; new
  - board/src/lib/client/validation.ts :: title/content/document만검증; modify
#### Details
- **Flow**: 작성폼에는제목/본문만수정가능하고현재Entra이름은읽기전용안내로보인다. 수정은기존작성자표시·작성일불변. 닉네임/글비밀번호입력·복구안내·비밀번호필드오류와state를제거한다. body는document만전송해plain content중복으로64KiB초과문제가재발하지않게한다.
- **미디어**: issueUploadSession의수정입력은{postId}만. 동일앱세션retry의File/readyasset/idempotency키재사용·업로드전로컬preview·URL해제/Undo·선택/붙여넣기/drop·IME·5장/5MiB/20MiB UX는보존한다. 앱세션만료/401이면기존업로드토큰을버리고재로그인안내, 새앱세션이옛token을재사용하지않게한다. 사용자가재로그인하면본문/File초안은브라우저메모리범위에서가능한한유지하되서버token을storage에저장하지않는다. fullpage이동으로메모리가사라지는한계를안내하고자동영구초안기능은추가하지않는다.
- **버튼/삭제**: canEdit일때만수정링크, canDelete일때삭제링크. 본인글은ownerDELETE{confirm:true}, 관리자타인/legacy글은adminDELETE{confirm:true}. 삭제페이지는동의checkbox 유지/비밀번호없음. 기존GETpostDTO에서canEditfalse legacy면읽기전용안내, admin계정도다른사람본문수정불가. 서버403후UI가자동다른endpoint로우회시도하지않는다.
- **관리**: /admin은Board.Admin전용목록/검색/페이지·삭제동의만. ADMIN비밀번호폼/별도admin로그인쿠키/state를제거하고로그아웃은앱공통메뉴로통일한다. 401재로그인/403권한안내/404목록새로고침, Next의globalannouncer와alert selector경합을피한다.

### I03. 브라우저 회귀와 독립 Linux 패키지
- Related Files:
  - board/tests/board.spec.ts, editor.spec.ts, admin.spec.ts :: 계정UI와기존회귀; modify
  - board/tests/auth.spec.ts :: 로그인/만료/로그아웃/직접페이지; new
  - board/tests/helpers/client-fixture.ts, auth-fixture.ts :: 같은actor/쿠키; modify
  - board/tests/package.test.mjs, scripts/package-azure.mjs, build-azure.mjs, verify-azure.mjs :: auth런타임/maintenance기동; modify
  - board/next.config.ts :: 필요시 serverExternalPackages/트레이스 및callback로그ignore유지; modify
#### Details
- client-fixture는같은test의request/context에동일TestActor를배정, 실제SQL앱세션쿠키를각jar에추가한다. tests권한시나리오는Bob/Admin별도context·무쿠키context로직접API를호출한다. 테스트용로그인backdoorroute를만들지않는다. fakeissuer로그인테스트는실제button→authorize→callback을검사한다.
- 1280/390px 로그인·이름1/21/256자/한글/메뉴/긴제목줄바꿈·가로넘침없음, keyboard/IME·Tiptap/선택/붙여넣기/drop·큰문서수정/미디어retry·재로그인안내·role링크/타인직접URL/legacy읽기/관리자동의·로그아웃back누출방지검사. 비밀번호폼이DOM에없음을검사한다.
- 브라우저추적은격리fake계정만허용. 실제회사login/password/MFA/token은trace/HAR/screenshot에남기지않는다. 스크린샷은테스트synthetic content/이름만확인한다. 기존coldroute timeout15초 assertion/충분한시나리오budget유지.
- Linuxpackage는환경파일없이빌드. openid-client와실제필요runtime dependency가ZIP에있는지확인하고필요할경우기존nodeFileTrace entries에추가한다. 테스트issuer/private key/tests/scripts/sql/env를ZIP에포함하지않는다. native sharp/기존SDK검사는유지한다.
- package.test는인증도입으로root200을더이상요구하지않는다. /login200+CSS200, AUTH_MODE미설정→보호root/API/이미지503(maintenance), health503/상세없음(SQL미설정), static200, 익명데이터렌더0를검사한다. 일반entra모드인증401/로그인redirect는격리API/E2E에서검증한다.

### I04. 실제 검증 도구의 세션 기반 전환
- Related Files:
  - board/scripts/verify-live-entra.ts, verify-live-entra.ps1 :: 실제브라우저/자기QA; new
  - board/scripts/verify-live.ts, verify-live-media.ts, verify-live.ps1, verify-live-media.ps1 :: 새도구alias또는폐기안내, password읽기제거; modify
  - board/tests/live-api.spec.ts, live-media-api.spec.ts :: 새검증자를fake계정으로검사; modify
  - board/package.json :: verify:live-entra 추가/옛alias정리; modify
#### Details
- **Signatures & Types**:
```typescript
type LiveEntraInput={url:string;expectedCommit:string;allowQaWrites:boolean;expectAdmin:boolean;qaProfile?:'local-smoke'|'production-full'};
verifyLiveEntra(input:LiveEntraInput,deps:{context:BrowserContext;operatorPool:ConnectionPool;store:BlobStore;restart:()=>Promise<void>}):Promise<{deployedCommit:string;checks:string[];remainingQaPostIds:number[];remainingQaAssetIds:string[]}>;
```
- production URL정확한Azure주소/local은정확한3200, 자동테스트만guard후3100허용. 실제실행은새browser context/headless:false에서사용자가회사SSO/MFA를직접완료한다. 준비완료후최대10분사람단계를기다리고실패시자격증명질문대신안전한상태/다음동작을보고한다. cookies/인증code/토큰을argv/env/stdin/파일로export하지않고로그인된context.request로API를호출한다. 기존DPAPI adminPassword를새도구가읽지않는다.
- 관리자현재SessionDto/claim검증은Entra실로그인으로확인한다. 일반Member/Guest/다른tenant거부는격리테스트로검증하고실제다른계정이없으면실검증했다고주장하지않는다. API결과assertion dump/responseURL/query/rawerror를실행로그에출력하지않고고정check이름·SHA·URL·자체잔여ID만남긴다.
- 실제자기QA 최대2글/이미지3장/세션3회, prefix '[entra-check:<UUID>]' + 메모리ownid/currentoid검증. 익명GET글/API/이미지401, 로그인된서식/이미지/검색/수정/작성일/조건부이미지·수정권한/400identity주입, admin동의400/삭제204, apprestart후문서/이미지/세션유지, logout/옛cookie401/이미지401를검증한다. Azure직접Blob익명차단도유지한다.
- finally에서현재계정/ownUUID prefix/ownid모두확인한글만API로삭제하고발급sessionhash를통해SQL에서자체assetID를확인한뒤기존trusted assetIds filter cleanup을호출한다. 다른운영자료/제한카운터를초기화하지않는다. 미정리id있으면Task완료금지. soft7일보존charge/삭제job정합성확인. 도구세션을마지막logout하고browser닫는다.
- 재시작 DI는테스트noop, 실제는정확한AppService azwebapprestart. wrapper는공유operatorSQL/Blob환경만검증하고회사암호/admin비밀번호를취급하지않는다. 실제기동/로그인은P02-T03에서수행한다.

## Acceptance Criteria
- [x] 로그인/메뉴·본문작성·본인/관리자/legacy UI가비밀번호없이동작하고직접페이지/RSC/이미지누출없음.
- [x] 기존에디터/검색/작성일/미디어/관리자동의회귀및PC·모바일접근성통과.
- [x] 환경없는maintenance LinuxZIP이닫힌상태로기동하고OIDC/sharp/SDK가포함됨.
- [x] 실제검증도구가fakeOIDC/격리SQL/Azurite에서자기QA와정리까지통과, 실제비밀자동화없음.

## Validation
- `npm run test:all`, `npm run typecheck`, `npm run lint`, `npm run build` — 전체성공.
- `npm run verify:azure` — 독립Linux로그인/maintenance기동·SDK/native검사성공.
- `node scripts/check-workflow.mjs`, `git diff --check` — 성공; health익명계약/OIDC배포권한유지.
- synthetic screenshot 1280/390을직접확인. 빌드/테스트는순차실행하고next-env사용자내용복원.

## Commit Message
```text
feat(board): switch board screens to Entra account sessions

Plan: 2026-11-18-entra-id-login
Phase: P02-entra-delivery
Task: T01-identity-ui

- protect page rendering and replace password forms with account permissions
- verify responsive editor flows and prepare authenticated live release checks
```

## Progress
- [x] 구현 완료
- [x] 검증 통과
- commit: this source commit

## Next Task
P02-entra-delivery/T02-entra-provisioning.md. 소스검증완료후외부설정준비로전진.

## Execution Evidence
- test:all: 서비스77/API21/E2E28 성공. typecheck/lint/Next build/check-workflow/diffcheck 성공. verify:azure: 환경파일 없는 독립 LinuxZIP/sharp/SDK/openid-client/로그인200/static200/보호페이지·API·이미지503/health503 검증 성공.
- 합성1280/390 로그인·게시글·긴이름 화면을 직접 확인했다. 사용자 next-env의두 dev타입경로는보존했고운영설정/SQL/Entra/main은변경하지않았다.
- 핵심 변경: proxy.ts는설정오류/maintenance를SQL조회전503으로닫고, `(board)/layout.tsx`는`await requirePagePrincipal(...)`후본문을반환한다. 메뉴에전달하는것은SessionDto뿐이다. UI비밀번호/닉네임/별도관리자로그인은제거했다.
- 알아야 할 점: File초안은현재탭메모리에만남는다. 401이면업로드토큰을버리고새창로그인후저장재시도가능하며새로고침시초안유실안내를표시한다. 권한은UI버튼이아니라서버SQL에서강제된다.
- 함께 처리한 인접 사항: 기존 verify-image-access의import.meta CLIguard가Playwright CJS로드에서실패하여경로기반직접실행guard로바꿨다. 실제비밀을읽거나기능을우회하지않았다. 범위밖 발견특이사항없음. 실제회사SSO/운영restart는다음Tasks에서수행하며격리restart DI는noop이다.
- 실제검증자는한실행에자체prefix글1개/local이미지1개·prod2개/session1·2회만사용한다. SQL현재계정/ownprefix/ownid를확인한API삭제와ownuploadtokenhash로찾은assetIds필터정리를실행하고logout/replay401을확인한다. 테스트에서local-smoke/prod-full둘다정리완료했다.
