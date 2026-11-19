# Decisions: 보안 점검 3건 수정
- Date: 2026-11-19
- Status: Confirmed
- 사용자 결정: 보고서 F01~F03을 수정해 운영 반영. 기존 권고안 진행 선호에 따라 구현 기본값 확정.

## D01. 범위
SCM/FTP basic publishing false, CSP/프레임 차단, HSTS/공통헤더. DB/세션정책/방화벽/유료인프라 변경없음.
## D02. CSP
HTML마다 crypto.randomBytes(32).toString('base64') nonce. 요청·응답CSP 동일, 외부x-nonce/CSP 덮어쓰기. script-src self nonce strict-dynamic; script-src-attr none. unsafe-eval은development만. style-src self unsafe-inline은기존관리자React/Tiptap스타일호환용. img self blob data, connect self(개발만ws/wss), font self, default self, object none,base self,form self+고정Microsoft로그인origin(격리테스트만검증된fakeissuer),frame-ancestors none,frame-src none.
로그인/404/점검포함. 기존보호경로만maintenance/returnTo, prefetch인증유지.
## D03. 공통헤더
HSTS max-age31536000(공유상위도메인preload/includeSubDomains없음),XFO DENY,nosniff,strict-origin-when-cross-origin(콜백자체no-referrer유지),Permissions camera/microphone/geolocation비허용,poweredByfalse. static CSP최소frame/object/base/form정책, HTMLproxy는fullnonce정책.
## D04. 배포
고정App Service 두publishing정책만false PUT/readback+Bicep선언. 전체infraApply/설정dictionary덮어쓰기/기본인증재활성화금지. off상태실제main OIDC deploy성공/healthSHA필수. 필요시Entra bearer방식workflow로해결.
## D05. 검증
격리전체회귀+LinuxproductionZIP브라우저 nonce/임의inline/프레임차단/정상hydration. 이후실제운영SSO읽기QA와ownlogout만. 사용자3000/next-env/루트도구보존. 인증비밀/콜백쿼리/사용자내용로그금지.
