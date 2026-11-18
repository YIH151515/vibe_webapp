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
현재는 양쪽 AUTH_MODE=maintenance다. 로컬 APP_ORIGIN=3000과 기존 사용자 서버는 유지한다.
3200 실제 앱 검증 시 별도 프로세스에서 origin을 명시한다.
Enabled는 SQL5 호환 기준 ZIP 해시와 실제 health/SHA gate가 있어야 실행된다.
기존 provision-azure.ps1 -Mode Apply는 인증 설정이 존재하면 전체 덮어쓰기를 중단한다.

## 현재 검증과 전환 경계

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
