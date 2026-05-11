import type { MutableRefObject, ReactNode } from 'react';
import type { AuthUser } from '@/types/user';
import type { ColumnConfig } from '@/app/utils/jobUtils';

export type FilterOperator = 'contains' | 'equals' | 'startsWith' | 'endsWith' | 'gt' | 'lt' | 'gte' | 'lte';

export type EntityFilterRule<T> = {
    id: string;
    field: keyof T | '';
    value: any;
    operator: FilterOperator;
};

export type GenericTableData<T> = {
    rowData: T[];
    page: number;
    setPage: (value: number | ((val: number) => number)) => void;
    total: number;
    totalPages: number;
    loading: boolean;
    savingIdsRef: MutableRefObject<string[]>;
    hiddenColumns: string[];
    columnsOpen: boolean;
    setColumnsOpen: (value: boolean | ((val: boolean) => boolean)) => void;
    saveRow: (row: T) => Promise<void>;
    deleteRow: (id: string) => Promise<void>;
    addNewRow: () => void;
    handleFieldChange: (rowId: string, field: keyof T, value: any) => void;
    toggleColumn: (field: string) => void;
    filterMode: boolean;
    limitedToFirst50: boolean;
    activeFilters: Array<{ field: keyof T; value: any; operator?: FilterOperator }>;
    activeFilterLogic: 'AND' | 'OR';
    applyFilters: (filters: Array<{ field: keyof T; value: any; operator?: FilterOperator }>, logic: 'AND' | 'OR', applyOptions?: { skipFetch?: boolean }) => void;
    clearFilters: () => void;
    confirmRow?: (row: T) => Promise<void>;
    approvalIdsRef?: MutableRefObject<string[]>;
    [key: string]: any;
};

export type RenderActionsArgs<T, D extends GenericTableData<T>> = {
    row: T;
    rowId: string;
    saving: boolean;
    defaultActions: ReactNode;
    data: D;
    user: AuthUser | null;
};

export type EntityTablePageProps<T, D extends GenericTableData<T>> = {
    title: string;
    buildColumns: (data: D) => ColumnConfig<T>[];
    useDataHook: (
        user: AuthUser | null,
        setSnackbar: (value: { message: string; type: 'success' | 'error' } | null) => void,
        sortBy: keyof T | null,
        sortDir: 'asc' | 'desc'
    ) => D;
    renderActions?: (args: RenderActionsArgs<T, D>) => ReactNode;
    topbarAddon?: ReactNode;
    hideAddRowButton?: boolean;
    // When true, the right-side actions column (header + cells) is suppressed.
    // Useful when an entity renders its row actions inline within a column
    // via `ColumnConfig.renderCell`.
    hideActionsColumn?: boolean;
};
