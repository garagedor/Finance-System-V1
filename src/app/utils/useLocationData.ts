import { useEffect, useMemo, useRef, useState } from 'react';
import type { AuthUser } from '../../types/user';
import type { Location, Technician } from '../../types/job';
import { useEntityData } from './useEntityData';

const normalizeLocationRow = (row: Location) => row;

export type LocationFilterRule = { field: keyof Location; value: any };

const locationEntityOptions = {
  endpoint: '/api/locations',
  normalizeRow: normalizeLocationRow,
  makeDraftRow: () =>
  ({
    _id: `temp_${Date.now()}`,
    managerProfitPercent: 0,
    technician: '',
  } as Location),
  numberFields: ['managerProfitPercent'] as Array<keyof Location>,
};

export const useLocationData = (
  user: AuthUser | null,
  setSnackbar: (value: { message: string; type: 'success' | 'error' } | null) => void,
  sortBy: keyof Location | null,
  sortDir: 'asc' | 'desc'
) => {

  const data = useEntityData<Location>(user, setSnackbar, sortBy, sortDir, locationEntityOptions);

  const [lookups, setLookups] = useState<{ techs: Technician[] }>({ techs: [] });
  const hasLoadedRef = useRef(false);

  useEffect(() => {
    if (hasLoadedRef.current) return;
    hasLoadedRef.current = true;

    const loadTechs = async () => {
      try {
        const res = await fetch('/api/techs?page=1&pageSize=500');
        if (!res.ok) throw new Error('Failed to load techs');
        const json = await res.json();
        const techs = Array.isArray(json.rows) ? json.rows : Array.isArray(json) ? json : [];
        setLookups({ techs });
      } catch (err) {
        console.error('Failed to load tech list', err);
        hasLoadedRef.current = false;
      }
    };
    loadTechs();
  }, []);

  return { ...data, lookups };
};
