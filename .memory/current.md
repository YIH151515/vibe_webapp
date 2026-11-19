# Current Context
## Active Plan
[보안 점검 3건 수정](./plans/2026-11-19-security-hardening.md)
## Active Phase
[P01 보안 설정 수정](./phases/2026-11-19-security-hardening/P01-hardening/phase.md)
## Active Task
[T02 배포 기본 인증 차단](./phases/2026-11-19-security-hardening/P01-hardening/T02-publishing-auth.md)
## Status
- T01 완료: e6af04c545aee350f09b920afad36a6e8d6dbcf7. service84/API21/E2E29, 최신nativebuild/type/lint/workflow/diff, LinuxproductionZIP브라우저검증29716 모두통과. 공통strict-origin-when-cross-origin, /api/auth콜백no-referrer예외유지. fullnonceCSP/iframe/HSTS공통헤더.
- 아직mainpush/운영변경없음. 기존운영ba5e3bb223272c112b074bc0c1ec45567c419a63/SQL5/entra. feature/security-hardening. 이전Entra6/6완료유지.
- 검증도중no-referrer/NativePOST Origin null충돌과CDP신뢰스크립트테스트오류를발견해수정. 실제HTMLparser삽입스크립트차단/별도CSP없는embedding에서targetiframe방어/정상NextRSC실행/NativeOriginPOST를production브라우저로확인했다.
- user3000PID29808/next-env .next/dev/types두경로/루트도구/DPAPI/SQLite/Dockerpad보존. 진단용3200모두종료. 자체보고서security-review-2026-11-19.md는untracked,T03stage예정. 실제SQL/Blob자료쓰기나방화벽변경없음.
## Next Step (IMPORTANT)
T02청사진을읽고SCM/FTP기본인증false Bicep/안전한고정scope PS도구/의미있는회귀를구현한다. T02검증후실제두정책off/readback,커밋/포인터T03. T03에서main OIDC실제배포/운영SSO·CSP재검증/최종baseline갱신/보고서완료. 기본인증재활성화금지. 실제MFA만사용자직접진행.
