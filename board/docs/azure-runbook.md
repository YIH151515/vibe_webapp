# 자유 게시판 Azure 운영 기록

2026-11-13 구축 중. 아직 GitHub 최초 릴리스가 끝나지 않았으므로 아래 주소는 **게시판 공개 완료를 뜻하지 않는다**.

Azure 리소스 생성과 실제 검증은 완료했다. Bicep/Validate/WhatIf/Apply/Verify, migration2회, 제한된 SQL 계정의 CRUD/DDL 거부, 글0개/schema3 검증이 통과했다. 기존 로컬 개발 서버의 health200과 관리자 미인증401도 확인했다. 2026-11-16 GitHub 인증 및 배포 변수5개 등록·재조회도 완료했으며 최초 공개 릴리스가 남았다.

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

관리자 비밀번호가 필요하면 **본인 PC에서만** 다음을 실행해 클립보드로 가져온 뒤 `/admin`에 붙여 넣는다. 사용 후 클립보드를 비운다. 값을 채팅으로 전송할 필요가 없다.

```powershell
$boardProtected = (Get-Content "$env:LOCALAPPDATA/VibeBoard/azure-prod.dpapi" -Raw).Trim() | ConvertTo-SecureString
$boardCredential = [Net.NetworkCredential]::new('', $boardProtected).Password | ConvertFrom-Json
Set-Clipboard -Value $boardCredential.adminPassword
Remove-Variable boardCredential,boardProtected
```

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

수동 등록 위치는 Repository Settings → Secrets and variables → Actions → Variables이다. SQL/관리자 암호를 등록하지 않는다. OIDC subject는 `repo:YIH151515/vibe_webapp:ref:refs/heads/main`, issuer는 GitHub, audience는 `api://AzureADTokenExchange`이다. Website Contributor는 이 Web App 범위에만 부여한다. 장기 client secret이나 Entra 앱 등록은 만들지 않았다.

T02의 실제 설정 검증 완료 후 `/memory-execute`가 T03 최초 push·배포·실제 CRUD/관리자/제한·재시작 영속성 검증을 수행한다. 인증이 없다고 Task를 완료로 표시하거나 임의 수동 배포로 자동 배포 검증을 대체하지 않는다. 배포 완료 후 실제 commit/run/검증 결과와 운영 백업·복구 절차를 이 문서에 추가한다.
