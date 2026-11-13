# Plan: 자유 게시판

- Date: 2026-11-13
- Status: completed
- Decisions: [확정 설계](../decisions/2026-11-13-free-board.md)

## Goal
로컬 컴퓨터에서 실행하는 비회원 자유 게시판을 만든다. 글 목록·상세·작성·수정·삭제, 제목/본문 검색, 최신순 20개 페이지 나누기와 영구 저장을 제공한다. 댓글·업로드·회원·조회수·공지·관리자·외부 배포는 제외한다.

## Phases
| Phase | Status | Summary | Blueprint |
| :--- | :--- | :--- | :--- |
| P01 | completed | 앱 기반부터 비회원 게시판 완성까지 | [P01](../phases/2026-11-13-free-board/P01-free-board/phase.md) |

## Architecture
- 앱은 `D:/vibeweb/board/`에 배치한다. 기존 스타터킷 파일은 보존한다.
- 설치된 Node.js 24.13.1을 기준으로 Node 24.x, Next.js 16.x App Router, React 19.x, TypeScript strict, npm을 사용한다. 설치 시 해당 major의 최신 안정 patch를 선택하고 package-lock.json에 고정한다. React는 선택한 Next peer dependency를 만족해야 한다.
- SQLite는 Node 내장 `node:sqlite`의 DatabaseSync로 접근한다. ORM과 외부 SQLite 네이티브 빌드 의존성을 추가하지 않는다. 이 Node 버전의 SQLite 모듈은 실험적 상태일 수 있으므로 실행 경고를 오류와 구분하고 README에 기록한다.
- Node 서버 전용 서비스 → JSON Route Handlers → 클라이언트 폼과 화면 순서다. Edge, 정적 내보내기는 사용하지 않는다.
- CSS는 직접 작성한다. 외부 이미지, 폰트 다운로드, UI 프레임워크는 필요 없다.
- 기본 데이터 파일은 board/data/board.sqlite이며 DATABASE_PATH로 테스트 DB를 분리한다.
- 비밀번호는 Node crypto의 비동기 scrypt + 임의 salt로 해시한다. 글 비밀번호 변경과 복구는 제공하지 않는다.
- 보안은 텍스트 이스케이프, 매개변수 SQL, 서버 입력 검증, 비밀번호 확인, 쓰기 요청 Origin 검증으로 구현한다. 운영용 계정·스팸 관리 기능은 범위 밖이다.

## Sequence
1. T01: board 앱과 검증 도구, Git 기반.
2. T02: 스키마·검증·해시·저장 서비스 및 의미 있는 데이터 테스트.
3. T03: HTTP 계약·오류 처리·API 통합 검증.
4. T04: 반응형 화면·사용 흐름·브라우저 검증·실행 안내.

각 Task는 선행 Task 완료를 전제로 독립적인 구현 설명을 포함한다. 모든 청사진을 동시에 구현하지 말고 current.md의 한 작업씩 실행한다.

## Definition of Done
- 21개 이상 글로 두 페이지와 검색 결과 페이지 이동이 검증된다.
- 올바른 비밀번호만 수정·삭제할 수 있고 조회 응답과 HTML에 해시가 노출되지 않는다.
- 재시작 후 글이 유지되고, 테스트는 실제 사용자 DB를 건드리지 않는다.
- 390px 모바일/1280px PC에서 읽기·검색·작성·수정·삭제 동작과 일반 텍스트 안전 표시를 검증한다.
- lint, TypeScript, 서비스/API/브라우저 테스트, production build가 통과한다.
- Task별 커밋과 phase/current 포인터 동기화가 완료된다.

## Execution Notes
현재 D:/vibeweb은 Git 저장소가 아니다. T01에서 루트에 git init을 수행한다. 사용자 작성 파일, zip, 기존 예시를 일괄 스테이징하지 않는다. 커밋 작성자 정보가 없으면 사용자 전역 설정을 임의로 만들지 말고 필요한 정보를 요청한다. 원격 저장소 생성과 push는 포함하지 않는다.

## References
- [Next 설치/런타임 요구사항](https://nextjs.org/docs/app/getting-started/installation)
- [Route Handler 및 비동기 params](https://nextjs.org/docs/app/api-reference/file-conventions/route)
- [설치된 Node 24.13.1의 SQLite API](https://nodejs.org/download/release/v24.13.1/docs/api/sqlite.html)
- [Node crypto scrypt와 timingSafeEqual](https://nodejs.org/download/release/v24.13.1/docs/api/crypto.html)

## Adjacent Findings
기존 앱이나 중복 기능은 없다. Git 미초기화는 필수 커밋을 위한 T01 기반 작업에 포함한다. 추가 범위 결정을 요구하는 인접 결함은 발견되지 않았다.
