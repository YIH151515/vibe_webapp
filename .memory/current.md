# Current Context

## Active Plan
[보안 점검 3건 수정 — completed](./plans/2026-11-19-security-hardening.md)

## Active Phase
없음 — P01 3/3 completed.

## Active Task
없음 — 전체3/3 completed. 이전 Entra 로그인 계획6/6 완료 이력 보존.

## Status
- 사용자 보안 점검 F01~03수정/운영반영요청 완료. 운영 URL https://app-vibe-board-prod-7b1417.azurewebsites.net .
- T01 e6af04c(공통헤더/nonceCSP), T02 aed6df0(기본인증차단), T03 972064dbbc074f22ab1a07d03467eedfaa7a0a74(실제운영재검증/문서) 완료. 현재branchfeature/security-hardening,source/docs모두정상main통합/push하며force금지.
- 실제 실행source083b0af7808a18feb178c665f7cd45067c7bd35a. main Actions44479404023 verify/deploy success: https://github.com/YIH151515/vibe_webapp/actions/runs/44479404023 . 후속완료문서HEAD와실제source를구분한다.
- 운영 Running/HTTPS only/SQL5/AUTH_MODEentra/health200 statusok/version위source. EDITOR_FEATURE_ENABLED=1/MEDIA_CLEANUP_ENABLED=1 유지. SCM/FTP basicPublishingCredentialsPolicies실제false, off상태mainOIDC배포성공후재조회도false. 기존AppSettings전체key/value보존확인.
- CSP: HTML요청별32byte난수nonce,script self/nonce/strict-dynamic,productionunsafe-inline/eval스크립트금지,script-src-attrnone,frame-ancestorsnone/XFODENY. style-srcunsafe-inline만React/Tiptap호환으로허용. 이미지self/blob/data미리보기허용,form self+정확Microsoft로그인origin. 격리개발만assertTestOidc후fakeissuer허용.
- HSTS max-age31536000/nosniff/Permissions/poweredByfalse. 공통Referrerstrict-origin-when-cross-origin으로NativePOST Origin유지,/api/auth에는별도no-referrer로콜백쿼리보호. Nextglobalheaders가route보다우선하므로예외유지.
- 실제 브라우저검증 complete=true: health/header/nonce고유성/parser로삽입한nonce없는inline실행차단/정상Nextruntime/별도CSP없는embedding에서targetiframe차단. 사용자직접회사SSO/MFA·최초Admin/home/new/admin·서식·이미지blob미리보기·정상페이지CSP위반0. 기존이미지로그인200/private,no-store·익명401. 타Originlogout403/ownlogout204→session401.
- 운영글/이미지쓰기0. 미저장메모리초안만선택/편집,브라우저contentmutationroute차단기능에시도0확인. 자체BrowserServer/브라우저종료,토큰/쿠키/nonce/code/state/사용자내용/trace/HAR저장없음. 결과공개검증명만board/.deploy/security-hardening-verification.json.
- 검증 service86/API21/E2E29,타입/lint/workflow/Bicep컴파일/Windowsbuild/LinuxproductionZIP브라우저/main전체검사성공. npm audit --omit=dev 알려진운영취약점0.
- 최종actualActions artifact14508096968 내려받아manifest/commit/node24/SHA256대조. board/.deploy/entra-schema5-maintenance/board.zip+release.json 새source로갱신. SHA25674a5f9d427f90d2b9729bb520d4f5a3bb7d6877b250ff12f40aeee11b4469a93. 이전은previous-ba5e3bb2/prepared-c62339c5보존. 검증후entra-release-authorized.json도schema5/새source/해시와동기화. 복구도SQL5maintenance와기본인증off유지,역migration/익명/schema4ZIP복구금지.
- SQL/Blob자료·방화벽·Entra역할/비밀·유료SKU 변경없음. 기존90일Entra secrets만료2027-02-16 UTC/별도DPAPI유지. 세션최대1h회수한계/읽기제한/운영자IP수명검토는기존별도설계사항이며이번F01~03과구분한다. 실제타계정/Guest/다른tenant는추가로그인하지않고격리회귀범위로명시.
- 사용자3000개발서버유지(next.config자동재로딩으로workerPID는바뀔수있음),사용자next-env두.next/dev/types경로·루트.agents/.codeburn/AGENTS/README/zip/SQLite·Dockerpad보존. 테스트/diagnostic3200/3100과소유컨테이너정리,사용자파일stage하지않음.
- 상세수정증거/조건/한계는board/docs/security-review-2026-11-19.md,운영정책은entra-runbook/azure-runbook/README.

## Next Step (IMPORTANT)
추가 Active Task 없음. 확인된 F01~F03 수정/운영반영/재검증 completed3/3. 다음요청은새결정/계획으로진행한다. 전체보안무결성을보장하는표현은하지않고실제검증범위와기존별도설계위험을구분한다. 사용자미커밋next-env와루트도구보존.
