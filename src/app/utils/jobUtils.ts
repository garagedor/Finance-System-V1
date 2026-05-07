import type { JobRow } from '../../types/job';

export const PAGE_SIZE = 50;

export type ColumnConfig<T = JobRow> = {
  key: keyof T;
  label: string;
  type?: 'text' | 'number' | 'currency' | 'boolean' | 'date' | 'multiline' | 'chip' | 'select' | 'password';
  options?: string[];
  editable?: boolean;
  minWidth?: number;
  maxWidth?: number;
};

export const numberFields: Array<keyof JobRow> = [
  'totalAmount',
  'techPaidCash',
  'totalPaidCard',
  'totalPaidCompanyCheck',
  'totalPaidFinance',
  'totalPaidCompanyCash',
  'techParts',
  'companyParts',
  'tipsCard',
  'tipsFinance',
  'tipsCompanyCash',
  'tipsCheck',
];

export const normalizeApprovals = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return Array.from(
      new Set(
        value
          .map((v) => (typeof v === 'string' ? v : String(v)))
          .map((v) => v.trim())
          .filter(Boolean)
      )
    );
  }

  if (typeof value === 'string') {
    return Array.from(
      new Set(
        value
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean)
      )
    );
  }

  return [];
};

export const normalizeDate = (value: unknown): string => {
  if (!value) return '';

  const toYmd = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  if (value instanceof Date) {
    return toYmd(value);
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
    if (iso) return iso[0];
    const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
    if (us) {
      const [, mm, dd, yyyy] = us;
      return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
    }
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
      return toYmd(parsed);
    }
  }

  return '';
};

export const normalizeRow = (row: JobRow): JobRow => ({
  ...row,
  approvals: normalizeApprovals((row as any).approvals),
  date: normalizeDate((row as any).date) || ((row as any).date as any) || '',
});

export const getRowId = (row: JobRow) =>
  String((row as any).__tempId ?? (row as any)._id ?? (row as any).id ?? '');

export const formatCurrency = (value: number | string | undefined) => {
  if (value === undefined || value === null) return '-';
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (Number.isNaN(num)) return '-';
  return `$${num.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
};

export const formatDisplayDate = (value: string | undefined) => {
  if (!value) return '-';

  // Parse the date string (supports YYYY-MM-DD and other ISO formats)
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value; // Return original if invalid

  // Format as MM/DD/YYYY
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const year = date.getFullYear();

  return `${month}/${day}/${year}`;
};
