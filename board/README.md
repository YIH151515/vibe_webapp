# 자유 게시판

Next.js + Azure SQL 기반 사내 게시판입니다. Entra ID 회사 계정으로 로그인하고 본인 글을 수정·삭제합니다. **[게시판](https://app-vibe-board-prod-7b1417.azurewebsites.net)** · [관리자 화면](https://app-vibe-board-prod-7b1417.azurewebsites.net/admin). 운영에 SQL5와 Entra 로그인을 반영했고 main 자동 배포 및 실제 로컬·운영 로그인을 검증했습니다. 최신 상태와 인증 설정은 [Entra 운영 안내](docs/entra-runbook.md)를 확인하세요.

글 작성·수정은 Tiptap 오픈소스 에디터를 사용합니다. 굵게·기울임·밑줄·제목·목록·인용·링크와 이미지 선택/붙여넣기/드롭을 지원합니다. JPEG·PNG·WebP를 장당5MiB, 글당5장/합20MiB까지 선택하고 저장할 때 업로드합니다. 실제 운영 이미지 게시·수정·검색·재시작·관리자 삭제와 PC/모바일 검증을 완료했습니다. 저장소·비용·복구·정리 절차는 [이미지 운영 안내](docs/images-runbook.md)를 참고하세요.

## Azure 배포 패키지와 자동 검사

실제 리소스·비밀값 보관·GitHub 인증·구축/검증 절차는 [Azure 운영 기록](docs/azure-runbook.md)을 참고합니다. 생성된 리소스는 앱 공개 전에도 요금이 발생합니다.

Windows에서는 `npm run verify:azure`로 Node24 Linux 컨테이너에서 독립 빌드·ZIP·HTTP/CSS 검증을 실행합니다. 운영 환경파일은 복사하지 않습니다. Linux CI에서는 `npm run build:azure` → `npm run package:azure` → `node --test tests/package.test.mjs` 순서입니다. 기본 `npm run build`는 기존 로컬 빌드를 유지합니다.

`.deploy/board.zip`은 server.js와 필요한 node_modules/.next/static/public을 포함하고 환경파일·DB·키를 제외합니다. `.deploy/release.json`은 Git commit과 ZIP SHA256만 기록합니다. `/api/health`는 SQL 및 스키마5가 준비되면 상태와 배포 버전을, 준비되지 않으면 상세정보 없는503을 반환합니다. 점검 모드에서도 스키마가 일치하면 health는 정상이고 콘텐츠는503입니다.

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

인증에는 `AUTH_MODE=entra`, `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET`, `AUTH_ENCRYPTION_KEY`가 필요합니다. 로컬은 운영과 별도 Entra 앱을 사용합니다. 서버 전용 비밀값과 정확한 callback 등록 절차는 Entra 운영 안내를 따르세요. 기본 `AUTH_MODE=maintenance`에서는 콘텐츠에 접근할 수 없습니다.

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

Azure 배포는 main의 GitHub Actions를 사용합니다. SQL5 전환 후 복구는 검증한 schema5 점검 패키지를 사용하며 과거 비회원 ZIP으로 되돌리지 않습니다.

## 기능

- 최신 글부터 20개씩 표시합니다. PC는 표, 모바일은 세로 목록입니다.
- 제목과 본문을 함께 검색하며, 검색 결과에도 페이지 나누기를 적용합니다.
- 제목 1~100자, 본문 1~10,000자입니다. 작성자 표시는 인증된 계정에서 가져옵니다.
- Tiptap 문서와 첨부 이미지를 서버에서 검증하고 안전하게 렌더링합니다.
- 같은 테넌트의 Member 계정이 읽고 작성합니다. Guest와 다른 테넌트 계정은 허용하지 않습니다.
- 본인 글만 수정·삭제합니다. Board.Admin은 다른 사람과 기존 비회원 글을 삭제할 수 있으며 삭제 동의가 필요합니다.
- 기존 비회원 글은 로그인 후 읽을 수 있고 관리자만 삭제합니다. 과거 글 비밀번호로 수정하거나 로그인할 수 없습니다.
- 작성일은 한국 시간으로 표시하고 수정 후에도 최초 작성일을 유지합니다.
- 계정의 테넌트·객체 ID로 소유권을 확인합니다. 이메일 주소나 화면에서 보낸 작성자 값을 권한 판정에 사용하지 않습니다.

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

SQL5는 게시글 소유자, 계정, 로그인 시도와 서버 세션을 저장합니다. 기존 비회원 글의 내용·날짜·해시는 보존하며 새 계정 글에 비밀번호를 저장하지 않습니다. dbo.schema_migrations가 적용된 migration을 기록합니다. 변경은 transaction과 DB 잠금으로 직렬화하며, 이미 적용한 migration을 다시 실행해도 기존 글을 지우지 않습니다. 앱의 게시글 경로는 DDL을 실행하지 않습니다.

관리형 SQL의 백업·방화벽·최소 권한 설정과 운영자 비밀번호 관리 절차는 Azure 리소스 구성 Task에서 실제 값에 맞춰 추가합니다. 기존 SQLite 파일을 지워서 SQL 오류를 해결하지 마세요.

## API

GET /api/posts?q=&page=1, POST /api/posts, GET/PATCH/DELETE /api/posts/{id}를 제공합니다. 쓰기는 application/json이며 응답은 캐시하지 않습니다. Origin은 APP_ORIGIN의 단일 정규 주소와 비교하며, 내부 HTTP로 전달된 HTTPS 요청도 공개 주소 기준으로 확인합니다.

## 인증과 요청 제한

글·검색·이미지 API는 로그인하지 않으면401을 반환하며 페이지는 로그인 화면으로 이동합니다. 점검 모드는 콘텐츠503입니다. 이미지는 인증을 먼저 확인한 뒤 `private, no-store`로 제공하며 원본 Blob은 비공개입니다.

로그인 쿠키는 HttpOnly·SameSite=Lax·host-only이고 운영 HTTPS에서는 Secure입니다. 임의 세션 값의 해시를 SQL에서 확인하며 최대1시간 후 만료합니다. 로그아웃하면 해당 세션과 초안 업로드를 취소합니다. 다른 기기의 로그인이나 회사 전체 SSO를 로그아웃하지 않습니다. 관리자 권한을 회수해도 이미 발급한 세션은 만료 또는 명시적 취소 전까지 남을 수 있습니다.

쓰기 요청은 `APP_ORIGIN`과 Origin을 비교합니다. 계정 HMAC 식별자로 제한을 공유하므로 같은 계정의 기기·IP를 바꿔도 제한이 초기화되지 않습니다. 글 작성은10분당5회이며 이미지 예약·용량 제한도 별도로 적용됩니다. 제한은429와 Retry-After로 안내합니다. SQL이나 인증 설정 장애는503으로 처리합니다. `RATE_LIMIT_KEY_SECRET`과 인증 비밀은 서버에만 보관합니다.

`REQUEST_IP_MODE`의 local/app-service/test 설정은 환경에 맞게 유지합니다. app-service는 플랫폼이 덮어쓰는 client-ip만 신뢰하고 test 모드는 격리 DB 증명이 있을 때만 허용합니다. 새 업로드는 로그인 계정과 발급 세션 모두에 묶습니다. 과거 관리자 비밀번호 로그인과 비회원 비밀번호 검증 경로는 사용할 수 없습니다.

## 알려진 개발 도구 제한

ESLint 9.39.5는 현재 Next.js lint 플러그인 호환성 때문에 유지하고 있으며 지원 종료 경고가 있습니다. 2026-11-13 검사 결과 개발 의존성에는 중간 수준 경고 13건(기존 lint 및 새 Testcontainers의 archiver/glob 계열)이 있었으며, 운영 의존성은 `npm audit --omit=dev`에서 0건이었습니다. Testcontainers를 구버전 major로 바꾸는 강제 수정은 적용하지 않았습니다. 호환되는 개발 도구 업데이트를 별도로 검토해야 합니다.

SQL 드라이버는 Next.js `serverExternalPackages: ["mssql"]`로 Node에서 직접 로드합니다. OS별 실행 파일 경로를 번들러가 해석하다 Windows 빌드가 실패하는 것을 방지하는 설정이므로 유지하세요.

## 이미지 수명과 수동 정리

이미지는 private Blob에 보관하며 게시된 글과 연결된 파일만 로그인한 사용자에게 앱의 `/api/images/{id}`로 제공합니다. 초안은 24시간 후 정리하고, 글에서 제거한 이미지는 즉시 공개를 중단한 뒤 outbox로 삭제를 재시도합니다. Azure soft delete 보존 7일 동안은 사용 용량에 계속 포함하며 보존 종료와 파일 부재를 확인한 뒤 반환합니다. 늦게 나타난 파일도 SQL에서 추적한 경로만 재확인하며 전체 컨테이너를 훑어 삭제하지 않습니다.

`npm run media:cleanup -- --limit 100`은 삭제 대기 건수만 읽는 dry-run입니다. `--apply`를 명시해야 실제 정리가 실행됩니다. 운영자 CLI는 로컬 `.env.local`의 정확한 운영 SQL·Blob 설정과 Azure CLI 인증을 사용하므로 적용 전 대상 환경을 확인하세요. 자동 정리는 Azure Node 런타임에서 `MEDIA_CLEANUP_ENABLED=1`일 때만 10분 간격으로 실행합니다. 테스트는 운영 자격증명과 `.env.local`을 사용하지 않습니다. Azurite에는 soft delete가 없으므로 실제 CRUD는 Azurite로, 7일 보존·장애 회계는 fake clock으로 검증합니다.

## 브라우저 보안 정책과 배포 인증

HTML은 요청마다 새로운 nonce를 발급해 Next.js 스크립트를 허용하고 임의의 HTML 인라인 스크립트와 프레임 삽입을 차단합니다. production 스크립트에는 unsafe-inline/unsafe-eval을 허용하지 않습니다. 관리자 화면과 Tiptap 호환을 위한 인라인 CSS, 이미지 미리보기 blob:/data:는 별도로 허용합니다.

공통 헤더는 HSTS·X-Frame-Options DENY·nosniff·Permissions-Policy를 포함합니다. 로그인 POST가 정상 Origin을 보내도록 공통 Referrer-Policy는 strict-origin-when-cross-origin이고, 인증 콜백 경로만 no-referrer로 쿼리 정보를 보호합니다. 새 외부 스크립트나 iframe을 추가할 때는 CSP 회귀를 함께 확인하세요.

SCM/FTP 배포 기본 인증을 끄고 Entra/OIDC 배포를 사용합니다. `./scripts/harden-publishing.ps1 -Mode Inspect` 또는 Verify로 두 정책을 조회할 수 있습니다. 실제 main 배포와 회사 계정 브라우저 재검증을 완료했습니다. 자세한 근거와 최종 결과는 [보안 점검 보고서](docs/security-review-2026-11-19.md)에 기록합니다.

보안 수정 실제 실행 source: 083b0af7808a18feb178c665f7cd45067c7bd35a / Actions44479404023 success. SQL5·AUTH_MODEentra·기존 자료와 비용 등급을 유지했다. 최종 복구 ZIP SHA256: 74a5f9d427f90d2b9729bb520d4f5a3bb7d6877b250ff12f40aeee11b4469a93. 상세 검증 범위와 예외는 보안 점검 보고서를 따른다.
