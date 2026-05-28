'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { EntityTablePage } from '@/components/EntityTable';
import { entityConfigs, entityOptions, type EntityKey, isEntityKey } from '../entityConfigs';
import { useAuth } from '@/components/AuthShell';

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
        hideAddRowButton={activeConfig.hideAddRowButton}
        hideActionsColumn={activeConfig.hideActionsColumn}
      />
    ) : null
  );
}
