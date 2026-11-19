# Task: T02 배포 기본 인증 차단
## Status: done
## Goal
F01 SCM/FTP기본인증을실제운영과인프라선언에서끄기.
## Decision Summary
DEX구독/rg-vibe-board-prod/app-vibe-board-prod-7b1417두정책만false. SQL/방화벽/다른설정불변. 실패시기본인증true로복구금지.
## Implementation
### I01. 선언/도구
- Related Files: infra/azure/main.bicep(modify)::Microsoft.Web/sites/basicPublishingCredentialsPolicies@2023-12-01두resource,parentapp,nameftp/scm,properties.allowfalse; board/scripts/harden-publishing.ps1(new)::param([ValidateSet('Inspect','Apply','Verify')][string]$Mode='Inspect').
- entra-common.ps1 Assert-EntraOperator/Get-BoardAccessToken/Invoke-BoardRest재사용. 모델PublishingPolicy{name:'ftp'|'scm',allow:boolean}. API2024-11-01. GET2개출력은이름/boolean만. Apply ftpfalse PUT→scmfalse PUT→GET둘false검사. 기본정책false명시와readback성공시만통과. 앱전체config/settings/infraApply사용금지.
### I02. 검증
- 정책 실행을 board/scripts/publishing-policy.ps1(new)::Invoke-PublishingHardening(Mode,ReadPolicy:scriptblock,DisablePolicy:scriptblock)로분리해실제클라우드없이쓰기순서/읽기전용/잘못된readback실패를검증한다. Apply는ftp→scm쓰기후두readback, Inspect/Verify는쓰기0. 반환모델name/allow이며allow는실제Boolean만허용. entry도구의실제delegates만고정URI로연결한다.
- Related Files: board/tests/publishing-policy.test.ts(new)::PS AST,두Bicep resource/allowfalse보장. az bicep build --file infra/azure/main.bicep --stdout템플릿출력은메모리캡처/성공상태만출력.
- 실제Apply후Verify,401만으로off판정금지. 다음Task에서기본인증off실제OIDC배포검증.
## Acceptance Criteria
- [x] Bicep/PS회귀성공,실제두allowfalse,다른설정유지.
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
- [x] 구현 완료
- [x] 검증 통과
- commit: 지정 fix(security) 커밋 이력 참조

## Actual validation
서비스86/타입/lint/PowerShell모의2개/실제Bicep컴파일성공. 실제운영ftp/scm모두false(readback), 다른AppSettings전체key/value불변. SQL/방화벽변경없음. 다음Task에서off상태실제OIDC배포검증.
