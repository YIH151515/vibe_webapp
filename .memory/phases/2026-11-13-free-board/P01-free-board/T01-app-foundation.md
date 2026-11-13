# Task: T01 앱 기반 구성

## Status: done

## Goal
기존 스타터킷을 보존하면서 board 앱을 설치하고 타입 검사·lint·build가 가능한 상태를 만든다.

## Decision Summary
- Next.js + SQLite 로컬 앱이라는 확정 결정을 따른다.
- root Git 저장소와 board 하위 앱을 사용해 메모리와 코드의 커밋 이력을 함께 남긴다.

## Execution Context
- 작업 루트: D:/vibeweb. 앱 루트: D:/vibeweb/board. 검증 명령은 별도 언급이 없으면 앱 루트에서 실행한다.
- Node 24.x, Next 16.x App Router, React 19.x, TypeScript strict, npm. 기존 .agents, examples, skill-project-main 및 zip은 변경하지 않는다.
- 비회원 로컬 게시판이며 댓글·이미지·회원·관리자·배포는 제외한다.
- 완료 시 이 Task Status를 done으로 변경하고 phase.md 진행률 및 current.md를 다음 작업으로 갱신한다. 커밋은 이번 Task와 관련 메모리 파일만 명시적으로 stage한다. git add . 금지.

## Implementation

### I01. 프로젝트와 Git 기반
- Related Files:
  - `board/package.json`, `board/package-lock.json` :: 의존성·scripts; new
  - `board/tsconfig.json`, `board/next-env.d.ts`, `board/next.config.ts`, `board/eslint.config.mjs` :: 빌드 설정; new
  - `board/src/app/layout.tsx` :: RootLayout; new
  - `board/src/app/page.tsx` :: Home; new
  - `board/src/app/globals.css` :: 기본 CSS; new
  - `board/.gitignore`, `board/.env.example`, `board/README.md` :: 로컬 실행 설정; new
  - `AGENTS.md`, `.gitignore` :: 기존 규칙; read-only
#### Details
- **Signatures & Types**:
```typescript
RootLayout(props: Readonly<{ children: React.ReactNode }>): React.JSX.Element;
Home(): React.JSX.Element;
```
- **Data & Schema Fields**: 이 작업은 DB 모델을 생성하지 않는다. 환경변수 DATABASE_PATH는 선택적 string, 미설정 시 앱 cwd/data/board.sqlite. .env.example에는 이 기본값을 설명한다.
- **Execution Flow / Logic**:
  1. git rev-parse로 현재 상태 재확인 후 Git 저장소가 여전히 없으면 D:/vibeweb에서 git init. 중첩 board/.git은 만들지 않는다.
  2. board 폴더에 수동 설정 또는 비대화형 scaffolding으로 App Router/TypeScript/src 경로 앱 생성. 자동 git init, Tailwind, React Compiler, 외부 font는 사용하지 않는다.
  3. Node engine >=24.13.1 <25. Next 16의 최신 안정 patch, peer-compatible React 19/react-dom, TypeScript 5.x, @types/node 24.x, @types/react 19.x, ESLint 및 eslint-config-next를 설치한다. Next와 eslint-config-next 버전을 맞추고 lockfile을 보관한다.
  4. 개발 의존성 tsx, @playwright/test를 설치한다. 테스트 코드는 이후 작업에서 추가한다.
  5. scripts: dev="next dev --hostname 127.0.0.1", start="next start --hostname 127.0.0.1", build="next build", lint="eslint .", typecheck="tsc --noEmit", test:service="tsx --test tests/service.test.ts", test:api="playwright test tests/api.spec.ts", test:e2e="playwright test tests/board.spec.ts". 아직 없는 테스트는 이번 작업에서 실행하지 않는다.
  6. alias @/* → ./src/*, strict=true. html lang=ko, 기본 metadata 제목은 자유 게시판. 한국어 시작 화면과 전역 기본 CSS만 추가한다.
  7. board/.gitignore에 node_modules, .next, out, data/, *.sqlite 및 sidecar, .env*, !.env.example, playwright-report, test-results, *.tsbuildinfo 제외. 실제 DB와 비밀번호 파일은 stage하지 않는다.
  8. README에 cd board, npm ci, npm run dev, http://127.0.0.1:3000, Node 버전과 SQLite 실험적 경고 가능성을 설명한다.
  9. 설치 네트워크/샌드박스 실패는 승인 절차로 재시도한다. Git identity 없으면 임의 작성자 설정 대신 필요한 정보만 요청한다.
  10. 이번 앱 파일, 계획/결정 문서와 포인터를 명시적으로 stage하고 커밋한다. 기존 zip이나 도구 묶음을 초기 커밋에 섞지 않는다.

### I02. 기반 검증
- Related Files: 위 설정과 시작 화면; 검증 대상
#### Details
typecheck, lint, production build의 종료코드 0을 확인한다. build는 DB 파일이나 네트워크 폰트를 필요로 하지 않아야 한다. 브라우저 테스트나 형식적인 smoke test 파일은 이 단계에서 만들지 않는다.

## Acceptance Criteria
- [x] 루트 Git 저장소와 board 앱이 준비된다.
- [x] 시작 화면이 한국어로 구성되고 기존 스타터킷을 보존한다.
- [x] 세 검증이 통과하고 lockfile이 존재하며 DB/비밀파일은 제외된다.

## Validation
- `npm run typecheck` — 타입 오류 없음.
- `npm run lint` — lint 오류 없음.
- `npm run build` — production build 성공.
- 루트에서 `git status --short` — 이번 작업 외 파일을 stage하지 않았는지 확인.

## Commit Message
```text
chore(board): initialize local Next.js application

Plan: 2026-11-13-free-board
Phase: P01-free-board
Task: T01-app-foundation

- 기존 스타터킷을 보존하면서 board 앱을 설치하고 타입 검사·lint·build가 가능한 상태를 만든다.
```

## Progress
- [x] 구현 완료
- [x] 검증 통과
- commit: bc29538

## Execution Result
- Node 24.13.1, Next 16.4.6, React 19.3.1, TypeScript 5.9.3.
- npm run typecheck / npm run lint / npm run build 모두 종료 코드 0.
- DB 파일 및 data 디렉터리 미생성 확인. 기존 스타터킷 파일은 변경하지 않음.
- Next.js lint 플러그인의 ESLint 10 비호환으로 ESLint 9.39.5 사용. 지원 종료 경고 및 lint 하위 minimatch 관련 중간 수준 취약점 7건은 README에 기록. 강제 major 업데이트 미적용.
- 기존 루트 ignore 규칙상 current.md와 next-env.d.ts는 제외되므로 필요한 두 파일만 명시적으로 force-stage한다.

## Next Task
T02-post-service.md
