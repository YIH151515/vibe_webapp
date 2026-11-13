# 자유 게시판

Next.js + Azure SQL로 만드는 비회원 게시판입니다. 회원가입 없이 닉네임과 비밀번호로 글을 작성합니다. 현재 단계는 SQL 저장소 전환이며, Azure 리소스 생성과 공개 배포는 후속 Task에서 진행합니다.

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

GET /api/posts?q=&page=1, POST /api/posts, GET/PATCH/DELETE /api/posts/{id}를 제공합니다. 쓰기는 application/json이며 응답은 캐시하지 않습니다. 현재 Origin 검증은 로컬 기준입니다. 공개 HTTPS 대응은 다음 보안 Task에서 적용합니다.

## 알려진 개발 도구 제한

ESLint 9.39.5는 현재 Next.js lint 플러그인 호환성 때문에 유지하고 있으며 지원 종료 경고가 있습니다. 2026-11-13 검사 결과 개발 의존성에는 중간 수준 경고 13건(기존 lint 및 새 Testcontainers의 archiver/glob 계열)이 있었으며, 운영 의존성은 `npm audit --omit=dev`에서 0건이었습니다. Testcontainers를 구버전 major로 바꾸는 강제 수정은 적용하지 않았습니다. 호환되는 개발 도구 업데이트를 별도로 검토해야 합니다.

SQL 드라이버는 Next.js `serverExternalPackages: ["mssql"]`로 Node에서 직접 로드합니다. OS별 실행 파일 경로를 번들러가 해석하다 Windows 빌드가 실패하는 것을 방지하는 설정이므로 유지하세요.
