'use client';

import { FiChevronDown, FiPlus, FiX, FiTrash2, FiRefreshCw } from 'react-icons/fi';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useClickOutside } from '@/hooks/useClickOutside';
import type { ColumnConfig } from '@/app/utils/jobUtils';
import { EntityFilterRule } from './types';
import './EntityTableFilters.css';

type EntityTableFiltersProps<T> = {
    activeFiltersCount: number;
    filtersOpen: boolean;
    setFiltersOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
    logic: 'AND' | 'OR';
    setLogic: (logic: 'AND' | 'OR') => void;
    filters: EntityFilterRule<T>[];
    addFilterRow: () => void;
    updateFilterField: (id: string, field: keyof T) => void;
    updateFilterOperator: (id: string, operator: any) => void;
    removeFilterRow: (id: string) => void;
    handleClearFilters: () => void;
    handleApplyFilters: () => void;
    applyDisabled: boolean;
    filtersStale: boolean;
    filterableColumns: ColumnConfig<T>[];
    renderFilterValueInput: (filter: EntityFilterRule<T>) => React.ReactNode;
    isFilterMode: boolean;
    loading?: boolean;
};

export function EntityTableFilters<T>({
    activeFiltersCount,
    filtersOpen,
    setFiltersOpen,
    logic,
    setLogic,
    filters,
    addFilterRow,
    updateFilterField,
    updateFilterOperator,
    removeFilterRow,
    handleClearFilters,
    handleApplyFilters,
    applyDisabled,
    filtersStale,
    filterableColumns,
    renderFilterValueInput,
    isFilterMode,
    loading = false,
}: EntityTableFiltersProps<T>) {
    const filtersRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const popupRef = useRef<HTMLDivElement>(null);
    // See ColumnsOrder for why we use fixed-positioning here: the table page
    // has `overflow: hidden` ancestors that clip absolute children.
    const [popupPos, setPopupPos] = useState<{ top: number; right: number } | null>(null);

    // Custom outside-click that respects BOTH the trigger container and the
    // portaled popup (since the popup is no longer a DOM child of the trigger).
    useEffect(() => {
        if (!filtersOpen) return;
        const handler = (event: MouseEvent | TouchEvent) => {
            const target = event.target as HTMLElement;
            if (filtersRef.current?.contains(target)) return;
            if (popupRef.current?.contains(target)) return;
            // The DateRangePicker renders its calendar through react-datepicker's
            // portal, so a click on a date is technically outside `popupRef`.
            // Treat those clicks as inside the filter popup so picking a date
            // doesn't dismiss the whole filter panel.
            if (target.closest?.('.react-datepicker')) return;
            setFiltersOpen(false);
        };
        document.addEventListener('mousedown', handler);
        document.addEventListener('touchstart', handler);
        return () => {
            document.removeEventListener('mousedown', handler);
            document.removeEventListener('touchstart', handler);
        };
    }, [filtersOpen]);

    const computePos = () => {
        const rect = triggerRef.current?.getBoundingClientRect();
        if (!rect) return null;
        return { top: rect.bottom + 8, right: window.innerWidth - rect.right };
    };

    useEffect(() => {
        if (!filtersOpen) return;
        const reposition = () => {
            const next = computePos();
            if (next) setPopupPos(next);
        };
        window.addEventListener('resize', reposition);
        window.addEventListener('scroll', reposition, true);
        return () => {
            window.removeEventListener('resize', reposition);
            window.removeEventListener('scroll', reposition, true);
        };
    }, [filtersOpen]);

    const handleToggle = () => {
        if (!filtersOpen) {
            setPopupPos(computePos());
        }
        setFiltersOpen((v) => !v);
    };

    return (
        <div className="filters-inline relative" ref={filtersRef}>
            <button
                ref={triggerRef}
                className={`flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-200 rounded-lg font-medium text-sm text-slate-600 shadow-sm hover:bg-slate-50 hover:border-slate-300 transition-all ${filtersOpen ? 'bg-blue-50 border-blue-200 text-blue-600' : ''
                    }`}
                onClick={handleToggle}
            >
                Filters {activeFiltersCount > 0 ? `(${activeFiltersCount})` : '(0)'}
                <FiChevronDown
                    className={`transition-transform duration-200 ${filtersOpen ? 'rotate-180' : ''
                        }`}
                />
            </button>
            {filtersOpen && typeof document !== 'undefined' && createPortal((
                <div
                    ref={popupRef}
                    className="filters-popup"
                    style={{
                        position: 'fixed',
                        top: popupPos?.top ?? 80,
                        right: popupPos?.right ?? 20,
                        zIndex: 9999,
                    }}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && !applyDisabled) {
                            handleApplyFilters();
                        }
                    }}
                >
                    <div className="filters-header">
                        <div className="logic-toggle">
                            <button
                                type="button"
                                className={logic === 'AND' ? 'active' : ''}
                                onClick={() => setLogic('AND')}
                                title="Match ALL conditions"
                            >
                                AND
                            </button>
                            <button
                                type="button"
                                className={logic === 'OR' ? 'active' : ''}
                                onClick={() => setLogic('OR')}
                                title="Match ANY condition"
                            >
                                OR
                            </button>
                        </div>

                        <div className="filters-actions">
                            <button className="ghost" onClick={addFilterRow} style={{ padding: '6px 12px', fontSize: '13px' }}>
                                <FiPlus />
                                Add
                            </button>
                            <button
                                className="ghost"
                                onClick={handleClearFilters}
                                disabled={!filters.length && !isFilterMode}
                                style={{ padding: '6px 12px', fontSize: '13px' }}
                            >
                                <FiX />
                                Clear
                            </button>
                            <button
                                className="ghost refresh-btn"
                                onClick={handleApplyFilters}
                                disabled={loading}
                                title="Refresh data"
                                style={{ padding: '6px', fontSize: '15px' }}
                            >
                                <FiRefreshCw className={loading ? 'spin' : ''} />
                            </button>
                            <button
                                className={`primary apply-btn ${applyDisabled ? 'disabled' : ''}`}
                                onClick={handleApplyFilters}
                                disabled={applyDisabled}
                                title={
                                    applyDisabled
                                        ? 'Filters already applied'
                                        : undefined
                                }
                                style={{ padding: '6px 16px', fontSize: '13px' }}
                            >
                                Apply
                            </button>
                        </div>
                    </div>
                    {filtersStale && (
                        <div className="filters-warning" role="status">
                            Filters changed but not applied.
                        </div>
                    )}
                    <div className="filters-list">
                        {filters.length === 0 ? (
                            <div className="muted" style={{ textAlign: 'center', padding: '12px', background: '#f8fafc', borderRadius: '8px' }}>
                                No filters added.
                            </div>
                        ) : (
                            filters.map((filter) => (
                                <div key={filter.id} className="filter-row">
                                    <select
                                        className="input filter-field"
                                        value={String(filter.field ?? '')}
                                        onChange={(e) => updateFilterField(filter.id, e.target.value as keyof T)}
                                        style={{ flex: 1.5 }}
                                    >
                                        <option value="">Choose field...</option>
                                        {filterableColumns.map((col) => (
                                            <option key={col.key as string} value={col.key as string}>
                                                {col.label}
                                            </option>
                                        ))}
                                    </select>

                                    {(() => {
                                        const col = filterableColumns.find(c => c.key === filter.field);
                                        const isDateField = col?.type === 'date';

                                        // Hide operator for date fields
                                        if (isDateField) return null;

                                        return (
                                            <select
                                                className="input filter-operator"
                                                value={filter.operator}
                                                onChange={(e) => updateFilterOperator(filter.id, e.target.value)}
                                                style={{ flex: 1 }}
                                            >
                                                <option value="contains">Contains</option>
                                                <option value="equals">Equals</option>
                                                <option value="startsWith">Starts With</option>
                                                <option value="endsWith">Ends With</option>
                                                <option value="gt">Greater &gt;</option>
                                                <option value="lt">Less &lt;</option>
                                                <option value="gte">Greater &gt;=</option>
                                                <option value="lte">Less &lt;=</option>
                                            </select>
                                        );
                                    })()}

                                    <div style={{ flex: 2 }}>
                                        {renderFilterValueInput(filter)}
                                    </div>
                                    <button
                                        className="icon-btn danger"
                                        onClick={() => removeFilterRow(filter.id)}
                                        aria-label="Remove filter"
                                    >
                                        <FiTrash2 />
                                    </button>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            ), document.body)}
        </div>
    );
}
