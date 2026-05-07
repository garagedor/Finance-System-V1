import type { Dispute } from '../../../types/job';
import { normalizeDate } from '../../utils/jobUtils';
import { createCrudHandlers } from '../utils/crudHandlers';

const normalizeDisputeRow = (row: Dispute): Dispute => ({
  ...row,
  disputeDate: normalizeDate((row as any).disputeDate) || ((row as any).disputeDate as any) || '',
  dueDate: normalizeDate((row as any).dueDate) || ((row as any).dueDate as any) || '',
});

const { GET, POST, PUT, DELETE } = createCrudHandlers<Dispute>({
  collectionName: 'Dispute',
  normalizeRow: normalizeDisputeRow,
  numberFields: ['totalDisputed'],
  booleanFields: ['isTechOffset', 'isPrOffset'],
  dateFields: ['disputeDate', 'dueDate'],
  sortableFields: ['jobId', 'totalDisputed', 'disputeDate', 'dueDate', 'status', 'isTechOffset', 'isPrOffset'],
  defaultSort: { field: 'disputeDate', dir: -1 },
});

export { GET, POST, PUT, DELETE };
