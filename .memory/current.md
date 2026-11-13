# Current Context

## Active Plan
[자유 게시판 Azure 공개 운영](./plans/2026-11-13-free-board-azure.md)

## Active Phase
[P01 SQL·공개 운영 보안](./phases/2026-11-13-free-board-azure/P01-cloud-app/phase.md)

## Active Task
[P01-T02 HTTPS·IP·반복 요청 제한](./phases/2026-11-13-free-board-azure/P01-cloud-app/T02-request-security.md)

## Status
- P01-T01 완료 (commit: 047adb0)
- SQL 서비스9개/API7개/PC·모바일E2E7개 및 typecheck/lint/build 통과
- P01-T02 구현 시작 준비 완료
- done: 1/6
- Docker Linux 엔진 기동 확인, 테스트 전용 컨테이너 정리 완료
- 기존 로컬 게시판 계획은 completed 상태로 보존

## Next Step (IMPORTANT)
P01-T02 청사진을 읽고 APP_ORIGIN 기반 검증·client-ip 식별·SQL 공유 횟수 제한을 구현한다. 일반 실행은 SQL 설정이 필요하며 자동 테스트는 기존 일회용 컨테이너 경계를 유지한다. 사용자3000포트 서버와 next-env.d.ts의 기존 미커밋 변경을 보존한다. 한 번에 현재 Task만 실행한다.
