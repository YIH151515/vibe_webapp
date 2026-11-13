# 자유 게시판

Next.js + SQLite로 만든 로컬 비회원 게시판입니다. 회원가입 없이 닉네임과 비밀번호로 글을 작성합니다.

## 실행 환경

- Node.js 24.13.1 이상, 25 미만 (24.x), npm 11.x
- Next.js 16 / React 19 / TypeScript
- Node 내장 SQLite를 사용하므로 별도의 DB 서버는 필요 없습니다.

## 시작하기

저장소 루트에서 앱 폴더로 이동하여 실행합니다.

```powershell
cd board
npm ci
npm run dev
```

브라우저에서 http://127.0.0.1:3000 에 접속합니다. 서버는 로컬 인터페이스에만 연결됩니다. 터미널에서 Ctrl+C로 종료합니다.

프로덕션 모드:

```powershell
npm run build
npm run start
```

## 기능과 사용법

- 최신 글부터 20개씩 표시합니다. PC는 표, 모바일은 세로 목록입니다.
- 제목과 본문을 함께 검색합니다. 검색 결과에서도 페이지를 이동할 수 있습니다.
- 제목 1~100자, 본문 1~10,000자, 닉네임 2~20자, 비밀번호 8~64자를 사용합니다.
- 제목·본문·닉네임은 앞뒤 공백을 정리하며, 비밀번호의 공백은 그대로 유지합니다.
- 본문은 일반 텍스트입니다. HTML과 스크립트는 실행하지 않고 문자로 표시합니다.
- 글 수정·삭제에는 작성할 때의 비밀번호가 필요합니다. 비밀번호 변경과 분실 복구는 지원하지 않습니다.
- 삭제 화면에서 비밀번호와 삭제 동의를 확인합니다. 삭제한 글은 복구할 수 없습니다.
- 작성일은 한국 시간으로 표시하며, 글을 수정해도 최초 작성일을 유지합니다.
- 댓글·이미지 업로드·회원·조회수·공지·관리자·인터넷 배포는 포함하지 않습니다.

## 데이터와 백업

기본 DB는 앱 실행 폴더 기준 `data/board.sqlite`입니다. 앱을 재시작해도 글은 유지됩니다. 비밀번호는 임의 salt를 포함한 scrypt 해시로 저장하며 조회 응답에는 포함하지 않습니다.

다른 경로를 쓰려면 `.env.example`을 참고해 `.env.local`에 `DATABASE_PATH`를 설정하거나, 실행할 터미널에서 환경변수를 지정합니다.

```powershell
$env:DATABASE_PATH = 'D:/my-board-data/board.sqlite'
npm run dev
```

상대 경로는 `board`에서 실행하는 것을 기준으로 합니다. 사용을 마치면 해당 터미널의 환경변수를 제거할 수 있습니다.

```powershell
Remove-Item Env:DATABASE_PATH
```

백업할 때는 먼저 앱 서버를 종료한 뒤 DB 파일을 복사합니다. 같은 폴더에 `board.sqlite-wal`, `board.sqlite-shm`이 남아 있으면 함께 백업합니다. 복원도 서버를 종료한 상태에서 동일 이름의 파일 세트를 함께 복원합니다. 기본 DB의 파일을 테스트용 DB와 섞지 마세요. DB·로컬 환경 설정·테스트 결과는 Git에 포함하지 않습니다.

## 검증

모든 명령은 `board`에서 실행합니다.

```powershell
npx playwright install chromium
npm run test:service
npm run test:api
npm run test:e2e
npm run typecheck
npm run lint
npm run build
```

- 서비스 테스트는 운영 DB 대신 OS 임시 폴더의 DB를 사용하며 종료 시 정리합니다.
- API 및 브라우저 테스트는 3100 포트의 별도 개발 서버와 `test-results/api-e2e.sqlite`를 사용합니다. 서버는 테스트 후 종료됩니다.
- 테스트 시작 시 정확한 테스트 DB와 그 sidecar만 초기화합니다. 테스트 명령은 동시에 실행하지 마세요.
- 브라우저 테스트는 Chromium에서 1280px PC와 390px 모바일 크기를 검증합니다. 스크린샷과 실패 시 trace는 `test-results`에 저장됩니다.
- 평소 접속 주소는 3000 포트이며, 테스트의 3100 포트와 구분됩니다.

## API

`GET /api/posts?q=&page=1`, `POST /api/posts`, `GET/PATCH/DELETE /api/posts/{id}`를 제공합니다. 쓰기 요청은 `application/json`이며 Origin이 있으면 실제 요청 Host와 일치해야 합니다. 프록시의 Forwarded 헤더는 신뢰하지 않습니다. API 응답은 캐시하지 않습니다.

## 알려진 개발 도구 제한

Node 24.13.1의 SQLite 실험적 경고는 실행 실패를 의미하지 않습니다. 종료 코드와 실제 예외를 함께 확인하세요. 실행 환경에 따라 NO_COLOR/FORCE_COLOR 충돌 경고가 나올 수도 있습니다.

현재 Next.js lint 플러그인이 ESLint 10을 지원하지 않아 ESLint 9.39.5로 고정했습니다. 이 버전은 지원 종료 경고가 있습니다. 2026-11-13 설치 검증 시 lint 개발 의존성의 minimatch 관련 중간 수준 취약점 7건이 보고됐으며, 앱 실행 의존성에서는 보고되지 않았습니다. 호환되는 업데이트가 나오면 lint 도구를 함께 갱신하고 재검증해야 합니다. `npm audit fix --force`는 적용하지 않습니다.
