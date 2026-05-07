'use client';

import React from 'react';
import { FiRefreshCw } from 'react-icons/fi';
import './FiltersPanel.css';

export interface FiltersPanelProps {
    /** Layout direction: horizontal (default) or vertical */
    direction?: 'horizontal' | 'vertical';
    /** Whether data is loading */
    loading?: boolean;
    /** Whether filters have been changed but not applied */
    filtersDirty?: boolean;
    /** Callback when Apply button is clicked */
    onApply: () => void;
    /** Error message to display */
    error?: string | null;
    /** Extra actions to render next to Apply */
    extraActions?: React.ReactNode;
    /** Filter fields to render */
    children: React.ReactNode;
}

/**
 * Reusable filter panel component with horizontal or vertical layout.
 * Pass individual filter fields as children.
 */
export default function FiltersPanel({
    direction = 'horizontal',
    loading = false,
    filtersDirty = false,
    onApply,
    error,
    extraActions,
    children,
}: FiltersPanelProps) {
    return (
        <div
            className={`filters-panel filters-panel--${direction}`}
            onKeyDown={(e) => {
                if (e.key === 'Enter' && !loading && filtersDirty) {
                    onApply();
                }
            }}
        >
            <div className="filter-group">
                {children}
                <div className="filter-actions">
                    <button
                        className="btn-refresh"
                        onClick={onApply}
                        disabled={loading}
                        title="Refresh data"
                    >
                        <FiRefreshCw className={loading ? 'spin' : ''} />
                    </button>
                    <button
                        className="btn-apply"
                        onClick={onApply}
                        disabled={loading || !filtersDirty}
                    >
                        {loading ? 'Loading...' : 'Apply'}
                    </button>
                    {extraActions}
                </div>
            </div>
            {error && <div className="error">{error}</div>}
            {filtersDirty && !loading && (
                <div className="warn">Filters changed. Data not updated yet. Click Apply.</div>
            )}
        </div>
    );
}

/** 
 * Individual filter field wrapper for consistent styling.
 */
export function FilterField({
    label,
    children,
}: {
    label: string;
    children: React.ReactNode;
}) {
    return (
        <div className="filter-field">
            <label>{label}</label>
            {children}
        </div>
    );
}
