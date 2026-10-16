import { z } from 'zod';

export const statuses = ['received', 'reviewing', 'in_progress', 'waiting_customer', 'completed', 'on_hold', 'cancelled'] as const;
export const requestId = z.uuid().brand<'SupportRequestId'>();
const text = (max: number) => z.string().trim().min(1).max(max)
  .refine(value => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value));
export const createRequest = z.strictObject({
  title: text(200), description: text(10000), priority: z.enum(['low', 'normal', 'high']).default('normal'),
});
export const statusChange = z.strictObject({
  status: z.enum(statuses), reason: text(2000), version: z.number().int().min(1).max(2147483646),
});
export const message = z.strictObject({ body: text(10000), version: z.number().int().min(1).max(2147483646) });
export const listQuery = z.strictObject({
  page: z.string().regex(/^[1-9]\d{0,4}$/).transform(Number).default(1),
  page_size: z.string().regex(/^[1-9]\d?$/).transform(Number).pipe(z.number().max(50)).default(20),
  status: z.enum(statuses).optional(),
});
export const detailQuery = listQuery.omit({ status: true });

const item = z.object({
  id: z.uuid(), request_number: z.number().int().positive(), title: z.string(), description: z.string(),
  status: z.enum(statuses), priority: z.enum(['low', 'normal', 'high']), version: z.number().int().positive(),
  created_at: z.string(), updated_at: z.string(), closed_at: z.string().nullable(),
});
const comment = z.object({ id: z.uuid(), author_type: z.literal('internal_admin'), body: z.string(), created_at: z.string() });
const count = z.number().int().nonnegative();
export const customerList = z.object({ requests: z.array(item), total: count, page: count, page_size: count });
export const customerDetail = z.object({ request: item, comments: z.array(comment), comments_total: count, page: count, page_size: count });
export const customerCreated = z.object({ request: item });
const internalItem = item.extend({ requester_admin_id: z.uuid() });
export const internalList = customerList.extend({ requests: z.array(internalItem) });
export const internalDetail = customerDetail.extend({
  request: internalItem,
  notes: z.array(z.object({ id: z.uuid(), body: z.string(), actor_id: z.string(), created_at: z.string() })),
  notes_total: count,
  history: z.array(z.object({ id: z.uuid(), previous_status: z.enum(statuses).nullable(), new_status: z.enum(statuses), changed_by: z.string(), actor_type: z.string(), reason: z.string(), created_at: z.string() })),
  history_total: count,
  audit: z.array(z.object({ id: z.uuid(), action: z.string(), actor_type: z.string(), actor_id: z.string(), created_at: z.string() })),
  audit_total: count,
});
export const internalChanged = z.object({ request: internalItem });
export type Operation = 'list' | 'create' | 'detail' | 'status' | 'comment' | 'note';
export type Audience = 'customer' | 'internal';

export class SupportError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) { super(code); this.status = status; this.code = code; }
}

export function databaseError(code: string): SupportError {
  switch (code) {
    case '42501': return new SupportError(401, 'UNAUTHORIZED');
    case 'P0002': return new SupportError(404, 'NOT_FOUND');
    case '40001': return new SupportError(409, 'VERSION_CONFLICT');
    case '22023': case '23514': case '22P02': return new SupportError(400, 'INVALID_INPUT');
    default: return new SupportError(503, 'SUPPORT_UNAVAILABLE');
  }
}
