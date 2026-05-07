import type { AuthUser } from '../../types/user';
import type { JobStatus } from '../../types/job';
import { useEntityData } from './useEntityData';

export type JobStatusFilterRule = { field: keyof JobStatus; value: any };

const jobStatusEntityOptions = {
  endpoint: '/api/job-statuses',
  normalizeRow: (row: JobStatus) => row,
  makeDraftRow: () =>
  ({
    _id: `temp_${Date.now()}`,
  } as JobStatus),
};

export const useJobStatusData = (
  user: AuthUser | null,
  setSnackbar: (value: { message: string; type: 'success' | 'error' } | null) => void,
  sortBy: keyof JobStatus | null,
  sortDir: 'asc' | 'desc'
) =>
  useEntityData<JobStatus>(user, setSnackbar, sortBy, sortDir, jobStatusEntityOptions);
