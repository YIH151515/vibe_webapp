# Current Context
## Active Plan
[보안 점검 3건 수정](./plans/2026-11-19-security-hardening.md)
## Active Phase
[P01 보안 설정 수정](./phases/2026-11-19-security-hardening/P01-hardening/phase.md)
## Active Task
[T01 브라우저 정책](./phases/2026-11-19-security-hardening/P01-hardening/T01-browser-policy.md)
## Status
- 사용자 보고서F01~03수정/운영반영요청. 결정/단일Phase3Task계획완료. 이전Entra6/6완료유지.
- 운영sourceba5e3bb223272c112b074bc0c1ec45567c419a63/SQL5/AUTH_MODEentra. 새mainActions전에는header미수정.
- 사용자next-env dev타입/3000PID29808/루트도구/기존DPAPI/SQLite/Dockerpad보존. 보고서board/docs/security-review-2026-11-19.md는이번자체산출물untracked,T03stage예정.
## Next Step (IMPORTANT)
T01청사진에따라feature/security-hardening에서nonceCSP/공통헤더구현.3Task자동연속진행,실제MFA만사람안내. SQL/방화벽변경/비밀로그금지.

## T01 실행 중
- 공통헤더/fullnonceCSP/proxy matcher확장/정책unit+E2E+LinuxZIP브라우저검증구현. 아직커밋/운영반영전.
- 첫전체회귀에서globalno-referrer가formPOST Origin을null로만들어strictCSRF403을일으킴. 공통Referrer를strict-origin-when-cross-origin으로수정,callback자체no-referrer유지. form-action은self+정확Microsoft로그인origin,격리test만assertTestOidc후fakeissuerorigin허용.
- CSP검증시CDP신뢰실행에서동적으로스크립트추가는strict-dynamic의신뢰전파때문에실행됨. 실제HTMLparser에nonce없는script를삽입하는검증으로교정. 별도CSP없는embedding문서에서target의frame차단확인.
- 현재최신 test:all exec19807, Linuxverify exec40365, type/lint/workflow exec44010 진행중. 첫실행95955/39621은이전코드로실패했고최신pass를대체하지않음. 임시diagnostic3200 exec84521은본인PID/명령확인후종료. 사용자3000보존.
- 다음Task구현은T01검증/커밋/포인터전진후. SQL/방화벽/운영기본인증아직미변경.

## 최신 검증 갱신
- test:all31172 exit0: service84/API21/E2E29 통과. 로그인form Origin/콜백no-referrer/새parser기반CSP·별도iframe회귀포함.
- next.config headers가route자체Referrer를덮는것을기존authAPI테스트가발견. /api/auth/:path*에별도no-referrer규칙을마지막에적용했고최신전체회귀성공. 공통은strict-origin-when-cross-origin.
- 최신Linuxverify29716 진행중(이전25982는브라우저route정리오류,40365는APT DNS실패). package브라우저테스트를단계별page로분리/times1+unrouteAll wait로정리. 최신소스copy는29716.
- productionnative디버그50993의3200은본인명령확인후종료. 오래된nativebuild의no-referrer가Origin null을재현했으므로최신nativebuild/type/lint57567 재실행중.
- T01최종성공후명시경로만커밋하고T02로전진. productchanges아직mainpush/운영수정없음.
