# Current Context

## Active Plan
[자유 게시판 Azure 공개 운영](./plans/2026-11-13-free-board-azure.md)

## Active Phase
[P02 Azure 배포와 운영 인계](./phases/2026-11-13-free-board-azure/P02-azure-delivery/phase.md)

## Active Task
[P02-T03 최초 공개와 운영 검증](./phases/2026-11-13-free-board-azure/P02-azure-delivery/T03-first-release.md)

## Status
- P02-T01 완료 (commit: 58340f9), P01 3/3 및 P02 1/3 완료
- 서비스19개/API13개/브라우저10개 총42개 및 typecheck/lint/build, Linux ZIP 기동·assets·503·비밀파일 배제, workflow 검사 통과
- P02-T02 완료 (commit: a1148a2), Azure·SQL 실제 생성 및 검증 완료
- Bicep/Validate/WhatIf/Apply/Verify, migration2회, SQL CRUD허용·DDL거부·글0개/schema3, local health200/admin401 확인
- 2026-11-16 GitHub write 인증 및 배포 변수5개 등록·재조회 완료
- P02-T03 준비 5e63d1fcc85579f94bfb29e78b097ae7874be303 main 정상 push 완료, Actions run43777374241 진행 중
- 운영 리소스는 생성 시점부터 과금됨(예상 기본 약24,782원/월, 세금 등 별도). 실제 값·DPAPI 비밀 보관/로그인 절차: board/docs/azure-runbook.md
- done: 5/6
- Docker Linux 엔진 기동 확인, 테스트 전용 컨테이너 정리 완료
- 기존 로컬 게시판 계획은 completed 상태로 보존

## Next Step (IMPORTANT)
P02-T03 청사진을 읽고 원격 빈 상태와 추적 파일의 비밀 배제를 확인한 후 main 최초 push, GitHub Actions OIDC 배포, 실제 HTTPS CRUD·관리자·제한·재시작 영속성을 검증한다. 운영 데이터 초기화/전체 삭제는 금지하고 소유 QA 행만 정리한다. 사용자3000포트 서버와 next-env.d.ts의 기존 미커밋 변경을 보존한다. 사용자가 권고안으로 자동 연속 진행을 승인했다.
