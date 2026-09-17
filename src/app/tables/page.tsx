'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { EntityTablePage } from '@/components/EntityTable';
import { entityConfigs, entityOptions, type EntityKey, isEntityKey } from '../entityConfigs';
import { useAuth } from '@/components/AuthShell';
import { SummaryStrip, AlertCard } from '@/components/ui';
import type { GenericTableData } from '@/components/EntityTable/types';
import type { JobRow } from '@/types/job';

export default function TablesPage() {
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const router = useRouter();

  // Single source of truth: extract selected entity from URL
  const entityParam = searchParams.get('entity');

  // Natural selection logic: use URL param or default based on user permissions
  const selectedEntity = useMemo(() => {
    if (isEntityKey(entityParam)) {
      // Security/Permission check: non-admins (except location-manager) can only see 'job'
      if (user?.type !== 'admin' && user?.type !== 'location-manager' && entityParam !== 'job') {
        return 'job';
      }
      // Users moved to /admin/users — never resolve to the Tables Users entity.
      if (entityParam === 'user') {
        return user?.type === 'admin' ? null : 'job';
      }
      return entityParam;
    }

    if (!user) return null;

    if (typeof window !== 'undefined') {
      const cached = sessionStorage.getItem('tables-selected-entity');
      if (isEntityKey(cached)) {
        if (user.type !== 'admin' && user.type !== 'location-manager' && cached !== 'job') {
          return 'job';
        }
        if (cached === 'user' && user.type !== 'admin') {
          return 'job';
        }
        return cached;
      }
    }

    // Default to 'job-status' for admins/location-manager, 'job' for others
    return (user.type === 'admin' || user.type === 'location-manager') ? 'job-status' : 'job';
  }, [entityParam, user]);

  useEffect(() => {
    if (selectedEntity) {
      sessionStorage.setItem('tables-selected-entity', selectedEntity);
    }
  }, [selectedEntity]);

  // Auto-redirect admins hitting the legacy /tables?entity=user URL to the
  // new dedicated admin page.
  useEffect(() => {
    if (entityParam === 'user' && user?.type === 'admin') {
      router.replace('/admin/users');
    }
  }, [entityParam, user, router]);

  const activeConfig = useMemo(() => {
    if (!selectedEntity) return null;
    return entityConfigs[selectedEntity] ?? entityConfigs.job;
  }, [selectedEntity]);

  const handleChange = (value: EntityKey) => {
    router.push(`/tables?entity=${value}`);
  };

  const filteredOptions = useMemo(() => {
    const isViewer = user?.type === 'admin' || user?.type === 'location-manager';
    if (!isViewer) return entityOptions.filter((opt) => opt.key === 'job');
    // Users now live on the dedicated /admin/users page (with permission
    // management + password reset). Drop the legacy Tables entry for them.
    return entityOptions.filter((opt) => opt.key !== 'user');
  }, [user]);

  const selector = (
    <div className="entity-selector">
      <select
        id="entity-select"
        value={selectedEntity ?? ''}
        onChange={(e) => {
          const val = e.target.value as EntityKey | '';
          if (isEntityKey(val)) handleChange(val);
        }}
        aria-label="Choose entity"
      >
        {!selectedEntity && (
          <option value="" disabled>
            Select entity...
          </option>
        )}
        {filteredOptions.map((opt) => (
          <option key={opt.key} value={opt.key}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    activeConfig ? (
      <EntityTablePage
        key={selectedEntity} // Using string key directly for clarity and natural unmounting
        title={activeConfig.title}
        buildColumns={activeConfig.buildColumns}
        useDataHook={activeConfig.useDataHook}
        renderActions={activeConfig.renderActions}
        topbarAddon={selector}
        renderSummary={selectedEntity === 'job' ? renderJobSummary : undefined}
        hideAddRowButton={activeConfig.hideAddRowButton}
        hideActionsColumn={activeConfig.hideActionsColumn}
      />
    ) : null
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Design 360 S3 — Jobs summary.

   Reads only what the table already holds. No fetch, no query, no state.

   DATA-SHAPE LIMIT, stated honestly on the strip itself: `rowData` is the
   CURRENT PAGE only, so the status split can be counted for the loaded page
   but not for the whole filtered set. `total` is the one figure that is
   accurate across every match. Showing a page-scoped number as if it were
   the total would be worse than showing nothing, so the label says which it
   is. A small aggregate endpoint would remove the caveat entirely.
   ═══════════════════════════════════════════════════════════════════════════ */
function renderJobSummary(data: GenericTableData<JobRow>) {
  const rows = data.rowData ?? [];
  const statusOf = (r: JobRow) => String(r.statusCanonical ?? r.status ?? '').toLowerCase();
  const closed = rows.filter((r) => statusOf(r).includes('clos')).length;
  const cancelled = rows.filter((r) => /cancel/.test(statusOf(r))).length;
  const open = rows.length - closed - cancelled;

  const money = rows.reduce((s, r) => s + (Number(r.totalAmount) || 0), 0);
  const avg = closed > 0 ? money / rows.length : 0;
  const fmt = (n: number) =>
    n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  const filtersOn = (data.activeFilters?.length ?? 0) > 0 || !!data.search;

  return (
    <>
      <SummaryStrip
        items={[
          {
            label: filtersOn ? 'Jobs matching filters' : 'Jobs total',
            value: (data.total ?? rows.length).toLocaleString(),
            sub: filtersOn ? 'across all pages' : undefined,
          },
          { label: 'Closed · this page', value: closed.toLocaleString(), tone: closed ? 'pos' : 'muted' },
          { label: 'Open · this page', value: open.toLocaleString(), tone: open ? 'neg' : 'muted' },
          { label: 'Avg ticket · this page', value: rows.length ? fmt(avg) : undefined },
        ]}
      />
      {data.limitedToFirst50 && (
        <AlertCard
          tone="warn"
          title="Showing the first 50 matches only"
          description="Narrow the filters to see the rest, or export for the complete set."
        />
      )}
    </>
  );
}
