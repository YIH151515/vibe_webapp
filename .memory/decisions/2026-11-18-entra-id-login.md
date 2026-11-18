# Decisions: 자유 게시판 Entra ID 로그인

- Date: 2026-11-18
- Status: Confirmed
- Feature: entra-id-login
- 사용자 요청: 운영 중인 자유 게시판에 Microsoft Entra ID 로그인을 연동한다.
- 인터뷰: 2026-11-17~18. 아래 D01~D06은 사용자가 각각 선택1로 확정했다. D07 이후는 해당 선택을 기존 코드에 적용하기 위한 에이전트의 기술 기본값이며 사용자에게 개별 수치·라이브러리를 선택받은 것은 아니다.
- Scope: 이 단계에서는 결정 문서만 작성한다. 코드·패키지·DB·Entra 등록·Azure 설정·배포는 변경하지 않는다. 기존 rich-editor-images completed 포인터를 유지하며 `/memory-plan entra-id-login`에서 새 계획을 만든다.

## D01. 로그인 적용 범위 — 사용자 선택
- **Chosen**: 게시판 전체 로그인 필수. 글 목록/검색/상세/이미지 조회·작성·수정·삭제·업로드·관리자 화면과 해당 API를 보호한다.
- **Rationale**: 일부 화면만 가리면 직접 API나 이미지 URL로 내용을 읽을 수 있으므로 실제 데이터 접근도 서버에서 검사해야 한다.
- **예외**: 콘텐츠를 담지 않는 로그인/콜백/로그아웃 결과 화면·필수 정적 리소스와 최소 health만 허용한다. health는 기존 CI에 필요한 상태/배포 버전만 제공하고 글·사용자·SQL 상세를 노출하지 않는다.

## D02. 허용 계정 — 사용자 선택
- **Chosen**: 현재 Azure와 같은 Entra 테넌트의 Member 사용자만 허용. 외부 Guest, 다른 테넌트, 개인 Microsoft 계정은 거부한다.
- **Tenant**: `69c1e470-4528-435a-a1ae-de98e0aac738` (현재 DEX 구독의 tenant를 읽기로 확인).
- **Rationale**: 단일 테넌트 설정만으로 해당 테넌트의 게스트까지 제외되는 것은 아니다. 검증된 ID token의 tenant와 선택 claim `acct=0`을 모두 확인하며 `acct=1` 또는 누락/모호한 값은 허용하지 않는다. 이메일 접미사로 사내 사용자를 판정하지 않는다.
- **정확한 의미**: 허용 기준은 디렉터리의 Member 분류다. 이것만으로 실제 재직 여부까지 별도로 확인한 것은 아니며 계정·사용자 유형 관리는 조직의 Entra 정책을 따른다.

## D03. 작성자와 본인 글 권한 — 사용자 선택
- **Chosen**: 검증된 Entra 이름을 작성자로 표시하고 새 글의 닉네임·글 비밀번호 입력을 제거한다. 로그인한 작성자만 자기 글을 수정·삭제한다.
- **Rationale**: 소유권은 바뀔 수 있는 이름·이메일이 아니라 `(tenant ID, object ID)`로 저장·비교한다. 이름은 표시용이다. 클라이언트가 보낸 작성자·계정 ID를 권한 근거로 사용하지 않는다.
- **자동 보완**: 현재 nickname의 SQL/검증 제약은2~20자다. 실제 Entra 표시 이름을 위한1~256자 수용과 서버 저장값 생성이 필요하다. 기존 작성자/제목/본문/작성일은 소급 변경하지 않는다.
- **관리자 범위**: 관리자는 다른 사람의 글을 삭제할 수 있지만 다른 사람의 본문을 대신 수정하는 기능은 추가하지 않는다.

## D04. 최초 관리자 — 사용자 선택
- **Chosen**: 윤일호 `ih.yoon@dexconsulting.net`만 최초 관리자. 이후 Entra 앱 역할 할당으로 관리자를 추가한다.
- **확인된 계정**: object ID `e8222b20-96f4-4c25-a3af-1f40ebbbec56`; Azure signed-in-user 조회에서 이름/UPN/ID를 확인했다. 해당 조회의 userType은 null이었으므로 이를 Member 검증으로 취급하지 않는다.
- **구현 기준**: 게시판 앱 역할 `Board.Admin`을 정의하고 해당 object ID에 할당한다. 서버는 해당 앱의 검증된 `roles` claim으로 관리자 여부를 결정한다. 이메일 하드코딩이나 Azure 구독 Owner 여부로 게시판 관리자를 판정하지 않는다.
- **기존 인증**: 관리자 비밀번호 로그인과 그 쿠키를 새 권한의 우회 경로로 남기지 않는다. 기존 DB/암호 자료를 지우거나 노출할 필요는 없지만 새 코드에서는 인증 수단으로 인정하지 않는다.

## D05. 기존 비회원 글 — 사용자 선택
- **Chosen**: 기존 글/이미지/날짜를 보존하고 사내 열람은 허용한다. 계정 소유권이 없는 기존 글은 수정 불가, 관리자만 삭제 가능이다. 비밀번호로 소유권을 가져오거나 이름·이메일로 임의 연결하지 않는다.
- **Rationale**: 현 posts에는 Entra 소유권 정보가 없으므로 작성자를 확실히 매핑할 근거가 없다. 전환 후 기존 글에 대한 비밀번호 수정/삭제 API도 허용하지 않는다.
- **현황 한계**: 이번 인터뷰의 운영 SQL 글 개수 조회는 실패해 현재 글 수를 확인하지 못했다. 11월16일의0개 기록을 현재에도0개라고 간주하지 않는다. 실행 전에 연결과 실제 행 수를 다시 확인하고 데이터 보존을 검증한다.

## D06. 운영·로컬 로그인 — 사용자 선택
- **Chosen**: 운영 사이트와 로컬 개발 화면 모두 실제 Entra 회사 계정으로 로그인한다. 로컬에서 익명/개발자 임의 계정으로 운영 SQL을 읽고 쓰는 우회는 도입하지 않는다.
- **Rationale**: 로그인 흐름을 Azure App Service 앞단에만 의존하면 로컬 개발에서 같은 실제 인증 동작을 사용할 수 없다. 앱에서 표준 OpenID Connect(OIDC: 로그인 결과를 안전하게 확인하는 표준)를 처리한다.
- **로컬 구분**: 일반 개발의 실제 SSO와 자동 테스트의 가짜 OIDC는 다르다. 가짜 인증은 아래 격리 테스트 환경에만 허용한다.

## D07. 인증 연동과 Entra 등록 — 기술 기본값
- **Chosen**: single-tenant v2.0 OIDC Authorization Code + PKCE, state, nonce를 사용한다. 암호 직접 수집/ROPC/implicit flow는 사용하지 않는다. `openid-client`를 서버 전용으로 사용하며 인터뷰 조회 버전은6.9.0이다. 설치 시 공식 릴리스/Node24/Next16 호환성을 다시 검증하고 exact pin한다.
- **등록 분리**: 운영용과 로컬용 confidential Web 앱 등록을 분리해 운영 secret이 로컬에 필요 없게 한다. 두 등록은 같은 tenant/Member 정책/Board.Admin 역할을 갖고 최초 관리자는 동일하다. 기존 GitHub OIDC 배포 ID와 Blob runtime system identity를 로그인 앱으로 재사용하거나 교체하지 않는다.
- **주소**: 운영 origin은 기존 `https://app-vibe-board-prod-7b1417.azurewebsites.net`, 로컬 기본 origin은 `http://127.0.0.1:3000`. callback 경로는 계획에서 고정하고 origin+경로를 정확히 등록한다. wildcard·임의 Host에서 조합한 callback·외부 returnTo는 허용하지 않는다. 127.0.0.1 HTTP redirect의 등록 제한은 공식 문서에 따라 manifest/API 검증으로 처리하며 HTTP localhost fallback을 쓰려면 APP_ORIGIN/Origin/cookie 계약을 함께 일관되게 바꿔야 한다.
- **최소 권한**: `openid profile`을 기본으로 로그인에 필요한 claim만 받는다. Graph 읽기/메일/파일/offline_access·refresh token 권한은 기능에 필요하지 않으므로 요청하지 않는다. Member 판정은 optional ID token claim acct로 처리한다.
- **검증**: 라이브러리로 서명·issuer·audience·시간·nonce/PKCE를 검증한 뒤 앱이 tid/oid/acct/roles/name을 검증한다. 단순 JWT decode나 클라이언트 principal 헤더를 신뢰하지 않는다. 누락·잘못된 설정/토큰은 닫힌 상태로 실패하며 익명 방식으로 되돌아가지 않는다.

## D08. 앱 세션과 로그아웃 — 기술 기본값
- **Chosen**: 브라우저에는 임의의 opaque 세션 쿠키만 저장하고 SQL에는 세션 토큰 해시·검증된 계정 식별자·이름·역할·origin/client ID·만료를 저장한다. ID/access/refresh token을 localStorage·sessionStorage·URL 로그에 저장하지 않는다.
- **수명**: 기존 관리자1시간 정책을 참고해 비슬라이딩 앱 세션 최대1시간, ID token의 유효기간보다 길지 않게 한다. 로그인 트랜잭션은10분/일회용이며 PKCE·nonce·state와 해당 브라우저를 결합한다. 필요한 임시 비밀은 서버에서 보호하고 완료/만료 후 정리한다.
- **쿠키/요청**: 운영 HTTPS에 HttpOnly/Secure/SameSite=Lax/path 고정 쿠키를 사용한다. HTTP 예외는 설정된 로컬 loopback에만 허용하고 Azure에서는 금지한다. 상태 변경은 기존 Origin 검사와 세션 인증을 모두 요구한다. 로그인 callback의 cross-site GET은 정상 OIDC state/nonce 검증으로 별도 처리한다.
- **로그아웃**: 현재 앱 세션을 SQL에서 취소하고 쿠키를 삭제한다. 회사의 다른 앱까지 강제로 로그아웃시키지 않는다. 삭제한 쿠키 재전송은 거부하고 로그인 화면을 보여 준다.
- **제약**: Entra의 사용자 비활성화/역할 회수는 이미 발급된 앱 세션에 자동 즉시 반영된다고 주장하지 않는다. 재로그인/최대1시간 만료 또는 운영자의 해당 세션 취소로 반영한다. 회사 MFA/Conditional Access 정책은 유지하고 실제 검증 시 사용자가 직접 수행한다.

## D09. 페이지·API·이미지 보호 — 기술 기본값
- **Chosen**: 미로그인 페이지는 로그인 화면으로 보내고 안전한 원래 경로를 보관한다. API와 이미지의 미로그인 요청은 리다이렉트 HTML 대신401/기존 ErrorBody, 로그인했지만 Member/작성자/관리자 권한이 없으면403으로 처리한다.
- **서버 경계**: 화면 버튼/Next 페이지 가드만으로 권한을 구현하지 않는다. 모든 데이터 진입점과 변경 트랜잭션에서 계정/역할을 확인하며 직접 API 요청도 같은 규칙을 지킨다.
- **캐시**: 현재 이미지의 public/must-revalidate/ETag 계약을 그대로 유지하지 않고 로그인 보호에 맞게 private/no-store로 바꾼다. 304 처리보다 인증·부모 글/asset 상태 확인이 먼저다. 미로그인·권한 오류·사용자별 응답도 no-store다. 상세 ETag/HEAD 계약은 계획에서 명시한다.
- **표시**: 헤더에 현재 사용자 이름/로그아웃, 관리자에게만 관리 링크를 제공한다. 비밀번호 입력·안내와 기존 관리자 로그인 폼을 제거한다. 회원 가입·프로필 편집·이메일 공개 기능은 추가하지 않는다.

## D10. 글·이미지 소유권과 제한 — 기술 기본값
- **Chosen**: 새 글과 upload session에 검증된 계정 소유권을 기록하고 업로드의 issue/upload/cancel/final attach/기존 이미지 유지·제거·관리자 삭제 전체를 계정 권한으로 전환한다. 기존 author_hash/비밀번호 조건은 새 소유권 계약으로 대체하며 단순히 비밀번호 검사를 건너뛰지 않는다.
- **정합성**: SQL 트랜잭션 안에서 현재 소유권·업로드 상태를 다시 확인한다. 타인 글/이미지/세션 참조와 로그아웃한 사용자의 업로드 토큰 사용을 거부한다. 기존 atomic attach/outbox/soft delete/재시도/용량 예약은 유지한다.
- **제한**: 인증 후 작성·업로드 제한은 tenant+oid에서 만든 서버 HMAC 키로 계정별 적용한다. 작성5회/10분, 세션5회/10분, 파일20회/10분·50MiB 등 기존 창/수치는 유지한다. 회사 공인 IP를 공유하는 직원 전체가 한 사람의 quota를 나눠 쓰지 않게 하며 클라이언트가 보낸 계정 ID는 받지 않는다. 익명 로그인 시작 등 인증 전 제한은 기존 신뢰 가능한 출발지 IP를 사용한다. 구 SQL 제한 행을 초기화하지 않고 키 도메인을 분리한다.
- **보존**: 이미지5MiB/장·5장/글·20MiB/글·추적 용량1GiB, 임시24시간/삭제 soft-delete7일, 원본 비공개 WebP 변환, 검색/20개 페이지/제목·본문·작성일 계약은 유지한다.

## D11. 데이터 전환·운영·복구 — 기술 기본값
- **Chosen**: 추가 migration으로 identity/session/로그인 트랜잭션/새 소유권을 도입한다. 현 schema4에서 순차 업그레이드하고 초기화·기존 소유권 추측·역migration은 하지 않는다. 앱 limited SQL DML과 운영자 migration/grants 분리를 유지한다.
- **준비/실행 구분**: Entra 등록 권한·앱 역할 할당 권한·현재 로그인 사용자·redirect 지원·운영 SQL 연결을 구현 단계에서 사전 확인한다. Azure 구독 권한만으로 디렉터리 권한이 있다고 가정하지 않는다. 권한이 부족하면 완료한 산출물과 필요한 정확한 관리자 조치를 안내한다.
- **배포**: 기존 기능 브랜치와 사용자 미커밋 변경을 보호하고 새 작업 브랜치는 실행 첫 Task에서 생성한다. 검증된 코드/설정/전환 순서/복구 패키지를 갖춘 뒤 기존 main Actions/OIDC 경로로 배포한다. B1 x1·SQLBasic2GB·기존 Blob 정책/Managed Identity는 유지한다.
- **장애/복구**: 새 스키마와 계정 소유권을 이해하는 릴리스만 복구 기준으로 삼는다. 설정/로그인 실패 시 게시판 콘텐츠를 익명 공개하는 fail-open 복구를 하지 않는다. 기존 schema4 ZIP을 새 인증/소유권 도입 뒤 무조건 안전한 rollback이라고 보지 않는다.
- **비밀**: OIDC client secret과 로그인 트랜잭션 보호 키는 서버 전용이다. 운영 App settings는 출력 없이 변경하고 로컬 secret은 Git 제외 로컬 보관만 사용한다. 비밀·code·state·token·cookie·원문 IP·실제 사용자 글을 로그/문서/ZIP/GitHub artifact에 넣지 않는다. secret 수명/교체 절차도 운영 문서에 기록한다.
- **현황**: 현재 기능의 배포 근거는77fe827/Actions43826431986/schema4이나 새 작업의 실제 운영 버전은 실행 전에 다시 확인한다. 기존 .memory/current.md completed 포인터와 board/next-env.d.ts 사용자 변경/루트 도구/3000 서버를 이번 인터뷰에서 변경하지 않았다.

## D12. 검증과 완료 기준 — 기술 기본값
- **Chosen**: 격리 SQL/Azurite/loopback fake OIDC issuer로 토큰 서명/잘못된tenant·aud·nonce·state·acct/중복 callback/로그아웃·세션 만료/직접 API·이미지 차단/본인·타인·관리자 권한/legacy 글 보존·거부/이미지 수명과 기존 회귀를 검사한다. 테스트에서 .env.local·실제 Entra·운영 endpoint/자격증명을 읽거나 쓰지 않는다.
- **실제 SSO**: 로컬과 운영에서 실제 회사 로그인·역할·로그아웃과 자기 QA 글/이미지 생성·수정·삭제를 확인한다. 사용자에게 회사 암호/MFA 코드를 채팅으로 요구하거나 이를 자동 우회하지 않는다. 실제 사람의 로그인·MFA가 필요하면 준비를 모두 마친 후 해당 브라우저 단계만 안내한다. 실제 검증하지 않은 다른 계정·Guest·퇴사 처리까지 검증 완료로 보고하지 않는다.
- **운영 검증**: 미로그인 글/API/이미지 비공개와 기존 health/Actions 정상, 실제 배포 SHA, 재시작 후 세션/글/이미지 유지, 자체 QA만 정리, 쿠키/서식/PC·모바일 화면, 비용/복구 문서를 확인해야 구현 완료다.
- **인접 수정**: password_hash/author_hash 기반 권한·20자 닉네임 제약·공개 이미지 캐시·비밀번호 UI·익명 운영 검증 스크립트와 CI health 호출은 이번 인증 전환에 필수로 함께 갱신한다. 별도 감사 시스템/사용자 관리 UI/Graph 동기화/MFA 정책 변경/구독 관리자 권한 확대는 범위 밖이다.

## 읽기 확인 및 근거
- 코드: board/src/lib/server/posts.ts, admin.ts, post-media.ts, upload-sessions.ts, http.ts, board/src/lib/posts/types.ts, sql/001-posts.sql, sql/004-editor-images.sql, .github/workflows/board-azure.yml, board/README.md, board/.env.example.
- 읽기 확인: Azure DEX tenant 및 signed-in-user 이름/UPN/object ID. 이번 단계의 운영 글 개수 조회는 실패했으므로 수치 미확정. 변경 작업은 수행하지 않았다.
- [Microsoft ID token claims: tid/oid/audience/name](https://learn.microsoft.com/en-us/entra/identity-platform/id-token-claims-reference)
- [Microsoft optional claims: acct Member0/Guest1](https://learn.microsoft.com/en-us/entra/identity-platform/optional-claims-reference)
- [Microsoft app roles와 역할 할당](https://learn.microsoft.com/en-us/entra/identity-platform/howto-add-app-roles-in-apps)
- [Microsoft redirect URI 제약](https://learn.microsoft.com/en-us/entra/identity-platform/reply-url)
- [openid-client 공식 구현/Code+PKCE 예제](https://github.com/panva/openid-client)

## 인터뷰 종료
사용자 설계 선택 D01~D06 확정. 구현·설정 변경 없이 본 결정 문서를 저장했다. 다음 단계는 `/memory-plan entra-id-login`이며 이 단계에서는 구현하지 않는다.
