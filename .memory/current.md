# Current Context

## Active Plan
[자유 게시판 Entra ID 로그인 — completed](./plans/2026-11-18-entra-id-login.md)

## Active Phase
없음 — P01 3/3, P02 3/3 completed.

## Active Task
없음 — 전체6/6 completed.

## Status
- 사용자 요청의 실제 서버 반영·URL 제공까지 완료. 운영 https://app-vibe-board-prod-7b1417.azurewebsites.net . 회사계정으로 로그인한다.
- T03 완료 ef2d0dccc6e53d8bd4d0b9aa1a5073cc7230e989. 실제 배포source ba5e3bb223272c112b074bc0c1ec45567c419a63. 뒤따른 완료문서/current 커밋은 재배포하지 않는다.
- 실제 main Actions44262468755 success: https://github.com/YIH151515/vibe_webapp/actions/runs/44262468755 . 전체 서비스/API/E2E/type/lint/workflow/Linux ZIP/OIDC/배포/health 버전 검증 성공.
- 운영 Running/HTTPS only/SQL5/AUTH_MODEentra. health200/statusok/version위source, login200/미로그인글·설정·이미지API401. 운영/로컬 별도 Entra앱·최초Member/Admin실제SSO·역할/설정Verify 성공.
- SQL5 전환 전 콘텐츠를 schema5호환 점검ZIP으로 닫고 원본글/해시/날짜/attached참조 메모리snapshot→migrate2회→grants/제한앱CRUD허용·DDL/dbowner거부→원본보존 확인. 기존글1/attached1 보존, 소유자NULL 그대로.
- 실제 local QA17/prod QA18은 모두 삭제. 총2글/3이미지/3업로드세션 상한 준수, 잔여 자체post/asset ID0. 운영 실제재시작 후 같은 세션/글/이미지 bytes 보존, PC1280/390·서식·검색·수정·날짜·이미지HEAD/ETag인증·Blob직접익명차단·관리자동의·logout replay401 검증 성공.
- 최종 SQL 글1(legacy1)/QA0, attached1/purged2/soft_deleted6, occupied=charged72,206bytes. QA이미지3개는7일softdelete 보존·charge유지이며 물리완전삭제가 아니다.
- 사용자 명시승인으로118.235.12.2 한개를 최대60분 임시허용했다. watcher73881의 고유규칙 board-entra-temp-6bb6cc99ca144a49a2e235724fb68df3은 완료signal 후 실제삭제/ARM404/REMOVED 확인, watcherexit0. 기존사용자방화벽규칙은 변경하지 않았다.
- 최종 schema5 복구기준 board/.deploy/entra-schema5-maintenance/board.zip + release.json, source위ba5e3bb/node24/SHA256061330b00891785cd5d4cc9d685cf175defdba5f851e1a72d082fcf0174f6161. 실제Actions artifact14408647912와 해시대조. 준비c623패키지는 prepared-c62339c5 하위에 보존. schema4/익명ZIP복구·역migration·자료초기화 금지.
- Entra비밀은 Git무시 board/.deploy/entra-login.dpapi, 공개IDs/keyId/만료는entra-resources.json. 각90일secret 만료2027-02-16 UTC/별도암호화키. 운영/로컬 AUTH_MODEentra, local APP_ORIGIN3000 및 기존미디어flag0 유지. 3200 실제QA child만 에디터1 override. callback/query/token/claim/cookie/WS/trace/HAR 기록없음. HTTP logs/detailed errors/request tracing=false.
- DEX7b1417d8-833d-4ba9-a5cd-d27c91a28b83/rg-vibe-board-prod/B1Linuxx1/SQLBasic2GB/privateBlob SharedKeyOff TLS1.2 soft7일 유지. 새 유료인프라/디렉터리등급/과도한역할 추가 없음.
- 사용자3000 PID29808과next-env 두.next/dev/types 경로 변경·루트.agents/.codeburn/AGENTS/README/zip/SQLite·Dockerpad 보존. 자체3200과제어브라우저 모두정리. 사용자next-env는 커밋에포함하지않는다.
- 실제윤일호Admin과두앱SSO만 직접검증. 일반Member/Guest/다른tenant/타owner는격리SQL·가짜서명issuer 회귀로검증,추가실계정로그인까지주장하지않는다. role회수는최대1시간기존세션또는명시취소필요. secret회전/세션취소/SQL5점검복구절차는 board/docs/entra-runbook.md.

## Next Step (IMPORTANT)
추가 Active Task 없음. 요청한 Entra 로그인 운영전환 completed6/6. 다음기능은 사용자 요청에 따라 새 인터뷰/계획으로 시작한다. 현재 운영 source와 완료문서HEAD를 구분하고 사용자 미커밋변경을 보존한다.
