import type { JobStatus } from '../../../types/job';
import { createCrudHandlers } from '../utils/crudHandlers';

const { GET, POST, PUT, DELETE } = createCrudHandlers<JobStatus>({
  collectionName: 'JobStatus',
  sortableFields: ['_id'],
  defaultSort: { field: '_id', dir: 1 },
});

export { GET, POST, PUT, DELETE };
