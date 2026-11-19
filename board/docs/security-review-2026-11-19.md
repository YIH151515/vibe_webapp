# 자유게시판 보안 점검 — 2026-11-19

대상: https://app-vibe-board-prod-7b1417.azurewebsites.net

사용자가 소유한 운영 사이트에 대한 요청에 따라 제한된 모의해킹, 실제 로그인 후 점검, 코드 검토와 Azure 설정 조회를 수행했다. 확인 시점의 배포 버전은 `ba5e3bb223272c112b074bc0c1ec45567c419a63`이다. 심각도는 이번 범위의 정성 평가이며 CVSS 점수나 보안 인증 결과가 아니다.

최초 점검에서 인증 우회·비로그인 데이터 유출·관리자 권한 탈취는 재현하지 못했고 아래 보안 설정 문제3건을 확인했다. 이후3건 모두 수정해 실제 운영 재검증을 완료했다. 아래 F01~F03의 발견 근거는 수정 전 관찰이며, 최종 상태는 마지막 수정 결과 표를 따른다.

| ID | 심각도 / 우선순위 | 확인한 문제 | 근거 |
| --- | --- | --- | --- |
| F01 | 중간 / 1 | SCM 배포용 기본 인증 허용 | Azure `scm.properties.allow=true`, SCM 외부 접근 Allow Any, 미인증 SCM 응답의 Basic 인증 challenge |
| F02 | 낮음 / 2 | 프레임 삽입 차단과 CSP 누락 | 외부 문서의 iframe에서 로그인 화면 표시 성공. 인증 후 화면에도 CSP·X-Frame-Options 없음 |
| F03 | 낮음 / 3 | HSTS 누락 | HTTPS 응답에 Strict-Transport-Security 없음. HTTP는301로 HTTPS 전환 |

## F01. SCM 배포용 기본 인증이 남아 있음

**수정 전 확인 결과**

- 운영 App Service의 `basicPublishingCredentialsPolicies/scm`은 `allow=true`다.
- SCM IP 제한에는 Allow Any 규칙이 있다.
- `https://app-vibe-board-prod-7b1417.scm.azurewebsites.net/api/settings`에 자격증명 없이 접근하면401과 Basic 인증 challenge가 반환된다. 미인증 설정 조회 자체는 차단됐다.
- FTP 기본 인증 정책도 `allow=true`지만 `ftpsState=Disabled`이므로 FTP 서비스가 현재 열려 있다고 판정하지 않았다.
- GitHub 배포는 OIDC를 사용하지만 [main.bicep](../../infra/azure/main.bicep)의 App Service 선언은 기본 인증을 명시적으로 끄지 않는다.

**영향**

배포 자격증명이 별도로 유출되면 게시판의 Entra 로그인 정책과 별개인 배포 경로로 앱 코드·설정을 공격할 수 있다. 배포 경로를 장악할 때의 영향은 크지만, 이번 점검에서 배포 자격증명 유출·인증 성공·코드 변경은 확인하지 않았다. 따라서 현재 서버가 침해됐다는 의미는 아니다.

**권고**

SCM과 FTP의 기본 인증 정책을 모두 `allow=false`로 고정하고 인프라 선언에도 포함한다. SCM 접근 제한은 운영·배포 경로를 검토해 추가한다. GitHub 호스팅 러너 IP 전체를 임의 허용 목록에 추가하는 방식은 피하고 현재 OIDC 배포 및 긴급 배포 도구가 정상 작동하는지 재검증한다. 노출된 배포 자격증명이 발견될 경우 별도로 회전한다.

**수정 후 확인**

두 ARM 정책을 다시 조회해 false인지 확인하고 실제 main OIDC 배포·health 버전 확인까지 통과해야 한다. 미인증 SCM401만으로 기본 인증이 꺼졌다고 판정하면 안 된다.

근거: [Microsoft: 배포 기본 인증 비활성화](https://learn.microsoft.com/en-us/azure/app-service/configure-basic-auth-disable).

## F02. 프레임 삽입 차단과 CSP가 없음

**수정 전 확인 결과**

- `/login`과 실제 로그인 후 `/`, `/posts/new`, `/admin`에서 `Content-Security-Policy`, `X-Frame-Options`가 없었다.
- 별도 브라우저 문서에 운영 `/login`을 iframe으로 넣었을 때 회사 계정 로그인 버튼이 실제 표시됐다. 화면 캡처나 실제 사용자 내용은 저장하지 않았다.
- [next.config.ts](../next.config.ts)의 공통 응답 헤더 설정과 [proxy.ts](../src/proxy.ts)에도 이를 보완하는 정책이 없다. proxy의 페이지 matcher는 로그인 화면을 포함하지 않는다.
- HTML 응답에는 `X-Content-Type-Options`, 명시적 `Referrer-Policy`도 없었다. `X-Powered-By: Next.js`가 표시된다. 이를 별도의 고위험 취약점으로 중복 집계하지 않았다.

**영향과 한계**

외부 사이트가 로그인 화면을 다른 UI와 합성할 수 있고, 향후 콘텐츠 삽입 결함이 발생했을 때 CSP 방어가 없다. 다만 세션 쿠키는 Secure·HttpOnly·SameSite=Lax이며, 이번에 인증된 관리자 작업의 클릭재킹이나 XSS 실행까지 재현한 것은 아니다. CSP가 없다는 사실만으로 현재 저장형 XSS가 있다고 판단하지 않는다.

**권고**

로그인과 오류 화면을 포함한 HTML에 강제 적용되는 `frame-ancestors 'none'` 및 호환용 `X-Frame-Options: DENY`를 우선 적용한다. 스크립트 정책은 Next.js의 요청별 nonce와 Tiptap의 이미지 미리보기 `blob:` 등 필요한 동작을 확인해 도입한다. 스크립트 CSP를 Report-Only로 먼저 검증하더라도 프레임 차단 정책은 별도로 강제 적용해야 한다. 단순 `script-src 'self'` 추가로 Next.js 인라인 스크립트를 깨뜨리지 않도록 한다.

공통 `X-Content-Type-Options: nosniff`와 Referrer-Policy를 설정하고 불필요한 프레임워크 식별 헤더를 제거한다. Permissions-Policy는 카메라·마이크 등 사용하지 않는 기능을 제한하는 추가 보강 항목이다.

**수정 후 확인**

동일 iframe 검증이 브라우저 정책으로 차단돼야 한다. 실제 Entra 로그인·콜백·서식 편집·이미지 선택/미리보기·관리자 화면과 오류 응답에서 회귀를 확인한다.

근거: [OWASP 프레임 차단](https://cheatsheetseries.owasp.org/cheatsheets/Clickjacking_Defense_Cheat_Sheet.html), [Next.js CSP와 nonce](https://nextjs.org/docs/app/guides/content-security-policy).

## F03. HSTS 응답 헤더가 없음

**수정 전 확인 결과**

- `/login`, 인증 후 화면 및 확인한 API 응답에 `Strict-Transport-Security`가 없었다.
- Azure `httpsOnly=true`, 사이트와 SCM 최소 TLS1.2이며 HTTP `/login`은 HTTPS로301 응답했다. HTTPS 전환 자체는 정상이다.
- 점검 시점 Chromium main preload 목록에서 해당 앱 호스트와 `azurewebsites.net`의 정확한 항목은 없었다. 개별 사용자 브라우저의 과거 HSTS 상태나 모든 브라우저의 정책까지 판정한 것은 아니다.

**영향과 한계**

브라우저가 이 사이트를 HTTPS 전용으로 기억하도록 하는 서버 정책이 없다. 첫 HTTP 연결의 네트워크 변조 방어가 부족해질 수 있다. Secure 세션 쿠키가 설정돼 있으므로 이번 결과를 쿠키 평문 유출 성공으로 표현하면 안 된다. 실제 네트워크 중간자 공격은 수행하지 않았다.

**권고**

본 앱의 HTTPS 호스트에서 HSTS를 적용한다. 예를 들어 `Strict-Transport-Security: max-age=31536000`을 사용하고 운영 조건에 맞춰 기간을 정한다. 공유 상위 도메인 전체에 대한 preload·includeSubDomains 적용을 전제로 하지 않는다. HTTP→HTTPS 전환과 인증 쿠키 설정은 유지한다.

근거: [OWASP HTTP 보안 헤더](https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html), [Chromium preload 목록](https://github.com/chromium/chromium/blob/main/net/http/transport_security_state_static.json).

## 실제 운영에서 통과한 점검

| 점검 | 결과 |
| --- | --- |
| 비로그인 목록·상세·에디터 설정·세션·이미지 API | 401, no-store |
| 비로그인 홈·상세 페이지·관리자 페이지 | 로그인 화면으로307 |
| `x-middleware-subrequest` 위조 | 콘텐츠 API401 유지 |
| `x-ms-client-principal` 및 관리자 역할 헤더 위조 | 콘텐츠 API401 유지 |
| 임의64자리 세션 쿠키·rewrite/original URL 헤더 | 콘텐츠 API401 유지 |
| RSC/prefetch 헤더 | 리다이렉트, 콘텐츠 우회 확인 안 됨 |
| `.env.local`, `.git/HEAD`, 배포 ZIP 경로 | 404, 확인한 비밀 파일 signature 없음 |
| Next 이미지 최적화 경유 `/api/posts` | 401 |
| 실제 로그인 세션 | 관리자 세션 정상, Secure/HttpOnly/host-only/Path=/·SameSite=Lax·약1시간 만료 |
| 기존 첨부 이미지 | 로그인200 / 비로그인401 / private,no-store |
| 다른 Origin 또는 Origin 없는 로그아웃 요청 | 각각403, 기존 점검 세션은 유지 |
| 정상 점검 세션 로그아웃 | 204, 이후 세션 조회401 |
| Blob 보안 설정 | 익명 공개 false, Shared Key false, TLS1.2 |
| SQL 경계 | 최소TLS1.2, AllowAllAzure 규칙0, 이전 작업 임시 방화벽 규칙0 |
| 원격 디버깅 | false |
| 운영 npm 의존성 감사 | `npm audit --omit=dev --json` 알려진 취약점0건 |

운영 의존성 감사0건은 전체 보안성이나 미공개 취약점 부재를 보장하지 않는다. 세션 값·토큰·콜백 code/state·사용자 글 내용은 보고서나 로그에 넣지 않았다.

## 코드 검토 및 격리 검증

SQL 검색은 parameter binding을 사용하고 LIKE 특수문자를 escape한다. 본문은 허용된 문서 구조를 검증하고 React로 렌더링하며 임의 HTML을 삽입하지 않는다. 링크는 http/https/mailto 허용 목록을 사용한다. 업로드는 로그인 계정·발급 세션·글 소유자와 연결되고 실제 이미지 형식 검사 후 WebP로 변환한다. 쓰기는 트랜잭션 안에서 현재 세션과 권한을 다시 검사한다.

실제 운영에 다른 사용자·Guest·다른 테넌트 계정을 추가하지 않았다. 타인 수정·관리자 승격·악성 OIDC 서명/issuer/audience/nonce·업로드 위장·SQL injection·저장형 XSS 입력은 격리 회귀와 코드 검토로 평가하며, 실제 운영에서 파괴적 공격을 성공시켰다고 표현하지 않는다.

격리 검증 결과: **`npm run test:all` 최종 exit0, 서비스·API21개·E2E28개 모두 통과.** 최초 실행은 Docker Linux 엔진이 꺼져 준비에 실패했고, 엔진 기동 후 다시 실행해 성공했다. 악성 JWT·중복 callback·타인/legacy 권한·Origin·입력 위조·로그아웃 후 재사용·이미지 변환/소유권 등 기존 회귀를 포함한다. 운영 `.env.local` 대신 일회용 SQL Server/Azurite/가짜 OIDC issuer를 사용했다. 테스트가 만든 서버·컨테이너는 종료됐고 사용자3000 서버와 기존 pad 컨테이너는 유지됐다.

## 변경 없이 재확인하는 예

헤더 확인은 다음과 같이 할 수 있다. 인증 쿠키나 비밀값은 필요 없다.

```powershell
curl.exe -sI https://app-vibe-board-prod-7b1417.azurewebsites.net/login
curl.exe -sI http://app-vibe-board-prod-7b1417.azurewebsites.net/login
```

이번 응답에서는 HTTPS의 CSP/X-Frame-Options/HSTS가 없었고 HTTP 응답은301이었다. 프레임 삽입은 별도 로컬 HTML에서 아래 요소를 표시해 확인할 수 있다. 이 예는 로그인 화면 표시 여부만 확인하며 계정 침해를 재현하는 코드는 아니다.

```html
<iframe src="https://app-vibe-board-prod-7b1417.azurewebsites.net/login"
        width="900" height="700"></iframe>
```

## 기존 설계의 운영 위험 — 신규 발견 건수와 별도

- **권한 회수 지연:** [auth-session.ts](../src/lib/server/auth-session.ts)의 SQL 세션은 로그인 시 권한을 저장하고 최대1시간 유지한다. 계정 차단·관리자 역할 회수는 기존 세션에 즉시 반영되지 않을 수 있다. 기존 운영 안내에 명시된 설계다. 긴급 세션 취소 도구·운영 절차를 실제 대응 가능하게 유지하고 필요한 회수 시간을 별도 정책으로 정한다. 이번 점검에서 실제 계정을 비활성화하거나 역할을 변경하지 않았다.
- **SQL 네트워크:** public network와45개 IP 규칙이 있으며 운영자용 영구 IP 규칙도1개 남아 있다. 공용 endpoint나 규칙 개수만으로 취약하다고 판정하지 않았다. 동적 운영자 IP의 소유권·필요성·만료를 검토하고 불필요해진 정확한 규칙만 정리하는 것이 좋다. 이번에는 방화벽을 변경하지 않았다.
- **읽기 요청 자원 보호:** 로그인·작성·업로드에는 제한이 있지만 세션 검증·목록 검색 같은 읽기는 별도 호출 제한이 보이지 않는다. B1 단일 인스턴스와 Basic SQL에서 가용성 위험을 평가할 여지가 있다. 부하 공격이나 장애 재현을 하지 않았으므로 확정된 서비스 거부 취약점으로 집계하지 않았다.

## 범위와 완료 상태

운영에는 소량의 요청만 순차 실행했고 비밀번호 추측·MFA 우회·대량 요청·취약 파일 업로드·게시글 변경·배포 변경·DB/방화벽 변경을 수행하지 않았다. 실제 로그인은 사용자가 완료했으며 점검용 브라우저 세션은 정상 로그아웃 후 종료했다. 최초 진단에는 제품·운영 수정이 없었다. 이후 사용자의 수정 요청으로 아래 후속 조치를 수행했다.

후속 수정은 2026-11-19-security-hardening 결정/계획/3Task에 따라 수행했다. 기존 Entra6/6 완료 이력은 보존하고 새 보안 수정 계획을3/3 완료로 동기화한다. 실제 실행 source와 뒤따르는 보고서 완료커밋의 SHA는 다를 수 있다.

## 후속 수정과 실제 운영 재검증 — 2026-11-19 완료

| 항목 | 최종 확인 |
| --- | --- |
| F01 | **해소** — 실제 SCM/FTP 정책 모두 allow=false. 차단 상태의 main OIDC 배포 성공 후에도 false 유지 |
| F02 | **해소** — HTML 요청별32바이트 nonce CSP, script-src-attr none, frame-ancestors none/XFO DENY. 외부 문서의 iframe 표시 차단 및 parser 삽입 스크립트 실행 차단 |
| F03 | **해소** — HSTS max-age31536000 응답 확인. HTTPS only/TLS 설정 유지 |
| 실제 배포 source | 083b0af7808a18feb178c665f7cd45067c7bd35a |
| 실제 main Actions | [44479404023 success](https://github.com/YIH151515/vibe_webapp/actions/runs/44479404023), verify/deploy 모두 성공 |
| 앱 실행 | Running / HTTPS only / AUTH_MODEentra / health200 및 위 source일치 / 기존 editor·cleanup flag1 |
| 실제 브라우저 | 사용자 직접 회사SSO/MFA·최초Admin 세션·홈/작성/관리자 화면·서식/미저장 Blob이미지 미리보기·기존 첨부 조회 성공. 정상 페이지의 CSP 위반0 |
| 인증 유지 | 미로그인 API와 기존 이미지401, 인증된 이미지200/private,no-store, 타Origin logout403, 정상 ownlogout204→session조회401 |
| 데이터 보호 | 운영 게시글·이미지 저장/수정/삭제 요청0. 선택한 검증 이미지는 브라우저 메모리 미리보기만 사용하고 저장하지 않음 |
| 설정 보존 | 기본인증 변경 전후 AppSettings 전체key/value 동일. DB·방화벽·Entra 역할·비밀·유료 등급 변경 없음 |
| 회귀 검사 | 서비스86/API21/E2E29, 타입/lint/워크플로/Bicep컴파일, 실제 Linux production ZIP 브라우저 및 main 동일 검사 성공 |
| 운영 의존성 | npm audit --omit=dev 알려진 취약점0 |
| 복구 기준 | .deploy/entra-schema5-maintenance/board.zip + release.json, 위 source/node24, SHA256 74a5f9d427f90d2b9729bb520d4f5a3bb7d6877b250ff12f40aeee11b4469a93 |
| 이전 기준 보존 | previous-ba5e3bb2와 prepared-c62339c5에 기존 패키지 보존. 복구도 SQL5/maintenance 및 기본인증off 유지 |

실제 결과는 서버 설정 재조회와 운영 브라우저 검증 도구 `scripts/verify-browser-security.mjs`로 확인했다. 공개 상태·검증명만 .deploy/security-hardening-verification.json에 저장하며 쿠키·token·code/state·사용자 내용·trace/HAR는 기록하지 않는다. 점검용 브라우저는 종료했고 사용자3000 개발 서버와 next-env dev 타입 경로는 유지했다.

CSP 적용 과정에서 공통 no-referrer가 Native form POST의 Origin을 null로 만들어 기존 CSRF 검사를 막는 것을 발견했다. 공통 정책은 strict-origin-when-cross-origin으로 조정하고 인증 경로만 no-referrer를 별도로 고정해 기존 콜백 보호를 유지했다. 실제 로그인과 콜백 회귀가 통과했다. form-action은 self와 정확한 Microsoft 로그인 origin을 허용하고, 가짜 issuer 예외는 다중 격리 guard가 통과한 개발 테스트에서만 허용한다.

production의 스크립트에는 unsafe-inline/unsafe-eval을 허용하지 않는다. style-src unsafe-inline은 기존 React/Tiptap CSS 호환을 위한 제한적 예외다. strict-dynamic은 신뢰된 스크립트가 만든 스크립트로 신뢰를 전달하므로, CDP에서 이미 신뢰된 코드를 실행해 동적으로 만든 script를 공격 재현으로 사용하지 않았다. 별도로 HTML parser에 nonce 없는 script를 삽입해 차단을 검증하고 정상 Next.js 스크립트·네이티브 POST의 실행은 유지됨을 확인했다.

이 완료는 확인된 F01~F03의 해소를 뜻한다. 위의 기존 세션 회수 지연·읽기 자원 보호·운영자 IP 수명 같은 별도 설계 검토 항목이나 미점검 영역까지 무결하다고 보장하는 결과는 아니다.
