export type Program = { code: string; name: string };
export type FundingEligibility = {
  eligible_programs: string[];
  eligible_suppliers: string[];
  eligible_purchase_types: string[];
};
export type Funding = Partial<FundingEligibility> & {
  eligible_purchase_type: string | null;
  carry_eligible: boolean;
  carry_prohibited?: boolean;
  carried_in_cents: number;
  carried_out_cents: number;
  capacity_cents: number;
  organization: string;
  source_type: string;
  recurring: boolean;
  expected_date: string | null;
  notes: string;
  id: number;
  name: string;
  academic_year: string;
  kind: 'cash' | 'credit';
  expected_cents: number;
  received_cents: number;
  remaining_cents: number;
  unallocated_cents: number;
  expiry: string | null;
  eligible_program: string | null;
  eligible_supplier: string | null;
};
export type Budget = {
  id: number;
  funding_id: number;
  funding_name: string;
  program_code: string;
  academic_year: string;
  kind: string;
  cents: number;
  remaining: number;
  expiry: string | null;
};
export type Transaction = {
  original_id: number | null;
  replacement_id: number | null;
  status: 'confirmed' | 'voided';
  void_reason: string | null;
  voided_at: string | null;
  id: number;
  purchase_date: string;
  supplier: string;
  purchase_type: string;
  description: string;
  cents: number;
  allocations: {
    budget_id: number;
    program: string;
    funding: string;
    kind: string;
    academic_year: string;
    cents: number;
  }[];
};
export type Dashboard = {
  funding: {
    kind: string;
    received: number;
    expected: number;
    spent: number;
    carried_in: number;
    carried_out: number;
    capacity: number;
  }[];
  programs: { program_code: string; allocated: number; spent: number }[];
  pending?: { count: number; cents: number };
};
export type Api = <T>(path: string, method?: string, body?: unknown, format?: 'blob') => Promise<T>;
export function makeApi(): Api {
  return async <T>(path: string, method = 'GET', body?: unknown, format?: 'blob'): Promise<T> => {
    const response = await fetch('/api' + path, {
      method,
      headers: { 'X-ASUFC-Request': '1', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
      credentials: 'same-origin',
    });
    if (!response.ok) {
      const error = await response.json().catch(() => null);
      throw new Error(
        typeof error?.detail === 'string'
          ? error.detail
          : response.status === 401
            ? 'Staff session expired or invalid credentials'
            : 'Request failed (' + response.status + ')',
      );
    }
    return (format === 'blob' ? response.blob() : response.json()) as Promise<T>;
  };
}
export function cents(value: string): number {
  if (!/^\d+(\.\d{1,2})?$/.test(value))
    throw new Error('Enter a valid dollar amount with at most two decimal places.');
  const [whole, fraction = ''] = value.split('.');
  const n = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(n) || n > 1e12) throw new Error('Amount is too large.');
  return n;
}
export const money = (n: number) =>
  new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(n / 100);

export type AuditEvent = {
  id: number;
  actor: string;
  action: string;
  entity: string;
  entity_id: number;
  details: unknown;
  created_at: string;
};

export async function downloadReport(api: Api, path: string, filename = 'asufc-spending.xlsx') {
  // Use the same authenticated request path, but request a binary response.
  const blob = await api<Blob>(path, 'GET', undefined, 'blob');
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export type FundingReceipt = {
  id: number;
  funding_id: number;
  cents: number;
  received_on: string | null;
  recorded_at: string;
  actor: string;
};

export type AcademicPeriod = {
  id: number;
  academic_year: string;
  starts_on: string;
  ends_on: string;
  semesters: { id: number; name: string; starts_on: string; ends_on: string }[];
};

export type FundingTransfer = {
  reversed: boolean;
  reversal_reason: string | null;
  id: number;
  source_id: number;
  destination_id: number;
  cents: number;
  reason: string;
  source_year: string;
  destination_year: string;
  funding_name: string;
  kind: string;
  created_at: string;
};
