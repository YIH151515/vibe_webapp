# Decisions: 자유 게시판 Azure 공개 운영

- Date: 2026-11-13
- Status: Confirmed
- Feature: free-board-azure
- Scope: 인터뷰 결정 기록만 생성한다. 코드 수정, 원격 연결·push, Azure 리소스 생성·배포는 이 단계에서 수행하지 않는다.
- Previous decisions: [로컬 자유 게시판](./2026-11-13-free-board.md)

## D01. 공개 범위
- **Chosen**: 소규모 공개 게시판. 누구나 읽고 비회원으로 작성한다.
- **Rationale**: 사용자가 소규모 공개 운영을 선택했다. 회원가입·댓글·이미지·조회수·공지 기능은 추가하지 않는다.

## D02. 예산
- **Chosen**: 앱과 DB를 합해 월 50,000원 이하를 목표로 한다.
- **Rationale**: 사용자가 비용 우선 구성을 선택했다. 예상 기본 사용료와 세금·추가 사용량을 구분하고, 실제 구독의 견적을 리소스 생성 전에 재확인한다. 목표 예산은 과금 강제 상한을 뜻하지 않는다.

## D03. 지역과 리소스
- **Chosen**: 한국과 가까운 지역 중 비용·가용성을 비교하고, 한국 중부의 Linux App Service B1 + Azure SQL Database Basic(B, 5 DTU, 2GB) 구성을 채택한다. 앱 인스턴스는 초기 1개이며 자동 확장이나 고가용성 추가 리소스는 초기 범위에 포함하지 않는다.
- **Rationale**: 사용자는 예산 우선 지역 선택 및 Azure SQL Basic을 선택했다. 한국 중부는 비교한 한국 중부·일본 동부·동남아시아 중 기본 구성 비용이 가장 낮았다. 실제 구독의 해당 SKU 생성 가능 여부는 실행 단계에서 확인한다.
- **Pricing snapshot**: 2026-11-13 공개 Retail Prices API, KRW, Consumption 기준. 한국 중부 Linux App Service B1은 시간당 24.0777원으로 월 730시간 약 17,577원. SQL Database Single Basic B는 일당 236.8978원으로 730/24일 약 7,206원. 합계 약 24,782원/월이며 세금·네트워크·초과 백업·선택적 모니터링 등은 별도다. 할인·무료 크레딧·예약 구매는 가정하지 않았다.
- **Rejected alternative**: 한국 중부 App Service B1 + PostgreSQL Flexible B1MS + 32GB 저장소는 기본 사용료만 약 48,573원/월(세금·추가 비용 별도)이어서 예산 여유가 부족했다. 사용자는 이 대안 대신 SQL Basic을 선택했다.

## D04. 기존 Azure 계정
- **Chosen**: 사용자가 보유한 기존 Azure 계정과 구독을 사용한다.
- **Rationale**: 사용자가 기존 구독 보유를 확인했다. 구독 ID, 리소스 이름과 접근 권한은 실행 전 실제 환경에서 확인하며 비밀번호를 문서에 기록하지 않는다.

## D05. 새 데이터와 SQLite 보존
- **Chosen**: Azure SQL은 빈 게시판으로 시작한다. 기존 SQLite 게시글·비밀번호 해시는 이전하지 않는다. 기존 SQLite 파일은 보관하고 자동 삭제하지 않는다.
- **Rationale**: 사용자가 기존 글 이전 없이 새로 시작하는 방식을 선택했다. App Service 영구 네트워크 파일시스템은 SQLite 잠금 요구와 맞지 않아 Azure SQL로 변경한다.

## D06. 로컬 실행과 운영 데이터
- **Chosen**: 로컬도 SQLite 대신 Azure SQL을 사용한다. 별도 개발 DB나 개발 테이블을 만들지 않고 Azure에 공개된 앱과 같은 DB·게시글을 사용한다.
- **Rationale**: 사용자가 두 단계에서 명시적으로 동일 SQL 방식과 동일 데이터를 선택했다. 로컬에서 수정·삭제한 내용도 공개 게시판에 그대로 반영된다. 로컬 실행에는 인터넷·DB 연결 설정이 필요하다.
- **Test isolation**: 자동화 테스트는 운영 DB와 접속 정보를 사용하지 않는다. CI의 임시 SQL Server 환경 등 격리된 테스트 저장소로 SQL 동작을 검증한다. 운영 DB에 테스트용 초기화·삭제·seed를 실행하지 않는다. 세부 실행 방법은 계획 청사진에 명시한다.

## D07. SQL 인증과 비밀정보
- **Chosen**: DB 아이디·비밀번호 방식의 SQL 인증을 사용한다. 로컬은 Git에서 제외된 환경 설정, Azure는 App Service 환경 설정으로 전달한다.
- **Rationale**: 사용자가 Azure 계정/관리 ID 방식 대신 SQL 인증을 선택했다. 관리 ID 인증은 이번 범위에 포함하지 않는다.
- **Implementation principles**: TLS와 서버 인증서 검증을 사용한다. 비밀번호·연결 문자열은 소스·Task·GitHub 저장소·로그에 넣지 않는다. 앱의 DB 접근 권한과 초기 스키마 구성 권한을 구분하고, 실제 권한 부여 방식은 계획에서 구체화한다.

## D08. 공개 주소
- **Chosen**: 첫 공개 주소는 App Service가 제공하는 HTTPS 기본 호스트를 사용한다. 커스텀 도메인·DNS 구입과 연결은 제외한다.
- **Rationale**: 사용자가 Azure 기본 주소 사용을 선택했다. 실제 호스트 이름은 리소스 생성 결과를 기준으로 한다.

## D09. GitHub와 배포
- **Chosen**: https://github.com/YIH151515/vibe_webapp.git 의 main 브랜치로 자동 배포한다. 검사에 통과한 변경을 GitHub Actions로 배포한다.
- **Rationale**: 사용자가 GitHub 자동 배포와 기존 저장소를 선택하고 주소를 제공했다. 읽기 전용 git ls-remote 조회에서 공개되는 브랜치·태그 및 HEAD가 없었다. 당시 로컬 브랜치는 master였고 원격은 연결되어 있지 않았다. main 사용을 인터뷰에서 안내했다.
- **Implementation principles**: 기존 커밋 이력과 .memory 문서를 보존한다. 앱 작업 디렉터리는 board이며 루트 스타터킷·zip·도구 묶음을 배포 패키지에 섞지 않는다. 실행 시 원격 상태를 다시 확인하고 충돌하는 이력을 강제로 덮어쓰지 않는다.
- **Deployment authentication**: GitHub→Azure의 구체적 인증 및 최소 권한은 계획 단계에서 명시한다. SQL 인증 선택은 앱의 DB 접속 방식이며 배포 인증과는 별개다.

## D10. 글 작성과 비밀번호 반복 요청 제한
- **Chosen**: 같은 IP 기준으로 글 작성 10분당 5회, 글 비밀번호 확인 실패 10분당 10회, 관리자 로그인 실패 15분당 5회 제한한다. CAPTCHA·초대 코드는 추가하지 않는다.
- **Rationale**: 사용자가 누구나 작성 + 반복 요청 제한 방식 및 기본 수치를 선택했다. IP를 공유하는 회사·가정에서는 제한도 공유된다고 안내했다.
- **Implementation principles**: 제한 기록은 DB에 보관해 로컬·Azure 및 재시작 사이에 공유한다. 서버 메모리만으로 처리하지 않는다. 임의 프록시 헤더를 신뢰해 우회할 수 없도록 Azure 배포 경계와 클라이언트 IP 판별 방법을 검증한다. 비밀번호와 요청 본문은 저장하지 않는다. 제한 응답은 429와 재시도 안내를 제공하며, 원자적 갱신·만료 기록 정리를 계획에 포함한다.

## D11. 관리자 기능
- **Chosen**: 관리자 비밀번호로 접속하고, 작성자 비밀번호 없이 글을 삭제할 수 있는 최소 관리자 기능을 추가한다.
- **Rationale**: 사용자가 공개 게시판의 부적절한 글을 처리하기 위해 관리자 삭제 기능을 선택했다. 다중 관리자·회원 권한 체계·글 내용 편집 기능은 추가하지 않는다.
- **Implementation principles**: 관리자 비밀번호 비밀값은 서버 환경 설정에 보관하고 평문을 코드·로그에 남기지 않는다. 로그인 실패 제한은 D10을 따른다. 서버가 서명·검증하는 만료 세션과 로그아웃, HTTPS 운영 쿠키 보호, 삭제 전 재확인과 서버 권한 검증을 구현한다. 보관 형식·만료 시간·API 계약은 계획에서 고정한다.

## D12. 기존 동작 유지
- **Chosen**: 기존 글 필드·길이 제한·최신순 20개 페이지·제목/본문 리터럴 검색·한국 시간 표시·일반 텍스트 안전 표시·작성자 비밀번호 해시·복구 미지원은 유지한다.
- **Rationale**: 배포와 공개 운영 지원을 위한 변경이다. DB 전환으로 검색 결과 count/페이지 일관성, 동일 시각 id 정렬, 수정 시 작성일 유지, 비밀값 비노출이 깨지지 않도록 회귀 검증한다.

## D13. 코드 확인으로 확정한 배포 변경
- **Chosen**: 현재 로컬 전용 시작 설정과 동기 SQLite 서비스는 Azure용으로 변경해야 한다.
- **Rationale**: package.json start는 next start --hostname 127.0.0.1이며, database.ts는 node:sqlite DatabaseSync를 사용한다. Azure용 0.0.0.0 및 PORT 설정, 네트워크 DB용 비동기 서비스·트랜잭션/연결 관리가 필요하다.
- **HTTPS origin**: 현재 http.ts는 request URL protocol + Host를 사용하고 Forwarded 헤더는 무시한다. Azure는 앞단에서 TLS를 종료하므로 공개 HTTPS 주소와 로컬 HTTP 주소를 명시한 검증으로 정상 쓰기 요청을 지원해야 한다. 허용 출처를 무제한 확대하지 않는다.
- **Validation**: 기존 SQLite 기반 서비스 테스트를 SQL에 맞게 교체하고, 격리된 DB에서 서비스/API/브라우저 테스트 및 실제 배포 후 HTTPS CRUD·관리자·제한·재시작 보존을 확인한다.

## 환경 확인 및 인접 사항
- az와 docker 명령이 PATH에서 발견됐다. Azure 로그인·구독 권한·Docker 엔진 실행 가능 여부는 아직 확인하지 않았다. gh 명령은 발견되지 않았다.
- 기존 자유 게시판 계획과 current.md는 completed 상태다. 이 인터뷰 단계에서는 current.md를 변경하지 않는다.
- 이번 확인 시 board/next-env.d.ts에 기존 작업 이후의 미커밋 변경이 있었다. 사용자 실행이나 Next 자동 생성 결과일 수 있으므로 수정·복원·stage하지 않았다.
- 기존 ESLint 지원 종료 및 lint 개발 의존성 취약점 경고는 이전 README에 기록되어 있다. 이번 인터뷰에서 별도 도구 major 갱신을 추가하지 않았다.
- 추가 기능: 댓글, 이미지, 회원가입, CAPTCHA, 신고 체계, 개인 도메인, 별도 개발 DB, 데이터 이전은 제외한다.

## References
- [App Service Linux의 SQLite 미지원 안내](https://github.com/Azure/app-service-linux-docs/blob/master/Things_You_Should_Know/things_you_should_know.md#sqlite-and-other-file-based-databases-are-not-supported)
- [App Service Node.js 런타임·PORT·빌드·HTTPS 처리](https://learn.microsoft.com/en-us/azure/app-service/configure-language-nodejs)
- [Azure Retail Prices API](https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices)
- [Azure SQL DTU Basic 자원 한도](https://learn.microsoft.com/en-us/azure/azure-sql/database/resource-limits-dtu-single-databases)
- [Azure SQL Database 가격](https://azure.microsoft.com/en-us/pricing/details/azure-sql-database/single/)
