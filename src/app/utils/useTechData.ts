import { useEffect, useMemo, useRef, useState } from 'react';
import type { AuthUser } from '../../types/user';
import type { Location, Technician } from '../../types/job';
import { useEntityData } from './useEntityData';

const normalizeTechRow = (row: Technician) => row;

export type TechFilterRule = { field: keyof Technician; value: any };

const techEntityOptions = {
  endpoint: '/api/techs',
  normalizeRow: normalizeTechRow,
  makeDraftRow: () =>
  ({
    _id: `temp_${Date.now()}`,
    profitPercent: 0,
    location: '',
  } as Technician),
  numberFields: ['profitPercent'] as Array<keyof Technician>,
};

export const useTechData = (
  user: AuthUser | null,
  setSnackbar: (value: { message: string; type: 'success' | 'error' } | null) => void,
  sortBy: keyof Technician | null,
  sortDir: 'asc' | 'desc'
) => {

  const data = useEntityData<Technician>(user, setSnackbar, sortBy, sortDir, techEntityOptions);

  const [lookups, setLookups] = useState<{ locations: Location[] }>({ locations: [] });
  const hasLoadedRef = useRef(false);

  useEffect(() => {
    if (hasLoadedRef.current) return;
    hasLoadedRef.current = true;

    const loadLocations = async () => {
      try {
        const res = await fetch('/api/locations?page=1&pageSize=500');
        if (!res.ok) throw new Error('Failed to load locations');
        const json = await res.json();
        const locations = Array.isArray(json.rows) ? json.rows : Array.isArray(json) ? json : [];
        setLookups({ locations });
      } catch (err) {
        console.error('Failed to load location list', err);
        hasLoadedRef.current = false;
      }
    };
    loadLocations();
  }, []);

  return { ...data, lookups };
};
