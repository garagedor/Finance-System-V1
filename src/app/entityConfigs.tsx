'use client';

import { useState } from 'react';
import { FiCheck, FiLoader, FiX } from 'react-icons/fi';
import type { ColumnConfig } from '@/app/utils/jobUtils';
import { normalizeApprovals } from '@/app/utils/jobUtils';
import type { EntityTablePageProps, RenderActionsArgs } from '@/components/EntityTable';
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
};

const jobColumns = (data: ReturnType<typeof useJobData>): ColumnConfig<JobRow>[] => [
  { key: 'approvals', label: 'Approvals', type: 'chip', minWidth: 100 },
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
  { key: 'techParts', label: 'Tech Parts', type: 'currency', minWidth: 60 },
  { key: 'companyParts', label: 'Company Parts', type: 'currency', minWidth: 60 },
  { key: 'lmParts', label: 'LM Parts', type: 'currency', minWidth: 60 },
  { key: 'lmCash', label: 'LM Cash', type: 'currency', minWidth: 60 },
  { key: 'lmCheck', label: 'LM Check', type: 'currency', minWidth: 60 },
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

const disputeColumns: ColumnConfig<Dispute>[] = [
  { key: 'jobId', label: 'Job ID', type: 'text', editable: false },
  { key: 'totalDisputed', label: 'Total Disputed', type: 'currency' },
  { key: 'disputeDate', label: 'Dispute Date', type: 'date' },
  { key: 'dueDate', label: 'Due Date', type: 'date' },
  { key: 'status', label: 'Status', type: 'text' },
  { key: 'isTechOffset', label: 'Tech Offset', type: 'boolean' },
  { key: 'isPrOffset', label: 'PR Offset', type: 'boolean' },
];

const refundColumns: ColumnConfig<Refund>[] = [
  { key: 'jobId', label: 'Job ID', type: 'text', editable: false },
  { key: 'refundTotal', label: 'Refund Total', type: 'currency' },
  { key: 'dateRefunded', label: 'Date Refunded', type: 'date' },
  { key: 'dueDate', label: 'Due Date', type: 'date' },
  { key: 'reason', label: 'Reason', type: 'multiline' },
  { key: 'isTechOffset', label: 'Tech Offset', type: 'boolean' },
  { key: 'isPrOffset', label: 'PR Offset', type: 'boolean' },
];
// Proper React component for job actions (allows using hooks)
const JobActionsRow = ({
  row,
  rowId,
  saving,
  defaultActions,
  data,
  user,
}: RenderActionsArgs<JobRow, ReturnType<typeof useJobData>>) => {
  const [showDisputeModal, setShowDisputeModal] = useState(false);

  const approvals = normalizeApprovals((row as any).approvals);
  const alreadyConfirmed = user?.name ? approvals.includes(user.name) : false;
  const hasAdminApproval =
    data.adminNames instanceof Set ? approvals.some((a) => data.adminNames.has(a)) : false;
  const confirmingIds = data.approvalIdsRef?.current ?? data.approvalIds ?? [];
  const confirming = confirmingIds.includes(rowId);
  const canApprove = user?.type === 'admin' || user?.type === 'office';
  const showApproveButton = user?.type === 'admin' || (user?.type === 'office' && !hasAdminApproval);
  const confirmDisabled = confirming || saving || !showApproveButton;
  const canDispute = user?.type === 'admin' || user?.type === 'office';

  return (
    <>
      {showApproveButton && (
        <button
          className={`icon-btn ${alreadyConfirmed ? 'warn' : 'success'}`}
          disabled={confirmDisabled}
          onClick={() => data.confirmRow?.(row)}
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
          className="icon-btn success"
          onClick={() => setShowDisputeModal(true)}
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
    </>
  );
};

// Wrapper function that returns the component
const jobRenderActions = (args: RenderActionsArgs<JobRow, ReturnType<typeof useJobData>>) => (
  <JobActionsRow {...args} />
);

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
    renderActions: jobRenderActions,
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
