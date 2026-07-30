'use client';

import { useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import { FiPlus, FiTrash2, FiChevronDown, FiChevronUp, FiEdit2, FiX, FiSearch, FiSliders, FiColumns, FiChevronLeft, FiChevronRight } from 'react-icons/fi';
import dynamic from 'next/dynamic';
// Lazy-load the row-edit modal — only pulled in when a user opens it. Cast keeps
// the generic component type at the call site through next/dynamic.
const RowEditModal = dynamic(
  () => import('@/components/RowEditModal').then((m) => ({ default: m.RowEditModal })),
  { ssr: false },
) as typeof import('@/components/RowEditModal').RowEditModal;
import { LoadingOverlay } from '@/components/LoadingOverlay';
import { ColumnsOrder } from '@/components/ColumnsOrder';
import { EntityTableFilters } from './EntityTableFilters';
import DateRangePicker from '@/components/DateRangePicker';
import EmptyState from '@/components/EmptyState';
import type { AuthUser } from '@/types/user';
import type { ColumnConfig } from '@/app/utils/jobUtils';
import { PAGE_SIZE, formatCurrency, getRowId, normalizeApprovals } from '@/app/utils/jobUtils';
import { Snackbar } from '@/components/Snackbar';
import { useAuth } from '@/components/AuthShell';
import { GenericTableData, EntityTablePageProps, EntityFilterRule, FilterOperator } from './types';
import './EntityTablePage.css';

type SnackbarState = { message: string; type: 'success' | 'error' } | null;

const getTooltipText = <T,>(col: ColumnConfig<T>, value: any) => {
    if (value === undefined || value === null || value === '') return '-';
    if (col.type === 'currency') return formatCurrency(value);
    if (col.type === 'boolean') return value ? 'Yes' : 'No';
    if (col.type === 'chip') return normalizeApprovals(value).join(', ');
    return String(value);
};

export default function EntityTablePage<T, D extends GenericTableData<T>>({
    title,
    buildColumns,
    useDataHook,
    renderActions,
    topbarAddon,
    hideAddRowButton = false,
    hideActionsColumn = false,
}: EntityTablePageProps<T, D>) {
    const { user } = useAuth();
    const canEdit = user?.type === 'admin' || user?.type === 'office';
    const showAddRowButton = canEdit && !hideAddRowButton;
    const [snackbar, setSnackbar] = useState<SnackbarState>(null);
    const persistenceKey = `table-filters-${title.replace(/\s+/g, '-').toLowerCase()}`;
    // Column layout (order/widths/visibility) persists in localStorage so it
    // survives page navigation and tab close — filters/search live in
    // sessionStorage above and reset between sessions.
    const columnsKey = `table-columns-${title.replace(/\s+/g, '-').toLowerCase()}`;

    // Read initial state from sessionStorage to avoid redundant re-fetches
    const initialState = useMemo(() => {
        if (typeof window === 'undefined') return null;
        const saved = sessionStorage.getItem(persistenceKey);
        if (!saved) return null;
        try {
            return JSON.parse(saved);
        } catch { return null; }
    }, [persistenceKey]);

    const initialColumns = useMemo(() => {
        if (typeof window === 'undefined') return null;
        const saved = localStorage.getItem(columnsKey);
        if (!saved) return null;
        try {
            return JSON.parse(saved) as { order?: string[]; widths?: Record<string, number>; hidden?: string[]; sig?: string };
        } catch { return null; }
    }, [columnsKey]);

    const [sortBy, setSortBy] = useState<keyof T | null>(initialState?.sortBy ?? null);
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>(initialState?.sortDir ?? 'asc');
    const [filters, setFilters] = useState<EntityFilterRule<T>[]>(initialState?.filters ?? []);
    const [logic, setLogic] = useState<'AND' | 'OR'>(initialState?.logic ?? 'AND');

    const [filtersOpen, setFiltersOpen] = useState(false);
    const [editModalRow, setEditModalRow] = useState<T | null>(null);
    const [isAddingNew, setIsAddingNew] = useState(false);
    const [columnOrder, setColumnOrder] = useState<(keyof T)[]>(
        (initialColumns?.order as (keyof T)[]) ?? []
    );
    const [columnWidths, setColumnWidths] = useState<Record<string, number>>(initialColumns?.widths ?? {});
    const resizingRef = useRef<{ key: string; startX: number; startWidth: number } | null>(null);
    const data = useDataHook(user, setSnackbar, sortBy, sortDir);
    const [localSearch, setLocalSearch] = useState(data.search);

    useEffect(() => {
        // Update local search if data.search changes (e.g. on clear)
        setLocalSearch(data.search);
    }, [data.search]);

    const initialLoadRef = useRef(false);

    useEffect(() => {
        if (initialLoadRef.current) return;
        initialLoadRef.current = true;

        if (initialState?.search) {
            data.setSearch(initialState.search);
        }

        // Apply restored filters to the data hook if they exist
        if (initialState?.filters && initialState.filters.length > 0) {
            const usable = initialState.filters
                .filter((f: any) => f.field)
                .map((f: any) => ({ field: f.field, value: f.value, operator: f.operator }));
            data.applyFilters(usable, initialState.logic || 'AND', { skipFetch: true });
        }
        // Restore previously-hidden columns (the order/widths state was already
        // seeded synchronously via useState initializers above).
        if (initialColumns?.hidden && initialColumns.hidden.length > 0) {
            data.setHiddenColumns(initialColumns.hidden);
        }
        data.setIsInitialized(true);
    }, [persistenceKey]); // Run once when persistenceKey changes (mount or entity switch)

    useEffect(() => {
        // Persist to sessionStorage whenever filters or sorting changes
        const stateToSave = { filters, logic, sortBy, sortDir, search: data.search };
        sessionStorage.setItem(persistenceKey, JSON.stringify(stateToSave));
    }, [persistenceKey, filters, logic, sortBy, sortDir, data.search]);

    const columns = buildColumns(data);
    const columnKeySignature = useMemo(() => columns.map((c) => c.key).join('|'), [columns]);

    useEffect(() => {
        // Persist column layout to localStorage so it survives navigation. We
        // also stash a signature of the current column-key set so that when
        // the entity adds/removes columns the saved layout gets invalidated
        // on next load (instead of silently appending new columns to the end).
        const payload = {
            order: columnOrder as string[],
            widths: columnWidths,
            hidden: data.hiddenColumns,
            sig: columnKeySignature,
        };
        localStorage.setItem(columnsKey, JSON.stringify(payload));
    }, [columnsKey, columnOrder, columnWidths, data.hiddenColumns, columnKeySignature]);

    useEffect(() => {
        if (snackbar) {
            const timer = setTimeout(() => setSnackbar(null), 2800);
            return () => clearTimeout(timer);
        }
    }, [snackbar]);

    useEffect(() => {
        if (data.activeFilterLogic) {
            setLogic(data.activeFilterLogic);
        }
    }, [data.activeFilterLogic]);

    useEffect(() => {
        const defaultOrder = columns.map((c) => c.key);
        const savedSig = initialColumns?.sig;
        const savedMatchesCurrent = savedSig === columnKeySignature;
        setColumnOrder((prev) => {
            // First mount with no saved layout — use the entity's canonical order.
            if (!prev.length) return defaultOrder;
            // Saved layout matches the current column set — preserve user's order.
            if (savedMatchesCurrent) return prev;
            // Column set changed (entity added/removed columns) — reset to
            // canonical order so the new layout matches what the developer
            // intended instead of having new columns appended at the end.
            return defaultOrder;
        });
        if (!savedMatchesCurrent) {
            // Drop any stale hidden-column flags that refer to keys that no
            // longer exist; keep flags for keys still present.
            data.setHiddenColumns(data.hiddenColumns.filter((k) => defaultOrder.includes(k as keyof T)));
        }
    }, [columnKeySignature]);

    const filterableColumns = useMemo(
        () => columns.filter((c) => c.type !== 'chip' && c.type !== 'password'),
        [columns]
    );

    const addFilterRow = () => {
        const defaultField = (filterableColumns[0]?.key as keyof T | '') ?? '';
        setFilters((prev) => [
            ...prev,
            { id: `filter-${Date.now()}-${prev.length}`, field: defaultField, value: '', operator: 'contains' },
        ]);
    };

    const updateFilterField = (id: string, field: keyof T | '') => {
        setFilters((prev) => prev.map((f) => (f.id === id ? { ...f, field, value: '' } : f)));
    };

    const updateFilterValue = (id: string, value: any) => {
        setFilters((prev) => prev.map((f) => (f.id === id ? { ...f, value } : f)));
    };

    const updateFilterOperator = (id: string, operator: any) => {
        setFilters((prev) => prev.map((f) => (f.id === id ? { ...f, operator } : f)));
    };

    const removeFilterRow = (id: string) => {
        setFilters((prev) => prev.filter((f) => f.id !== id));
    };

    const usableFilters = filters
        .filter((f) => f.field)
        .map((f) => ({ field: f.field as keyof T, value: f.value, operator: f.operator }));

    const canApplyFilters = filters.every((f) => f.field);

    const activeFilterSignature = useMemo(
        () =>
            JSON.stringify({
                filters: (data.activeFilters ?? []).map((f: any) => ({ field: f.field, value: f.value, operator: f.operator })),
                logic: data.activeFilterLogic
            }),
        [data.activeFilters, data.activeFilterLogic]
    );

    const currentFilterSignature = useMemo(
        () => JSON.stringify({
            filters: usableFilters.map((f) => ({ field: f.field, value: f.value, operator: f.operator })),
            logic
        }),
        [usableFilters, logic]
    );

    const filtersStale = currentFilterSignature !== activeFilterSignature;
    const applyDisabled = !canApplyFilters || data.loading || activeFilterSignature === currentFilterSignature;

    const handleApplyFilters = () => {
        data.applyFilters(usableFilters, logic);
    };

    const handleSearchApply = () => {
        if (localSearch.length > 0 && localSearch.length < 2) return;
        data.setSearch(localSearch);
        data.setPage(1);
    };

    const handleSearchClear = () => {
        setLocalSearch('');
        data.setSearch('');
        data.setPage(1);
    };

    const handleClearFilters = () => {
        setFilters([]);
        setLogic('AND');
        data.clearFilters();

        // Clear persistence
        const persistenceKey = `table-filters-${title.replace(/\s+/g, '-').toLowerCase()}`;
        sessionStorage.removeItem(persistenceKey);
    };

    const canPrev = data.page > 1;
    const canNext = data.page < data.totalPages;
    const showActions = canEdit && !hideActionsColumn;
    const orderedColumns = columnOrder
        .map((key) => columns.find((c) => c.key === key))
        .filter(Boolean) as ColumnConfig<T>[];
    const visibleColumns = orderedColumns.filter((c) => !data.hiddenColumns.includes(c.key as string) && c.type !== 'password');

    // Column resize handlers
    const handleResizeStart = (e: React.MouseEvent, colKey: string, currentWidth: number) => {
        e.preventDefault();
        e.stopPropagation();
        resizingRef.current = { key: colKey, startX: e.clientX, startWidth: currentWidth };
        document.addEventListener('mousemove', handleResizeMove);
        document.addEventListener('mouseup', handleResizeEnd);
    };

    const handleResizeMove = (e: MouseEvent) => {
        if (!resizingRef.current) return;
        const { key, startX, startWidth } = resizingRef.current;
        const diff = e.clientX - startX;
        const newWidth = Math.max(80, startWidth + diff);
        setColumnWidths((prev) => ({ ...prev, [key]: newWidth }));
    };

    const handleResizeEnd = () => {
        resizingRef.current = null;
        document.removeEventListener('mousemove', handleResizeMove);
        document.removeEventListener('mouseup', handleResizeEnd);
    };

    const toggleSortColumn = (key: keyof T) => {
        if (sortBy !== key) {
            setSortBy(key);
            setSortDir('asc');
            data.setPage(1);
            return;
        }
        if (sortDir === 'asc') {
            setSortDir('desc');
            data.setPage(1);
            return;
        }
        setSortBy(null);
        setSortDir('asc');
        data.setPage(1);
    };

    const renderDisplayValue = (col: ColumnConfig<T>, value: any) => {
        if (col.type === 'currency') return formatCurrency(value);
        if (col.type === 'boolean') return value ? 'Yes' : 'No';
        if (col.type === 'date' && value) {
            // Format as mm/dd/yy
            const dateStr = String(value);
            const parsed = new Date(dateStr);
            if (!isNaN(parsed.getTime())) {
                const mm = String(parsed.getMonth() + 1).padStart(2, '0');
                const dd = String(parsed.getDate()).padStart(2, '0');
                const yy = String(parsed.getFullYear()).slice(-2);
                return <span className="cell-text">{`${mm}/${dd}/${yy}`}</span>;
            }
            return <span className="cell-text">{dateStr}</span>;
        }
        if (col.type === 'chip') {
            const approvals = normalizeApprovals(value);
            if (!approvals.length) return <span></span>;
            const full = approvals.join(', ');
            const adminNames = data.adminNames instanceof Set ? data.adminNames : new Set<string>();
            const officeNames = data.officeNames instanceof Set ? data.officeNames : new Set<string>();
            const hasAdmin = approvals.some((a) => adminNames.has(a));
            const hasOffice = approvals.some((a) => officeNames.has(a));
            const approvalClass = hasAdmin ? 'approval-admin' : hasOffice ? 'approval-office' : '';
            const approvalStyle = hasAdmin
                ? { background: 'rgba(16,185,129,0.15)', color: '#34d399', padding: '2px 7px', borderRadius: '6px' }
                : hasOffice
                    ? { background: 'rgba(245,158,11,0.15)', color: '#fbbf24', padding: '2px 7px', borderRadius: '6px' }
                    : { background: 'rgba(255,255,255,0.08)', color: '#94a3b8', padding: '2px 7px', borderRadius: '6px' };
            return (
                <span className={`approval-text ${approvalClass}`} title={full} style={approvalStyle}>
                    {full}
                </span>
            );
        }
        if (col.type === 'password') {
            return <span className="cell-text">********</span>;
        }
        if (value === undefined || value === null || value === '') return <span className="muted">-</span>;
        return <span className="cell-text">{String(value)}</span>;
    };

    if (!user) return null;

    const renderFilterValueInput = (filter: EntityFilterRule<T>) => {
        const col = columns.find((c) => c.key === filter.field);
        if (!col) {
            return (
                <input
                    className="input filter-input"
                    type="text"
                    placeholder="Select a field"
                    value={filter.value ?? ''}
                    disabled
                />
            );
        }

        switch (col.type) {
            case 'select':
                return (
                    <select
                        className="input filter-input"
                        value={filter.value ?? ''}
                        onChange={(e) => updateFilterValue(filter.id, e.target.value)}
                    >
                        <option value="">Select...</option>
                        {(col.options ?? []).map((opt) => (
                            <option key={opt} value={opt}>
                                {opt}
                            </option>
                        ))}
                    </select>
                );
            case 'boolean':
                return (
                    <select
                        className="input filter-input"
                        value={filter.value === '' ? '' : filter.value ? 'true' : 'false'}
                        onChange={(e) => updateFilterValue(filter.id, e.target.value === 'true')}
                    >
                        <option value="">Any</option>
                        <option value="true">Yes</option>
                        <option value="false">No</option>
                    </select>
                );
            case 'date': {
                // Parse the filter value as a date range object
                let startDate = '';
                let endDate = '';
                if (filter.value && typeof filter.value === 'string') {
                    try {
                        const parsed = JSON.parse(filter.value);
                        startDate = parsed.start || '';
                        endDate = parsed.end || '';
                    } catch {
                        // If it's not JSON, treat it as a single date for backward compatibility
                        startDate = filter.value;
                        endDate = filter.value;
                    }
                } else if (filter.value && typeof filter.value === 'object') {
                    startDate = (filter.value as any).start || '';
                    endDate = (filter.value as any).end || '';
                }

                return (
                    <div className="filter-date-range">
                        <DateRangePicker
                            startDate={startDate}
                            endDate={endDate}
                            onChange={(start, end) => {
                                // Store as JSON string
                                const rangeValue = JSON.stringify({ start, end });
                                updateFilterValue(filter.id, rangeValue);
                            }}
                        />
                    </div>
                );
            }
            case 'currency':
            case 'number':
                return (
                    <input
                        className="input filter-input"
                        type="number"
                        step="0.01"
                        value={filter.value ?? ''}
                        onChange={(e) => updateFilterValue(filter.id, e.target.value)}
                    />
                );
            default:
                return (
                    <input
                        className="input filter-input"
                        type="text"
                        placeholder="Search contains..."
                        value={filter.value ?? ''}
                        onChange={(e) => updateFilterValue(filter.id, e.target.value)}
                    />
                );
        }
    };

    // Table cells are now read-only - editing happens in modal
    const renderCellValue = (col: ColumnConfig<T>, value: any) => {
        return renderDisplayValue(col, value);
    };

    const handleOpenEditModal = (row: T) => {
        setEditModalRow({ ...row });
        setIsAddingNew(false);
    };

    const handleOpenAddModal = () => {
        // Create empty row with default values
        const emptyRow = {} as T;
        columns.forEach((col) => {
            if (col.type === 'boolean') {
                (emptyRow as any)[col.key] = false;
            } else if (col.type === 'currency' || col.type === 'number') {
                (emptyRow as any)[col.key] = 0;
            } else {
                (emptyRow as any)[col.key] = '';
            }
        });
        const tempId = `temp_${Date.now()}`;
        (emptyRow as any)._id = '';  // Empty for user to fill
        (emptyRow as any).__tempId = tempId;  // Internal tracking for new row detection
        setEditModalRow(emptyRow);
        setIsAddingNew(true);
    };

    const handleModalSave = async (updatedRow: T) => {
        // For both new and existing rows, just save directly
        // The saveRow function handles POST vs PUT based on temp_ id
        await data.saveRow(updatedRow as any);
    };

    const handleCloseModal = () => {
        setEditModalRow(null);
        setIsAddingNew(false);
    };

    const activeFiltersCount = data.activeFilters?.length || 0;
    const sortLabel = sortBy ? `${String(sortBy)} ${sortDir === 'asc' ? '↑' : '↓'}` : null;

    return (
        <main className="page">
            {/* Refetch indicator */}
            {data.loading && data.rowData.length > 0 && <div className="top-progress" />}

            <div className="content">

                {/* ── Topbar Row 1: title + entity addon ── */}
                <header className="topbar">
                    <div className="topbar-left">
                        <h1 className="title">{title}</h1>
                        {topbarAddon && <div className="topbar-addon">{topbarAddon}</div>}
                    </div>

                    {/* ── Topbar Row 1 right: actions ── */}
                    <div className="topbar-right">
                        <div className="search-box">
                            <FiSearch className="search-icon" size={14} />
                            <input
                                type="text"
                                className="search-input"
                                placeholder="Search…"
                                value={localSearch}
                                onChange={(e) => setLocalSearch(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') handleSearchApply(); }}
                            />
                            {localSearch && (
                                <button
                                    onClick={handleSearchClear}
                                    className="search-clear"
                                    aria-label="Clear search"
                                >
                                    <FiX size={13} />
                                </button>
                            )}
                            <button
                                className="search-go"
                                onClick={handleSearchApply}
                                disabled={localSearch.length > 0 && localSearch.length < 2}
                                title="Search"
                            >
                                Go
                            </button>
                        </div>

                        <div className="filters-inline">
                            <EntityTableFilters
                                activeFiltersCount={data.activeFilters?.length || 0}
                                filtersOpen={filtersOpen}
                                setFiltersOpen={setFiltersOpen}
                                logic={logic}
                                setLogic={setLogic}
                                filters={filters}
                                addFilterRow={addFilterRow}
                                updateFilterField={updateFilterField}
                                updateFilterOperator={updateFilterOperator}
                                removeFilterRow={removeFilterRow}
                                handleClearFilters={handleClearFilters}
                                handleApplyFilters={handleApplyFilters}
                                applyDisabled={applyDisabled}
                                filtersStale={filtersStale}
                                filterableColumns={filterableColumns}
                                renderFilterValueInput={renderFilterValueInput}
                                isFilterMode={data.filterMode}
                                loading={data.loading}
                            />
                        </div>

                        <div className="columns">
                            <ColumnsOrder
                                columns={columns.filter((c) => c.type !== 'password')}
                                columnOrder={columnOrder}
                                setColumnOrder={setColumnOrder as any}
                                hiddenColumns={data.hiddenColumns}
                                toggleColumn={data.toggleColumn}
                            />
                        </div>

                        {showAddRowButton && (
                            <button
                                className="btn-primary"
                                onClick={handleOpenAddModal}
                            >
                                <FiPlus />
                                Add row
                            </button>
                        )}
                    </div>
                </header>

                {/* ── Status bar ── */}
                <div className="status-bar">
                    <div className="status-left">
                        <span className="status-pill">
                            <span className="status-pill-num">{data.total}</span>
                            <span className="status-pill-label">total</span>
                        </span>
                        {sortLabel && (
                            <span className="status-meta">
                                <span className="status-meta-label">Sort</span>
                                <span className="status-meta-value">{sortLabel}</span>
                                <button
                                    className="status-meta-clear"
                                    onClick={() => { setSortBy(null); setSortDir('asc'); data.setPage(1); }}
                                    aria-label="Clear sort"
                                >
                                    <FiX size={11} />
                                </button>
                            </span>
                        )}
                        {activeFiltersCount > 0 && (
                            <span className="status-meta">
                                <span className="status-meta-label">Filters</span>
                                <span className="status-meta-value">{activeFiltersCount}</span>
                                <button
                                    className="status-meta-clear"
                                    onClick={handleClearFilters}
                                    aria-label="Clear filters"
                                >
                                    <FiX size={11} />
                                </button>
                            </span>
                        )}
                        {data.search && (
                            <span className="status-meta">
                                <span className="status-meta-label">Search</span>
                                <span className="status-meta-value">"{data.search}"</span>
                                <button
                                    className="status-meta-clear"
                                    onClick={handleSearchClear}
                                    aria-label="Clear search"
                                >
                                    <FiX size={11} />
                                </button>
                            </span>
                        )}
                    </div>
                    <div className="status-right">
                        {!data.filterMode && data.totalPages > 0 && (
                            <span className="status-pages">
                                Page <strong>{data.page}</strong> of <strong>{data.totalPages}</strong>
                            </span>
                        )}
                    </div>
                </div>

                {/* ── Table ── */}
                <section className="panel table-card">
                    <div className="table-wrapper">
                        <table className="table">
                            <thead>
                                <tr>
                                    {visibleColumns.map((col) => {
                                        const colKey = col.key as string;
                                        const width = columnWidths[colKey];
                                        return (
                                            <th
                                                key={colKey}
                                                className={`sortable ${sortBy === col.key ? 'active' : ''}`}
                                                onClick={() => toggleSortColumn(col.key as keyof T)}
                                                aria-sort={
                                                    sortBy === col.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'
                                                }
                                                title="Click to sort"
                                                style={width ? { width: `${width}px`, minWidth: `${width}px` } : undefined}
                                            >
                                                <span className="header-content">
                                                    <span className="header-label">{col.label}</span>
                                                    <span className="sort-indicator">
                                                        {sortBy === col.key ? (
                                                            sortDir === 'asc' ? (
                                                                <FiChevronUp />
                                                            ) : (
                                                                <FiChevronDown />
                                                            )
                                                        ) : (
                                                            <FiChevronDown className="inactive-sort-icon" />
                                                        )}
                                                    </span>
                                                </span>
                                                <div
                                                    className="resize-handle"
                                                    onMouseDown={(e) => {
                                                        const th = e.currentTarget.parentElement;
                                                        const currentWidth = th?.offsetWidth ?? 120;
                                                        handleResizeStart(e, colKey, currentWidth);
                                                    }}
                                                    onClick={(e) => e.stopPropagation()}
                                                />
                                            </th>
                                        );
                                    })}
                                    {showActions && <th className="actions-th"></th>}
                                </tr>
                            </thead>
                            <tbody>
                                {data.rowData.map((row: any) => {
                                    const rowId = getRowId(row);
                                    const approvals = normalizeApprovals((row as any)?.approvals ?? []);
                                    const adminApprovals =
                                        data.adminNames instanceof Set ? approvals.some((a) => data.adminNames.has(a)) : false;
                                    const rowEditable = canEdit && (!adminApprovals || user?.type === 'admin');
                                    const defaultActions = rowEditable ? (
                                        <>
                                            <button
                                                className="icon-btn"
                                                onClick={() => handleOpenEditModal(row)}
                                                title="Edit row"
                                                aria-label="Edit row"
                                            >
                                                <FiEdit2 />
                                            </button>
                                            <button
                                                className="icon-btn danger"
                                                onClick={() => {
                                                    if (!confirm('Delete this row?')) return;
                                                    data.deleteRow(rowId);
                                                }}
                                                title="Delete row"
                                                aria-label="Delete row"
                                            >
                                                <FiTrash2 />
                                            </button>
                                        </>
                                    ) : null;
                                    // Keep saving for renderActions compatibility (entityConfigs may use it)
                                    const saving = data.savingIdsRef?.current?.includes(rowId) ?? false;
                                    const renderedActions = renderActions
                                        ? renderActions({ row, rowId, saving, defaultActions, data, user })
                                        : defaultActions;

                                    return (
                                        <tr key={rowId || Math.random()}>
                                            {visibleColumns.map((col) => {
                                                const tooltip = getTooltipText(col, (row as any)[col.key]);
                                                const shouldTruncate = col.type !== 'multiline';
                                                return (
                                                    <td
                                                        key={col.key as string}
                                                        title={tooltip || undefined}
                                                        className={`${shouldTruncate ? 'truncate-cell' : ''}`}
                                                        style={{
                                                            ...(col.minWidth ? { minWidth: `${col.minWidth}px` } : {}),
                                                            ...(col.maxWidth ? { maxWidth: `${col.maxWidth}px` } : {}),
                                                        }}
                                                    >
                                                        {col.renderCell
                                                            ? col.renderCell({ row, value: (row as any)[col.key], data, user, defaultActions })
                                                            : renderCellValue(col, (row as any)[col.key])}
                                                    </td>
                                                );
                                            })}
                                            {showActions && <td className="actions actions-td">{renderedActions}</td>}
                                        </tr>
                                    );
                                })}
                                {!data.rowData.length && !data.loading && (
                                    <tr className="empty-row">
                                        <td colSpan={visibleColumns.length + (showActions ? 1 : 0)}>
                                            <EmptyState
                                                size="md"
                                                title="No matches"
                                                message={
                                                    activeFiltersCount > 0 || data.search
                                                        ? 'Try clearing filters or adjusting your search.'
                                                        : 'No rows yet.'
                                                }
                                                action={
                                                    (activeFiltersCount > 0 || data.search) ? (
                                                        <button
                                                            className="btn-ghost"
                                                            onClick={() => { handleClearFilters(); handleSearchClear(); }}
                                                        >
                                                            Reset all
                                                        </button>
                                                    ) : showAddRowButton ? (
                                                        <button className="btn-primary" onClick={handleOpenAddModal}>
                                                            <FiPlus /> Add first row
                                                        </button>
                                                    ) : undefined
                                                }
                                            />
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                        {data.loading && data.rowData.length === 0 && <LoadingOverlay message="Loading data..." />}
                    </div>
                </section>

                {/* ── Compact Pagination ── */}
                <div className="pagination-bar">
                    {!data.filterMode ? (
                        <>
                            <button
                                className="page-arrow"
                                onClick={() => canPrev && data.setPage((p: number) => p - 1)}
                                disabled={!canPrev || data.loading}
                                aria-label="Previous page"
                            >
                                <FiChevronLeft size={14} />
                            </button>
                            <span className="page-indicator">
                                Page <strong>{data.page}</strong> of <strong>{data.totalPages}</strong>
                            </span>
                            <button
                                className="page-arrow"
                                onClick={() => canNext && data.setPage((p: number) => p + 1)}
                                disabled={!canNext || data.loading}
                                aria-label="Next page"
                            >
                                <FiChevronRight size={14} />
                            </button>
                        </>
                    ) : (
                        <span className="page-indicator">
                            Filtered view {data.limitedToFirst50 ? `· first ${PAGE_SIZE} rows` : ''}
                        </span>
                    )}
                </div>
            </div>

            {editModalRow && (
                <RowEditModal
                    row={editModalRow}
                    columns={columns}
                    isNew={isAddingNew}
                    onSave={handleModalSave}
                    onClose={handleCloseModal}
                    title={title}
                />
            )}

            <Snackbar snackbar={snackbar} />
        </main>
    );
}

export { EntityTablePage };
