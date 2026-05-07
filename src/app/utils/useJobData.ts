import { useCallback, useEffect, useRef, useState } from 'react';
import type { AuthUser } from '../../types/user';
import type { JobRow, JobStatus, Location, Provider, Technician } from '../../types/job';
import type { User } from '../../types/user';
import { useEntityData, type EntityFilterRule, type UseEntityDataReturn } from './useEntityData';
import {
  getRowId,
  normalizeRow,
  normalizeApprovals,
  numberFields,
} from './jobUtils';

type Snackbar = { message: string; type: 'success' | 'error' } | null;

export type FilterRule = EntityFilterRule<JobRow>;

// Job-specific options for useEntityData
const jobEntityOptions = {
  endpoint: '/api/jobs',
  normalizeRow: normalizeRow,
  makeDraftRow: (user: AuthUser | null): JobRow & { _id: string } => ({
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

export type UseJobDataReturn = UseEntityDataReturn<JobRow> & {
  lookups: {
    statuses: JobStatus[];
    locations: Location[];
    providers: Provider[];
    techs: Technician[];
    users: User[];
  };
  approvalIds: string[];
  approvalIdsRef: React.MutableRefObject<string[]>;
  confirmRow: (row: JobRow) => Promise<void>;
  adminNames: Set<string>;
  officeNames: Set<string>;

};

export const useJobData = (
  user: AuthUser | null,
  setSnackbar: (value: Snackbar) => void,
  sortBy: keyof JobRow | null,
  sortDir: 'asc' | 'desc'
): UseJobDataReturn => {
  // Use the base entity data hook
  const entityData = useEntityData<JobRow>(user, setSnackbar, sortBy, sortDir, jobEntityOptions);

  // Job-specific state
  const [approvalIds, setApprovalIds] = useState<string[]>([]);
  const approvalIdsRef = useRef<string[]>([]);
  // hiddenColumns handled by useEntityData now
  const [lookups, setLookups] = useState<{
    statuses: JobStatus[];
    locations: Location[];
    providers: Provider[];
    techs: Technician[];
    users: User[];
  }>({ statuses: [], locations: [], providers: [], techs: [], users: [] });
  const hasLoadedRef = useRef(false);

  // Sync approvalIds ref
  useEffect(() => {
    approvalIdsRef.current = approvalIds;
  }, [approvalIds]);

  // Load lookups
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

    const loadLookups = async () => {
      const [statuses, locations, providers, techs, users] = await Promise.all([
        fetchList<JobStatus>('/api/job-statuses'),
        fetchList<Location>('/api/locations'),
        fetchList<Provider>('/api/providers'),
        fetchList<Technician>('/api/techs'),
        fetchList<User>('/api/users'),
      ]);
      setLookups({ statuses, locations, providers, techs, users });
    };

    loadLookups();
  }, []);

  // Job-specific confirmRow function
  const confirmRow = useCallback(
    async (row: JobRow) => {
      if (!user?.name) {
        setSnackbar({ message: 'Please log in to confirm rows', type: 'error' });
        return;
      }

      const rowId = getRowId(row);
      if (!rowId) {
        setSnackbar({ message: 'Cannot confirm row without ID', type: 'error' });
        return;
      }

      const approvals = normalizeApprovals((row as any).approvals);
      const adminNames = new Set((lookups.users ?? []).filter((u) => u.type === 'admin').map((u) => u.name));
      const hasAdminApproval = approvals.some((a) => adminNames.has(a));
      if (user?.type === 'office' && hasAdminApproval) {
        setSnackbar({ message: 'Admin already approved. Office cannot change approvals.', type: 'error' });
        return;
      }
      const alreadyConfirmed = approvals.includes(user.name);
      const updatedApprovals = alreadyConfirmed
        ? approvals.filter((a) => a !== user.name)
        : [...approvals, user.name];

      setApprovalIds((s) => [...s, String(rowId)]);
      try {
        const res = await fetch('/api/jobs', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ _id: rowId, approvals: updatedApprovals }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          console.error('Approval update failed', data);
          setSnackbar({ message: 'Failed to update approvals', type: 'error' });
          return;
        }

        const message = alreadyConfirmed ? 'Approval removed' : 'Row confirmed';
        setSnackbar({ message, type: 'success' });

        entityData.setRowData((prev) =>
          prev.map((r) => {
            const rid = getRowId(r);
            if (rid !== rowId) return r;
            return { ...r, approvals: normalizeApprovals(updatedApprovals) };
          })
        );
      } catch (err) {
        console.error('Error updating approvals', err);
        setSnackbar({ message: 'Failed to update approvals', type: 'error' });
      } finally {
        setApprovalIds((s) => s.filter((x) => x !== String(rowId)));
      }
    },
    [setSnackbar, user, lookups.users, entityData.setRowData]
  );

  // Computed admin/office names
  const adminNames = new Set((lookups.users ?? []).filter((u) => u.type === 'admin').map((u) => u.name));
  const officeNames = new Set((lookups.users ?? []).filter((u) => u.type === 'office').map((u) => u.name));

  return {
    // Spread all base entity data
    ...entityData,
    // Job-specific additions
    lookups,
    approvalIds,
    approvalIdsRef,
    confirmRow,
    adminNames,
    officeNames,
  };
};
