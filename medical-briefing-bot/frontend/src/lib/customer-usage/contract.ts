import { z } from 'zod';

const date = z.iso.date();
export const usageQuery = z.object({
  from: date,
  to: date,
  group: z.enum(['day', 'week', 'month']).default('day'),
  search: z.string().max(64).default(''),
  page: z.coerce.number().int().min(1).max(100000).default(1),
}).refine(value => {
  const days = (Date.parse(value.to) - Date.parse(value.from)) / 86400000;
  return days >= 0 && days <= 365;
});
const metrics = z.object({
  last_seen_at: z.iso.datetime({ offset: true }).nullable(),
  access_days: z.number().int().nonnegative(),
  login_count: z.number().int().nonnegative(),
});
export const usageResult = z.object({
  started_at: z.iso.datetime({ offset: true }),
  from: date, to: date, group: z.enum(['day', 'week', 'month']),
  page: z.number().int().positive(), page_size: z.literal(20), total: z.number().int().nonnegative(),
  users: z.array(metrics.extend({
    id: z.uuid(), employee_number: z.string(), active: z.boolean(),
    periods: z.array(metrics.extend({ period: date })),
  })),
});
export type UsageResult = z.infer<typeof usageResult>;
