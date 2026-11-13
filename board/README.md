# 자유 게시판

Next.js + SQLite로 만드는 로컬 비회원 게시판입니다. 현재 T01은 앱 기반과 한국어 시작 화면까지 구성하며, 게시글 저장과 화면 기능은 후속 작업에서 구현합니다.

## 실행 환경

- Node.js 24.13.1 이상, 25 미만 (24.x)
- npm 11.x
- Next.js 16 / React 19 / TypeScript

## 실행

저장소 루트에서 앱 디렉터리로 이동한 뒤 실행합니다.

```powershell
cd board
npm ci
npm run dev
```

브라우저에서 http://127.0.0.1:3000 에 접속합니다. 서버는 로컬 인터페이스에만 바인딩됩니다. 종료하려면 터미널에서 Ctrl+C를 누릅니다.

프로덕션 모드는 다음과 같습니다.

```powershell
npm run build
npm run start
```

## 설정과 데이터

추후 저장 서비스는 Node 내장 `node:sqlite`를 사용합니다. 기본 데이터 경로는 앱 실행 폴더 기준 `data/board.sqlite`입니다. `DATABASE_PATH` 환경변수로 변경할 수 있으며 상대 경로도 앱 실행 폴더 기준입니다. 설정 예시는 `.env.example`을 참고하세요. 이 단계에서는 데이터베이스 파일을 만들지 않습니다.

Node 24.13.1에서 SQLite 사용 시 실험적 API 경고가 나타날 수 있습니다. 경고 자체는 실행 실패를 의미하지 않습니다. 실제 예외와 종료 코드를 함께 확인하세요.

데이터 파일, 로컬 환경변수, 빌드 결과와 의존성은 Git에서 제외합니다.

## 검증

```powershell
npm run typecheck
npm run lint
npm run build
```

후속 작업을 위한 `test:service`, `test:api`, `test:e2e` 명령도 등록되어 있습니다. 해당 테스트 파일과 Playwright 설정은 후속 Task에서 추가하므로 현재 단계에서는 실행하지 않습니다.

## 개발 도구의 알려진 제한

현재 Next.js lint 플러그인들은 ESLint 10을 지원하지 않아 호환되는 ESLint 9.39.5로 고정했습니다. ESLint 9에는 지원 종료 경고가 있습니다. 2026-11-13 설치 검증 시 `npm audit`에서 개발용 lint 의존성의 `minimatch` 관련 중간 수준 취약점 7건이 보고되었습니다. 앱 실행 의존성에서는 취약점이 보고되지 않았습니다. 호환되는 플러그인 업데이트가 나오면 함께 갱신하고 lint와 빌드를 다시 검증해야 합니다. `npm audit fix --force`는 호환성을 깨뜨릴 수 있으므로 사용하지 않습니다.
