# Task: T02 배포 기본 인증 차단
## Status: pending
## Goal
F01 SCM/FTP기본인증을실제운영과인프라선언에서끄기.
## Decision Summary
DEX구독/rg-vibe-board-prod/app-vibe-board-prod-7b1417두정책만false. SQL/방화벽/다른설정불변. 실패시기본인증true로복구금지.
## Implementation
### I01. 선언/도구
- Related Files: infra/azure/main.bicep(modify)::Microsoft.Web/sites/basicPublishingCredentialsPolicies@2023-12-01두resource,parentapp,nameftp/scm,properties.allowfalse; board/scripts/harden-publishing.ps1(new)::param([ValidateSet('Inspect','Apply','Verify')][string]$Mode='Inspect').
- entra-common.ps1 Assert-EntraOperator/Get-BoardAccessToken/Invoke-BoardRest재사용. 모델PublishingPolicy{name:'ftp'|'scm',allow:boolean}. API2024-11-01. GET2개출력은이름/boolean만. Apply ftpfalse PUT→scmfalse PUT→GET둘false검사. 기본정책false명시와readback성공시만통과. 앱전체config/settings/infraApply사용금지.
### I02. 검증
- Related Files: board/tests/publishing-policy.test.ts(new)::PS AST,두Bicep resource/allowfalse보장. az bicep build --file infra/azure/main.bicep --stdout템플릿출력은메모리캡처/성공상태만출력.
- 실제Apply후Verify,401만으로off판정금지. 다음Task에서기본인증off실제OIDC배포검증.
## Acceptance Criteria
- [ ] Bicep/PS회귀성공,실제두allowfalse,다른설정유지.
## Validation
npm run test:service; npm run typecheck; npm run lint; ./scripts/harden-publishing.ps1 -Mode Apply; ./scripts/harden-publishing.ps1 -Mode Verify; git diff --check.
## Commit Message
```text
fix(security): disable basic publishing authentication

Plan: 2026-11-19-security-hardening
Phase: P01-hardening
Task: T02-publishing-auth
```
## Progress
- [ ] 구현 완료
- [ ] 검증 통과
- commit: pending
