import type { AuthUser } from '../../types/user';
import type { Provider } from '../../types/job';
import { useEntityData } from './useEntityData';

export type ProviderFilterRule = { field: keyof Provider; value: any };

const providerEntityOptions = {
  endpoint: '/api/providers',
  normalizeRow: (row: Provider) => row,
  makeDraftRow: () =>
    ({
      _id: `temp_${Date.now()}`,
      name: '',
      initials: '',
      profitPercent: 0,
    } as Provider),
  numberFields: ['profitPercent'] as Array<keyof Provider>,
};

export const useProviderData = (
  user: AuthUser | null,
  setSnackbar: (value: { message: string; type: 'success' | 'error' } | null) => void,
  sortBy: keyof Provider | null,
  sortDir: 'asc' | 'desc'
) =>
  useEntityData<Provider>(user, setSnackbar, sortBy, sortDir, providerEntityOptions);
