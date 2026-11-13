# Current Context

## Active Plan
[자유 게시판 Azure 공개 운영](./plans/2026-11-13-free-board-azure.md)

## Active Phase
[P02 Azure 배포와 운영 인계](./phases/2026-11-13-free-board-azure/P02-azure-delivery/phase.md)

## Active Task
[P02-T01 Linux 배포 패키지와 CI](./phases/2026-11-13-free-board-azure/P02-azure-delivery/T01-ci-package.md)

## Status
- P01-T03 완료 (commit: 70826b4), P01 3/3 완료
- 서비스19개/API12개/브라우저10개 총41개 및 typecheck/lint/build, stdin hash 도구 통과
- P02-T01 구현 시작 준비 완료
- done: 3/6
- Docker Linux 엔진 기동 확인, 테스트 전용 컨테이너 정리 완료
- 기존 로컬 게시판 계획은 completed 상태로 보존

## Next Step (IMPORTANT)
P02-T01 청사진에 따라 Linux standalone ZIP·health·GitHub Actions OIDC 배포 workflow를 구현하고 일회용 Linux 컨테이너에서 검증한다. 운영 비밀값을 빌드/패키지에 넣지 않는다. 사용자3000포트 서버와 next-env.d.ts의 기존 미커밋 변경을 보존한다. 사용자가 권고안으로 자동 연속 진행을 승인했다.
