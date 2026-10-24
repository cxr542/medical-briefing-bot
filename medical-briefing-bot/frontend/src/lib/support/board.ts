import { z } from 'zod';
import type { SupportStatus } from './client';

export const boardStatus = z.enum(['received', 'processing', 'completed']);
export type BoardStatus = z.infer<typeof boardStatus>;
export const boardLabels: Readonly<Record<BoardStatus, string>> = {
  received: '접수', processing: '처리 중', completed: '완료',
};
const groups: Readonly<Record<SupportStatus, BoardStatus>> = {
  received: 'received', reviewing: 'processing', in_progress: 'processing',
  waiting_customer: 'processing', on_hold: 'processing', completed: 'completed', cancelled: 'completed',
};
export function displayStatus(status: SupportStatus): BoardStatus { return groups[status]; }

// Use only transitions accepted by support_foundation; cancelled is terminal.
export function boardTransition(from: SupportStatus, to: BoardStatus): readonly SupportStatus[] {
  if (from === 'cancelled' || displayStatus(from) === to || to === 'received') return [];
  if (to === 'processing') return ['reviewing'];
  if (from === 'received') return ['reviewing', 'in_progress', 'completed'];
  if (from === 'reviewing' || from === 'on_hold') return ['in_progress', 'completed'];
  return ['completed'];
}
