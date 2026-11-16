# Decisions: 자유 게시판 웹 에디터와 이미지 업로드

- Date: 2026-11-16
- Status: Confirmed
- Feature: rich-editor-images
- 사용자 요청: 글쓰기 TextArea를 이미지 파일 업로드가 가능한 오픈소스 웹 에디터로 교체.
- 결정 근거: 사용자가 이전에 "물어볼 내용들은 권고안으로 진행"하도록 지시했으므로 추가 선택지는 권고안으로 확정했다. 아래 수치와 제품 선택은 사용자가 직접 지정한 것이 아니라 에이전트가 기존 구성에 맞춰 정한 기본값이다.
- Scope: 인터뷰/설계 결정 기록만 생성. 이 단계에서는 구현·패키지 설치·Azure 생성·운영 DB 변경·배포를 하지 않는다. 이전 Azure 계획의 completed 포인터는 유지한다.

## D01. 적용 범위와 기존 동작
- **Chosen**: 글쓰기와 글수정의 본문 입력을 같은 에디터로 교체하고, 글 상세에서 서식과 이미지를 표시한다. 제목/닉네임/작성자 비밀번호/관리자 삭제/검색/페이지/작성일/기존 제한 정책은 유지한다.
- **Rationale**: 두 화면이 PostForm/PostEditor를 공유한다. 현재 PostDetail은 본문 문자열을 React 텍스트로만 표시하므로 입력기 교체만으로는 저장된 서식과 이미지가 표시되지 않는다.
- **Out of scope**: 회원가입·댓글·일반 파일 첨부·동영상·협업 편집·AI·자동 저장·표·HTML 소스 편집·수동 이미지 크기 조절. 기존 SQLite 파일은 보관한다.

## D02. 에디터 제품과 기능
- **Chosen**: Tiptap 3의 MIT 오픈소스 패키지(@tiptap/react, @tiptap/pm, @tiptap/starter-kit 및 필요한 무료 확장)로 자체 한국어 툴바를 만든다. 유료 Pro/Cloud/업로드 SaaS는 도입하지 않는다. 실제 버전은 구현 시 React19/Next16/Node24 호환성과 공식 릴리스를 확인해 정확한 버전으로 고정한다.
- **Functions**: 문단, 제목 H2/H3, 굵게/기울임/밑줄/취소선, 글머리·번호 목록, 인용, 안전한 링크, 실행 취소/다시 실행, 이미지 선택·삭제·순서 이동. PC/390px 모바일·키보드·한글 IME 조합 입력을 지원한다.
- **Rationale**: 기존 React 컴포넌트에 통합하고 사용 중인 게시판 스타일을 유지할 수 있다. Tiptap Image 확장은 이미지를 표시하는 기능이며 실제 파일 업로드는 별도 구현해야 한다.
- **References**: [MIT license](https://raw.githubusercontent.com/ueberdosis/tiptap/main/LICENSE.md), [Next.js integration](https://tiptap.dev/docs/editor/getting-started/install/nextjs), [Image extension](https://tiptap.dev/docs/editor/extensions/nodes/image).

## D03. 본문 저장과 검색 호환성
- **Chosen**: HTML 원문을 저장·실행하지 않고 버전이 있는 허용 목록 기반 Tiptap JSON 문서를 저장한다. SQL posts.content에는 서버가 문서에서 추출한 일반 텍스트를 계속 저장해 기존 검색을 유지한다. content_format(plain|rich_v1), content_json(nullable JSON 문자열)을 추가한다.
- **Compatibility**: 기존 행은 plain/content_json=NULL로 유지하며 일괄 재작성하지 않는다. 기존 글을 처음 수정할 때 줄바꿈을 보존해 에디터 문단으로 변환하고 정상 저장 시에만 rich_v1으로 바꾼다. 기존 plain API 입력은 계속 지원한다.
- **Contract**: 상세 DTO의 기존 content:string을 유지하고 contentFormat 및 document를 추가한다. 새 편집 입력은 document와 선택적 uploadSessionToken을 지원한다. rich 입력의 content는 서버 추출값이 권위값이며 클라이언트의 검색 텍스트·URL을 신뢰하지 않는다. 목록 DTO는 유지한다.
- **Limits**: 일반 텍스트 최대10,000 UTF-16자 유지. rich 문서 UTF-8 JSON 최대48KiB, 전체 글 JSON 요청은 기존64KiB 유지. 최대1,000노드/중첩8단계. 빈 서식만 있는 글은 거부하고, 텍스트 또는 유효한 이미지가 있으면 본문으로 인정한다. 이미지 전용 글을 위해 기존 SQL content 최소1자 제약을 format에 따라 조정한다.
- **Migration**: 다음 SQL version4에 필요한 additive 스키마와 제약 변경을 모은다. 기존 데이터·비밀번호·id·작성일은 유지한다. health/검증 도구의 schema3 고정값과 grants도 함께 갱신해야 한다.

## D04. 안전한 출력
- **Chosen**: 서버에서 허용 node/mark/attribute만 통과시키고 같은 스키마로 상세를 React 요소로 렌더링한다. 임의 HTML/dangerouslySetInnerHTML/임의 style/class/event attribute를 허용하지 않는다.
- **Links**: http/https/mailto만 허용, javascript/data/file 등 거부. URL 길이 최대2,048자. 새 창 링크에는 noopener/noreferrer를 적용한다.
- **Images**: 저장 문서의 이미지 노드는 서버 asset UUID와 alt(최대200자)를 참조한다. 표시 URL은 서버가 /api/images/{id}로 구성한다. 외부 이미지 URL·base64·blob URL·다른 글 소유 asset 참조는 저장 API에서 거부한다. 붙여넣은 HTML은 지원 서식만 취하고 외부 이미지를 서버가 대신 다운로드하지 않는다.
- **Rationale**: 현재는 일반 텍스트 출력이 XSS 실행을 막아 주고 있다. 에디터 도입으로 이 경계를 잃지 않으며 외부 URL 수집으로 인한 SSRF도 만들지 않는다.

## D05. 이미지 입력과 처리 제한
- **Chosen**: 파일 선택, 이미지 파일 드롭, 클립보드 이미지 붙여넣기를 지원한다. JPEG/PNG/WebP만 허용, 파일당5MiB·글당5장·입력 파일 합계20MiB. GIF/SVG/HEIC/AVIF/일반 첨부파일은 초기 범위에서 거부하고 이유를 안내한다.
- **Server validation**: 확장자/Content-Type만 신뢰하지 않는다. 시그니처와 실제 디코딩 형식 일치, 단일 정지 화면, 최대24메가픽셀/가로·세로 각각10,000px를 검사한다. 실패/손상/다중 프레임 파일은 저장하지 않는다.
- **Normalization**: sharp로 방향 보정·긴 변 최대1,920px/확대 없음·WebP quality82로 재인코딩한다. EXIF/GPS 등 원본 메타데이터와 원래 파일명은 저장/로그하지 않는다. 출력도5MiB를 넘으면 거부한다. 서버 변환 동시성은 B1 메모리를 고려해 최대2개로 제한한다.
- **HTTP boundary**: 이미지 전용 multipart API에5MiB+64KiB 스트리밍 body 상한을 적용한다. 기존 일반 JSON API의64KiB 상한을 전역적으로 늘리지 않는다. 위반413, 형식415/400, 용량 부족409, 제한429/Retry-After, 저장소 장애503을 구분한다.
- **Reference**: [sharp input limits](https://sharp.pixelplumbing.com/api-constructor/).

## D06. 업로드 시점과 작성 UX
- **Chosen**: 이미지 선택 직후에는 브라우저 메모리의 파일과 Object URL로 미리 보여 주고, 글 등록/수정 저장 시 실제 업로드한다. 초안 파일을 localStorage/SQL 본문/base64로 보관하지 않는다. 선택 취소·완료·화면 종료 시 Object URL을 해제한다.
- **Flow**: 입력 검증 → 필요하면 업로드 세션 발급 → 이미지 순차 업로드 → 임시 노드를 반환된 asset UUID로 교체 → 글 원자 저장. 업로드 진행/실패/재시도를 표시하고 진행 중 이중 제출을 막는다. 일부 실패 시 본문·선택 파일을 유지하고 성공한 파일은 유효한 세션 내에서 재사용한다. 비밀번호는 기존처럼 실패 시 지우고 재입력을 받는다.
- **Edit authorization**: 기존 글에 새 이미지를 업로드하기 전에 작성자 비밀번호를 확인한다. 비밀번호를 URL·storage·로그에 넣지 않는다. 임시 세션이 만료되면 새 세션과 업로드를 시작하며 이전 파일은 정리 대상으로 남긴다.
- **Rationale**: 글을 쓰다가 취소한 경우 불필요한 클라우드 업로드를 줄인다. 기존 수정 폼에 작성자 비밀번호 입력이 이미 있다.

## D07. 파일 저장소와 기존 Azure 자원
- **Chosen**: 현재 DEX 구독/rg-vibe-board-prod/한국 중부에 Standard StorageV2 Hot LRS 저장소1개와 private board-images 컨테이너를 추가한다. 기본 계정명은 stvibeboardimg7b1417이며 실제 전역 충돌 시 소유 확인 후 숫자 suffix로 조정한다. 기존 B1/SQL Basic/SKU/지역은 유지한다.
- **Security**: TLS1.2 이상, allowBlobPublicAccess=false, Shared Key 인증 비활성화. App Service에는 별도의 system-assigned 관리 ID를 부여하고 해당 컨테이너 범위의 Storage Blob Data Contributor만 부여한다. GitHub 배포용 사용자 할당 ID를 앱 런타임 자격증명으로 공유하지 않는다.
- **Credentials**: Azure 앱은 ManagedIdentityCredential, 로컬은 명시적 AzureCliCredential을 사용한다. 저장소 URL/컨테이너명은 서버 설정이며 계정 키·브라우저 SAS·장기 업로드 비밀값을 만들지 않는다. 로컬 사용자에게 필요한 컨테이너 범위 data 역할을 실행 단계에서 검증한다. 기존 SQL은 현재 SQL 인증을 유지한다.
- **Rationale**: App Service의 배포 ZIP/로컬 디스크와 이미지 수명을 분리하고 재시작·재배포 시 파일을 유지한다. SQL Basic2GB에는 이미지 바이너리나 base64를 넣지 않는다.
- **References**: [JavaScript Blob upload](https://learn.microsoft.com/en-us/azure/storage/blobs/storage-blob-upload-javascript), [Entra authorization](https://learn.microsoft.com/en-us/azure/storage/blobs/authorize-access-azure-active-directory).

## D08. 비용과 전체 용량
- **Chosen**: 기존 월50,000원 목표를 유지하며 이미지 계정은 사용량 과금임을 운영 기록에 추가한다. 활성·초안·삭제 대기·soft-delete 보존분을 포함한 추적 용량/예약의 합을1GiB로 제한한다. 임계 초과 시 새 업로드만 막고 기존 글 읽기/이미지 없는 작성은 계속 허용한다.
- **Pricing snapshot**: 2026-11-16 공식 Retail Prices API/KRW/한국 중부/General Block Blob v2/Hot LRS: 첫 구간 저장26.753원/GB·월, 읽기5.3506원/10K, 쓰기66.8825원/10K. 저장 용량 요금만의 값이며 송신·거래·세금 등은 별도다. 구현 시 실제 구독/가격을 다시 확인한다. 저장 한도는 전체 Azure 과금을 강제로 차단하는 장치가 아니다.
- **Rationale**: 이미지 남용으로 SQL/디스크가 가득 차는 상황을 막으면서 소규모 공개 게시판의 기존 예산 구성을 유지한다.
- **Reference**: [Azure Retail Prices API](https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices).

## D09. 비회원 업로드 권한과 요청 제한
- **Chosen**: 서버 생성 random32bytes 소유 토큰을 가진 업로드 세션을 사용한다. 서버에는 토큰 SHA256만 저장하고 토큰 원문은 브라우저/서버 메모리에만 둔다. 만료15분, 원래 HMAC 출발지와 대상 글(id 또는 새 글)에 결합한다. 변경 요청은 requireOrigin=true로 검증한다. 업로드 토큰을 asset URL이나 query에 넣지 않는다.
- **Ownership**: 새 글 저장은 제출 세션이 소유한 준비 완료 이미지, 수정은 해당 글에 기존 연결된 이미지와 제출 세션 이미지에만 연결 가능하다. 업로드 세션 발급·수정 저장 모두 기존 비밀번호 검증/실패 제한을 유지한다. 단순히 글id/asset UUID를 안다고 업로드/연결/삭제 권한이 생기지 않는다.
- **Limits**: 기존 작성5/10분·작성자 실패10/10분·관리자 실패5/15분 유지. 업로드 세션 발급은 출발지당5/10분, 파일 업로드는 출발지당20개/10분 및 입력50MiB/10분을 추가한다. SQL에서 처리 중 건수·바이트를 예약해 동시 요청 우회를 막는다. 실패한 시도도 업로드 시도/수신 바이트 예산에는 반영해 손상 파일 반복 변환을 제한한다. 만료된 세대의 완료는 새 세대 카운터를 변경하지 않는다.
- **Rationale**: 게시판은 공개 비회원 서비스이며 이미지 업로드만 무제한 API로 추가하면 기존 작성 제한을 우회하는 파일 호스팅이 된다.

## D10. 데이터와 정합성
- **Chosen**: SQL에 upload_sessions, image_assets, 삭제 outbox 및 용량/바이트 예약·cleanup lease 기록을 추가한다. 실제 파일은 UUID 기반 고정 경로로 Blob에 저장하며 동일 경로를 덮어쓰지 않는다. 원본 파일명은 경로나 소유권으로 쓰지 않는다.
- **Lifecycle**: 업로드 전 SQL 예약/asset 행 생성 → Blob 쓰기 → ready. 글 저장의 SQL 트랜잭션에서 유효한 소유권을 확인해 attached/post_id 연결과 본문을 함께 확정한다. 같은 asset은 한 글에만 귀속한다. 실패 시 모르는 파일을 일괄 삭제하지 않고 자신이 추적한 상태만 재시도/정리한다.
- **Deletes**: 글 수정에서 제거된 이미지와 작성자/관리자 글 삭제는 같은 트랜잭션에서 detach/삭제 작업을 기록한다. Blob I/O는 SQL 트랜잭션 밖에서 멱등 처리한다. Blob 장애가 글 삭제의 유실이나 이미지를 다른 글에 잘못 연결하는 결과를 만들지 않게 한다.
- **Concurrency**: 임시 파일 정리와 글 저장은 SQL 잠금/상태 전이로 경쟁을 제어한다. 이미 deleting으로 획득된 asset은 연결할 수 없고, 연결된 파일을 만료 정리가 삭제하지 않는다. 예약은 lease 만료로 회복하고 무기한 용량 잠금을 남기지 않는다.

## D11. 공개 이미지 읽기와 삭제
- **Chosen**: GET/HEAD /api/images/{UUID}에서 게시된 글에 연결된 ready 이미지인지 SQL로 확인한 후 private Blob을 서버가 스트리밍한다. 미게시/삭제된/다른 상태는404이다. 임의 Blob 경로·외부 URL·SAS는 입력받지 않는다.
- **Response**: 서버가 정한 image/webp, Content-Length, ETag, X-Content-Type-Options:nosniff. Cache-Control:public,max-age=0,must-revalidate로 재검증하며, 304도 연결 상태 확인 후에만 반환한다. 삭제 후 새로운 네트워크 요청은404로 처리한다. 이미 사용자가 내려받은 공개 이미지는 회수할 수 없다.
- **Rationale**: 이미지 직접 public 컨테이너를 열지 않고, 글과 이미지 공개 상태를 동일하게 유지한다.

## D12. 미사용 파일 정리와 백업
- **Chosen**: 글에 연결되지 않은 임시 파일은 생성24시간 후, 제거/삭제된 파일은 삭제 outbox에 따라 정리한다. Azure 앱의 Node instrumentation에서 시작하는 정리 루프를10분 간격/최대100건으로 실행하고 SQL lease로 중복 작업을 제어한다. 오류는 재시도하며 별도 유료 작업 서비스는 만들지 않는다. 안전한 수동 cleanup 명령도 제공한다. 로컬은 자동 정리 기본off, 테스트는 명시적 job 호출만 허용한다.
- **Recovery**: Blob/컨테이너 soft delete7일을 설정하고 versioning은 사용하지 않는다. soft-delete 보존 기간이 끝날 때까지 추적 삭제 용량도 전체1GiB 한도에 포함한다. SQL PITR7일 복원 시 이미지 복구도 함께 확인하는 runbook을 작성한다. 이번 기능 검증에서 불필요한 복원 리소스를 만들지 않는다.
- **Reference**: [Blob soft delete](https://learn.microsoft.com/en-us/azure/storage/blobs/soft-delete-blob-overview).

## D13. 테스트 격리와 검증 범위
- **Chosen**: 현재 Docker SQL Testcontainers에 Azurite 일회용 저장소를 추가한다. 운영 .env.local/운영 Azure Blob/운영 SQL을 자동 테스트에서 사용하지 않는다. test 모드는 loopback SQL+board_test_와 loopback Azurite+전용 container를 모두 검증하고 production endpoint를 거부한다.
- **Checks**: 기존43개 회귀 갱신, plain 글 호환/검색, JSON·링크·HTML/XSS 거부, 한글 조합/서식 왕복, 이미지 선택·드롭·붙여넣기·취소·실패 재시도, 크기/MIME/손상/다중 프레임·디코딩 제한, 출발지/세션/다른 글 소유권·만료·동시 예약·byte/storage quota, 삭제/정리 경쟁과 Blob 장애/재시도, 관리자 삭제, 키보드/390px/1280px, Linux standalone sharp 런타임과 이미지 CSS.
- **Live acceptance**: 실제 Blob 자원/최소 권한, 이미지가 있는 소유 QA 글의 새로고침·수정·재배포/재시작 후 표시·관리자 삭제·파일 정리, 기존 글 무변경을 확인한다. 운영 QA는 UUID로 소유권을 추적하고 해당 글/이미지만 정리한다.

## D14. 순차 구현과 공개 배포
- **Chosen**: 완료된 Azure 계획과 별도의 rich-editor-images 계획을 만든다. 작업은 feature/rich-editor-images 브랜치에서 진행해 미완성 스키마/코드가 main 자동 배포되지 않게 한다. 호환 코드·SQL migration·Blob 인프라·에디터·검증을 순서화하고 전체 검증 후 main 통합과 공개 배포까지 계획에 포함한다.
- **Rollout**: migration/Blob 권한/설정을 먼저 검토·적용하고 호환되는 앱을 배포한다. B1 단일 인스턴스의 짧은 전환 시간은 허용하되 기존 데이터 삭제/전체 초기화는 하지 않는다. 일반 텍스트 본문을 계속 유지하므로 기존 검색 데이터를 잃지 않는다.
- **Rollback constraint**: rich JSON 저장 후에는 이 기능을 모르는 예전 버전으로 무조건 롤백하지 않는다. 이전 코드의 글 수정이 JSON/이미지 연결을 갱신하지 못하기 때문이다. schema4·문서/이미지 상태를 이해하는 검증된 호환 릴리스를 최소 롤백 기준으로 준비하고 DB를 역마이그레이션하지 않는다.

## 코드 탐색으로 자동 확정한 제약과 인접 발견
- PostForm이 글쓰기/수정을 공유하고 PostDetail은 React 문자열 출력이며, HTML 문서 저장 체계가 없다. API·상세 표시·검증·검색을 함께 바꿔야 한다.
- JSON body64KiB, 본문10,000자/최소1자 SQL 제약, schema3 health 고정값, 최소 SQL grants가 이미 존재한다. 이미지 body를 허용하려고 기존 JSON 한도를 전역 해제하지 않는다.
- 현재 앱 SQL 인증과 배포용 UAMI는 서로 다른 목적이다. Blob용 앱 system-assigned ID를 분리해야 하며 기존 배포 ID를 앱에 연결하지 않는다.
- 운영과 로컬은 같은 SQL을 사용한다. 기능 이후에는 로컬 Blob도 운영 이미지를 다루므로 자동 테스트·cleanup 분리가 필수다.
- 기존 next-env.d.ts 미커밋 변경/루트 도구/SQLite 보관 파일은 기능과 무관하므로 건드리거나 stage하지 않는다.
- 이번 범위 밖에서 새로 확인된 별도 결함은 없다. 기존 개발 의존성 경고를 해결하려고 무관한 major 갱신을 하지 않는다.

## Next command
`/memory-plan rich-editor-images` — 위 결정으로 상세 Task 청사진을 만들고 새 current 포인터를 설정한다. 이 결정 기록 단계에서는 구현하지 않는다.
