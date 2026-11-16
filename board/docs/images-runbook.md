# 이미지 에디터 운영 안내

2026-11-16 준비. 기능 활성화와 실제 runtime Blob QA는 마지막 릴리스 Task에서 기록한다. 현재 운영 SQL 스키마3과 기존 앱을 유지한다.

## 자원과 인증

| 항목 | 값 |
| --- | --- |
| 구독 | DEX / 7b1417d8-833d-4ba9-a5cd-d27c91a28b83 |
| 그룹 / 지역 | rg-vibe-board-prod / koreacentral |
| 앱 | app-vibe-board-prod-7b1417 |
| Storage | stvibeboardimg7b1417 / StorageV2 / Standard_LRS / Hot |
| 서비스 URL | https://stvibeboardimg7b1417.blob.core.windows.net |
| 컨테이너 | board-images, private |
| runtime system principal | c622583d-88b1-45c2-b335-fe576e2ab599 |
| local operator principal | e8222b20-96f4-4c25-a3af-1f40ebbbec56 |
| data 역할 | Storage Blob Data Contributor, 컨테이너 범위만 |
| 역할 ID | ba92f5b4-2d11-453d-a403-e96b0029c9fe |

역할 범위는 `/subscriptions/7b1417d8-833d-4ba9-a5cd-d27c91a28b83/resourceGroups/rg-vibe-board-prod/providers/Microsoft.Storage/storageAccounts/stvibeboardimg7b1417/blobServices/default/containers/board-images`이다. 앱에는 system identity를 추가하며 GitHub 배포용 user-assigned identity는 붙이지 않는다. GitHub OIDC subject와 Website Contributor 범위는 기존 앱으로 유지한다. 계정 키/SAS/장기 client secret은 생성하거나 사용하지 않는다.

HTTPS 전용/TLS1.2 이상, Blob 익명 공개 금지, Shared Key 비활성, Microsoft 관리 기본 암호화, Blob·컨테이너 soft delete 7일, versioning 비활성이다. 같은 지역의 공개 endpoint에 Entra data 인증을 사용하며 추가 VNet/Private Endpoint는 만들지 않는다.

## 준비·검증 명령

`infra/azure/images.bicep`만 Incremental로 배포한다. main.bicep 전체를 다시 적용하지 않는다. 기존 B1 Linux x1/SQL Basic5DTU·2GB/Local7일 백업을 유지한다. WhatIf의 기존 SQL/앱 `Ignore`는 무변경이며, Delete와 관계없는 Create/Modify는 실행기에서 거부한다.

```powershell
# board 디렉터리. 먼저 지정 앱의 system identity를 초기화한다.
az webapp identity assign --subscription 7b1417d8-833d-4ba9-a5cd-d27c91a28b83 -g rg-vibe-board-prod -n app-vibe-board-prod-7b1417 --identities '[system]' -o none
./scripts/provision-images.ps1 -Mode Validate
./scripts/provision-images.ps1 -Mode WhatIf
./scripts/provision-images.ps1 -Mode Apply
./scripts/provision-images.ps1 -Mode Verify
./scripts/set-image-settings.ps1 -Mode Disabled
npm run verify:image-access
```

Validate/WhatIf/Verify는 자원을 변경하지 않는다. Apply는 소유 태그·정확한 지역/SKU를 확인하고 지정 계정과 자식 자원만 변경한다. 새 역할 전파에 시간이 걸리면 실패 원문을 출력하지 말고 같은 읽기 검사를 잠시 후 재시도한다. `verify:image-access`는 AzureCliCredential로 컨테이너 속성 조회와 익명 HEAD 거부만 검사하며 파일을 쓰지 않는다. 실제 앱의 ManagedIdentityCredential put/read/delete 증명은 schema4 원장에 등록한 최종 own QA에서만 수행한다.

앱은 STORAGE_AUTH_MODE=managed-identity, 로컬은 azure-cli이다. STORAGE_BLOB_SERVICE_URL과 STORAGE_CONTAINER는 위 값이며 EDITOR_FEATURE_ENABLED/MEDIA_CLEANUP_ENABLED의 준비 값은 둘 다0이다. 설정 스크립트는 관련 nonsecret 키만 추가하고 SQL/admin/rate 비밀값을 읽거나 변경하지 않는다. 로컬 `.env.local`도 관련 줄만 교체하고 기존 scrypt dollar escape와 나머지 줄을 유지한다. 이 파일을 Git/ZIP에 넣지 않는다. 전체 인프라 실행기도 기존 이미지 설정·flag·identity·APP_VERSION을 보존하도록 갱신했다.

## 게시·정리·용량

이미지당5MiB, 최대5장/글, 원본 합계20MiB, 전체 추적 용량1GiB이다. JPEG/PNG/WebP의 magic·형식·정지 프레임을 확인해 EXIF/ICC/GPS 없이 최대1920px WebP로 재인코딩한다. 공개 URL은 앱 `/api/images/{id}`이며 SQL의 attached와 부모 글 존재를 확인한 뒤 스트리밍한다. draft/삭제 파일은404이다. 원본 이름과 업로드 토큰을 저장 문서/로그/URL/storage에 넣지 않는다.

저장 중 파일은 최대5MiB를 예약한다. 확정 후 실제 출력 크기로 조정하고, 삭제·실패·late completion의 파일은 원장과 outbox로 추적한다. 미연결 초안은24시간 후 정리한다. Blob 삭제 성공 뒤에도7일 soft-delete 기간에는 용량을 반환하지 않는다. 늦게 나타난 객체는 다시 durable outbox에 넣어 삭제를 확인한 시점부터7일을 보존한다. 반복되는 없는 파일 HEAD는 보존 기간을 연장하지 않는다. 실제 보존이 끝나고 head 부재를 확인한 뒤에만 용량을 반환한다.

자동 worker는 Azure Node runtime에서 MEDIA_CLEANUP_ENABLED=1일 때10분 간격, 1회 최대100건·4분 budget으로 실행한다. SQL 유지보수 lease5분과 job lease2분으로 중복 실행을 막는다. 장애는 제한된 상수 코드와 지수 backoff로 재시도한다. 원본 SQL/Blob 오류나 IP/토큰을 남기지 않는다. 작업은 특정 SQL asset 경로만 대상으로 하며 컨테이너 전체 delete sweep는 하지 않는다.

```powershell
npm run media:cleanup -- --limit 100          # queue 건수만 읽는 dry-run
npm run media:cleanup -- --apply --limit 100  # 정확한 운영 환경/권한 확인 후 실제 정리
```

초안/토큰/File/ObjectURL은 브라우저 메모리에만 있다. 저장 실패 후 문서와 선택 파일은 유지하지만 페이지를 닫으면 초안이 사라진다. 서버 세션15분·취소·만료와 이미지 정리는 재시작에도 SQL에 남는다. 이탈 시 취소 요청이 실패해도 worker가 정리한다. 1GiB 도달 시 새 업로드만 중지하며 기존 글 읽기·인증된 삭제는 계속된다.

## 배포와 복구

schema4 전환 전에 `.deploy/compat-schema4/board.zip`과 release.json의 commit/SHA256을 확인한다. 마지막 Task에서 flag0 상태로 운영 migration·grants·제한 계정 검증을 수행한 뒤 main Actions를 배포하고 `/api/health.version`을 실제 배포 SHA와 대조한다. 이 Task에서는 운영 migration을 하지 않는다. 정상 main Actions의 flag0 호환 패키지를 최종 최소 rollback 기준으로 보관한다.

릴리스 실패 시 DB를 되돌리지 않고 검증한 호환 ZIP을 배포해 flag0에서 읽기와 일반 글을 회복한다. schema4 이후 과거 schema3 ZIP, 역migration, 운영 데이터 초기화는 사용하지 않는다. rich 문서와 이미지 metadata/Blob을 보존한다. GitHub artifact는14일 후 만료하므로 baseline ZIP·manifest를 별도 안전 보관한다. `.deploy`는 Git에서 제외되며 비밀값을 포함하지 않는다.

DB PITR이 필요하면 uploads/자동 cleanup을 멈추고 별도 DB로 복원·검증한다. 복원 시점의 attached asset metadata와 Blob 상태를 함께 대조한다. 7일 내 soft-deleted Blob은 해당 SQL asset의 정확한 경로만 operator Entra 권한으로 undelete하고, outbox/상태/용량을 확인한다. 복원 시점 이후 파일도 존재할 수 있으므로 기존 DB와 Blob을 보존한 채 원장을 조정하기 전 업로드를 재개하지 않는다. blob 없는 metadata만 복원하거나, 컨테이너 전체를 복원/삭제하는 방식은 피한다. 이 준비 작업에서 복원 DB나 미추적 QA Blob을 만들지 않았다.

## 비용 목표

2026-11-16 [공식 Retail Prices API](https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices)의 Korea Central/KRW/Consumption을 조회했다. B1 Linux24.0777원/시간, Single Basic B236.8978원/일로730시간 기준 합계 약24,782원/월이다. 새 Hot LRS는1GiB당26.753원/월, 쓰기66.8825원/1만건, 읽기5.3506원/1만건, 기타 작업5.3506원/1만건이다. 예를 들어1GiB·쓰기1만·읽기2만·기타1만건은 기존 기본 요금과 합쳐 약24,900원/월(세금·추가 백업·송신 별도)이다.

[Blob 공식 가격](https://azure.microsoft.com/en-us/pricing/details/storage/blobs/)은 저장량·거래·송신·중복 방식에 따라 달라진다. 조회한 MGN 송신 meter는 최소구간0원, 100GB 이후 첫 구간160.518원/GB였으며 무료 구간 적용은 구독 전체 사용과 계약을 확인해야 한다. KRW 표시는 참고 환산값으로 실제 청구·환율·계약과 다를 수 있다. 월50,000원은 목표이며 강제 지출 한도가 아니다. 1GiB SQL 용량 한도도 HTTP 조회 수·송신 요금의 상한은 아니다. Azure Cost Management에서 해당 RG를 모니터링한다. SKU·지역·인스턴스 수를 높이거나 추가 모니터링/Private Endpoint/geo 복제를 생성하지 않았다.

복구와 보존 정책은 [Azure Blob soft delete 문서](https://learn.microsoft.com/en-us/azure/storage/blobs/soft-delete-blob-overview), 권한은 [Storage Blob Data Contributor](https://learn.microsoft.com/en-us/azure/role-based-access-control/built-in-roles/storage#storage-blob-data-contributor)를 따른다. 실제 적용 및 릴리스 증거는 아래에 추가한다.

## 실행 증거

- 2026-11-16 images.bicep/main.bicep 빌드, Azure Validate, Incremental WhatIf/Apply, Verify 통과. 기존 자원은 Ignore이고 새 계정/service/container/두 role assignment만 생성했다.
- runtime principal c622583d-88b1-45c2-b335-fe576e2ab599 / operator e8222b20-96f4-4c25-a3af-1f40ebbbec56에 위 컨테이너 범위 역할을 확인했다. B1 Linux x1·SQL Basic2GB와 기존 GitHub OIDC subject는 유지했다.
- 앱·로컬 이미지 flag는0, 앱 인증은managed-identity/로컬은azure-cli이다. `verify:image-access` 결과 containerReadable=true/private=true. 파일 쓰기·운영 migration은 실행하지 않았다.
- 기능 비활성 설정 후 기존 공개 health가 status=ok/version=57fda56f9e28dbc33971323dd804b2268cee5a55로 복구됨을 확인했다.
- 익명 HEAD의 응답은 API 버전에 따라 다르다. 버전 없는 요청은409였고, 검증기는2023-11-03을 명시해401/403/404 차단을 확인한다. 이는 [Microsoft의 익명 요청 응답 설명](https://learn.microsoft.com/en-us/azure/storage/blobs/anonymous-read-access-prevent#responses-to-anonymous-requests)에 따른다. 권한 있는 컨테이너 속성 조회의 private 확인도 함께 수행한다.
- 로컬 개발도 운영 SQL과 같은 Blob 계정을 공유한다. 로컬 기본 flag0을 유지하며 자동 테스트는 항상 전용 SQL/Azurite fixture를 사용한다.
- 전환 전 복구 baseline: source `6d7b5d9238db9cb2d7977db93ab9f4709aea9528`, SHA256 `2dd907e71cbf2f24bb959c4d185f208b731f91d4ea36b37910309f9b0ea96c4a`. Linux 패키지 검증 후 `.deploy/compat-schema4/board.zip`과 manifest를 보관했고 실제 해시를 대조했다. 정상 main Actions 아티팩트로 최종 baseline을 교체한다.

## 이미지 릴리스 검증

`./scripts/verify-live-media.ps1 -Commit <실제 배포 SHA> -Disabled`로 schema4 flag0 일반 글 호환과 rich/session/upload 차단을 검사한 뒤, `./scripts/set-image-settings.ps1 -Mode Enabled`로 두 flag를 활성화한다. 이후 `./scripts/verify-live-media.ps1 -Commit <실제 배포 SHA>`를 실행한다. 관리자 비밀번호는 DPAPI에서 복호화해 stdin으로만 전달한다.

검증은 임의 UUID 접두어의 글 최대2개와 세션 최대4개, 파일 예약 최대5개만 사용한다(flag0 검증 글1개는 별도). Chromium 파일 선택·서식·1280/390px·검색·수정·이미지 소유권·초안 비공개·Origin·형식/크기·실제 App Service 재시작·관리자 삭제/로그아웃을 검사한다. 자동 테스트는 격리 SQL/Azurite에서 같은 도구를 먼저 실행한다. 운영 브라우저 trace와 요청 본문/자격증명은 기록하지 않는다.

정리는 메모리에 있는 본인 세션 토큰의 해시로 SQL asset 소유권을 확인한 UUID만 worker에 전달한다. 응답 유실 시에도 본인 UUID 접두어와 작성자 비밀번호를 확인해 글을 삭제한다. 다른 운영 글·이미지·제한 카운터는 변경하지 않는다. 삭제된 파일은 공개 경로에서 즉시404이며 Azure의 실제 deleted marker와7일 용량 보류를 확인한다. 파일 예약이 변환 전에 실패한 경우 파일 없이 즉시 환급될 수 있다. 검증은 제한 윈도우를 소비하므로429는 Retry-After의 자연 만료를 기다리고 카운터를 초기화하지 않는다.
