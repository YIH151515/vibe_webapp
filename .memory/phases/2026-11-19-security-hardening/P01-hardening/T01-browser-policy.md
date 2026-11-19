# Task: T01 브라우저 보안 정책
## Status: done
## Goal
F02/F03을공통헤더와production nonce CSP로해결하고로그인/편집유지.
## Decision Summary
DB/DTO변경없음. feature/security-hardening. 사용자3000/next-env보존. 스타일만unsafe-inline허용,production스크립트inline/eval금지.
## Implementation
### I01. 정책과proxy
- Related Files: board/src/lib/security-headers.ts(new)::securityHeaders:{key:string;value:string}[],contentSecurityPolicy(nonce:string,development:boolean):string; board/next.config.ts(modify)::headers,poweredByHeader; board/src/proxy.ts(modify)::proxy,config.
- 공통 HSTS max-age31536000,XFO DENY,nosniff,strict-origin-when-cross-origin(콜백자체no-referrer유지),Permissions-Policy camera=(), microphone=(), geolocation=(),static CSP object/base/form/frame차단.
- fullCSP default-src self;script-src self nonce strict-dynamic + development만unsafe-eval;script-src-attr none;style-src self unsafe-inline;img-src self blob:data:;font-src self;connect-src self+개발ws:wss:;object-src none;base-uri self;form-action self+Microsoft로그인(테스트issuerguard);frame-ancestors none;frame-src none. nonce는32bytebase64검증,부적합throw.
- matcher는/api,_next/static,_next/image제외전체(로그인/404포함). root/posts/admin만기존maintenance/returnTo적용. 점검503에도정책. 전달된x-nonce/CSP/x-board-return-to삭제후서버값주입. request/response CSP같고private,no-store. prefetch인증유지.
### I02. 의미있는검증
- Related Files: board/tests/browser-policy.test.ts(new)::순수prod/dev정책·잘못된nonce거부; board/tests/browser-policy.spec.ts(new)::로그인/nonce고유성/헤더위조무시/iframe차단; board/tests/package.test.mjs(modify)::실제productionZIP스크립트nonce·임의inline실행차단·정상hydrate.
- 실제Next실행형inline과src스크립트nonce가CSP와같아야한다. 브라우저가파싱할HTML에nonce없는스크립트를삽입해실행차단증명(CDP의신뢰된실행으로동적추가하면strict-dynamic신뢰전파이므로공격재현에쓰지않음). SQL없는점검에서login버튼은비활성이므로brand NextLink클릭의RSC요청으로실제hydration증명(운영비밀불필요). SQL없는점검/API503기존계약유지.
- board/scripts/verify-azure.mjs(modify)::Linux컨테이너에서npx playwright install --with-deps chromium 추가; CI는이미설치됨. 새공통모듈이next.config에서import되므로복사목록src유지.
## Acceptance Criteria
- [x] 로그인/404/점검/API공통헤더,nonce위조차단,productioninline차단/정상스크립트허용.
- [x] 전체회귀/type/lint/build/LinuxZIP브라우저성공,사용자변경보존.
## Validation
npm run test:all; npm run typecheck; npm run lint; npm run build; npm run verify:azure; node scripts/check-workflow.mjs; git diff --check. build전next-env snapshot후정확한dev→prod경로자동변경만복원.
## Commit Message
```text
fix(security): enforce nonce CSP and browser security headers

Plan: 2026-11-19-security-hardening
Phase: P01-hardening
Task: T01-browser-policy
```
## Progress
- [x] 구현 완료
- [x] 검증 통과
- commit: 지정 fix(security) 커밋 이력 참조

## Actual validation
test:all31172 exit0 service84/API21/E2E29; 최신nativebuild/type/lint57567 exit0; LinuxproductionZIP29716 exit0(브라우저parser차단/RSC런타임/정상OriginPOST/외부iframe차단); workflow/diff검사성공. 임시3200종료/user3000·next-env dev경로보존.
