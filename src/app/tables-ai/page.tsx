'use client';

import { useState } from 'react';
import { EntityTablePage } from '@/components/EntityTable';
import { useAiJobData } from '@/app/utils/useAiJobData';
import { aiJobColumns } from './columns';
import { CompareView } from './CompareView';

type Tab = 'table' | 'compare';

export default function TablesAiPage() {
  const [tab, setTab] = useState<Tab>('table');

  return (
    <div style={{ padding: '0 0 40px' }}>
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
          borderBottom: '1px solid rgba(255,255,255,0.08)', flexWrap: 'wrap',
        }}
      >
        <span style={{ fontWeight: 600 }}>Tables AI</span>
        <span
          style={{
            fontSize: 11, padding: '2px 8px', borderRadius: 6,
            background: 'rgba(99,102,241,0.15)', color: '#a5b4fc',
          }}
          title="Isolated bot sandbox. Reads/writes ag.Job_ai only — never production ag.Job."
        >
          isolated bot sandbox · ag.Job_ai
        </span>
        <div style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6 }}>
          <TabBtn active={tab === 'table'} onClick={() => setTab('table')}>Table</TabBtn>
          <TabBtn active={tab === 'compare'} onClick={() => setTab('compare')}>Compare / QA</TabBtn>
        </div>
      </div>

      {tab === 'table' ? (
        <EntityTablePage
          key="ai-job"
          title="Tables AI — Jobs (bot)"
          buildColumns={aiJobColumns}
          useDataHook={useAiJobData}
        />
      ) : (
        <CompareView />
      )}
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '6px 12px', borderRadius: 8, fontSize: 13, cursor: 'pointer',
        border: '1px solid rgba(255,255,255,0.12)',
        background: active ? 'rgba(99,102,241,0.25)' : 'transparent',
        color: active ? '#c7d2fe' : '#94a3b8',
      }}
    >
      {children}
    </button>
  );
}
