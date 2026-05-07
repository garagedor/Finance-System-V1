import type { Technician } from '../../../types/job';
import { createCrudHandlers } from '../utils/crudHandlers';

const { GET, POST, PUT, DELETE } = createCrudHandlers<Technician>({
  collectionName: 'Technician',
  numberFields: ['profitPercent'],
  sortableFields: ['_id', 'profitPercent', 'location'],
  defaultSort: { field: '_id', dir: 1 },
});

export { GET, POST, PUT, DELETE };
