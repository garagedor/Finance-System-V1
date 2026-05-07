import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction, MutableRefObject } from 'react';
import type { AuthUser } from '../../types/user';
import { PAGE_SIZE, getRowId } from './jobUtils';

export type FilterOperator = 'contains' | 'equals' | 'startsWith' | 'endsWith' | 'gt' | 'lt' | 'gte' | 'lte';
export type FilterLogic = 'AND' | 'OR';

export type EntityFilterRule<T> = {
  field: keyof T;
  value: any;
  operator?: FilterOperator;
};

type Snackbar = { message: string; type: 'success' | 'error' } | null;

type EntityOptions<T> = {
  endpoint: string;
  normalizeRow: (row: T) => T;
  makeDraftRow: (user: AuthUser | null) => T & { _id?: string };
  numberFields?: Array<keyof T>;
  booleanFields?: Array<keyof T>;
};

export type UseEntityDataReturn<T> = {
  rowData: T[];
  setRowData: Dispatch<SetStateAction<T[]>>;
  page: number;
  setPage: Dispatch<SetStateAction<number>>;
  total: number;
  totalPages: number;
  loading: boolean;
  savingIds: string[];
  savingIdsRef: MutableRefObject<string[]>;
  hiddenColumns: string[];
  columnsOpen: boolean;
  setColumnsOpen: Dispatch<SetStateAction<boolean>>;
  fetchPage: (pageToLoad: number, filtersOverride?: EntityFilterRule<T>[], logicOverride?: FilterLogic) => Promise<void>;
  saveRow: (row: T) => Promise<void>;
  deleteRow: (id: string) => Promise<void>;
  addNewRow: () => void;
  handleFieldChange: (rowId: string, field: keyof T, value: any) => void;
  toggleColumn: (field: string) => void;
  setHiddenColumns: Dispatch<SetStateAction<string[]>>;
  filterMode: boolean;
  limitedToFirst50: boolean;
  activeFilters: EntityFilterRule<T>[];
  activeFilterLogic: FilterLogic;
  applyFilters: (filters: EntityFilterRule<T>[], logic: FilterLogic, applyOptions?: { skipFetch?: boolean }) => void;
  clearFilters: () => void;
  search: string;
  setSearch: Dispatch<SetStateAction<string>>;
  isInitialized: boolean;
  setIsInitialized: Dispatch<SetStateAction<boolean>>;
};

export const useEntityData = <T extends { _id?: string }>(
  user: AuthUser | null,
  setSnackbar: (value: Snackbar) => void,
  sortBy: keyof T | null,
  sortDir: 'asc' | 'desc',
  options: EntityOptions<T>
): UseEntityDataReturn<T> => {
  const canEdit = user?.type === 'admin' || user?.type === 'office';
  const [rowData, setRowData] = useState<T[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [savingIds, setSavingIds] = useState<string[]>([]);
  const savingIdsRef = useRef<string[]>([]);
  const rowDataRef = useRef<T[]>([]);
  const [hiddenColumns, setHiddenColumns] = useState<string[]>([]);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [activeFilters, setActiveFilters] = useState<EntityFilterRule<T>[]>([]);
  const [activeFilterLogic, setActiveFilterLogic] = useState<FilterLogic>('AND');
  const [filterMode, setFilterMode] = useState(false);
  const [limitedToFirst50, setLimitedToFirst50] = useState(false);
  const [search, setSearch] = useState('');
  const [isInitialized, setIsInitialized] = useState(false);
  const lastFetchRef = useRef<string | null>(null);

  useEffect(() => {
    savingIdsRef.current = savingIds;
  }, [savingIds]);

  useEffect(() => {
    rowDataRef.current = rowData;
  }, [rowData]);

  const totalPages = useMemo(() => (total > 0 ? Math.ceil(total / PAGE_SIZE) : 1), [total]);

  const fetchPage = useCallback(
    async (pageToLoad: number, filtersOverride?: EntityFilterRule<T>[], logicOverride?: FilterLogic) => {
      const filtersToApply = filtersOverride ?? activeFilters;
      const logicToApply = logicOverride ?? activeFilterLogic;
      const filtering = (filtersToApply?.length ?? 0) > 0;

      const fetchParams = {
        page: filtering || search.length >= 2 ? '1' : String(pageToLoad),
        pageSize: PAGE_SIZE,
        sortBy,
        sortDir,
        filters: JSON.stringify(filtersToApply),
        filterLogic: logicToApply,
        search
      };
      const fetchKey = `${options.endpoint}?${JSON.stringify(fetchParams)}`;

      // Deduplication: skip if identical request is already loading
      if (lastFetchRef.current === fetchKey) return;
      lastFetchRef.current = fetchKey;

      try {
        setLoading(true);
        const params = new URLSearchParams({
          page: filtering || search.length >= 2 ? '1' : String(pageToLoad),
          pageSize: String(PAGE_SIZE),
        });
        if (sortBy) {
          params.set('sortBy', String(sortBy));
          params.set('sortDir', sortDir);
        }
        if (filtering) {
          params.set('filters', JSON.stringify(filtersToApply));
          params.set('filterLogic', logicToApply);
          params.set('limitFirst50', 'true');
        }
        if (search.length >= 2) {
          params.set('search', search);
          params.set('limitFirst50', 'true');
        }
        const res = await fetch(`${options.endpoint}?${params.toString()}`);
        const data = await res.json();
        
        // Race condition check: only process results if this is still the latest request
        if (lastFetchRef.current !== fetchKey) return;

        const normalizedRows = (data.rows ?? []).map((r: T) => options.normalizeRow(r as T));
        const tempRows = rowDataRef.current.filter((r) => getRowId(r).startsWith('temp_'));
        const combined = [...tempRows, ...normalizedRows];
        setRowData(combined);
        const baseTotal = data.total ?? normalizedRows.length;
        setTotal(baseTotal + tempRows.length);
        setLimitedToFirst50(Boolean(data.limited) || ((filtering || search.length >= 2) && normalizedRows.length >= PAGE_SIZE));
        setFilterMode(filtering || search.length >= 2);
      } catch (err) {
        console.error('Failed to load data', err);
      } finally {
        setLoading(false);
      }
    },
    [activeFilters, activeFilterLogic, sortBy, sortDir, options.endpoint, options.normalizeRow, search]
  );

  useEffect(() => {
    if (isInitialized) {
      fetchPage(page);
    }
  }, [page, fetchPage, sortBy, sortDir, search, isInitialized]);

  const saveRow = useCallback(
    async (row: T) => {
      const draftId = (row as any).__tempId;
      const id = getRowId(row as any);
      if (!id) {
        console.error('Cannot save row without _id', row);
        return;
      }

      setSavingIds((s) => [...s, String(id)]);

      try {
        // Use __tempId presence to determine if this is a new row (more reliable than temp_ prefix)
        const isNewRow = Boolean(draftId);
        const method = isNewRow ? 'POST' : 'PUT';

        const normalizedRow = options.normalizeRow(row);
        const bodyToSend: any = { ...normalizedRow };

        // For new rows: only delete _id if it's the auto-generated temp ID
        if (isNewRow) {
          const rawId = (row as any)._id;
          const idIsTemp = String(rawId ?? '').startsWith('temp_');
          // If user changed _id from temp to something custom, keep it
          // Only delete if it's still the temp ID, matches the draft ID, or is empty (auto-gen)
          if (idIsTemp || rawId === draftId || !rawId) {
            delete bodyToSend._id;
          }
        }
        delete bodyToSend.__tempId;

        const res = await fetch(options.endpoint, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(bodyToSend),
        });

        const data = await res.json();
        if (!res.ok) {
          console.error('Save failed', data);
          setSnackbar({ message: 'Failed to save row', type: 'error' });
          return;
        }

        const updatedRaw = data.updated ?? data.created ?? data;
        const updated = options.normalizeRow(updatedRaw as T);
        const newId = getRowId(updated as any);

        setRowData((prev) => {
          const targetId = String(id);
          let replaced = false;
          // Filter out the temp row if this was a new row (use draftId to identify)
          const filtered = isNewRow ? prev.filter((r) => getRowId(r) !== draftId && getRowId(r) !== targetId) : prev;
          const next = filtered.map((r) => {
            const rid = getRowId(r);
            if (rid === targetId) {
              replaced = true;
              return updated as T;
            }
            return r;
          });
          // For new rows, prepend to front; for updates, keep position or append
          return replaced ? next : (isNewRow ? [updated as T, ...next] : [...next, updated as T]);
        });

        setSnackbar({ message: 'Row saved', type: 'success' });
      } catch (err) {
        console.error('Error saving row', err);
        setSnackbar({ message: 'Failed to save row', type: 'error' });
      } finally {
        setSavingIds((s) => s.filter((x) => x !== String(id)));
      }
    },
    [options, setSnackbar]
  );

  const deleteRow = useCallback(
    async (id: string) => {
      if (!canEdit) {
        setSnackbar({ message: 'Only admin/office can delete rows', type: 'error' });
        return;
      }

      if (String(id).startsWith('temp_')) {
        setRowData((prev) => prev.filter((r) => getRowId(r) !== String(id)));
        setSnackbar({ message: 'Draft row removed', type: 'success' });
        return;
      }

      try {
        setLoading(true);
        const res = await fetch(`${options.endpoint}?id=${encodeURIComponent(id)}`, {
          method: 'DELETE',
        });
        const data = await res.json();
        if (!res.ok) {
          console.error('Delete failed', data);
          setSnackbar({ message: 'Failed to delete row', type: 'error' });
          return;
        }

        setRowData((prev) => prev.filter((r) => getRowId(r) !== String(id)));
        setSnackbar({ message: 'Row deleted', type: 'success' });
      } catch (err) {
        console.error('Error deleting row', err);
        setSnackbar({ message: 'Failed to delete row', type: 'error' });
      } finally {
        setLoading(false);
      }
    },
    [options.endpoint, setSnackbar, canEdit]
  );

  const addNewRow = useCallback(() => {
    if (!canEdit) {
      setSnackbar({ message: 'Only admin/office can add rows', type: 'error' });
      return;
    }

    const newRow = options.makeDraftRow(user);
    const providedId = (newRow as any)._id;
    const draftId = (newRow as any).__tempId;
    const tempId = draftId ?? (providedId ? providedId : undefined) ?? `temp_${Date.now()}`;
    const withId = {
      ...newRow,
      _id: providedId ?? '',
      __tempId: tempId,
    };

    setRowData((prev) => [withId as T, ...prev]);
    setSnackbar({
      message: 'Draft row added. Edit and save to persist.',
      type: 'success',
    });
  }, [options, setSnackbar, user, canEdit]);

  const handleFieldChange = useCallback(
    (rowId: string, field: keyof T, value: any) => {
      const numberFields = new Set(options.numberFields ?? []);
      const booleanFields = new Set(options.booleanFields ?? []);

      setRowData((prev) =>
        prev.map((row) => {
          const rid = getRowId(row);
          if (rid !== rowId) return row;

          let nextValue: any = value;

          if (booleanFields.has(field)) {
            nextValue = Boolean(value);
          } else if (numberFields.has(field)) {
            const parsed = value === '' ? 0 : Number(value);
            nextValue = Number.isNaN(parsed) ? 0 : parsed;
          }

          return { ...row, [field]: nextValue };
        })
      );
    },
    [options.booleanFields, options.numberFields]
  );

  const toggleColumn = useCallback((field: string) => {
    setHiddenColumns((prev) =>
      prev.includes(field) ? prev.filter((f) => f !== field) : [...prev, field]
    );
  }, []);

  const applyFilters = useCallback((filters: EntityFilterRule<T>[], logic: FilterLogic, applyOptions?: { skipFetch?: boolean }) => {
    setActiveFilters(filters);
    setActiveFilterLogic(logic);
    setPage(1);
    
    if (applyOptions?.skipFetch) return;

    // Force fetch even if params are identical (for refresh)
    // The effect might not fire if state hasn't changed, so we call directly.
    // Deduplication in fetchPage will handle the case where the effect also fires.
    lastFetchRef.current = null;
    fetchPage(1, filters, logic);
  }, [fetchPage]);

  const clearFilters = useCallback(() => {
    setActiveFilters([]);
    setActiveFilterLogic('AND');
    setSearch('');
    setFilterMode(false);
    setLimitedToFirst50(false);
    setPage(1);
  }, []);

  return {
    rowData,
    setRowData,
    page,
    setPage,
    total,
    totalPages,
    loading,
    savingIds,
    savingIdsRef,
    hiddenColumns,
    columnsOpen,
    setColumnsOpen,
    fetchPage,
    saveRow,
    deleteRow,
    addNewRow,
    handleFieldChange,
    toggleColumn,
    setHiddenColumns,
    filterMode,
    limitedToFirst50,
    activeFilters,
    activeFilterLogic,
    applyFilters,
    clearFilters,
    search,
    setSearch,
    isInitialized,
    setIsInitialized,
  };
};
