# Task: T03 운영 반영 및 점검 종료
## Status: done
## Goal
기본인증off실제main OIDC배포/SSO·CSP·iframe방어를증명하고보고서3건종료.
## Decision Summary
DB글/이미지쓰기없는HTTP/브라우저읽기QA. 사용자MFA만직접수행. 보안성무조건보장금지. user3000/nextenv보존.
## Implementation
### I01. 배포
- Related Files: .github/workflows/board-azure.yml(modify only if required)::OIDC배포; board/scripts/github-release.mjs,download-entra-release.mjs(read-only); board/scripts/verify-browser-security.mjs(new)::고정운영origin/40hexexpectedCommit.
- remote main fetch/ancestry정상FFpush,main verify/deploy success와healthSHA일치. basic off유지,실패시Entra bearer token workflow로수정하고retry(기본인증재활성화없음). token/쿠키/자격증명로그/argv금지.
- 최종main artifact다운로드/manifest/node24/SHA256검사,SQL5이전baseline보존후새entra-schema5-maintenance ZIP갱신.
### I02. 운영검증
- HTTPlogin/404/API/health에서HSTS/XFO/CSP/nosniff/strict-origin-when-cross-origin(콜백자체no-referrer유지),HTMLnonce2회서로다름,API401. headless cross-origin iframe login표시차단. production임의 inline실행차단+정상loginbuttonhydration.
- 실제SSO제어BrowserServer127/headful/자체PIDfocus,trace/HAR/쿠키/code/state출력금지. 사용자MFA후post/new/admin읽기와CSP위반directivename만집계. 기존이미지조회만. crossOriginlogout403→정상logout204→session401. finallyownlogout/browser종료. QA글/파일쓰기0.
- harden-publishingVerify/AppRunning/HTTPS/health재확인. 일반Member/Guest추가실계정은사용않고격리회귀한계명시.
### I03. 문서
- Related Files: board/docs/security-review-2026-11-19.md(기존untracked본인보고서modify/stage)::원발견보존+수정증거; board/docs/entra-runbook.md,azure-runbook.md,board/README.md(modify)::nonce/style예외/기본인증off/실제SHA; memory plan/phase/current/task.
- 마지막sourceSHA와docsHEAD구분,3/3/currentActive없음. docs완료commit정상mainpush(재배포제외경로). 기존session1h/방화벽검토는별도기존위험으로표시.
## Acceptance Criteria
- [x] mainOIDCdeploy/health/실제SSO/nonce/iframe·inline차단/두기본인증false확인.
- [x] 자료쓰기0/ownsession종료/사용자보존/baseline갱신/3/3완료보고서.
## Validation
node scripts/github-release.mjs <40hex>; ./scripts/harden-publishing.ps1 -Mode Verify; node scripts/verify-browser-security.mjs <40hex>; npm audit --omit=dev; git diff --check/status.
## Commit Message
```text
deploy(security): verify hardened production board

Plan: 2026-11-19-security-hardening
Phase: P01-hardening
Task: T03-production
```
## Progress
- [x] 구현 완료
- [x] 검증 통과
- commit: 972064dbbc074f22ab1a07d03467eedfaa7a0a74

## Actual completion evidence
실제 source083b0af7808a18feb178c665f7cd45067c7bd35a/main Actions44479404023 verify+deploy success/health200/Running/entra. 기본인증false재확인. 실제SSO·서식/미저장이미지preview·CSP위반0·parser/iframe차단·ownlogout/replay401·자료쓰기0. 최종artifact14508096968/node24/SHA25674a5f9d427f90d2b9729bb520d4f5a3bb7d6877b250ff12f40aeee11b4469a93 기준ZIP갱신. 사용자3000서버·next-env보존, own브라우저종료. 실제다른계정까지로그인한것은아니며해당회귀는격리검증범위다.
