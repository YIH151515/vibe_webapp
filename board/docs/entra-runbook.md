# 회사 계정 로그인 운영 기록

운영 주소: https://app-vibe-board-prod-7b1417.azurewebsites.net

구독 DEX: 7b1417d8-833d-4ba9-a5cd-d27c91a28b83

Tenant: 69c1e470-4528-435a-a1ae-de98e0aac738

리소스 그룹: rg-vibe-board-prod

App Service B1 Linux 1대, SQL Basic 2GB, 기존 private Blob과 7일 soft delete를 유지한다.
새 유료 인프라나 Entra 등급·조건부 접근 정책을 추가하지 않았다.

## 앱과 권한

| 환경 | 앱 이름 | Client ID | Application object ID | Service principal ID |
| --- | --- | --- | --- | --- |
| 운영 | vibe-board-entra-prod | 5fc11fd1-1c26-48b9-9cef-ea5785fffbb2 | fd5a5ae5-2eeb-460e-b85e-76c54363bc6d | 727f50c5-7631-4e58-b09c-6ede14ba1ee4 |
| 로컬 | vibe-board-entra-local | 395f9a9a-5abc-4534-8539-eb653bc956ff | c4bf10b9-c180-4fd9-af4b-2b29c836fb94 | 6b7b2d10-2e74-4d36-8e4b-76eb7162dcea |

두 앱 모두 단일 tenant confidential Web client다. implicit/public client는 사용하지 않는다.
요청 scope는 openid profile이며 Graph·메일·파일·offline access 권한은 없다.
ID token의 optional acct claim을 요청하며 Member=0만 허용한다.

운영 redirect는 운영 주소의 /api/auth/callback 한 개다.
로컬 redirect는 http://127.0.0.1:3000/api/auth/callback 과
http://127.0.0.1:3200/api/auth/callback 이다. Graph 등록 후 두 주소를 실제 read-back했다.
임의 localhost 전환이나 wildcard는 허용하지 않는다.

역할 Board.Admin의 ID는 b804ef25-9734-4e12-87e3-b8ea76c73353이다.
최초 할당과 앱 소유자는 윤일호의 immutable object ID
e8222b20-96f4-4c25-a3af-1f40ebbbec56으로 확인했다.
이메일은 권한 판정에 사용하지 않는다. 사내 일반 Member는 역할 할당 없이 로그인한다.
관리자는 타인·기존 비회원 글을 삭제할 수 있으나 타인의 글을 수정할 수 없다.

## 비밀과 설정

90일 client secret은 각 환경에 따로 발급했으며 만료일은 **2027-02-16 UTC**다.
값은 Git·문서·CLI 인자·배포 ZIP·실행 로그에 기록하지 않는다.
board/.deploy/entra-login.dpapi는 현재 Windows 사용자의 DPAPI로 암호화했다.
공개 식별자·keyId·만료일은 같은 디렉터리의 entra-resources.json에 있다.
기존 %LOCALAPPDATA%/VibeBoard/azure-prod.dpapi는 변경하지 않았다.

scripts/provision-entra.ps1 -Mode Inspect|Apply|Verify는 기록된 ID와 소유권으로 재실행한다.
이름만 같은 기존 앱을 인수하거나, 기존 secret을 임의 초기화하지 않는다.
수명이 남은 저장 secret은 재사용한다. 만료 전에 새 credential을 준비하고 read-back·실제 SSO를
확인한 뒤 설정을 교체한다. 이전 credential 제거는 별도로 검토한다.
암호화키 교체는 진행 중 로그인 flow를 재시도하게 하지만 기존 SQL 앱 세션 자체를 취소하지 않는다.

scripts/set-entra-settings.ps1 -Mode Maintenance|Enabled|Verify는 ARM에서 기존 dictionary를 읽고
인증 관련 5개 key만 merge한다. SQL·관리자·rate·미디어 설정은 그대로 두고 read-back을 검증한다.
로컬 .env.local에는 로컬 secret만 쓰며 Next dotenv roundtrip은 성공 여부만 출력한다.
최종 운영과 로컬 AUTH_MODE=entra다. 전환 준비 때는 양쪽 maintenance를 사용했다. 로컬 APP_ORIGIN=3000과 기존 사용자 서버는 유지한다.
3200 실제 앱 검증 시 별도 프로세스에서 origin을 명시한다.
Enabled는 SQL5 호환 기준 ZIP 해시와 실제 health/SHA gate가 있어야 실행된다.
기존 provision-azure.ps1 -Mode Apply는 인증 설정이 존재하면 전체 덮어쓰기를 중단한다.

## T02 준비 당시 검증과 전환 경계

- 운영 health는 기존 77fe827b4ca69cfc9a82cf79688133a1e72ba920으로 정상이다.
- 수동 읽기에서 SQL schema4, 글 1개, 이미지 6개를 확인했다.
  attached 1개 / purged 2개 / soft_deleted 3개이며 occupied/charged는 각각 71,864 bytes로 일치한다.
- 기존 운영자 IP와 현재 출발지가 달라 읽기 연결이 차단됐다. 현재 단일 IP만
  board-118-235-73-99 규칙으로 추가한 후 실제 SELECT에 성공했다.
  다른 규칙·전체 IP 허용·AllowAzureServices·방화벽 해제는 변경하지 않았다.
- 운영 SQL migration/grants/main push는 아직 하지 않았다. 기존 글 내용을 읽거나 변경하지 않았다.
- 실제 preflight는 SQL 없이 loopback3200 callback으로 Code/PKCE/state/nonce/signature/Member/Admin을 검증한다.
  기본 브라우저로 재시도하여 실제 Member/Admin 및 최초 관리자 OID 검증을 완료했다.
- source/해시가 일치하는 SQL5 maintenance 기준 ZIP과 최종 검증 결과는 아래 실행 증거에 추가한다.

## 실제 로그인과 자체 QA

scripts/verify-entra-registration.ps1 실행 시 열린 창에서 회사 계정과 MFA를 직접 완료한다.
3200에 다른 서버가 있으면 종료하지 않고 실행을 중단한다. trace/HAR/token/claims를 저장하지 않는다.
이 검사는 SQL5 전환 후 실제 앱 로그인을 대체하지 않는다.

최종 전환은 새 코드 maintenance ZIP으로 콘텐츠를 닫은 뒤 SQL5 migration/grants,
Actions 배포·SHA 검증, Entra enable, 실제 로컬3200/운영 로그인 순으로 진행한다.
schema4 ZIP이나 anonymous 모드로 되돌리지 않는다. 실패 시 schema5 호환 maintenance로 닫는다.
전환 전 원본 글/원장의 메모리 snapshot과 hash를 비교하며 초기화나 기존 글 소유권 추정은 하지 않는다.

scripts/verify-live-entra.ps1 -Commit <40hex>는 운영 실제 브라우저 QA다.
-Local은 별도3200용이다. 각 실행은 자체 UUID prefix 글 한 개와 local1/prod2 이미지,
local1/prod2 업로드 세션만 사용한다. 실제 사람 로그인 외 자격 증명 입력은 자동화하지 않는다.
자체 계정·prefix·ID를 SQL에서 확인한 글만 API로 삭제하고, 자체 세션에 속한 assetIds만 정리한다.
soft delete의 7일 charge는 유지한다. 마지막 앱 logout과 이전 cookie replay401을 확인한다.
다른 운영 자료나 rate counter를 초기화하지 않는다. 잔여 자체 ID가 있으면 완료하지 않는다.

## 오류와 공식 근거

403은 안전한 Graph code로 분류한다. 구독 Owner는 Entra 디렉터리 관리 권한과 별개다.
앱 생성·본인 소유 secret 생성·사용자 app role 할당에 필요한 권한이 다르므로
실제 실패 API에 해당하는 관리자 조치만 요청한다. tenant 전체 역할을 자동으로 부여하지 않는다.
AADSTS50011이면 manifest의 정확한 callback과 요청 origin을 함께 확인한다.
Member 거부는 acct, tenant, 역할·OID 검증을 유지한 채 원인을 확인한다.

- [앱 생성 API](https://learn.microsoft.com/en-us/graph/api/application-post-applications?view=graph-rest-1.0)
- [사용자 app role 할당](https://learn.microsoft.com/en-us/graph/api/serviceprincipal-post-approleassignedto?view=graph-rest-1.0)
- [secret 추가 API](https://learn.microsoft.com/en-us/graph/api/application-addpassword?view=graph-rest-1.0)
- [acct claim](https://learn.microsoft.com/en-us/entra/identity-platform/optional-claims-reference)
- [127.0.0.1 callback 제약](https://learn.microsoft.com/en-us/entra/identity-platform/reply-url)

## 2026-11-18 실행 증거

사전 실제SSO는10분대기후정상Member/Admin결과없이종료되었다. 실제회사로그인/MFA확인후재시도하며미완료를성공으로표시하지않는다. 앱브라우저/3200은정리했다.

서비스81/API21/E2E28·타입/lint/build·PowerShell강화AST/합성dotenv4개·독립Linux패키지1검증이성공했다. 실제비밀과신규9개소스내용대조로포함0을확인했다.

운영자Contributor배포권한, Node24-lts/alwaysOn/FTPSDisabled 및privateBlob/SharedKeyOff/TLS1.2/soft7일을확인했다. verify:image-access도성공했다.

고정Gitarchive source c62339c5eadfa61ff61083912801aa79de383072의기준ZIP은 board/.deploy/entra-schema5-maintenance/board.zip이다. SHA256 aa1eebf1a659fb5ee65a7202adb8844281146f69c3b7d1545d10d1964435fd4d이며release.json의source/node24/해시와일치한다. SQL없는독립기동에서로그인·CSS200, 보호페이지·API·이미지503, health503을검증했다.

## 실제 사전 로그인 성공

첫 대기 미완료 후 기본 브라우저와 loopback 직접 링크로 재시도했다.
tenantMatches/member/admin 모두 true이며 real-code-pkce-nonce-signature, tenant-member, initial-administrator-oid, Board.Admin 검증에 성공했다. SQL·앱세션을 만들지 않는 사전 검사다. 실제 로컬·운영 앱 로그인과 자체 QA는 SQL5 전환 후 별도로 수행한다.

## 최종 전환 도구

release-entra.ps1은검증된schema5기준ZIP으로먼저콘텐츠를닫고버전을설정한다. cutover-entra-sql.ts는원본글/비밀번호해시/작성일/기존첨부참조를메모리에만보관해migration2회·앱grants·실제제한계정검증후비교한다. 원본데이터나snapshot을파일/로그에저장하지않는다.

실제로그인후Entra가추가한0역할기본접근할당은관리자권한이아니므로보존한다. Verify는비0역할중Board.Admin이확정윤일호User에게만있는지검사한다. [공식appRoleAssignment정의](https://learn.microsoft.com/en-us/graph/api/resources/approleassignment?view=graph-rest-1.0)에따르며추가관리자/그룹/다른역할은계속거부한다.

실제QA도구는별도의loopback제어BrowserServer를사용하고자신이시작한창만앞으로표시한다. cookies/WS제어주소/token은출력·저장하지않으며브라우저와자체3200서버를정리한다. 사용자3000서버는종료하지않는다.

## 운영 전환 과정 기록

2026-11-18 07:13:58 UTC부터전환을시작해schema5호환maintenance기준ZIP을운영에배포했다. /login200, 보호root/API503으로닫힌상태를확인했다. 기존SQL4때문에health는503이며자료/스키마쓰기전이다.

운영자TDS출발지가118.235.12.2로변경돼DB접속이차단됐다. 새IP영구허용은자동승인검토에서구체적인권한승인미확인을이유로거부됐다. 이후 사용자가 단일IP 최대60분 임시허용을 명시 승인했다. 고유 임시 규칙으로 접속해 SQL5 migration2회·제한계정권한·원본글1개/첨부1개·날짜·이미지회계 보존을 확인했다. 임시 규칙은 작업 종료 시 삭제하고 실제 삭제를 확인한다.

준비소스be048b6fe282f3b592b750f1874f7efbc4a50ea7은featurebranch에만게시했고main은변경하지않았다. feature수동검증Actions44258216715는success로완료됐다(test:all/type/lint/workflow/Linux패키지). deploy는main조건으로skipped이며실제main배포성공을대체하지않는다.

## 권한 변경과 세션 취소 인계

일반 사용자는 이 tenant의 Member여야 한다. 이메일 도메인, 표시 이름, Guest 초대 여부만으로 권한을 부여하지 않는다. 관리자 변경은 Entra Enterprise applications에서 위 환경별 service principal의 Users and groups에 정확한 사용자 object ID와 Board.Admin을 할당하거나 해당 할당을 회수한다. 로컬과 운영의 할당은 별도다. 현재 Verify는 최초 관리자 한 명만 허용하는 고정 정책이므로 승인된 관리자 변경 시 공개 설정과 검증 정책도 함께 갱신한다.

역할·Member 상태·계정 사용 중지의 변경은 이미 발급된 SQL 세션에 실시간 반영되지 않는다. 해당 사용자는 재로그인하거나 최대1시간의 만료를 기다린다. 긴급 회수는 운영자가 정확한 app_origin/client_id/tenant_id/object_id와 아직 유효한 세션만 조회해 대상을 검토하고 `src/lib/server/auth-session.ts`의 `revokeAppSession(pool, principal)`을 호출한다. principal은 조회한 tenantId/objectId/displayName/isAdmin/sessionHash/expiresAt으로 메모리에서 구성하며 세션 해시나 사용자 정보를 로그·파일·명령 인수로 내보내지 않는다. 운영 대상은 운영 APP_ORIGIN/client 자격증명을 프로세스에만 주입하고 로컬 .env의 앱과 혼동하지 않는다.

이 함수는 capacity→auth→upload→asset 잠금 순서의 트랜잭션에서 세션을 취소하고 해당 세션의 active 업로드와 draft 파일만 삭제 대기열로 보낸다. 단순 auth_sessions UPDATE로 대체하거나 다른 계정의 세션을 일괄 초기화하지 않는다. 취소 후 기존 쿠키의 API401, 해당 세션 draft 취소, 게시된 첨부 보존을 확인한다. 자체 QA의 logout과 재사용401은 같은 취소 함수를 검증한다.

## 비밀 교체와 관측 설정

90일 만료 전에 각 앱별로 새 client secret을 발급하고 새 값을 해당 환경 DPAPI와 ARM 또는 로컬 설정에 안전하게 전달한다. 기존 dictionary를 merge해 SQL/Blob/rate 설정을 보존한다. 새 설정의 실제 SSO와 health를 확인한 뒤 해당 앱의 이전 keyId만 제거한다. 두 앱의 secret을 서로 복사하지 않으며 채팅·Git·일반 JSON 파일로 전달하지 않는다. 현재 provision 도구는 유효한 기존 secret을 재사용하므로 만료 전 회전은 명시적 운영 절차로 수행한다.

AUTH_ENCRYPTION_KEY 교체 시 진행 중인 최대10분 로그인 flow는 재시도해야 한다. 기존 SQL 로그인 세션은 별도 취소가 필요하다. 운영 callback의 code/state/query, token/claim/cookie, 요청 본문을 로그에 남기지 않는다. App Service HTTP 로그·detailed errors·request tracing은 비활성 상태를 유지하고 APM이나 프록시를 추가할 때 callback/query 마스킹을 먼저 검증한다. 실제 로그인 브라우저는 trace/HAR/스크린샷을 수집하지 않는다.

로컬도 운영 SQL/Blob을 공유한다. 자동 테스트는 격리 DB/Azurite/가짜 issuer만 사용하고 실제 .env.local을 로드하지 않는다. 점검 복구에는 SQL5 호환 기준 ZIP만 사용하며 익명 서비스 재개나 schema4 역전환으로 인증 장애를 해결하지 않는다.

로컬 실제 앱 QA는 ba5e3bb223272c112b074bc0c1ec45567c419a63 기준으로 통과했다. 최초 세 번은 로컬 EDITOR_FEATURE_ENABLED=0 때문에 서식 버튼을 찾지 못했으며 글/파일/업로드 세션 생성은0이었다. wrapper가 자신이 시작한3200 child환경에서만 에디터를 켜도록 수정했다. 사용자 .env.local의 미디어 flag와3000 서버는 보존했다.

성공한 로컬 QA는 글1개/이미지1개/업로드 세션1회다. 실제Member/Admin 세션·글서식·이미지인증/ETag/HEAD·수정/날짜·1280/390 화면·관리자동의·자체삭제·logout이전쿠키401을 확인했다. 잔여QA글/삭제대기asset ID는0이고 Blob은7일softdelete 동안 사용 용량을 유지한다. 로컬 restart callback은 no-op이며 실제 AppService 재시작 검증은 운영 프로필에서 별도로 수행한다.

## 최종 운영 결과 — 2026-11-18

| 항목 | 확인 결과 |
| --- | --- |
| 운영 URL | https://app-vibe-board-prod-7b1417.azurewebsites.net |
| 실제 source | ba5e3bb223272c112b074bc0c1ec45567c419a63 |
| main Actions | [44262468755 success](https://github.com/YIH151515/vibe_webapp/actions/runs/44262468755) — verify와 deploy 모두 성공 |
| 실행 상태 | Running / HTTPS only / SQL5 / AUTH_MODE=entra / health200 status ok 및 version 일치 |
| 익명 접근 | login200, 글·설정·이미지 API401. 보호 페이지는 로그인 화면으로 이동 |
| 실제 계정 | 로컬·운영 별도 앱에서 Member/최초 관리자 OID/Board.Admin 확인 |
| 실제 QA | 로컬1글1이미지1업로드세션 + 운영1글2이미지2업로드세션. QA글17/18 삭제, 잔여 자체post/asset ID0 |
| 브라우저·미디어 | 서식·파일선택·검색·수정/작성일·1280/390·HEAD/ETag인증·Blob직접익명차단·관리자동의/삭제·logout재사용401 |
| 실제 재시작 | 운영 App Service 재시작 후 동일 앱세션·문서·이미지 bytes 유지 |
| 원본 보존 | 기존글1/기존attached1, 원문·해시·날짜·이미지참조 메모리비교 통과. 기존소유자는 NULL 유지 |
| 최종 SQL 회계 | 글1(legacy1)/QA0, attached1/purged2/soft_deleted6, occupied=charged72,206bytes |
| 복구 ZIP | .deploy/entra-schema5-maintenance/board.zip + release.json, node24 |
| 최종 ZIP SHA256 | 061330b00891785cd5d4cc9d685cf175defdba5f851e1a72d082fcf0174f6161 |
| 준비 ZIP 보존 | 같은 디렉터리 prepared-c62339c5에 원본 준비패키지 보존 |
| 임시 방화벽 | 승인된118.235.12.2 단일IP 규칙 board-entra-temp-6bb6cc99ca144a49a2e235724fb68df3은 종료signal 후 삭제·ARM404 확인. 60분 이내 종료 |
| 관측 보호 | HTTP logs/detailed errors/request tracing=false, 실제SSO trace/HAR/쿠키/claim/콜백query 기록 없음 |
| 사용자 작업 보호 | 사용자3000 PID29808 유지, 자체3200 종료. next-env 두dev타입경로/루트도구/기존DPAPI/SQLite·Docker pad 보존 |

자동검사는 최신 main에서 서비스/API/E2E 전체와 typecheck/lint/workflow/Linux ZIP을 통과했다. 실제 일반Member·Guest·다른tenant·타owner 계정은 추가로 로그인하지 않았으며, 해당 권한과 악성 OIDC 입력은 격리SQL/가짜서명issuer 테스트로 검증했다. 긴 표시이름256자는 합성화면으로 검증했고 실제 계정 이름을 변경하지 않았다.

삭제된 QA 이미지는 즉시 접근이 차단되지만 Blob soft delete7일과 용량보류가 남는다. 이를 물리 완전삭제로 해석하지 않는다. 실제 배포source와 뒤따르는 docs/.memory 완료커밋의 SHA는 다를 수 있으며 완료문서 변경은 배포를 다시 실행하지 않는다.

## 보안 정책 유지 — 2026-11-19 수정 작업

SCM/FTP 배포 기본 인증은 `harden-publishing.ps1 -Mode Apply`로 두 정책만 false로 바꾸고 Verify로 재조회한다. Inspect/Verify는 읽기만 한다. 기존 Entra/SQL/Blob 설정을 초기화하거나 전체 인프라 Apply로 우회하지 않는다. 비상 배포도 Entra/OIDC 경로를 사용하며 기본 인증을 다시 켜지 않는다. 실제 main 배포·회사 계정 브라우저 재검증을 완료했다.

HTML의 CSP nonce는 요청마다 생성하는32바이트 난수이며 인증 암호화키나 로그인 쿠키와 별개다. 외부 x-nonce와 CSP 헤더를 신뢰하지 않고 서버에서 덮어쓴다. 스크립트는 nonce/strict-dynamic으로 제어하고 production unsafe-inline/unsafe-eval은 허용하지 않는다. style-src의 unsafe-inline만 기존 React 관리자 스타일·Tiptap 편집 스타일 호환을 위해 허용한다. 이미지 미리보기의 blob:/data:와 서버 이미지 경로를 유지한다.

form-action은 self와 정확한 Microsoft 로그인 origin을 허용한다. 공통 Referrer-Policy는 strict-origin-when-cross-origin으로 정상 로그인 POST의 Origin을 유지하고, /api/auth 경로에는 별도 no-referrer를 적용해 콜백 쿼리를 보호한다. Next의 전역 headers가 route 응답보다 우선할 수 있으므로 이 예외를 삭제하지 않는다. CSP를 임의의 unsafe-inline 스크립트나 wildcard로 바꿔 로그인 문제를 해결하지 않는다.

프레임 삽입은 frame-ancestors none/X-Frame-Options DENY로 차단한다. HSTS max-age31536000은 본 앱 HTTPS 호스트에 적용하며 공유 Azure 상위도메인의 preload를 변경하지 않는다. 오류·로그인·점검 화면과 API에도 공통 방어 헤더를 적용한다. 새로운 외부 스크립트·iframe·폼 전송 기능은 정확한 허용 출처와 실제 CSP 회귀를 함께 검토한다.

보안 수정 실제 실행 source: 083b0af7808a18feb178c665f7cd45067c7bd35a / Actions44479404023 success. SQL5·AUTH_MODEentra·기존 자료와 비용 등급을 유지했다. 최종 복구 ZIP SHA256: 74a5f9d427f90d2b9729bb520d4f5a3bb7d6877b250ff12f40aeee11b4469a93. 상세 검증 범위와 예외는 보안 점검 보고서를 따른다.
