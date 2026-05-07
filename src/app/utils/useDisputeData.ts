import type { AuthUser } from '../../types/user';
import type { Dispute } from '../../types/job';
import { normalizeDate } from './jobUtils';
import { useEntityData } from './useEntityData';

const normalizeDisputeRow = (row: Dispute): Dispute => ({
  ...row,
  disputeDate: normalizeDate((row as any).disputeDate) || ((row as any).disputeDate as any) || '',
  dueDate: normalizeDate((row as any).dueDate) || ((row as any).dueDate as any) || '',
});

export type DisputeFilterRule = { field: keyof Dispute; value: any };

const disputeEntityOptions = {
  endpoint: '/api/disputes',
  normalizeRow: normalizeDisputeRow,
  makeDraftRow: () => ({} as Dispute),
  numberFields: ['totalDisputed'] as Array<keyof Dispute>,
  booleanFields: ['isTechOffset', 'isPrOffset'] as Array<keyof Dispute>,
};

export const useDisputeData = (
  user: AuthUser | null,
  setSnackbar: (value: { message: string; type: 'success' | 'error' } | null) => void,
  sortBy: keyof Dispute | null,
  sortDir: 'asc' | 'desc'
) =>
  useEntityData<Dispute>(user, setSnackbar, sortBy, sortDir, disputeEntityOptions);
