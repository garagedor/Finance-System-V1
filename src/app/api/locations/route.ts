import type { Location } from '../../../types/job';
import { createCrudHandlers } from '../utils/crudHandlers';

const { GET, POST, PUT, DELETE } = createCrudHandlers<Location>({
  collectionName: 'Location',
  numberFields: ['managerProfitPercent'],
  sortableFields: ['_id', 'managerProfitPercent', 'technician'],
  defaultSort: { field: '_id', dir: 1 },
});

export { GET, POST, PUT, DELETE };
