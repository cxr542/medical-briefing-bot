import ky, { HTTPError, type KyInstance } from 'ky';
import { z } from 'zod';
import type { customerCreated } from './contract';

const settings = z.object({
  RESEND_API_KEY: z.string().trim().min(1),
  SUPPORT_NOTIFICATION_FROM: z.email(),
  SUPPORT_NOTIFICATION_TO: z.email().default('cxr542@gmail.com'),
  SUPPORT_NOTIFICATION_SITE_URL: z.url().refine(value => {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  }).default('https://medical-briefing-bot.vercel.app'),
});

type CreatedRequest = z.infer<typeof customerCreated>['request'];
type NotificationResult =
  | { readonly status: 'sent' | 'disabled' | 'expired' }
  | { readonly status: 'failed'; readonly reason: 'configuration' | 'provider' | 'transport'; readonly httpStatus?: number };

// Called only by the server after a committed create; no request headers supply configuration.
export async function notifySupportCreated(request: CreatedRequest, http: KyInstance = ky): Promise<NotificationResult> {
  if (process.env.SUPPORT_EMAIL_NOTIFICATIONS_ENABLED !== 'true') return { status: 'disabled' };
  const config = settings.safeParse(process.env);
  if (!config.success) return { status: 'failed', reason: 'configuration' };
  // Resend retains idempotency keys for 24h. Never resend old create-RPC replays.
  const createdAt = Date.parse(request.created_at);
  if (!Number.isFinite(createdAt) || Date.now() - createdAt >= 23 * 60 * 60 * 1000) return { status: 'expired' };
  const { RESEND_API_KEY, SUPPORT_NOTIFICATION_FROM, SUPPORT_NOTIFICATION_TO, SUPPORT_NOTIFICATION_SITE_URL } = config.data;
  const title = request.title.replace(/[\r\n\u2028\u2029]/gu, ' ');
  const date = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short',
  }).format(new Date(createdAt));
  const priorities = { low: '낮음', normal: '보통', high: '높음' } as const;
  const body = {
    from: SUPPORT_NOTIFICATION_FROM,
    to: [SUPPORT_NOTIFICATION_TO],
    subject: `[Medical Briefing] 새 문의 #${request.request_number}: ${title}`,
    text: [
      '새 문의가 등록되었습니다.', '',
      `문의 번호: #${request.request_number}`, `제목: ${title}`,
      `우선순위: ${priorities[request.priority]}`, `등록 시간: ${date} (한국 시간)`,
      `문의 ID: ${request.id}`, '',
      `관리자 문의 목록: ${new URL('/admin/support', SUPPORT_NOTIFICATION_SITE_URL).href}`,
      '관리자 로그인 후 문의 번호로 내용을 확인해 주세요.',
    ].join('\n'),
  };
  try {
    await http.post('https://api.resend.com/emails', {
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Idempotency-Key': `support-created/${request.id}` },
      json: body, timeout: 5000, totalTimeout: 12000,
      retry: { limit: 1, methods: ['post'], statusCodes: [429, 500, 502, 503, 504], retryOnTimeout: true, maxRetryAfter: 1000 },
      redirect: 'error',
    });
    return { status: 'sent' };
  } catch (error) {
    if (error instanceof HTTPError) return { status: 'failed', reason: 'provider', httpStatus: error.response.status };
    if (error instanceof Error) return { status: 'failed', reason: 'transport' };
    throw error;
  }
}
