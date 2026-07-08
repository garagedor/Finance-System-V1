'use client';

import { useState } from 'react';
import { FiCheck, FiLoader, FiX } from 'react-icons/fi';
import type { ColumnConfig } from '@/app/utils/jobUtils';
import { getRowId, normalizeApprovals } from '@/app/utils/jobUtils';
import type { EntityTablePageProps } from '@/components/EntityTable';
import { DisputeRefundModal } from '@/components/DisputeRefundModal';
import { useDisputeData } from '@/app/utils/useDisputeData';
import { useJobData } from '@/app/utils/useJobData';
import { useJobStatusData } from '@/app/utils/useJobStatusData';
import { useLocationData } from '@/app/utils/useLocationData';
import { useProviderData } from '@/app/utils/useProviderData';
import { useRefundData } from '@/app/utils/useRefundData';
import { useTechData } from '@/app/utils/useTechData';
import { useUserData } from '@/app/utils/useUserData';
import type { Dispute, JobRow, JobStatus, Location, Provider, Refund, Technician } from '@/types/job';
import type { User } from '@/types/user';
import { FiPlus } from 'react-icons/fi';

export type EntityKey =
  | 'job'
  | 'refund'
  | 'dispute'
  | 'location'
  | 'provider'
  | 'tech'
  | 'job-status'
  | 'user';

type EntityConfig = {
  key: EntityKey;
  label: string;
  title: string;
  buildColumns: (data: any) => ColumnConfig<any>[];
  // keep hook/render loosely typed to allow entities with richer data than the base table shape
  useDataHook: (
    user: any,
    setSnackbar: (value: any) => void,
    sortBy: any,
    sortDir: 'asc' | 'desc'
  ) => any;
  renderActions?: EntityTablePageProps<any, any>['renderActions'];
  hideAddRowButton?: boolean;
  hideActionsColumn?: boolean;
};

// Approvals cell: chip showing existing approvers + ALL row actions inline
// (approve/unapprove toggle, create dispute, edit, delete). Used to render
// these as the right-side actions column; they now sit next to the chip so
// every interactive bit of the row lives on the left under "Approvals".
const ApprovalsCell = ({
  row, value, data, user, defaultActions,
}: {
  row: JobRow; value: unknown; data: any; user: any; defaultActions: React.ReactNode;
}) => {
  const [showDisputeModal, setShowDisputeModal] = useState(false);

  const approvals = normalizeApprovals(value);
  const adminNames: Set<string> = data?.adminNames instanceof Set ? data.adminNames : new Set();
  const officeNames: Set<string> = data?.officeNames instanceof Set ? data.officeNames : new Set();
  const hasAdmin = approvals.some((a) => adminNames.has(a));
  const hasOffice = approvals.some((a) => officeNames.has(a));
  const approvalStyle: React.CSSProperties = hasAdmin
    ? { background: 'rgba(16,185,129,0.15)', color: '#34d399', padding: '2px 7px', borderRadius: '6px' }
    : hasOffice
      ? { background: 'rgba(245,158,11,0.15)', color: '#fbbf24', padding: '2px 7px', borderRadius: '6px' }
      : { background: 'rgba(255,255,255,0.08)', color: '#94a3b8', padding: '2px 7px', borderRadius: '6px' };

  const alreadyConfirmed = user?.name ? approvals.includes(user.name) : false;
  const hasAdminApproval = approvals.some((a) => adminNames.has(a));
  const rowId = getRowId(row);
  const confirmingIds: string[] = data?.approvalIdsRef?.current ?? data?.approvalIds ?? [];
  const confirming = confirmingIds.includes(rowId);
  const savingIds: string[] = data?.savingIdsRef?.current ?? [];
  const saving = savingIds.includes(rowId);
  const showApproveButton = user?.type === 'admin' || (user?.type === 'office' && !hasAdminApproval);
  const confirmDisabled = confirming || saving || !showApproveButton;
  const canDispute = user?.type === 'admin' || user?.type === 'office';

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
      {approvals.length > 0 && (
        <span className="approval-text" title={approvals.join(', ')} style={approvalStyle}>
          {approvals.join(', ')}
        </span>
      )}
      {showApproveButton && (
        <button
          type="button"
          className={`icon-btn ${alreadyConfirmed ? 'warn' : 'success'}`}
          disabled={confirmDisabled}
          onClick={(e) => { e.stopPropagation(); data.confirmRow?.(row); }}
          title={
            confirmDisabled
              ? 'Save the row before confirming'
              : alreadyConfirmed
                ? 'Remove my approval'
                : 'Confirm this row'
          }
          aria-label={alreadyConfirmed ? 'Unconfirm row' : 'Confirm row'}
        >
          {confirming ? <FiLoader className="spin" /> : alreadyConfirmed ? <FiX /> : <FiCheck />}
        </button>
      )}
      {canDispute && (
        <button
          type="button"
          className="icon-btn success"
          onClick={(e) => { e.stopPropagation(); setShowDisputeModal(true); }}
          title="Create Dispute or Refund"
          aria-label="Create Dispute or Refund"
        >
          <FiPlus />
        </button>
      )}
      {defaultActions}
      {showDisputeModal && (
        <DisputeRefundModal
          jobId={rowId}
          onClose={() => setShowDisputeModal(false)}
        />
      )}
    </span>
  );
};

const renderApprovalsCell = (args: {
  row: JobRow; value: unknown; data: any; user: any; defaultActions: React.ReactNode;
}) => <ApprovalsCell {...args} />;

const jobColumns = (data: ReturnType<typeof useJobData>): ColumnConfig<JobRow>[] => [
  { key: 'approvals', label: 'Approvals', type: 'chip', minWidth: 220, renderCell: renderApprovalsCell },
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
  { key: '_id', label: 'ID', type: 'text', minWidth: 100, editable: false },
];

const locationColumns = (data: any): ColumnConfig<Location>[] => [
  { key: '_id', label: 'Location', type: 'text' },
  { key: 'managerProfitPercent', label: 'Manager %', type: 'number' },
  {
    key: 'technician',
    label: 'Technician',
    type: 'select',
    options: (data.lookups?.techs ?? []).map((t: any) => t._id ?? ''),
  },
];

const providerColumns: ColumnConfig<Provider>[] = [
  { key: '_id', label: 'Provider', type: 'text' },
  { key: 'initials', label: 'Initials', type: 'text' },
  { key: 'profitPercent', label: 'Profit %', type: 'number' },
];

const techColumns = (data: any): ColumnConfig<Technician>[] => [
  { key: '_id', label: 'Tech', type: 'text' },
  { key: 'profitPercent', label: 'Profit %', type: 'number' },
  {
    key: 'location',
    label: 'Location',
    type: 'select',
    options: (data.lookups?.locations ?? []).map((l: any) => l._id ?? ''),
  },
];

const jobStatusColumns: ColumnConfig<JobStatus>[] = [{ key: '_id', label: 'Status', type: 'text' }];

const userColumns: ColumnConfig<User>[] = [
  { key: 'name', label: 'Name', type: 'text' },
  { key: 'password', label: 'Password', type: 'password' },
  { key: 'type', label: 'Type', type: 'select', options: ['admin', 'office', 'location-manager', 'simple'] },
];

// Dispute status pipeline — concrete options so the picker doesn't allow typos.
const DISPUTE_STATUS_OPTIONS = ['in review', 'open', 'partial', 'won', 'lost', 'settled', 'closed'];

const dash = () => <span style={{ color: '#94a3b8' }}>—</span>;
const money = (n?: number) => (n != null ? `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}` : null);

// Column order matches the operations spreadsheet. Every column is editable:
// the user can override any Job-derived value per-dispute (overrides are
// stored on the Dispute doc and take precedence over Job lookup on read).
const disputeColumns: ColumnConfig<Dispute>[] = [
  {
    key: 'jobAddress', label: 'Address', type: 'text', editable: true,
    renderCell: ({ row }) => {
      const r = row as Dispute;
      return (
        <div style={{ fontSize: 12, lineHeight: 1.35 }}>
          <div style={{ fontWeight: 500 }}>{r.jobAddress ?? dash()}</div>
          <div style={{ color: '#94a3b8', fontFamily: 'ui-monospace, SF Mono, monospace', fontSize: 10 }}>
            {r.jobId?.slice(0, 10) ?? '—'}
          </div>
        </div>
      );
    },
  },
  { key: 'jobCustomerName', label: 'Name', type: 'text', editable: true },
  { key: 'jobPhoneNumber',  label: 'Phone Number', type: 'text', editable: true },
  {
    key: 'jobTechFullName', label: 'Tech Name', type: 'text', editable: true,
    renderCell: ({ row }) => {
      const r = row as Dispute;
      const full = r.jobTechFullName;
      const short = r.jobTech;
      if (!full && !short) return dash();
      return (
        <span style={{ fontSize: 12 }}>
          {full ?? short}
          {full && short && full !== short && (
            <span style={{ color: '#94a3b8', marginLeft: 6, fontSize: 10 }}>({short})</span>
          )}
        </span>
      );
    },
  },
  { key: 'jobProvider',        label: 'Provider', type: 'text', editable: true },
  { key: 'jobLocationManager', label: 'Location Manager', type: 'text', editable: true },
  { key: 'jobTotalInclTip',    label: 'Jo. Total inc Tip', type: 'currency', editable: true },
  { key: 'totalDisputed',      label: 'Money Disputed', type: 'currency', editable: true },
  { key: 'jobPartsTotal',      label: 'Parts', type: 'currency', editable: true },
  { key: 'jobTipsTotal',       label: 'Tip', type: 'currency', editable: true },
  { key: 'status',             label: 'Status', type: 'select', options: DISPUTE_STATUS_OPTIONS, editable: true },
  { key: 'jobDate',            label: 'Job Date', type: 'text', editable: true },
  { key: 'dateLost',           label: 'Date Lost', type: 'date', editable: true },
  { key: 'messageFound',       label: 'Message Found', type: 'multiline', editable: true },
  { key: 'isTechOffset',       label: 'Taken Tech', type: 'boolean', editable: true },
  { key: 'isPrOffset',         label: 'Taken PR', type: 'boolean', editable: true },
  { key: 'isDeposit',          label: 'Is Deposit', type: 'boolean', editable: true },
];

const refundColumns: ColumnConfig<Refund>[] = [
  {
    key: 'jobAddress',
    label: 'Job',
    type: 'text',
    editable: false,
    renderCell: ({ row }) => {
      const r = row as Refund;
      return (
        <div style={{ fontSize: 12, lineHeight: 1.35 }}>
          <div style={{ fontWeight: 500 }}>{r.jobAddress ?? <span style={{ color: '#94a3b8' }}>—</span>}</div>
          <div style={{ color: '#94a3b8', fontFamily: 'ui-monospace, SF Mono, monospace', fontSize: 10 }}>
            {r.jobId?.slice(0, 10) ?? '—'}
          </div>
        </div>
      );
    },
  },
  { key: 'jobDate',     label: 'Job Date', type: 'text', editable: false },
  {
    key: 'jobTech',
    label: 'Tech / Area',
    type: 'text',
    editable: false,
    renderCell: ({ row }) => {
      const r = row as Refund;
      if (!r.jobTech && !r.jobLocation) return <span style={{ color: '#94a3b8' }}>—</span>;
      return (
        <span style={{ fontSize: 12 }}>
          {r.jobTech ?? '—'} {r.jobLocation ? <span style={{ color: '#94a3b8' }}>· {r.jobLocation}</span> : null}
        </span>
      );
    },
  },
  { key: 'jobProvider', label: 'Provider', type: 'text', editable: false },
  { key: 'jobTotalAmount', label: 'Job Total', type: 'currency', editable: false },
  { key: 'refundTotal', label: 'Refund Total', type: 'currency' },
  { key: 'dateRefunded', label: 'Date Refunded', type: 'date' },
  { key: 'dueDate', label: 'Due Date', type: 'date' },
  { key: 'reason', label: 'Reason', type: 'multiline' },
  { key: 'isTechOffset', label: 'Tech Offset', type: 'boolean' },
  { key: 'isPrOffset', label: 'PR Offset', type: 'boolean' },
];
export const entityOrder: EntityKey[] = [
  'job',
  'refund',
  'dispute',
  'location',
  'provider',
  'tech',
  'job-status',
  'user',
];

export const entityConfigs: Record<EntityKey, EntityConfig> = {
  job: {
    key: 'job',
    label: 'Jobs',
    title: 'Jobs Table',
    buildColumns: jobColumns,
    useDataHook: useJobData,
    // All row actions (approve, dispute, edit, delete) render inline inside
    // the Approvals cell via ApprovalsCell — the right-side actions column
    // is suppressed entirely for Jobs.
    hideActionsColumn: true,
  },
  refund: {
    key: 'refund',
    label: 'Refunds',
    title: 'Refund Table',
    buildColumns: () => refundColumns,
    useDataHook: useRefundData,
    hideAddRowButton: true,
  },
  dispute: {
    key: 'dispute',
    label: 'Disputes',
    title: 'Dispute Table',
    buildColumns: () => disputeColumns,
    useDataHook: useDisputeData,
    hideAddRowButton: true,
  },
  location: {
    key: 'location',
    label: 'Locations',
    title: 'Location Table',
    buildColumns: locationColumns,
    useDataHook: useLocationData,
  },
  provider: {
    key: 'provider',
    label: 'Providers',
    title: 'Provider Table',
    buildColumns: () => providerColumns,
    useDataHook: useProviderData,
  },
  tech: {
    key: 'tech',
    label: 'Technicians',
    title: 'Technician Table',
    buildColumns: techColumns,
    useDataHook: useTechData,
  },
  'job-status': {
    key: 'job-status',
    label: 'Job Statuses',
    title: 'Job Status Table',
    buildColumns: () => jobStatusColumns,
    useDataHook: useJobStatusData,
  },
  user: {
    key: 'user',
    label: 'Users',
    title: 'Users Table',
    buildColumns: () => userColumns,
    useDataHook: useUserData,
  },
};

export const entityOptions = entityOrder.map((key) => ({
  key,
  label: entityConfigs[key].label,
}));

export const isEntityKey = (value: string | null | undefined): value is EntityKey =>
  Boolean(value) && entityOrder.includes(value as EntityKey);
