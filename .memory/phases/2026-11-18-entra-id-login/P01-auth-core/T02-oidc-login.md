# Task: T02 실제 OIDC 흐름과 격리 issuer

## Status: done

## Goal
Code+PKCE 로그인부터 SQL 앱 세션 발급/로그아웃까지 구현하고, 자동 테스트는 실제 Entra 대신 서명하는 전용 loopback issuer로 전체 프로토콜을 검증한다.

## Decision Summary
- 단일 테넌트 Member(acct0)만 허용하고 Board.Admin claim만 관리자다. Client secret/PKCE/token은 서버 전용이다.
- 이번 Task는 auth route만 추가한다. 게시판 권한 전환은 다음 Task이며 운영/Entra/SQL/main 변경 금지다.

## 실행 맥락과 고정 계약
- Plan2026-11-18-entra-id-login, cwd D:/vibeweb/board, feature/entra-id-login/Node24/Next16/TS strict. 사용자 next-env dev 경로·3000·루트 도구·기존 SQLite·Docker pad 보존, 명시한 파일만 stage. 기존 .env.local은 운영 SQL/Blob를 공유하므로 자동 테스트에서 읽지 않는다.
- schema5: board_users PK(tenant_id,object_id), display_name1..256; auth_sessions id_hash64hex PK, tenant_id/object_id FK, display_name,is_admin,app_origin,client_id,created_at,expires_at<=created+1h,revoked_atnullable; oidc_login_attempts state_hash PK/browser_hash64hex/client_id UUID/app_originNVARCHAR256/return_toNVARCHAR2048/secret_cipherVARBINARY2048/crypto_key_idCHAR16/created_at/expires_at<=10min. 기존 posts/업로드/미디어는 이 Task에서 읽고쓰지 않는다.
- auth-config의 AUTH_MODE=maintenance|entra(defaultmaintenance). entra에는 고정tenant69c1e470-4528-435a-a1ae-de98e0aac738, ENTRA_CLIENT_ID/SECRET, AUTH_ENCRYPTION_KEY64hex, canonical APP_ORIGIN 필요. production issuer는 tenant v2.0에서만 추론한다. Principal={tenantId,objectId,displayName,isAdmin,sessionHash,expiresAt:Date}, SessionDto={displayName,isAdmin,expiresAt:ISOstring}.
- fake OIDC 허용은 NODE_ENV=test/APP_TEST_MODE1/loopback SQL board_test_32hex/전용 Azurite/WEBSITE없음/issuer http127.0.0.1할당port의 동시 guard에 한정한다. test env override는 production에서 거부한다.

## Implementation

### I01. OIDC 어댑터와 일회용 flow
- Related Files:
  - board/package.json, package-lock.json :: openid-client exact pin; modify
  - board/src/lib/server/oidc-client.ts :: discover/code exchange; new
  - board/src/lib/server/auth-flow.ts :: state/nonce/PKCE/AES-GCM/consume; new
  - board/src/lib/server/auth-config.ts, auth-principal.ts, auth-session.ts :: 공통계약 재사용; modify if required
  - board/tests/auth-flow.test.ts :: 실제 SQL flow 보안; new
#### Details
- **Signatures & Types**:
```typescript
type LoginStart={authorizationUrl:string;browserCookie:string};
beginLogin(pool:ConnectionPool,config:EntraConfig,browserCookie:string|undefined,returnTo:string):Promise<LoginStart>;
finishLogin(pool:ConnectionPool,config:EntraConfig,callbackUrl:URL,browserCookie:string|undefined):Promise<{cookieValue:string;principal:Principal;returnTo:string}>;
safeReturnTo(raw:unknown):string;
getOidcClient(config:EntraConfig):Promise<import('openid-client').Configuration>;
```
- **라이브러리**: 인터뷰 확인6.9.0을 설치 전 공식 npm/README/Node24 require(esm) 호환성으로 다시 검증하고 exact pin. Next runtime build/추적을 확인한다. 순수 crypto 서명검증을 재구현하지 않는다. getOidcClient는 import/build 중 discovery하지 않고 설정별 lazy cache+실패cache제거, 유한 timeout10초/redirect manual. fake issuer만 allowInsecureRequests 허용.
- **Flow**: random state/nonce 각32bytes hex, PKCE verifier는 라이브러리 randomPKCECodeVerifier, S256 challenge. browser flow cookie는 기존 유효64hex를 재사용해 여러 탭 flow를 지원한다. DB에는 state/browser SHA256만 저장. AES256GCM(random IV12, tag16)으로 {verifier,nonce} JSON을 암호화하고 version1+IV+tag+ciphertext를 secret_cipher에 넣는다. AAD=JSON.stringify([state_hash,browser_hash,origin,clientId]), crypto_key_id=SHA256(key).slice(0,16). return_to는 서버 검증 경로만 저장한다.
- **ReturnTo**: 기본 '/', 최대2048, 단일 '/'로 시작하는 현재 origin 상대경로만 허용. '//', backslash, 제어문자, protocol/scheme, percent decoding 후 우회, /api/auth*, /login 반복경로는 '/'로 정규화한다. new URL(raw,origin).origin도 검사한다. query/검색·글id는 보존한다.
- **교환**: callback의 state/code/error 각단일값/총query8KiB 이내, state64hex/browserCookie64hex를 먼저 검사. state_hash+browser_hash+origin+client_id+SQL미만료 조건으로 DELETE...OUTPUT을 transaction commit하여 단일 소비 승자를 정한다. 불일치 요청은 다른 브라우저의 flow를 소비하지 않는다. 소비 이후 OIDC교환 실패해도 flow를 재사용하지 않고 재로그인을 요구한다. provider error/access_denied는 정상취소 안내, 원문 error_description/code/state를 반사하지 않는다.
- **검증**: openid-client authorizationCodeGrant에 expectedState/expectedNonce/pkceCodeVerifier를 모두 전달. reconstructed callback URL은 canonical APP_ORIGIN+고정path+검증한query로 만들고 내부 HTTP host나 forwarded URL을 신뢰하지 않는다. 검증된 claims만 validateEntraClaims에 전달, acct 0/'0' 필수/tenant·oid·name·exp 검사/roles Board.Admin 확인 후 createAppSession. ID/access/refresh token은 메모리에서 버리고 저장/로그하지 않는다. upstream network/discovery503, 토큰/nonce/PKCE/state오류401, tenant/Guest403.

### I02. auth HTTP 계약과 비밀 로그 방지
- Related Files:
  - board/src/lib/server/auth-http.ts :: 공통 cookie/request handling; new
  - board/src/lib/server/rate-limit.ts :: RateAction에oidc-login과10회/600초정책추가; modify
  - board/src/app/api/auth/login/route.ts :: POST; new
  - board/src/app/api/auth/callback/route.ts :: GET; new
  - board/src/app/api/auth/session/route.ts :: GET; new
  - board/src/app/api/auth/logout/route.ts :: POST; new
  - board/next.config.ts :: callback incomingRequests logging 제외; modify
  - board/tests/auth-api.spec.ts :: 라우트/쿠키/보안; new
#### Details
- **Signatures & Types**: authRequest(action:'login'|'callback'|'session'|'logout',request:Request):Promise<Response>. auth route Node runtime/dynamic/no-store. EntraConfig=Extract<AuthConfig,{mode:'entra'}>; maintenance는503 ErrorBody(SERVICE_UNAVAILABLE)이며 임의 로그인우회를 제공하지 않는다.
- **HTTP**: POST /api/auth/login accepts application/x-www-form-urlencoded form with returnTo만(로그인버튼 HTML form용, streamed총4KiB) 또는 application/json {returnTo?:string}(테스트/API), strict Origin 필수. 허용되지 않은필드/타입400/415/413. IP 기반 'oidc-login'10회/600초(새rate action), flow 생성 성공을 1회로 지출하고 invalid Origin/body는 미지출. 303 Location=검증한Entra authorization URL와flow쿠키. GET login405.
- **Cookies**: 운영 __Host-board_session / __Host-board_flow, Secure/HttpOnly/SameSite=Lax/Path=/ noDomain. 세션MaxAge=min3600/token남은초; flowMaxAge600. HTTP loopback은 board_session/board_flow 이름으로 Secure=false, 운영에서 로컬이름을 대체 수단으로 읽지 않는다. callback 성공은303 안전한returnTo+Referrer-Policy:no-referrer. flow쿠키는 여러탭을 위해 유효수명까지 유지하며 DB state만 소비한다. 실패는 비밀 없는 /login?error=cancelled|denied|failed 로303, 저장 토큰이나 error_description을 URL에 넣지 않는다. Session fixation 방지를 위해 성공 시 이전 유효 앱세션은 revoke하고 새 random cookie를 발급한다.
- **Session**: GET /api/auth/session 현재 cookie를 readAppSession으로 확인→200 SessionDto 또는401. POST logout은 strictOrigin 필수, 유효cookie면 revokeAppSession, 무효/없는cookie도 쿠키지우고204로 멱등처리하되 DB오류는503(브라우저cookie는 삭제)이다. 원문cookie를 DTO/body로 반환하지 않는다. admin로그아웃과 회사전체SSO로그아웃은 별개가 아니라 새 앱 세션 하나로 통일할 예정이다.
- **로그**: Next16 설치 logging docs의 incomingRequests.ignore에 /^\/api\/auth\/callback(?:\?|$)/를 추가한다. fetch URL full logging/프로토콜debug/토큰object console 금지. 테스트는 합성 code/nonce/token marker가 stdout/stderr에 없는지 검사한다. production HTTP query logging 상태 확인은 외부연동 Task에서 수행한다. Next config의 기존 mssql/sharp/standalone 설정은 유지한다.

### I03. fake OIDC와 fixture
- Related Files:
  - board/tests/helpers/fake-oidc-issuer.ts :: startFakeOidcIssuer; new
  - board/tests/helpers/auth-fixture.ts :: synthetic principals/session login helpers; new
  - board/scripts/run-tests.ts :: per-suite issuer lifecycle/env sanitize; modify
  - board/tests/auth-oidc.test.ts :: 서명·protocol fault; new
  - board/playwright.config.ts :: test issuer env 전달; modify if required
#### Details
- **Signatures & Types**:
```typescript
startFakeOidcIssuer():Promise<{issuer:string;clientId:string;clientSecret:string;close():Promise<void>}>;
type TestActor={tenantId:string;objectId:string;displayName:string;isAdmin:boolean};
createTestActor(overrides?:Partial<TestActor>):TestActor;
createTestSession(pool:ConnectionPool,actor:TestActor):Promise<{cookieName:string;cookieValue:string;principal:Principal}>;
```
- **Fake 서버**: wrapper 부모 프로세스가 loopback port0에서 per-suite issuer를 띄우고 child Playwright/Node tests 동안 유지한다. Node crypto RSA2048 keypair/RS256 JWT/JWKS kid를 사용하고 private key는 메모리만. /.well-known/openid-configuration, /authorize, /token, /jwks 제공. 정확한 client/redirect URI/S256/nonce/scope를 검사, code는 메모리60초 단일소비/PKCE mismatch거부. 명시된 fake identity cookie로 Alice/Bob/Admin/Guest/wrongtid/missingacct/badsig 등 합성 claim을 선택하며 실제앱에는 test login/identity injection HTTP route를 만들지 않는다.
- **Fixture**: assertTestDatabase/assertMediaTestStorage/assertTestOidc를 첫 줄에서 검사한다. createTestSession은 synthetic identity로 실제 세션 service를 사용하고 raw cookie는 테스트 메모리만. 보통 기능테스트는 이 빠른 fixture를 쓰고 auth protocol 테스트는 fake issuer→realcallback 전체를 통과한다. 같은test의 request/context는 동일 TestActor, 다른 세션이어도 글소유권은 같으며 업로드session은발급앱세션에만유효하다.
- **Wrapper**: mode service/api/e2e/all 유지, per-suite 새DB+container+issuer, inherited AUTH_/ENTRA_/TEST_OIDC_ 삭제후테스트용만주입, .env.local미사용. issuer닫기와본인SQL/Azurite정리Promise.allSettled, 3100/.next-test 및 next-env 사전값보호 유지. 실패/timeout에도 issuer외부endpoint접근금지.
- **Scenarios**: 실제code grant성공, PKCE/nonce/state불일치, state중복/병렬callback1개만성공, 다른브라우저/다른origin/clientflow401, exp/iat/aud/iss/서명/kid오류, acct1/누락/타테넌트403, unknownroles일반사용자, issuer유효응답모양아님503, 인증취소, 세션고정방지, 로그marker미포함, logout후replay401.

## Acceptance Criteria
- [x] Code/PKCE/state/nonce/Member/role 검사 뒤에만SQL세션이 발급된다.
- [x] flow는 암호화·브라우저결합·일회용이며 만료/취소/재시도도 비밀을 노출하지 않는다.
- [x] 자동테스트는 격리 fake issuer만 사용하고 실제Entra/운영설정을 읽지 않는다.
- [x] 기존게시판 라우트는 아직 이전계약이며 auth신규코드/기존회귀가 함께빌드된다.

## Validation
- `npm run test:service`, `npm run test:api` — OIDC/세션/로그 검사와 기존 회귀 성공.
- `npm run typecheck`, `npm run lint`, `npm run build` — 성공; next-env 사용자 경로를 정확한변환만복원.
- `git diff --check` 및 staged diff/lockfile 확인 — secret/test key/private material 없음.

## Commit Message
```text
feat(auth): implement Entra OIDC login and isolated issuer tests

Plan: 2026-11-18-entra-id-login
Phase: P01-auth-core
Task: T02-oidc-login

- exchange one-time browser-bound PKCE flows for hashed app sessions
- cover verified claims, callback replay, logout and log redaction without live Entra
```

## Progress
- [x] 구현 완료
- [x] 검증 통과
- commit: pending

## Next Task
P01-auth-core/T03-board-authorization.md. done/commit 후 phase/current 갱신.

## Execution Notes
- openid-client6.9.0 exact pin(Node24 require-ESM지원확인). lazy/실패cache삭제/discovery10초/동일origin endpoint/redirect거부를구현했다. enableNonRepudiationChecks를명시하여서명검증을강제하고실제bad-signature/kid/aud/issuer/expiry/nonce/PKCE오류를검증했다.
- state/browser해시+AES256GCM proof/AAD+10분일회용SQL삭제와cookie회전·Origin검사·logout/replay를구현했다. callback로그제외/원문오류미출력,한글검색returnTo정상인코딩과외부redirect우회를검사했다.
- 로그아웃Origin거부시cookie를삭제하지않도록수정해403요청이정상세션을방해하지않는다. 로그인flow성공10회/600초한도와Retry-After도실HTTP로검사했다.
- 서비스73개/API21개/typecheck/lint/build/diffcheck성공. fakeOIDC는wrapper부모프로세스의per-suite loopback서버이며SQL/Azurite/issuer동시guard로실제Entra/운영접속을차단한다. 테스트키는메모리에만있고testlogin route는없다.
- npm audit --omit=dev 결과운영의존성취약점0. 전체audit21개는개발의존성경고이며이번Task에서강제major update하지않았다. 로그인검사구현은완료했지만게시판API/이미지의세션게이트는다음T03이다.
- 운영SQL5/Entra등록/Azure설정/mainpush없음,사용자next-env dev경로/3000/Dockerpad/루트도구보존. 실제서버반영요청에따라다음Task를자동연속실행한다.
