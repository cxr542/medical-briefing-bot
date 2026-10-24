import { z } from 'zod';

export const MAX_BYTES = 10 * 1024 * 1024;
export const PART_BYTES = 1024 * 1024;
export const fileTypes = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
} as const;
export const prepareAttachment = z.strictObject({
  client_key: z.uuid(), original_name: z.string().min(1).max(200).refine(value => !/[\x00-\x1f\x7f/\\\u202a-\u202e\u2066-\u2069]/u.test(value)),
  mime: z.string(), bytes: z.number().int().min(1).max(MAX_BYTES), sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).refine(value => Object.entries(fileTypes).some(([extension, mime]) => value.original_name.toLowerCase().endsWith(`.${extension}`) && value.mime === mime));
export const attachmentItem = z.object({
  id: z.uuid(), original_name: z.string(), mime: z.string(), bytes: z.number().int().positive(),
  scan_status: z.enum(['pending', 'scanning', 'clean', 'infected', 'failed']),
  upload_status: z.enum(['reserved', 'uploaded']), created_at: z.string(),
});
export const attachmentList = z.object({ attachments: z.array(attachmentItem).max(5) });
export const prepared = z.object({ id: z.uuid(), expires_at: z.string(), uploaded: z.boolean(), token: z.string(), part_bytes: z.literal(PART_BYTES) });
export type Attachment = z.infer<typeof attachmentItem>;
