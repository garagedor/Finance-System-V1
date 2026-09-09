import { useEffect, useRef, useState } from 'react';
import type { AuthUser } from '../../types/user';
import type { JobRow, JobStatus, Location, Provider, Technician } from '../../types/job';
import type { User } from '../../types/user';
import { useEntityData, type UseEntityDataReturn } from './useEntityData';
import { normalizeRow, numberFields } from './jobUtils';

type Snackbar = { message: string; type: 'success' | 'error' } | null;

// Tables AI data hook — identical to useJobData but bound to the ISOLATED
// /api/ai-jobs endpoint (ag.Job_ai). It reuses the SAME shared reference
// lookups (JobStatus / techs / locations / providers) as production — those are
// single-source and never duplicated.
const aiJobEntityOptions = {
  endpoint: '/api/ai-jobs',
  normalizeRow,
  makeDraftRow: (_user: AuthUser | null): JobRow & { _id: string } => ({
    _id: `temp_${Date.now()}`,
    tech: '',
    status: '',
    date: new Date().toISOString().split('T')[0],
    address: '',
    location: '',
    totalAmount: 0,
    techPaidCash: 0,
    totalPaidCard: 0,
    totalPaidCompanyCheck: 0,
    totalPaidFinance: 0,
    totalPaidCompanyCash: 0,
    techParts: 0,
    companyParts: 0,
    provider: '',
    tipsCard: 0,
    tipsFinance: 0,
    tipsCompanyCash: 0,
    tipsCheck: 0,
    clientName: '',
    clientPhoneNumber: '',
    approvals: [],
    notes: '',
    needTracking: false,
  }),
  numberFields: numberFields as unknown as Array<keyof JobRow>,
  booleanFields: ['needTracking'] as Array<keyof JobRow>,
};

export type UseAiJobDataReturn = UseEntityDataReturn<JobRow> & {
  lookups: {
    statuses: JobStatus[];
    locations: Location[];
    providers: Provider[];
    techs: Technician[];
    users: User[];
  };
  adminNames: Set<string>;
  officeNames: Set<string>;
};

export const useAiJobData = (
  user: AuthUser | null,
  setSnackbar: (value: Snackbar) => void,
  sortBy: keyof JobRow | null,
  sortDir: 'asc' | 'desc',
): UseAiJobDataReturn => {
  const entityData = useEntityData<JobRow>(user, setSnackbar, sortBy, sortDir, aiJobEntityOptions);

  const [lookups, setLookups] = useState<{
    statuses: JobStatus[];
    locations: Location[];
    providers: Provider[];
    techs: Technician[];
    users: User[];
  }>({ statuses: [], locations: [], providers: [], techs: [], users: [] });
  const hasLoadedRef = useRef(false);

  useEffect(() => {
    if (hasLoadedRef.current) return;
    hasLoadedRef.current = true;
    const fetchList = async <T,>(url: string) => {
      try {
        const res = await fetch(`${url}?page=1&pageSize=500`);
        if (!res.ok) throw new Error(`Failed to load ${url}`);
        const json = await res.json();
        if (Array.isArray(json?.rows)) return json.rows as T[];
        if (Array.isArray(json)) return json as T[];
        return [];
      } catch (err) {
        console.error(`Failed to load ${url}`, err);
        return [];
      }
    };
    const load = async () => {
      const [statuses, locations, providers, techs, users] = await Promise.all([
        fetchList<JobStatus>('/api/job-statuses'),
        fetchList<Location>('/api/locations'),
        fetchList<Provider>('/api/providers'),
        fetchList<Technician>('/api/techs'),
        fetchList<User>('/api/users'),
      ]);
      setLookups({ statuses, locations, providers, techs, users });
    };
    load();
  }, []);

  const adminNames = new Set((lookups.users ?? []).filter((u) => u.type === 'admin').map((u) => u.name));
  const officeNames = new Set((lookups.users ?? []).filter((u) => u.type === 'office').map((u) => u.name));

  return { ...entityData, lookups, adminNames, officeNames };
};
