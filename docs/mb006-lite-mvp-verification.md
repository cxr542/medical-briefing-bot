# MB-006 Lite MVP v1.0 검증

## 범위와 기준

- 기준 main: `2f233f27248d8868488b9d5fa90223c467fb8eda`
- 브랜치: `feat/mb006-lite-mvp`
- 고객 `/customer-admin/support`, 내부 관리자 `/admin/support`의 기존 화면을 간소화한다.
- 기존 작업 checkout을 수정하지 않고 별도 worktree에서 구현·검증했다.
- 운영 Migration은 **BLOCKED**다. 이 PR은 운영 적용이나 활성화 승인이 아니다.

## A. 기존 기능 재사용

| 기능 | 처리 |
| --- | --- |
| 고객·내부 관리자 인증, 역할·요청 소유권 검사 | 기존 서버 가드와 API 유지 |
| 문의 목록·등록·상세·공개 답변·상태 API | 기존 계약과 RPC 유지 |
| DB 상태 7개·전이 제약·낙관적 버전·감사 기록 | 변경 없음 |
| 첨부파일 선택·붙여넣기·미리보기·분할 업로드·재시도 | PR #95 컴포넌트 재사용 |
| 비공개 Storage·검사·인증 다운로드 | 기존 API·정책 유지 |
| Dialog·페이지 이동·로딩·오류·충돌 처리 | 기존 공통 컴포넌트 재사용 |
| 우선순위·상세 상태 필터·내부 메모·처리/감사 이력 표시 | MVP 화면에서 제외, DB/API 보존 |

`edu-team-tms`의 CSR 카드 구조를 참고했다. 해당 프로젝트의 공개 파일 URL 방식을 가져오지 않았다.

## B–D. 구현 및 변경 파일

고객은 목록에서 문의를 열고 제목·내용과 선택적 파일을 등록한다. 내부 관리자는 전체 목록에서 문의와 공개 답변을 확인하고 답변·상태를 저장한다. 대시보드, 배정, 통계, 자동 분류를 추가하지 않았다.

파일 경로는 `medical-briefing-bot/frontend/` 기준이다.

- `src/lib/support/board.ts`: 7개 DB 상태의 화면 그룹, 유효 전이 계획.
- `src/components/support/SupportCenter.tsx`: 번호·제목·상태·등록일의 단순 목록.
- `src/components/support/NewRequestDialog.tsx`: 제목·내용 중심 등록, 기본 우선순위 normal.
- `src/components/support/SupportRequestDetail.tsx`: 문의·답변·첨부, 내부 답변·상태 변경.
- `src/components/support/SupportPrimitives.tsx`: 공통 상태 표시와 첨부 비활성 안내.
- `src/components/support/support.css`: 처리 중 그룹 스타일, 불필요한 상태 스타일 제거.
- `DESIGN.md`: CSR 화면 계약.
- `tests/supportBoard.test.mjs`: 상태 그룹 및 실제 migration RPC와의 전이 호환성.
- `tests/ui/support.spec.mjs`: 간소화 UI·충돌·부분 실패·인증·반응형 회귀.
- `tests/ui/attachments.spec.mjs`: PDF/DOCX/XLSX 선택·업로드 시나리오 추가.
- `tests/fixtures/supportUiServer.mjs`: support 활성/첨부 비활성인 로컬 검사 환경 추가.
- 저장소 루트 `docs/mb006-lite-mvp-verification.md`: 이 보고서.

| 화면 상태 | DB 상태 |
| --- | --- |
| 접수 | received |
| 처리 중 | reviewing, in_progress, waiting_customer, on_hold |
| 완료 | completed, cancelled |

취소된 문의에는 종료 안내를 표시하고 상태를 재개하지 않는다. 완료 문의는 기존 규칙대로 reviewing으로 재개할 수 있다. 접수로 되돌리는 DB 전이는 제공하지 않는다.

접수 → 완료는 기존 API로 reviewing → in_progress → completed를 순서대로 수행한다. 각 호출의 응답 version을 다음 호출에 전달한다. 여러 호출 전체가 단일 트랜잭션인 것은 아니다. 중간 오류에는 저장 사실을 표시하고 최신 상태를 재조회한다. 재시도는 재조회한 상태에서 필요한 단계만 수행한다. 409는 기존처럼 입력 보존·최신 내용 확인 후 재시도한다.

## E. 첨부파일

JPG/PNG/WEBP/PDF/DOCX/XLSX, 파일당 10MiB·문의당 5개 제한을 유지한다. 클립보드 이미지는 파일 첨부 영역에서 붙여넣는다. 선택 이미지 미리보기는 로컬 object URL이다. 업로드 실패 시 문의 내용·생성 ID·재시도 키를 유지한다.

원격 파일은 clean 판정 후 기존 인증 API를 통해서만 미리보기·다운로드한다. pending/scanning/infected/failed 파일을 노출하지 않는다. 기능 플래그가 꺼진 화면에는 실제 업로드가 불가능하다는 안내를 표시하며 첨부 API를 호출하지 않는다.

## F–G. 검증

2026-10-20 로컬 격리 환경에서 다음을 실행했다.

| 검증 | 결과 |
| --- | --- |
| `npm test` | 227개 통과, skip 없음 |
| `npm run test:support:http` | 14개 통과; 내부에서 기존 고객 HTTP 4개도 통과 |
| `SUPPORT_TEST_WEBPACK=1 npm run test:support:ui` | 41개 통과; production build 포함 |
| `npx tsc --noEmit` | 통과 |
| `npm run lint` | 통과 |
| `git diff --check` | 통과 |

UI 검증은 문의 등록·목록·상세·공개 답변, 상태 완료·재개·취소 종료, 중간 전이 실패/재시도, 409, 저장 성공 후 조회 실패, 중복 제출 방지, 파일 제한·이미지 미리보기·붙여넣기·실패 복구, 문서 3종, 검사 상태별 다운로드 제한을 포함한다.

보안 회귀는 미인증·일반 직원·반대 역할·다른 고객 접근 차단, CSRF, 텍스트의 HTML 비실행, 업로드 권한 만료, 파일 형식 검사, 동시 업로드 제한, 검사 결과 위조/오류, 안전한 다운로드 헤더, 비공개 메모 분리 등을 기존 unit/DB/HTTP 테스트로 확인한다. `CUSTOMER_AUTH_ENFORCEMENT_ENABLED=false`인 UI 환경에서도 지원 화면의 인증을 검증했다.

화면 캡처는 고객/내부 × 폭 390/1440/1920 × OS light/dark에서 목록·상세·상세 하단 및 고객 등록 Dialog를 생성한다. 390은 touch/mobile·DPR 3이다. 가로 넘침, 키보드 취소·포커스 복귀를 검사한다. 기존 운영 화면의 명시적 light 색상 체계를 유지하므로 OS dark에서도 밝은 화면이다. 캡처는 `frontend/test-results/support-ui/`에 생성되며 Git에 포함하지 않는다. 두 역할 화면의 배치·한글 줄바꿈·스크롤 하단·등록 Dialog를 직접 시각 검토했다.

PGlite/Mock Storage/로컬 인증 서버를 사용했다. 실제 운영 Supabase·Storage·Scanner와 실제 iOS Safari는 **미검증**이다. 문서 UI 테스트의 파일 내용·검사 결과는 Mock이며 운영 파일 검사 통과의 증거가 아니다. 새 의존성을 추가하지 않았다.

## H–I. PR 및 운영 조건

PR 제목: `feat(mb-006): simplify support center into CSR board MVP`.
GitHub CI 결과와 PR URL은 해당 PR 및 최종 전달 보고서에서 확인한다. 자동 병합을 설정하지 않는다.

운영 DB/Migration/이력 repair/Storage/Scanner/Secrets/환경변수/기능 플래그/Vercel/Collector를 변경하지 않았다. Actions를 수동 실행하지 않았다. 기존 운영 Migration BLOCKED를 유지한다.

운영 적용에는 기존 MB-006 절차에 따른 백업·복원 검증, Migration 이력 정합성과 적용 승인, 비공개 Storage/정책, 실제 검사기·작업자 연결과 오류 시 차단 검증, 실제 Supabase/PostgREST 다중 연결 검증, 실기기 확인 및 별도 기능 활성화 승인이 필요하다. 이 PR 롤백은 UI 커밋 revert로 수행하며 DB 롤백·데이터 삭제가 필요하지 않다.

## J. 사용량

계정 사용량은 최종 보고 시점의 Codex 조회 결과를 별도로 제공한다. 이 PR의 토큰·컨텍스트 사용량이나 정확한 모델 ID는 계정 한도 조회 API로 알 수 없으며 추정하지 않는다.
