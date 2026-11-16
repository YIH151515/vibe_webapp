# Current Context

## Active Plan
[웹 에디터와 이미지 업로드 — completed](./plans/2026-11-16-rich-editor-images.md)

## Active Phase
없음 — P01 completed4/4, P02 completed3/3.

## Active Task
없음 — 전체7/7 완료.

## Status
- completed (2026-11-16). 사용자 요청대로 오픈소스 에디터·이미지 업로드 완성과 실제 Azure 운영 반영을 모두 완료했다.
- 운영 URL: https://app-vibe-board-prod-7b1417.azurewebsites.net
- 실제 실행 commit77fe827b4ca69cfc9a82cf79688133a1e72ba920. [Actions43826431986](https://github.com/YIH151515/vibe_webapp/actions/runs/43826431986) verify/artifact/OIDC/deploy/health 모두 success. 완료 문서 Task commit a264b3f와 이후 포인터 문서는 재배포하지 않는다.
- SQL4 migration2회/제한 앱 권한 검증 완료. EDITOR_FEATURE_ENABLED=1, MEDIA_CLEANUP_ENABLED=1, App Running/health200 statusok 및 version 일치.
- 전체93개(서비스54/API18/E2E21), typecheck/lint/build/Linux 독립 ZIP/sharp/SDK/CSS/workflow 검사 통과. Node FormData 테스트 입력 보완 후 Linux20회 반복/최종CI 전체 성공.
- 실제 MI 이미지 업로드·private Blob 직접 익명 거부·초안404·ETag304·소유권/Origin/비밀번호/token/MIME/크기와 PC1280/390px·서식·검색·수정/추가/제거·작성일·실제 재시작 후 bytes 동일·관리자 삭제/로그아웃 검증 완료.
- 07:57:16Z 집계: own QA글0/전체글0/삭제jobs0. soft_deleted3개396bytes는7일 보존/용량 보류, prewrite 실패 purged2개0bytes. occupied_bytes=SUM(charge_bytes)=396. 실제 Azure deleted marker 확인. 파일을 전부 즉시 물리 삭제한 것은 아니다.
- 최종 schema4 baseline: board/.deploy/compat-schema4/board.zip + release.json. source77fe827, SHA25626e7d087d6497b758d5052b06ccd409815602e80c4043a71fb98ddc2b9421d7f. 실제 Actions artifact와 대조. 이전6d7b5d9 전환 baseline은 .deploy/pre-transition-schema4 보존. SQL 역migration/schema3 ZIP 복구 금지.
- DEX구독7b1417d8-833d-4ba9-a5cd-d27c91a28b83 / rg-vibe-board-prod / B1 Linux x1 / SQLBasic2GB 유지. stvibeboardimg7b1417/board-images private HotLRS/TLS1.2/SharedKeyOff/soft-delete7일. 앱systemID/operator의 container scope data contributor 확인.
- 운영/로컬 SQL·Blob 공유, 로컬 기본flags0. 자동 테스트는 전용 loopback SQL/Azurite 이중 guard이며 .env.local을 읽지 않는다. 암호·token·cookie·원문IP/파일명/이미지dump 로그·stage 제외.
- 사용자 board/next-env.d.ts dev 경로 변경/루트 도구/AGENTS/zip/기존 SQLite를 보존했고 stage하지 않았다. 사용자3000와 Docker pad 서버 보존. 소유 테스트 컨테이너는 정리 완료.
- 운영·비용·백업/soft delete·복구/cleanup·검증 도구: [이미지 운영 안내](../board/docs/images-runbook.md), [Azure 운영 기록](../board/docs/azure-runbook.md).

## Next Step (IMPORTANT)
남은 Task 없음. 게시판에서 새 이야기 쓰기로 에디터와 이미지를 사용한다. 새 기능은 AGENTS.md의 인터뷰→계획→순차 실행 절차로 시작한다. 운영 복구는 위 schema4 baseline/해시와 flags0을 사용하며 데이터/제한 카운터를 초기화하지 않는다.
