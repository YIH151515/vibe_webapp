# Current Context

## Active Plan
[자유 게시판 Azure 공개 운영](./plans/2026-11-13-free-board-azure.md)

## Active Phase
[P02 Azure 배포와 운영 인계](./phases/2026-11-13-free-board-azure/P02-azure-delivery/phase.md)

## Active Task
[P02-T02 Azure 리소스와 배포 인증](./phases/2026-11-13-free-board-azure/P02-azure-delivery/T02-azure-resources.md)

## Status
- P02-T01 완료 (commit: 58340f9), P01 3/3 및 P02 1/3 완료
- 서비스19개/API13개/브라우저10개 총42개 및 typecheck/lint/build, Linux ZIP 기동·assets·503·비밀파일 배제, workflow 검사 통과
- P02-T02 구현 시작 준비 완료
- done: 4/6
- Docker Linux 엔진 기동 확인, 테스트 전용 컨테이너 정리 완료
- 기존 로컬 게시판 계획은 completed 상태로 보존

## Next Step (IMPORTANT)
P02-T02 청사진을 읽고 구독·권한을 확인한 뒤 B1/SQL Basic·최소 SQL 권한·방화벽·OIDC·운영 설정을 구축한다. GitHub 변수에는 AZURE_RESOURCE_GROUP도 포함한다. 비밀값을 명령 인수/로그/Git에 넣지 않는다. 사용자3000포트 서버와 next-env.d.ts의 기존 미커밋 변경을 보존한다. 사용자가 권고안으로 자동 연속 진행을 승인했다.
