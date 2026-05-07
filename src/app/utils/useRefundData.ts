import type { AuthUser } from '../../types/user';
import type { Refund } from '../../types/job';
import { normalizeRefundRow, refundBooleanFields, refundNumberFields } from './refundUtils';
import { useEntityData } from './useEntityData';

export type RefundFilterRule = {
  field: keyof Refund;
  value: any;
};

const refundEntityOptions = {
  endpoint: '/api/refunds',
  normalizeRow: normalizeRefundRow,
  makeDraftRow: () => ({} as Refund),
  numberFields: refundNumberFields,
  booleanFields: refundBooleanFields,
};

export const useRefundData = (
  user: AuthUser | null,
  setSnackbar: (value: { message: string; type: 'success' | 'error' } | null) => void,
  sortBy: keyof Refund | null,
  sortDir: 'asc' | 'desc'
) =>
  useEntityData<Refund>(user, setSnackbar, sortBy, sortDir, refundEntityOptions);
