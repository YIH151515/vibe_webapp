# Current Context
## Active Plan
[보안 점검 3건 수정](./plans/2026-11-19-security-hardening.md)
## Active Phase
[P01 보안 설정 수정](./phases/2026-11-19-security-hardening/P01-hardening/phase.md)
## Active Task
[T03 실제 운영 반영](./phases/2026-11-19-security-hardening/P01-hardening/T03-production.md)
## Status
- T01 e6af04c 완료: service84/API21/E2E29/nativebuild/type/lint/workflow/LinuxproductionZIP29716 pass. nonce CSP/parser삽입차단/iframe차단/Next RSC/nativePOST Origin 검증. 공통Referrerstrict-origin-when-cross-origin, auth콜백no-referrer 별도유지. HSTS/XFO/nosniff/Permissions/poweredByfalse.
- T02 aed6df050b414891b157f61fdd8b8f6f258eaa0c 완료: Bicep두기본인증false/고정범위PS도구+모의read/write테스트. service86/타입/lint/Bicep컴파일/실제Apply+Verify 성공. 실제운영ftp/scm allowfalse, AppSettings전체key/value동일 확인. SQL/방화벽변경없음.
- 아직mainpush없음. 운영기본인증만off이고앱source는기존ba5e3bb223272c112b074bc0c1ec45567c419a63/SQL5/entra. F02/F03은새main Actions후해소검증필요. branchfeature/security-hardening.
- 사용자3000PID29808/next-env두dev타입경로/루트도구/기존DPAPI/SQLite/Dockerpad보존. 임시3200모두종료. 보고서security-review-2026-11-19.md는이번자체untracked,T03 stage예정. 이전Entra6/6완료유지.
## Next Step (IMPORTANT)
T03청사진을읽고verify-browser-security.mjs(고정운영URL/40hex,글·이미지쓰기없는브라우저검증/사용자MFA/ownlogout)구현/검사. 준비source커밋→main fetch정상FFpush→실제main OIDC Actions success/healthSHA→운영CSP/HSTS/iframe/실제SSO·편집미리보기/기본인증false 재검증→실제artifact와새SQL5baseline해시대조갱신→보고서종료/3/3/current없음/완료docs mainpush. 배포실패는OIDC bearer경로로수정하고기본인증재활성화금지. 실제MFA는사용자가직접완료.
