// The Provider-statistics spreadsheet on the Statistics page is for the owner
// only (owner, 2026-11-02): the CRM user "yehonatan". Checked on the server by
// user id; the page also hides the button from everyone else.
export const STATS_XLSX_OWNER = { id: '6a0161a0c3c7bac5ce75fae3', name: 'yehonatan' } as const;

export const isStatsXlsxOwner = (u: { _id?: string | null; userId?: string | null; name?: string | null } | null | undefined) =>
  !!u && (u._id ?? u.userId) === STATS_XLSX_OWNER.id && u.name === STATS_XLSX_OWNER.name;
