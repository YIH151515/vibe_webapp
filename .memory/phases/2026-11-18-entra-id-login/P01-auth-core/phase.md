# Phase: P01 인증과 서버 권한 기반

- Date: 2026-11-18
- Status: in_progress

## Tasks
| Task | Status | Summary | Blueprint |
| :--- | :--- | :--- | :--- |
| T01 | done ✅ | additive SQL5·principal·설정·opaque 세션 | [T01](./T01-identity-schema.md) |
| T02 | done ✅ | OIDC/일회용 flow·auth routes·가짜 issuer | [T02](./T02-oidc-login.md) |
| T03 | in_progress 🔵 | 글·이미지·업로드·관리자 계정 권한/DTO 전환 | [T03](./T03-board-authorization.md) |

## Progress
- done: 2/3 (active: T03)
- T01 commit cc6cd9c: schema5와인증설정/principal/opaque세션구현,서비스66/API18/typecheck/lint/diffcheck통과. 기존route인증연결및운영변경없음.

## Completion
3개 Task 검증·지정커밋 후 P02-T01로 전진한다. 이 Phase에서 운영 Entra/SQL/main을 변경하지 않는다.

- T02 commit b47774d: 서비스73/API21/typecheck/lint/build통과. OIDC/signature/PKCE/암호화flow/cookie/logout/fakeissuer완료,게시판권한연결과운영변경은아직없음.
