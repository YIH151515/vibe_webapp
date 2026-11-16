# Plan: 자유 게시판 Azure 공개 운영

- Date: 2026-11-13
- Status: completed
- Decisions: [확정 결정](../decisions/2026-11-13-free-board-azure.md)

## Goal
한국 중부 Linux App Service B1 + Azure SQL Basic에 비회원 게시판을 공개한다. 로컬과 공개 앱은 같은 DB를 사용하고 새 빈 DB로 시작한다. 관리자 삭제, DB 기반 반복 요청 제한, GitHub main 자동 배포를 추가한다. 월 목표 50,000원 이하, 현재 예상 기본 요금 약24,782원/월(2026-11-13 스냅샷, 세금·추가 사용료 별도).

## Phases
| Phase | Status | Summary | Blueprint |
| :--- | :--- | :--- | :--- |
| P01 | completed | SQL 전환·공개 운영 보안·관리자 | [P01](../phases/2026-11-13-free-board-azure/P01-cloud-app/phase.md) |
| P02 | completed | Linux 패키지·CI·Azure 구축·첫 공개 | [P02](../phases/2026-11-13-free-board-azure/P02-azure-delivery/phase.md) |

## Roadmap
| 순서 | Task | 결과 |
| :--- | :--- | :--- |
| 1 | P01-T01 sql-storage | 비동기 SQL 저장과 운영 DB 격리 테스트 |
| 2 | P01-T02 request-security | HTTPS 출처·IP 식별·공유 반복 요청 제한 |
| 3 | P01-T03 admin-moderation | 관리자 세션·권한·삭제 화면/API |
| 4 | P02-T01 ci-package | standalone ZIP과 검사/배포 workflow |
| 5 | P02-T02 azure-resources | 리소스·SQL 권한·방화벽·OIDC·설정 |
| 6 | P02-T03 first-release | 최초 push·실제 배포 검증·운영 인계 |

## Architecture
- 앱 경로 board, mssql12.7.14(Tedious), @types/mssql12.3.0. SQLite 이중 구현은 제거하고 파일은 보관한다.
- DB: dbo.schema_migrations, posts(version1)→rate_buckets(version2)→admin_sessions(version3). additive migration을 명시 CLI로만 실행한다. import/build/runtime에서 자동 DDL하지 않는다.
- 전역 지연 연결 pool 하나, 모든 저장 서비스 Promise. 로컬은 실제 운영 DB를 변경한다.
- 테스트: @testcontainers/mssqlserver12.2.1 + SQL Server2022 Developer. 매 실행 일회용 컨테이너·자격증명·테스트 DB. Linux 엔진 기동 및 테스트 소유 컨테이너 정리를 확인했다. NODE_ENV=test로 운영 .env.local을 제외한다.
- Origin은 APP_ORIGIN으로 검증한다. HTTPS 프록시 헤더를 무조건 신뢰하지 않는다.
- IP는 직접 App Service 프런트엔드가 덮어쓰는 client-ip를 배포 검증 후 사용한다. local 모드는 LOCAL_CLIENT_IP로 설정한 공개 IP를 사용하고 헤더를 무시한다. IP 원문 대신 HMAC 식별자를 DB에 저장한다.
- 제한: 작성5/10분, 글 비밀번호 실패10/10분, 관리자 실패5/15분. SQL 고정 윈도우+진행 중 예약으로 동시 요청과 재시작에서도 유지한다.
- 관리자: 환경설정 hash, 1시간 절대 만료, 서명 쿠키와 DB 세션 취소. HttpOnly/host-only/SameSite=Strict, HTTPS Secure.
- 릴리스는 Linux GitHub runner의 standalone ZIP. server.js/node_modules/.next와 .next/static 포함. Node24, node server.js, HOSTNAME=0.0.0.0 및 플랫폼 PORT.
- GitHub→Azure는 사용자 할당 관리 ID의 OIDC 연합. 앱→SQL의 SQL 계정/비밀번호와 별개다.
- SQL public endpoint는 App Service outbound IP와 로컬 현재 IP만 허용. 전체 Azure 서비스 허용 규칙은 만들지 않는다. 앱 SQL 계정에는 필요한 DML과 schema 버전 조회만 허용한다.
- B1의 staging slot이나 고가용성 추가 리소스를 전제로 하지 않는다. 이전 artifact 재배포는 앱만 되돌리며 운영 DB 삭제/빈 DB 교체는 하지 않는다.

## Definition of Done
- 서비스/API/PC·모바일 E2E 및 typecheck/lint/build가 실제 격리 SQL 환경에서 통과.
- 운영 비밀값·운영 데이터가 테스트/Git/artifact에 없음.
- 실제 B1 1인스턴스와 SQL Basic2GB, HTTPS 기본 URL의 CRUD·관리자·제한·재시작 영속성 확인.
- main push 검사 후 OIDC 배포 workflow 성공, URL/commit/run 기록.
- current는 completed, phase는6/6, 운영·백업·비밀번호 교체·비용 안내가 실제 상태와 일치.

## Completion Evidence
- 2026-11-16 전체6/6 완료. 마지막 Task 완료 commit2c5b2ac.
- 공개 URL https://app-vibe-board-prod-7b1417.azurewebsites.net / 실제 배포57fda56f9e28dbc33971323dd804b2268cee5a55.
- Actions https://github.com/YIH151515/vibe_webapp/actions/runs/43777945761 verify/deploy success.
- 전체43개 테스트와 Linux artifact 검증, 공개 CRUD·관리자·프록시 IP/HMAC·429·실제 재시작·PC/모바일 화면 검증 통과. 소유 QA 글 전부 정리.
- OIDC는 실제 immutable owner/repository ID를 포함하는 main 한정 subject로 검증했다. 운영 기록과 비밀 보관/비밀번호 확인/백업/비용/롤백 안내: board/docs/azure-runbook.md.

## Execution Boundaries (historical)
계획 단계는 .memory 파일만 작성한다. Azure 로그인·리소스 생성·원격 연결·push·배포는 실행 단계 Task다. 실행 시 SKU·구독 권한·원격 상태를 다시 확인한다. 부족한 로그인/권한/필수 정보만 요청한다. 기존 미커밋 next-env.d.ts를 보존한다.

## Adjacent Findings
Docker Linux 엔진 기동이 통합 테스트의 선행 조건이다. 테스트를 생략하거나 운영 DB로 대체하지 않는다. 기존 ESLint 지원 종료/개발 의존성 경고는 별도 major 갱신을 추가하지 않고 README에 유지한다. 추가 범위 결정이 필요한 앱 결함은 발견되지 않았다. 댓글·회원·업로드·CAPTCHA·도메인·데이터 이전·별도 개발 DB는 제외한다.

## References
- [mssql](https://github.com/tediousjs/node-mssql)
- [SQL Testcontainers](https://node.testcontainers.org/modules/mssqlserver/)
- [Next standalone](https://nextjs.org/docs/pages/api-reference/config/next-config-js/output)
- [App Service Node](https://learn.microsoft.com/en-us/azure/app-service/configure-language-nodejs)
- [client-ip 신뢰 경계](https://github.com/Azure/app-service-linux-docs/blob/master/Things_You_Should_Know/headers.md)
- [GitHub OIDC 배포](https://learn.microsoft.com/en-us/azure/app-service/deploy-github-actions)
- [SQL firewall](https://learn.microsoft.com/en-us/azure/sql-database/sql-database-firewall-configure)
- [SQL Basic 백업](https://learn.microsoft.com/en-us/azure/azure-sql/database/automated-backups-overview)
