import { useMemo } from 'react';
import type { AuthUser } from '../../types/user';
import type { User } from '../../types/user';
import { useEntityData } from './useEntityData';

export type UserFilterRule = { field: keyof User; value: any };

const userEntityOptions = {
  endpoint: '/api/users',
  normalizeRow: (row: User) => row,
  makeDraftRow: () =>
  ({
    name: '',
    password: '',
    type: 'simple',
  } as User),
};

export const useUserData = (
  user: AuthUser | null,
  setSnackbar: (value: { message: string; type: 'success' | 'error' } | null) => void,
  sortBy: keyof User | null,
  sortDir: 'asc' | 'desc'
) => {
  return useEntityData<User>(user, setSnackbar, sortBy, sortDir, userEntityOptions);
};
