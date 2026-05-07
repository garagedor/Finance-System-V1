import type { Provider } from '../../../types/job';
import { createCrudHandlers } from '../utils/crudHandlers';

const { GET, POST, PUT, DELETE } = createCrudHandlers<Provider>({
  collectionName: 'Provider',
  numberFields: ['profitPercent'],
  sortableFields: ['_id', 'initials', 'profitPercent'],
  defaultSort: { field: '_id', dir: 1 },
});

export { GET, POST, PUT, DELETE };
