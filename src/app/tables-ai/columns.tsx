'use client';

import type { ColumnConfig } from '@/app/utils/jobUtils';
import type { JobRow } from '@/types/job';
import type { UseAiJobDataReturn } from '@/app/utils/useAiJobData';

// Column set for the Tables AI (bot) job table. Deliberately reuses the EXACT
// same field columns, types, and shared lookups as the production Tables job
// entity (see entityConfigs.tsx `jobColumns`) — same statuses, techs,
// locations, providers — so it is a faithful mirror. It intentionally OMITS the
// production "Approvals / create-dispute" action cell, because those actions
// write to production collections and Tables AI must never touch production.
// It ADDS read-only provenance columns.
export const aiJobColumns = (data: UseAiJobDataReturn): ColumnConfig<JobRow>[] => [
  { key: 'invoiceNumber', label: 'Invoice #', type: 'text', minWidth: 130 },
  { key: 'clientName', label: 'Client Name', type: 'text' },
  { key: 'tech', label: 'Tech', type: 'select', options: data.lookups.techs.map((t) => t._id ?? ''), minWidth: 80 },
  { key: 'status', label: 'Status', type: 'select', options: data.lookups.statuses.map((s) => s._id ?? '') },
  { key: 'date', label: 'Date', type: 'date' },
  { key: 'address', label: 'Address', type: 'text' },
  { key: 'location', label: 'Location', type: 'select', options: data.lookups.locations.map((l) => l._id ?? '') },
  { key: 'techPaidCash', label: 'Tech Paid Cash', type: 'currency', minWidth: 60 },
  { key: 'totalPaidCard', label: 'Paid Card', type: 'currency', minWidth: 60 },
  { key: 'totalPaidCompanyCheck', label: 'Paid Company Check', type: 'currency', minWidth: 60 },
  { key: 'totalPaidFinance', label: 'Paid Finance', type: 'currency', minWidth: 60 },
  { key: 'totalPaidCompanyCash', label: 'Paid Company Cash', type: 'currency', minWidth: 60 },
  { key: 'lmCash', label: 'Paid LM Cash', type: 'currency', minWidth: 60 },
  { key: 'lmCheck', label: 'Paid LM Check', type: 'currency', minWidth: 60 },
  { key: 'techParts', label: 'Tech Parts', type: 'currency', minWidth: 60 },
  { key: 'companyParts', label: 'Company Parts', type: 'currency', minWidth: 60 },
  { key: 'lmParts', label: 'LM Parts', type: 'currency', minWidth: 60 },
  { key: 'provider', label: 'Provider', type: 'select', options: data.lookups.providers.map((p) => p._id ?? '') },
  { key: 'tipsCard', label: 'Tips Card', type: 'currency', minWidth: 60 },
  { key: 'tipsFinance', label: 'Tips Finance', type: 'currency', minWidth: 60 },
  { key: 'tipsCompanyCash', label: 'Tips Company Cash', type: 'currency', minWidth: 60 },
  { key: 'tipsCheck', label: 'Tips Check', type: 'currency', minWidth: 60 },
  { key: 'clientPhoneNumber', label: 'Client Phone', type: 'text' },
  { key: 'notes', label: 'Notes', type: 'multiline' },
  { key: 'needTracking', label: 'Need Tracking', type: 'boolean' },
  // ── Read-only provenance (bot origin + human-edit marker) ──
  {
    key: 'aiSource' as keyof JobRow,
    label: 'AI Source',
    type: 'text',
    editable: false,
    minWidth: 90,
    renderCell: ({ row }: { row: JobRow }) => <>{(row as any).aiMeta?.source ?? ''}</>,
  },
  {
    key: 'aiEvent' as keyof JobRow,
    label: 'AI Event',
    type: 'text',
    editable: false,
    minWidth: 80,
    renderCell: ({ row }: { row: JobRow }) => <>{(row as any).aiMeta?.eventType ?? ''}</>,
  },
  {
    key: 'aiEdited' as keyof JobRow,
    label: 'Edited',
    type: 'text',
    editable: false,
    minWidth: 90,
    renderCell: ({ row }: { row: JobRow }) => <>{(row as any).aiLastEditedBy ? `✎ ${(row as any).aiLastEditedBy}` : ''}</>,
  },
  { key: '_id', label: 'ID', type: 'text', minWidth: 100, editable: false },
];
