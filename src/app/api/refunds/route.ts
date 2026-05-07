import type { Refund } from '../../../types/job';
import { normalizeRefundRow } from '../../utils/refundUtils';
import { createCrudHandlers } from '../utils/crudHandlers';

const { GET, POST, PUT, DELETE } = createCrudHandlers<Refund>({
  collectionName: 'Refund',
  normalizeRow: normalizeRefundRow,
  numberFields: ['refundTotal'],
  booleanFields: ['isTechOffset', 'isPrOffset'],
  dateFields: ['dateRefunded', 'dueDate'],
  sortableFields: ['jobId', 'refundTotal', 'dateRefunded', 'dueDate', 'reason', 'isTechOffset', 'isPrOffset'],
  defaultSort: { field: 'dateRefunded', dir: -1 },
});

export { GET, POST, PUT, DELETE };
