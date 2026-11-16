# 자유 게시판

Next.js + Azure SQL로 운영하는 비회원 게시판입니다. 회원가입 없이 닉네임과 비밀번호로 글을 작성합니다. **[공개 게시판](https://app-vibe-board-prod-7b1417.azurewebsites.net)** · [관리자 화면](https://app-vibe-board-prod-7b1417.azurewebsites.net/admin). GitHub main 검사 후 OIDC 자동 배포와 실제 공개 검증을 완료했습니다.

## Azure 배포 패키지와 자동 검사

실제 리소스·비밀값 보관·GitHub 인증·구축/검증 절차는 [Azure 운영 기록](docs/azure-runbook.md)을 참고합니다. 생성된 리소스는 앱 공개 전에도 요금이 발생합니다.

Windows에서는 `npm run verify:azure`로 Node24 Linux 컨테이너에서 독립 빌드·ZIP·HTTP/CSS 검증을 실행합니다. 운영 환경파일은 복사하지 않습니다. Linux CI에서는 `npm run build:azure` → `npm run package:azure` → `node --test tests/package.test.mjs` 순서입니다. 기본 `npm run build`는 기존 로컬 빌드를 유지합니다.

`.deploy/board.zip`은 server.js와 필요한 node_modules/.next/static/public을 포함하고 환경파일·DB·키를 제외합니다. `.deploy/release.json`은 Git commit과 ZIP SHA256만 기록합니다. `/api/health`는 SQL 및 스키마3이 준비되면 상태와 배포 버전을, 준비되지 않으면 상세정보 없는503을 반환합니다.

GitHub Actions는 PR/main에서 격리 SQL 전체 테스트 후 동일 ZIP을 배포합니다. 배포 변수 `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `AZURE_WEBAPP_NAME`, `AZURE_RESOURCE_GROUP`가 없으면 배포 job은 **skipped**이며 공개 배포가 완료된 것이 아닙니다. OIDC subject는 `repo:YIH151515@355682187/vibe_webapp@1456296194:ref:refs/heads/main`입니다. SQL/관리자 암호는 GitHub 변수나 artifact에 넣지 않습니다. 배포는 OIDC로 인증하고 ZIP 해시·최종 health 버전을 검사합니다. 공식 action의 확인한 안정 tag를 commit SHA로 고정했습니다: [checkout](https://github.com/actions/checkout/releases/tag/v7.0.1), [setup-node](https://github.com/actions/setup-node/releases/tag/v7.1.0), [upload-artifact](https://github.com/actions/upload-artifact/releases/tag/v7.0.2), [download-artifact](https://github.com/actions/download-artifact/releases/tag/v8.0.2), [Azure login](https://github.com/Azure/login/releases/tag/v3.1.0), [webapps-deploy v3](https://github.com/Azure/webapps-deploy/tree/v3).

## 실행 환경

- Node.js 24.13.1 이상, 25 미만 (24.x), npm 11.x
- Next.js 16 / React 19 / TypeScript / mssql(Tedious)
- 일반 로컬 실행: 인터넷과 Azure SQL 접속 설정 필요
- 자동 테스트: Docker의 Linux 엔진과 SQL Server 2022 Developer 이미지 필요

## 로컬 실행

저장소 루트에서 앱 폴더로 이동합니다.

```powershell
cd board
npm ci
```

.env.example을 .env.local로 복사해 SQL_SERVER, SQL_PORT(기본1433), SQL_DATABASE, SQL_USER, SQL_PASSWORD를 설정합니다. 이 파일은 Git에 올리지 않습니다.

**로컬과 Azure 앱은 같은 운영 게시글을 사용합니다.** 로컬에서 수정·삭제해도 공개 글에 그대로 반영됩니다. 기존 SQLite 파일은 보관하며 자동 이전하거나 삭제하지 않습니다. DATABASE_PATH는 더 이상 사용하지 않습니다.

SQL 스키마는 앱이 자동 생성하지 않습니다. 최초 구성이나 스키마 변경은 별도의 운영자 계정 SQL_MIGRATION_USER/SQL_MIGRATION_PASSWORD로 명시 실행합니다. 이 계정은 앱 runtime이나 배포 workflow에 전달하지 않습니다.

```powershell
npm run db:migrate
npm run dev
```

연결이 구성되면 http://127.0.0.1:3000 에 접속합니다. Ctrl+C로 서버를 종료합니다. 개발 서버는 로컬 인터페이스만 사용합니다. DB 설정이 없거나 연결이 실패하면 API는 세부 연결 정보 없이 503을 반환합니다. 정상 운영 연결은 암호화와 서버 인증서 검증을 필수로 사용합니다.

프로덕션 빌드는 데이터베이스에 접속하지 않습니다.

```powershell
npm run build
npm run start
```

Azure용 실행·배포 설정은 후속 배포 Task에서 추가합니다.

## 기능

- 최신 글부터 20개씩 표시합니다. PC는 표, 모바일은 세로 목록입니다.
- 제목과 본문을 함께 검색하며, 검색 결과에도 페이지 나누기를 적용합니다.
- 제목 1~100자, 본문 1~10,000자, 닉네임 2~20자, 비밀번호 8~64자입니다.
- 제목·본문·닉네임은 앞뒤 공백을 정리합니다. 비밀번호의 공백은 그대로 유지합니다.
- 본문은 일반 텍스트로 표시하며 HTML이나 스크립트를 실행하지 않습니다.
- 작성할 때의 비밀번호로 수정·삭제합니다. 비밀번호 분실 복구는 지원하지 않습니다.
- 삭제 화면에서 비밀번호와 삭제 동의를 확인합니다. 삭제한 글은 복구할 수 없습니다.
- 작성일은 한국 시간으로 표시하고 수정 후에도 최초 작성일을 유지합니다.
- 비밀번호는 임의 salt를 사용한 scrypt 해시로 저장하며, 조회 응답에 비밀번호나 해시를 포함하지 않습니다.

## 격리된 SQL 자동 테스트

Docker Desktop의 Linux 엔진을 먼저 실행합니다. 테스트는 운영 .env.local을 읽지 않고 일회용 SQL Server 컨테이너, 임의 비밀번호, 새 board_test_<UUID> DB를 자동으로 만듭니다. 테스트를 운영 서버나 운영 DB로 향하게 하지 마세요.

```powershell
npx playwright install chromium
npm run test:all
npm run typecheck
npm run lint
npm run build
```

개별 실행은 다음과 같습니다.

```powershell
npm run test:service
npm run test:api
npm run test:e2e
```

- all은 한 컨테이너에서 서비스→API→브라우저 순서로 검증하고, 각 suite는 별도 테스트 DB를 사용합니다.
- 서비스 test fixture도 고유 DB로 격리합니다. 삭제·초기화는 검증 도구가 만든 테스트 DB에서만 수행합니다.
- 테스트 연결은 loopback 호스트 + board_test_ 이름 + APP_TEST_MODE=1을 모두 확인합니다. 이 환경에서만 자체 서명 테스트 인증서를 허용합니다.
- 직접 playwright test를 실행하면 격리 증명이 없어 거부됩니다. 위 npm 명령을 사용하세요.
- API·브라우저 테스트는 3100 포트와 .next-test 빌드 폴더를 사용합니다. 사용 중인 3000 포트 개발 서버를 종료하거나 재사용하지 않습니다.
- 테스트용 tsconfig.playwright.json과 정상 개발 tsconfig를 분리합니다. 테스트가 생성한 next-env 경로는 실행 후 이전 상태로 복원합니다.
- 테스트 실패에도 해당 실행이 소유한 서버·컨테이너를 정리하며, 사용자 다른 컨테이너는 건드리지 않습니다.
- 초기 Docker 이미지 다운로드에는 시간이 걸릴 수 있습니다. Microsoft SQL Server Developer 컨테이너는 개발·검증 용도로만 사용합니다.
- 브라우저 검증은 Chromium의 1280px PC/390px 모바일이며, 스크린샷과 실패 trace는 Git에서 제외된 test-results에 저장합니다.

## SQL 스키마와 연결

dbo.posts는 Unicode 본문, 비밀번호 해시, UTC 작성일을 저장합니다. dbo.schema_migrations가 적용된 migration을 기록합니다. 변경은 transaction과 DB 잠금으로 직렬화하며, 이미 적용한 migration을 다시 실행해도 기존 글을 지우지 않습니다. 앱의 게시글 경로는 DDL을 실행하지 않습니다.

관리형 SQL의 백업·방화벽·최소 권한 설정과 운영자 비밀번호 관리 절차는 Azure 리소스 구성 Task에서 실제 값에 맞춰 추가합니다. 기존 SQLite 파일을 지워서 SQL 오류를 해결하지 마세요.

## API

GET /api/posts?q=&page=1, POST /api/posts, GET/PATCH/DELETE /api/posts/{id}를 제공합니다. 쓰기는 application/json이며 응답은 캐시하지 않습니다. Origin은 APP_ORIGIN의 단일 정규 주소와 비교하며, 내부 HTTP로 전달된 HTTPS 요청도 공개 주소 기준으로 확인합니다.

## 공개 요청 보안과 제한

서버 환경 설정에 APP_ORIGIN, REQUEST_IP_MODE, RATE_LIMIT_KEY_SECRET을 지정합니다. RATE_LIMIT_KEY_SECRET은 임의 32바이트의 64자리 소문자 hex이며 로컬과 Azure에서 같은 값을 사용합니다. 키를 코드·문서·로그에 넣지 않습니다.

- local 모드: LOCAL_CLIENT_IP에 본인의 현재 공개 IP를 설정합니다. 요청의 IP 헤더는 무시합니다.
- app-service 모드: HTTPS APP_ORIGIN과 WEBSITE_INSTANCE_ID가 필요합니다. App Service가 덮어쓰는 client-ip만 읽으며, x-forwarded-for/x-client-ip를 대체 수단으로 신뢰하지 않습니다. 잘못된 IP나 누락은 503으로 쓰기를 거부합니다.
- test 모드: 일회용 loopback SQL DB 증명이 있을 때만 허용합니다. 테스트마다 다른 가상 IP를 사용하며 운영에는 설정하지 않습니다.

같은 정규화 IP의 HMAC 식별자를 SQL에 저장하고 다음 고정 윈도우를 적용합니다. 원문 IP와 비밀번호는 저장하지 않습니다.

| 동작 | 한도 |
| --- | --- |
| 정상 글 작성 | 10분당 5회 |
| 글 비밀번호 확인 실패(수정·삭제 공유) | 10분당 10회 |
| 관리자 로그인 실패 정책 | 15분당 5회 |

관리자 화면은 /admin입니다. ADMIN_PASSWORD_HASH와 ADMIN_SESSION_SECRET을 서버 환경 설정에 추가하면 비밀번호로 로그인하여 작성자 비밀번호 없이 글을 삭제할 수 있습니다. 세션은 서명 쿠키와 DB 기록으로 확인하며, 1시간 후 만료하거나 로그아웃하면 이전 쿠키도 무효가 됩니다. 삭제는 동의 확인 후 실행합니다. 쿠키는 HttpOnly·SameSite=Strict·host-only이며 HTTPS에서는 Secure를 사용합니다. 관리자 비밀번호와 세션 키를 교체하면 기존 세션은 무효가 됩니다. 관리자 hash 도구 npm run admin:password는 명령행 인수 대신 비공개 stdin만 받으며 평문을 출력하지 않습니다.

입력 검증 실패와 없는 글은 횟수에 넣지 않습니다. 정상 비밀번호 확인도 실패 횟수에 넣지 않습니다. 동시에 진행 중인 시도는 SQL에서 슬롯을 예약하여 병렬 요청으로 한도를 넘지 못하게 합니다. 재시작과 다른 앱 연결에서도 같은 DB의 제한이 유지됩니다. 제한 응답은 429, Retry-After 초와 한국어 대기 안내를 포함합니다. 제한 저장소 장애는 허용으로 전환하지 않고 503으로 처리합니다.

JSON 요청은 Content-Length와 실제 읽은 바이트 모두 64KiB 이하로 제한하며 초과 시 413을 반환합니다. 일반 글의 최대 길이는 그대로 유지합니다. 소멸한 제한 기록은 만료 후 24시간이 지나면 소량씩 정리합니다. 프로세스가 시도 중 중단되면 예약은 현재 윈도우 만료까지 보수적으로 남을 수 있습니다.

설정이 없는 쓰기 요청은 503으로 안내합니다. 실제 Azure 프런트엔드가 client-ip를 덮어쓰는지는 최종 배포 검증에서 확인해야 합니다.

## 알려진 개발 도구 제한

ESLint 9.39.5는 현재 Next.js lint 플러그인 호환성 때문에 유지하고 있으며 지원 종료 경고가 있습니다. 2026-11-13 검사 결과 개발 의존성에는 중간 수준 경고 13건(기존 lint 및 새 Testcontainers의 archiver/glob 계열)이 있었으며, 운영 의존성은 `npm audit --omit=dev`에서 0건이었습니다. Testcontainers를 구버전 major로 바꾸는 강제 수정은 적용하지 않았습니다. 호환되는 개발 도구 업데이트를 별도로 검토해야 합니다.

SQL 드라이버는 Next.js `serverExternalPackages: ["mssql"]`로 Node에서 직접 로드합니다. OS별 실행 파일 경로를 번들러가 해석하다 Windows 빌드가 실패하는 것을 방지하는 설정이므로 유지하세요.
