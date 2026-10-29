# 새 문의 관리자 이메일 알림

고객 관리센터에서 문의가 저장된 뒤 Next.js `after()`로 Resend에 발송합니다.
수신 주소 기본값은 `cxr542@gmail.com`이며 서버 환경변수로 바꿀 수 있습니다.
등록 응답은 메일 발송을 기다리지 않습니다. 메일 오류로 이미 저장된 글이 실패 처리되지 않습니다.

## 활성화

Resend 계정을 만들고 API 키를 발급한 다음, 해당 Vercel 프로젝트의 Production 환경변수를 설정하고 재배포합니다.

| 변수 | 값 |
| --- | --- |
| `SUPPORT_EMAIL_NOTIFICATIONS_ENABLED` | `true` |
| `RESEND_API_KEY` | Resend에서 발급한 발송 권한 API 키 |
| `SUPPORT_NOTIFICATION_FROM` | Resend에서 사용 가능한 발신 이메일 주소(표시 이름 없이 주소만) |
| `SUPPORT_NOTIFICATION_TO` | `cxr542@gmail.com` (생략해도 동일) |
| `SUPPORT_NOTIFICATION_SITE_URL` | `https://medical-briefing-bot.vercel.app` (기본값) |

발신 주소로 Gmail 주소를 임의 지정하면 안 됩니다. 인증한 도메인의 발신 주소를 사용합니다.
도메인 인증 전 Resend 테스트 발신자 `onboarding@resend.dev`를 사용할 경우 수신 주소가 Resend 계정에 등록된 본인 이메일이어야 합니다.
키를 소스 코드에 넣거나 `NEXT_PUBLIC_` 변수로 만들지 않습니다.
Preview/Development에는 활성화 변수를 설정하지 않으면 테스트 문의가 실제 메일로 발송되지 않습니다.
기존 `SUPPORT_ENABLED`와 고객 인증 설정도 활성화되어 있어야 합니다.

## 동작과 운영

- 메일에는 문의 번호, 제목, 우선순위, 한국 시간 등록일, ID와 관리자 목록 링크가 들어갑니다. 본문과 첨부파일, 세션 정보는 전송하지 않습니다.
- 인증·입력 검증·저장에 실패한 요청, 조회, 답변, 상태 변경은 메일을 보내지 않습니다.
- Resend idempotency 키를 문의 UUID에서 만들어 24시간 내 동일 문의 재시도의 중복 메일을 방지합니다. 등록 후 23시간이 지난 생성 RPC 재실행은 발송하지 않습니다.
- 한 번의 요청은 5초 제한, 일시적인 통신 오류/429/일부 5xx에 최대 1회 재시도하며 전체 12초로 제한합니다.
- `support.notification.failed` 로그에는 문의 ID, 실패 분류, HTTP 상태만 기록합니다. 키와 문의 제목·본문, 공급자 응답은 기록하지 않습니다.
- 이 구현은 영속 큐가 아닙니다. 인스턴스 중단이나 재시도 후에도 계속되는 장애의 자동 재전송을 보장하지 않습니다. 메일 접수 성공도 Gmail 수신함 도착을 보장하지 않으므로 Resend 발송 내역과 스팸함을 확인합니다.
- 비활성화는 `SUPPORT_EMAIL_NOTIFICATIONS_ENABLED=false` 설정 후 재배포합니다. 설정 전 등록된 과거 문의는 소급 발송하지 않습니다.

## 검증

로컬: `npm test`, `npm run lint`, `npm run test:support:http` (프로덕션 빌드 포함), `npx tsc --noEmit`, `npm run test:support:notification:http` (빌드 후 실행).
실제 발송 설정 뒤 고객 관리자 계정으로 테스트 문의 1건을 등록하여 등록 성공, 관리자 목록의 문의 번호, Resend 발송 결과와 수신 메일을 확인합니다.
실제 발송 API 키가 없는 로컬 검증은 Resend HTTP 대역으로 수행하며 실제 수신 검증을 대신하지 않습니다.

참고: [Resend 발송 API](https://resend.com/docs/api-reference/emails/send-email), [24시간 idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys), [Next.js after](https://nextjs.org/docs/app/api-reference/functions/after).
