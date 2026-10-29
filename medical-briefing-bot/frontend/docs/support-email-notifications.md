# 새 문의 관리자 이메일 알림 (Gmail SMTP)

고객 문의가 저장된 뒤 Next.js `after()`에서 Gmail SMTP로 관리자에게 메일을 보냅니다.
기본 발신·수신 계정은 `cxr542@gmail.com`입니다. 메일 오류가 이미 저장된 문의를 실패 처리하지 않습니다.
Resend 가입, 도메인 인증, Resend API 키는 필요하지 않습니다.

## 활성화

1. 발신 Google 계정의 2단계 인증을 켭니다.
2. https://myaccount.google.com/apppasswords 에서 `Medical Briefing` 앱 비밀번호를 발급합니다.
3. Vercel의 `medical-briefing-bot` 프로젝트 Production 환경변수에 아래를 설정합니다. 앱 비밀번호를 채팅·소스·로그에 입력하지 않습니다.
4. `../supabase/migrations/20261029083035_support_email_notifications.sql`을 서비스가 사용하는 DB에 적용한 뒤 운영 코드를 배포합니다.

| 변수 | 값 |
| --- | --- |
| `GMAIL_APP_PASSWORD` | 발신 계정에서 만든 16자리 앱 비밀번호. 표시용 공백은 자동 제거됩니다. |
| `GMAIL_SMTP_USER` | 기본값 `cxr542@gmail.com` |
| `SUPPORT_NOTIFICATION_TO` | 기본값 `cxr542@gmail.com` |
| `SUPPORT_EMAIL_NOTIFICATIONS_ENABLED` | `true` |
| `SUPPORT_NOTIFICATION_SITE_URL` | 기본값 `https://medical-briefing-bot.vercel.app` |

`GMAIL_APP_PASSWORD`는 Production 전용 Secret/Sensitive로 저장합니다. 일반 Google 로그인 비밀번호는 사용하지 않습니다.
Preview/Development에는 발송 활성화 변수를 설정하지 않습니다. 기존 `SUPPORT_ENABLED`와 고객 인증은 계속 필요합니다.
Google 계정 비밀번호를 변경하면 앱 비밀번호가 취소될 수 있으므로 재발급해 Vercel 값을 갱신하고 재배포합니다.

## 발송과 중복 방지

- 서버는 `smtp.gmail.com:465`에 TLS로 접속합니다. 발신 주소는 SMTP 로그인 계정과 동일합니다.
- 문의 번호·제목·우선순위·한국 시간 등록일·ID와 관리자 목록 링크만 보냅니다. 문의 본문·첨부파일·세션은 메일에 넣지 않습니다.
- `support.support_email_notifications`의 문의 UUID 기본 키와 원자적 INSERT로 한 문의당 한 번만 발송을 시도합니다. 병렬 요청·등록 재시도·인스턴스 재시작에도 이 기록을 사용합니다.
- SMTP에는 공급자 중복 방지 키가 없습니다. 응답 유실 시 이미 접수된 메일을 또 보낼 수 있으므로 자동 재전송하지 않습니다. DB 상태는 `attempting`, `accepted`, `failed`입니다. `accepted`는 SMTP 접수이며 Gmail 수신함 도착을 의미하지 않습니다.
- 연결·인사·DNS는 각 5초, 소켓 비활성은 10초 제한입니다. 메일 처리 후 연결을 닫습니다.
- DB 기록에 실패하면 메일을 보내지 않습니다. 접수 후 완료 기록이 실패해도 기존 시도 기록으로 중복 발송을 막습니다.
- 이 구현은 영속 재시도 큐가 아닙니다. 프로세스 중단이나 통신 오류로 알림을 놓칠 수 있습니다. 실패·장기 `attempting` 기록은 운영자가 문의 목록 및 실제 수신 내역과 대조해 수동 처리합니다.
- 23시간이 지난 등록 재실행은 발송하지 않습니다. 과거 문의를 자동으로 소급 발송하지 않습니다.
- 실패 로그에는 문의 ID와 오류 분류만 기록합니다. 비밀번호·메일 내용·SMTP 원문 응답은 기록하지 않습니다.
- 알림을 끄려면 `SUPPORT_EMAIL_NOTIFICATIONS_ENABLED=false`로 변경하고 재배포합니다.

## 검증

`npm test`, `npm run lint`, `npm run test:support:http`(프로덕션 빌드 포함), `npx tsc --noEmit`, `npm run test:support:notification:http`(빌드 후).
알림 테스트는 실제 로컬 SMTP 서버와 Postgres 함수를 사용하며 Google에 접속하지 않습니다.
운영에서는 테스트 문의를 등록하고 메일 도착(스팸함 포함), 문의 번호와 DB의 `accepted` 상태를 확인합니다.

참고: [Google 앱 비밀번호](https://support.google.com/accounts/answer/185833?hl=ko), [Nodemailer Gmail](https://nodemailer.com/usage/using-gmail/), [Next.js after](https://nextjs.org/docs/app/api-reference/functions/after).
