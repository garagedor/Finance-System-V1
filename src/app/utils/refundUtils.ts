import type { Refund } from '@/types/job';
import { ColumnConfig, normalizeDate } from './jobUtils';

export type RefundColumnConfig = ColumnConfig<Refund>;

export const refundNumberFields: Array<keyof Refund> = ['refundTotal'];
export const refundBooleanFields: Array<keyof Refund> = ['isTechOffset', 'isPrOffset'];

export const normalizeRefundRow = (row: Refund): Refund => ({
  ...row,
  dateRefunded: normalizeDate((row as any).dateRefunded) || ((row as any).dateRefunded as any) || '',
  dueDate: normalizeDate((row as any).dueDate) || ((row as any).dueDate as any) || '',
});
