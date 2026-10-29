import nodemailer, { type SendMailOptions } from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import { z } from 'zod';
import type { customerCreated } from './contract';

const settings = z.object({
  GMAIL_SMTP_USER: z.email().default('cxr542@gmail.com'),
  GMAIL_APP_PASSWORD: z.string().transform(value => value.replace(/\s/gu, '')).pipe(z.string().regex(/^[a-zA-Z]{16}$/)),
  SUPPORT_NOTIFICATION_TO: z.email().default('cxr542@gmail.com'),
  SUPPORT_NOTIFICATION_SITE_URL: z.url().refine(value => {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  }).default('https://medical-briefing-bot.vercel.app'),
});

type CreatedRequest = z.infer<typeof customerCreated>['request'];
type NotificationResult =
  | { readonly status: 'sent' | 'disabled' | 'expired' | 'duplicate' }
  | { readonly status: 'failed'; readonly reason: 'configuration' | 'database' | 'transport' };

export type NotificationStore = {
  readonly record: (operation: 'claim' | 'accepted' | 'failed', requestId: string) => Promise<boolean>;
};
type SmtpFactory = (options: SMTPTransport.Options) => {
  readonly sendMail: (message: SendMailOptions) => Promise<SMTPTransport.SentMessageInfo>;
  readonly close: () => void;
};

// Called only by the server after a committed create; no request headers supply configuration.
export async function notifySupportCreated(request: CreatedRequest, store: NotificationStore, createTransport: SmtpFactory = nodemailer.createTransport): Promise<NotificationResult> {
  if (process.env.SUPPORT_EMAIL_NOTIFICATIONS_ENABLED !== 'true') return { status: 'disabled' };
  const config = settings.safeParse(process.env);
  if (!config.success) return { status: 'failed', reason: 'configuration' };
  // Do not send historical create-RPC replays when notifications are enabled later.
  const createdAt = Date.parse(request.created_at);
  if (!Number.isFinite(createdAt) || Date.now() - createdAt >= 23 * 60 * 60 * 1000) return { status: 'expired' };
  const { GMAIL_SMTP_USER, GMAIL_APP_PASSWORD, SUPPORT_NOTIFICATION_TO, SUPPORT_NOTIFICATION_SITE_URL } = config.data;
  const title = request.title.replace(/[\r\n\u2028\u2029]/gu, ' ');
  const date = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short',
  }).format(new Date(createdAt));
  const priorities = { low: '낮음', normal: '보통', high: '높음' } as const;
  const body = {
    from: GMAIL_SMTP_USER,
    to: [SUPPORT_NOTIFICATION_TO],
    messageId: `<support-created.${request.id}@${new URL(SUPPORT_NOTIFICATION_SITE_URL).hostname}>`,
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
    if (!await store.record('claim', request.id)) return { status: 'duplicate' };
  } catch (error) {
    if (error instanceof Error) return { status: 'failed', reason: 'database' };
    throw error;
  }
  let accepted = false;
  try {
    const transport = createTransport({
      host: 'smtp.gmail.com', port: 465, secure: true,
      auth: { user: GMAIL_SMTP_USER, pass: GMAIL_APP_PASSWORD },
      connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 10000, dnsTimeout: 5000,
      tls: { minVersion: 'TLSv1.2' }, disableFileAccess: true, disableUrlAccess: true,
    });
    try {
      const result = await transport.sendMail(body);
      accepted = result.accepted.length > 0;
    } finally { transport.close(); }
  } catch (error) {
    // SMTP may have accepted DATA even if its reply was lost. Never automatically resend.
    if (!(error instanceof Error)) throw error;
  }
  try {
    if (!await store.record(accepted ? 'accepted' : 'failed', request.id)) return { status: 'failed', reason: 'database' };
  } catch (error) {
    if (error instanceof Error) return { status: 'failed', reason: 'database' };
    throw error;
  }
  return accepted ? { status: 'sent' } : { status: 'failed', reason: 'transport' };
}
