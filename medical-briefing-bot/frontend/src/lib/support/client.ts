import { z } from 'zod';
import { customerList, customerDetail, internalDetail, internalList, type Audience } from './contract';

export type SupportItem = z.infer<typeof customerList>['requests'][number];
export type CustomerDetail = z.infer<typeof customerDetail>;
export type InternalDetail = z.infer<typeof internalDetail>;
export type SupportStatus = SupportItem['status'];
export const statusLabels: Readonly<Record<SupportStatus, string>> = {
  received: '접수', reviewing: '검토 중', in_progress: '진행 중',
  waiting_customer: '고객 확인 대기', completed: '완료', on_hold: '보류', cancelled: '취소',
};
export const priorityLabels = { low: '낮음', normal: '보통', high: '높음' } as const;
export const endpoint = (audience: Audience) => audience === 'customer' ? '/api/customer-admin/support/requests' : '/api/admin/support/requests';

export class SupportClientError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(status === 503 && code === 'SUPPORT_DISABLED' ? '기술지원 기능이 아직 활성화되지 않았습니다.' : ({
      400: '입력 내용 또는 상태 변경을 확인해 주세요.',
      401: '로그인이 만료되었습니다. 다시 로그인해 주세요.',
      403: '이 요청에 접근할 권한이 없습니다.',
      404: '요청을 찾을 수 없습니다.',
      409: '다른 작업으로 요청이 변경되었습니다. 최신 내용을 확인해 주세요.',
      503: '기술지원 서비스에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.',
    }[status] || '요청을 처리할 수 없습니다. 다시 시도해 주세요.'));
  }
}

export async function supportFetch<T>(path: string, schema: z.ZodType<T>, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { ...options, credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', ...options.headers } });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new SupportClientError(503, 'NETWORK_ERROR');
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const code = z.object({ error: z.string() }).safeParse(body);
    throw new SupportClientError(response.status, code.success ? code.data.error : 'UNKNOWN');
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new SupportClientError(503, 'INVALID_RESPONSE');
  return parsed.data;
}

export const loadList = (audience: Audience, query: string, signal?: AbortSignal) =>
  supportFetch(`${endpoint(audience)}?${query}`, audience === 'customer' ? customerList : internalList, { signal });
export const loadDetail = (audience: Audience, id: string, page: number, signal?: AbortSignal) =>
  supportFetch<CustomerDetail | InternalDetail>(`${endpoint(audience)}/${id}?page=${page}&page_size=10`,
    audience === 'customer' ? customerDetail : internalDetail, { signal });
export function formatSupportDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '날짜 확인 불가' : new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(date);
}
