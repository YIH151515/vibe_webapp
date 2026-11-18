# 자유 게시판 Azure 운영 기록

2026-11-18 Entra 로그인 전환 완료. 운영 주소: **https://app-vibe-board-prod-7b1417.azurewebsites.net**. 관리자 화면은 같은 주소의 `/admin`이다.

Azure 리소스 생성과 실제 검증을 완료했다. Bicep/Validate/WhatIf/Apply/Verify, migration2회, 제한된 SQL 계정의 CRUD/DDL 거부, 글0개/schema3 검증이 통과했다. GitHub 변수5개 등록 후 main 자동 배포가 성공했고 공개 환경의 CRUD·관리자·프록시 IP·제한·재시작·브라우저 검증도 통과했다.

## 이전 이미지 에디터 릴리스 — 2026-11-16

2026-11-16 schema4로 전환하고 `77fe827b4ca69cfc9a82cf79688133a1e72ba920`을 운영에 배포했다. [성공 Actions43826431986](https://github.com/YIH151515/vibe_webapp/actions/runs/43826431986)의 전체93개 검사와 OIDC/ZIP/실제 health 검증이 통과했다. EDITOR_FEATURE_ENABLED=1, MEDIA_CLEANUP_ENABLED=1이며 private Blob `stvibeboardimg7b1417/board-images`는 런타임 system identity로 접근한다. 기존 B1 x1/SQLBasic2GB 등급은 유지했다.

실제 공개 QA로 이미지 게시·서식·검색·PC1280/모바일390·수정/제거/추가·재시작 후 동일 파일 유지·관리자 삭제/로그아웃을 검증했다. QA 글과 삭제 대기 작업은0, 파일은 soft-delete3개/396bytes를7일 보존하고 있다(07:57:16Z 조회). 자세한 정책·권한·비용·복구/검증 도구는 [이미지 운영 안내](images-runbook.md)를 따른다. **schema4 이후 아래 최초 schema3 ZIP으로 복구하지 않는다.** 최종 schema4 baseline ZIP SHA256은 `26e7d087d6497b758d5052b06ccd409815602e80c4043a71fb98ddc2b9421d7f`이며 `.deploy/compat-schema4`에 manifest와 보관했다. 문서만 갱신한 HEAD와 실제 실행 SHA는 다를 수 있다.

## 최초 배포 증거

| 항목 | 결과 |
| --- | --- |
| 실제 배포 commit | 57fda56f9e28dbc33971323dd804b2268cee5a55 |
| 성공 Actions | https://github.com/YIH151515/vibe_webapp/actions/runs/43777945761 |
| 실행 결과 | verify → artifact SHA256 → OIDC → ZIP 배포 → health/version 모두 성공 |
| 공개 health | HTTP200 / status ok / version 위 commit과 일치 |
| 공개 화면 | 홈페이지·CSS200, Chromium1280/390px 검색·긴 본문·비밀번호 빈 입력·관리자 로그인/로그아웃·가로 넘침 없음 |
| API 검증 | 작성·조회·오답 무변경·수정·작성일 유지·삭제404·다른 Origin403 |
| 관리자 | 미인증401, Secure/HttpOnly/SameSite=Strict/Path 쿠키, 동의 없는 삭제400, 관리자 삭제204, 로그아웃 토큰 재사용401 |
| IP·제한 | 서로 다른 client-ip/x-forwarded-for/x-client-ip에도 실제 출발지의 같은 HMAC 버킷에 누적, 여섯 번째 작성429/Retry-After |
| 재시작 | 실제 az webapp restart 후 health 버전·QA 글·관리자 세션·작성 제한 유지 |
| 정리 | 소유 QA 글 모두 삭제. 검증 직후 전체 글0개, 진행 중 예약0. 테스트용 서버·컨테이너 정리, 운영 App은 Running 유지 |
| 자동 검사 | 로컬 및 GitHub 서비스19/API14/E2E10 총43개, typecheck/lint/build, 실제 Linux ZIP 기동·CSS·DB 없는 health503·비밀파일 배제 통과 |

작성 제한 검증 직후 Retry-After589초였다. 동일 출발지의 글 작성 제한 만료는 **2026-11-16 09:17:36 KST**이며 제한을 임의 초기화하지 않았다. 조회·수정·삭제와 다른 출발지는 이 작성 제한의 영향을 받지 않는다. 이 기록은 당시 검증 증거이며 이후 사용량과는 별개다.

## 리소스와 예산

| 항목 | 실제 값 |
| --- | --- |
| 구독 | DEX / 7b1417d8-833d-4ba9-a5cd-d27c91a28b83 |
| Tenant | 69c1e470-4528-435a-a1ae-de98e0aac738 |
| 지역 / RG | koreacentral / rg-vibe-board-prod |
| Linux plan | asp-vibe-board-prod / B1 / 1 instance |
| App | app-vibe-board-prod-7b1417 |
| Azure가 반환한 기본 호스트 | app-vibe-board-prod-7b1417.azurewebsites.net |
| SQL server / DB | sql-vibe-board-7b1417 / dbboardprod |
| SQL FQDN | sql-vibe-board-7b1417.database.windows.net |
| DB 크기 / 성능 / 백업 | Basic / 5 DTU / 2GB / Local / PITR 7일 |
| 배포 ID | id-vibe-board-github |
| 배포 Client ID | de9e7f82-b0f8-40f8-94c7-025ea350d37c |
| 배포 Principal ID | a024b4f3-2dfe-4cf0-b2e1-3c0cd455f8ab |

공식 [Retail Prices API](https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices)를 2026-11-13 KRW로 재조회했다. 한국 중부 Linux B1 시간당24.0777원×730시간 + Single Basic B 일당236.8978원×730/24일 = 약24,782원/월. 세금·송신 트래픽·추가 백업 등은 별도이며 목표는 월50,000원 이하이다. 리소스를 생성한 시점부터 요금이 발생한다. 다른 유료 모니터링·도메인·geo/LTR·VNet은 생성하지 않았다.

## 구축 및 검증

저장소 루트에서 `az bicep build --file infra/azure/main.bicep --stdout`로 문법을 검사한다. board에서 다음 순서로 실행한다. Validate는 신규 RG가 필요하면 소유 태그를 붙여 생성하며, 동명 타인 리소스를 채택하지 않는다.

```powershell
./scripts/provision-azure.ps1 -Mode Validate
./scripts/provision-azure.ps1 -Mode WhatIf
./scripts/provision-azure.ps1 -Mode Apply
npm run db:migrate
npm run db:migrate
npm run provision:sql
npm run verify:sql-access -- --expect-empty
./scripts/provision-azure.ps1 -Mode Verify
```

SQL migration은 운영자 계정으로만 실행한다. 앱 `board_app`은 posts/rate_buckets/admin_sessions의 DML과 schema_migrations의 SELECT만 사용하며 DDL/db_owner 권한이 없다. 권한 검사는 UUID QA 행과 자체 DDL 검사 객체만 정리한다. 운영 DB의 기존 글·스키마를 초기화하거나 SQLite 파일을 삭제하지 않는다.

`--expect-empty`는 최초 공개 전 빈 DB 검증 전용이다. 운영 글이 생긴 뒤에는 해당 플래그 없이 검사한다.

`main.bicep`은 Linux B1/SQL Basic/7일 백업/OIDC/앱 설정을 선언한다. `firewall.bicep`은 앱 생성 후 조회한 outbound/possibleOutbound IP와 실행자의 공개 IPv4를 정확한 단일 IP 규칙으로 등록한다. `0.0.0.0` Azure 전체 허용은 사용하지 않는다. 앱 스케일/플랜 변경 또는 로컬 IP 변경 시 WhatIf를 검토하고 허용 IP를 갱신한다. incremental 배포는 과거 IP 규칙을 자동 삭제하지 않으므로 `az sql server firewall-rule list`에서 현재 집합과 비교해 불필요한 **해당 규칙만** 정리한다.

## 비밀값과 로컬 설정

운영 SQL 관리자·앱 비밀번호, 관리자 로그인 비밀번호, scrypt hash, 32byte session/rate 키를 난수로 생성했다. 원문은 `%LOCALAPPDATA%\VibeBoard\azure-prod.dpapi`에 현재 Windows 사용자 DPAPI로 암호화하고 디렉터리 ACL을 제한한다. 일시적인 배포 매개변수 파일은 같은 보호 폴더에서 만들고 finally에서 삭제한다. 비밀값을 명령 인수·Git·로그·artifact·일반 parameter 예시에 넣지 않는다.

과거 비회원 관리자 비밀번호는 Entra 전환 후 로그인에 사용할 수 없다. 기존 DPAPI는 SQL 등 기존 설정 보존을 위해 유지한다. 회사 계정 인증 비밀은 별도 `board/.deploy/entra-login.dpapi`에 보관하며 [Entra 운영 안내](entra-runbook.md)의 등록·교체 절차를 사용한다.

`board/.env.local`은 Git에서 제외되며 로컬 앱도 **같은 운영 데이터**를 변경한다. SQL_MIGRATION_*는 로컬 운영자 도구 전용이고 Azure에는 설정하지 않는다. APP_ORIGIN은 로컬 `http://127.0.0.1:3000`, Azure 실제 HTTPS 기본 호스트이다. 로컬 REQUEST_IP_MODE=local/LOCAL_CLIENT_IP는 실제 공개 IP, Azure는 app-service이다. DATABASE_PATH는 폐지됐으며 기존 값과 SQLite 파일은 사용하지 않고 보관한다. Next 환경파일의 scrypt `$`는 `\$`로 escape해야 한다. Azure 앱 설정의 값에는 escape를 넣지 않는다.

비밀값을 변경하려면 보호 저장소의 값을 안전하게 갱신한 뒤 `./scripts/set-azure-settings.ps1`로 원문을 명령 인수에 노출하지 않고 전달한다. SQL 앱 비밀번호는 SQL 사용자의 암호도 같은 값으로 명시적으로 변경해야 하며 기존 사용자 암호를 provision 스크립트가 임의 교체하지 않는다. 관리자 hash 또는 session 키 변경은 기존 세션을 무효화하고, rate 키 변경은 기존 제한 식별자를 바꾼다. 보관 파일 분실 시 SQL 관리자 암호는 Azure에서 재설정해야 한다. 원문을 소스에 기록하지 않는다.

## GitHub 인증과 남은 배포 연결

대상은 [YIH151515/vibe_webapp](https://github.com/YIH151515/vibe_webapp)이다. 2026-11-16 로컬 Git Credential Manager의 저장소 write 권한과 변수5개 등록·재조회를 확인했다. 향후 인증이 만료되면 PowerShell에서 아래 명령으로 GitHub의 기기 인증을 완료한다. 토큰을 채팅에 붙여 넣지 않는다.

```powershell
git credential-manager github login --username YIH151515 --device
cd D:/vibeweb/board
node scripts/configure-github.mjs --check
node scripts/configure-github.mjs
```

변수 설정 도구는 OS 자격증명 저장소의 토큰을 메모리에서만 사용하고 다음 비밀 아닌 Actions Variables를 등록·재조회한다.

| 변수 | 값 |
| --- | --- |
| AZURE_CLIENT_ID | de9e7f82-b0f8-40f8-94c7-025ea350d37c |
| AZURE_TENANT_ID | 69c1e470-4528-435a-a1ae-de98e0aac738 |
| AZURE_SUBSCRIPTION_ID | 7b1417d8-833d-4ba9-a5cd-d27c91a28b83 |
| AZURE_WEBAPP_NAME | app-vibe-board-prod-7b1417 |
| AZURE_RESOURCE_GROUP | rg-vibe-board-prod |

수동 등록 위치는 Repository Settings → Secrets and variables → Actions → Variables이다. SQL/관리자 암호를 등록하지 않는다. 실제 OIDC subject는 `repo:YIH151515@355682187/vibe_webapp@1456296194:ref:refs/heads/main`, issuer는 GitHub, audience는 `api://AzureADTokenExchange`이다. 첫 실행에서 이름만 있는 subject와 불일치하여, GitHub API로 검증한 owner/repository ID를 포함하는 immutable subject로 수정했다. [GitHub OIDC 공식 문서](https://docs.github.com/en/actions/reference/security/oidc#immutable-subject-claims) 형식과 일치하며 이 저장소의 main만 허용한다. Website Contributor는 이 Web App 범위에만 부여한다. 배포용 OIDC identity에는 장기 client secret을 만들지 않았다. 사용자 로그인용 별도 Entra 앱은 Entra 운영 안내를 따른다.

T02와 T03의 실제 설정·공개 배포 검증을 완료했다. 이후 README/docs/.memory만 갱신하는 완료 커밋은 재배포를 유발하지 않으므로 Git main의 HEAD와 위 실제 배포 commit은 다를 수 있다. 실행 버전은 `/api/health`로 확인한다.

## Entra 전환과 운영 검증

이 문서의 비회원 공개 검증 결과와 schema4 버전은 과거 기록이다. 현재 실제 전환 상태는 [Entra 운영 안내](entra-runbook.md)를 우선한다. SQL5 migration·원본 보존·main Actions·실제 로컬/운영 앱 QA를 완료했고 AUTH_MODE=entra다. 실제 실행 source는 ba5e3bb223272c112b074bc0c1ec45567c419a63이며 [성공 Actions44262468755](https://github.com/YIH151515/vibe_webapp/actions/runs/44262468755)와 health가 일치한다.

현재 QA는 `./scripts/verify-live-entra.ps1 -Commit <실제40자리SHA> -Environment Local` 후 `-Environment Production` 순서다. 별도 브라우저에서 사람이 회사 계정 로그인과 MFA를 수행한다. 비밀번호 기반 verify-live/verify-live-media 도구는 Entra 운영에서 실행하지 않는다.

실제 QA 상한은 로컬1글/1이미지, 운영1글/2이미지, 총 업로드 세션3회다. 자체 UUID·현재 계정 소유 데이터만 정리하고 기존 글·이미지·제한 카운터는 변경하지 않는다. 실패 후 남은 QA ID가 있으면 정리 완료 전 Task를 완료 처리하지 않는다. 실제 SSO 브라우저의 trace/HAR/쿠키/콜백 쿼리를 기록하지 않는다.

배포 상태는 `node scripts/github-release.mjs <배포SHA>`로 확인한다. 실행에 실패한 경우에만 --failure로 실패 단계 진단을 확인하며 설정 전체·쿠키·요청 body·암호는 로그에 출력하지 않는다. callback/query·요청 본문·쿠키가 노출될 수 있는 원시 HTTP 로그를 켜지 않는다. HTTP logs/detailed errors/request tracing은 false로 확인했으며 관측 설정을 추가할 때 마스킹부터 검증한다.

백업은 Azure SQL Basic의 PITR7일·Local 중복 저장을 실제 확인했다. 복원은 Azure Portal의 해당 DB → Restore에서 필요한 시점을 선택하고 **별도 DB 이름**으로 실행한다. 복원 대상/추가 비용을 검토한 뒤 별도 DB로 검증하고 운영 연결을 전환한다. 기존 운영 DB를 지우거나 이번 구축 검증에서 불필요한 복원 DB를 만들지 않는다.

SQL5 전환 후 복구는 `AUTH_MODE=maintenance`에서 검증한 `.deploy/entra-schema5-maintenance/board.zip`과 release.json을 사용한다. manifest의 commit/node24/SHA256과 실제 ZIP을 대조하고 APP_VERSION 및 health를 확인한다. 과거 schema3/4 또는 익명 접근 ZIP으로 복구하지 않는다. DB 역migration이나 운영 자료 초기화 없이 닫힌 상태에서 수정한다. 최종 main Actions 성공 뒤 그 실제 패키지로 기준 ZIP을 갱신하고 준비 패키지도 보존한다.

현재 비용은 Azure Portal → 구독 DEX → Cost Management → Cost analysis에서 RG rg-vibe-board-prod 필터로 확인한다. 월50,000원은 목표이며 강제 지출 차단이 아니다. SKU/인스턴스/백업 변경 전 비용을 다시 확인한다.
