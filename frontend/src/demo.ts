// Public demonstration only. All state is fictional, in-memory and reset on reload.
import type {
  Api,
  Program,
  Funding,
  Budget,
  Transaction,
  AcademicPeriod,
  AuditEvent,
  FundingReceipt,
  Dashboard,
} from './api';
type PurchaseInput = {
  purchase_date: string;
  supplier: string;
  purchase_type: string;
  description: string;
  cents: number;
  duplicate_reason?: string;
  allocations: { budget_id: number; cents: number }[];
};
type Row = { label: string; cash_cents: number; credit_cents: number };
const YEAR = '2026-2027';
const fail = (s: string): never => {
  throw new Error(s);
};
const positive = (n: number) => Number.isSafeInteger(n) && n > 0 && n <= 1e12;
const yearValid = (y: string) => /^\d{4}-\d{4}$/.test(y) && Number(y.slice(5)) === Number(y.slice(0, 4)) + 1;
export function makeDemoApi(): Api {
  let signed = false,
    nextId = 100;
  const programs: Program[] = [
    { code: 'ASUFCGR', name: 'General Restocks' },
    { code: 'ASUFCFSBP', name: 'Foodsharing Breakfast Program' },
    { code: 'ASUFCE&W', name: 'Events & Workshops' },
    { code: 'ASUFCSIR', name: 'Specialty Item Restocks' },
  ];
  const seed = (
    id: number,
    name: string,
    kind: 'cash' | 'credit',
    expected: number,
    received: number,
  ): Funding => ({
    id,
    name,
    kind,
    academic_year: YEAR,
    expected_cents: expected,
    received_cents: received,
    remaining_cents: received,
    unallocated_cents: received,
    capacity_cents: received,
    eligible_purchase_type: null,
    carry_eligible: false,
    carried_in_cents: 0,
    carried_out_cents: 0,
    organization: 'Fictional demonstration',
    source_type: 'Demo',
    recurring: false,
    expected_date: null,
    notes: 'Synthetic example only',
    expiry: null,
    eligible_program: null,
    eligible_supplier: null,
  });
  const funding: Funding[] = [
    seed(1, 'Demo university funding', 'cash', 1000000, 1000000),
    seed(2, 'Demo community grant', 'cash', 500000, 300000),
    seed(3, 'Demo purchasing credit', 'credit', 300000, 300000),
  ];
  const budgets: Budget[] = [
    {
      id: 1,
      funding_id: 1,
      funding_name: funding[0].name,
      program_code: 'ASUFCGR',
      academic_year: YEAR,
      kind: 'cash',
      cents: 400000,
      remaining: 400000,
      expiry: null,
    },
    {
      id: 2,
      funding_id: 2,
      funding_name: funding[1].name,
      program_code: 'ASUFCFSBP',
      academic_year: YEAR,
      kind: 'cash',
      cents: 250000,
      remaining: 250000,
      expiry: null,
    },
    {
      id: 3,
      funding_id: 3,
      funding_name: funding[2].name,
      program_code: 'ASUFCGR',
      academic_year: YEAR,
      kind: 'credit',
      cents: 200000,
      remaining: 200000,
      expiry: null,
    },
  ];
  const transactions: Transaction[] = [
    {
      id: 1,
      purchase_date: '2026-09-15',
      supplier: 'Demo Grocery',
      purchase_type: 'Groceries',
      description: 'Fictional restock',
      cents: 25000,
      status: 'confirmed',
      original_id: null,
      replacement_id: null,
      void_reason: null,
      voided_at: null,
      allocations: [
        {
          budget_id: 1,
          program: 'ASUFCGR',
          funding: funding[0].name,
          kind: 'cash',
          academic_year: YEAR,
          cents: 25000,
        },
      ],
    },
  ];
  const periods: AcademicPeriod[] = [
    {
      id: 1,
      academic_year: YEAR,
      starts_on: '2026-09-01',
      ends_on: '2027-08-31',
      semesters: [
        { id: 2, name: 'Fall', starts_on: '2026-09-01', ends_on: '2026-12-31' },
        { id: 3, name: 'Winter', starts_on: '2027-01-01', ends_on: '2027-04-30' },
      ],
    },
  ];
  const receipts: FundingReceipt[] = funding.map((f) => ({
    id: f.id,
    funding_id: f.id,
    cents: f.received_cents,
    received_on: '2026-09-01',
    recorded_at: '2026-09-01T12:00:00Z',
    actor: 'demo',
  }));
  const audit: AuditEvent[] = [];
  const log = (action: string, entity: string, id: number, details: unknown) =>
    audit.unshift({
      id: nextId++,
      actor: 'demo',
      action,
      entity,
      entity_id: id,
      details,
      created_at: new Date().toISOString(),
    });
  const active = () => transactions.filter((t) => t.status === 'confirmed');
  const spent = (id: number) =>
    active()
      .flatMap((t) => t.allocations)
      .filter((a) => a.budget_id === id)
      .reduce((s, a) => s + a.cents, 0);
  const budgetRows = () => budgets.map((b) => ({ ...b, remaining: b.cents - spent(b.id) }));
  const fundRows = () =>
    funding.map((f) => {
      const bs = budgets.filter((b) => b.funding_id === f.id);
      return {
        ...f,
        capacity_cents: f.received_cents,
        remaining_cents: f.received_cents - bs.reduce((s, b) => s + spent(b.id), 0),
        unallocated_cents: f.received_cents - bs.reduce((s, b) => s + b.cents, 0),
      };
    });
  const findFund = (id: number) => funding.find((f) => f.id === id) || fail('Unknown demo funding');
  const findBudget = (id: number) => budgetRows().find((b) => b.id === id) || fail('Unknown demo budget');
  const purchase = (p: PurchaseInput): Transaction => {
    if (
      !positive(p.cents) ||
      !p.supplier.trim() ||
      !p.purchase_type.trim() ||
      !p.allocations.length ||
      p.allocations.reduce((s, a) => s + a.cents, 0) !== p.cents ||
      new Set(p.allocations.map((a) => a.budget_id)).size !== p.allocations.length
    )
      fail('Allocations must match the positive purchase total');
    const allocations = p.allocations.map((a) => {
      const b = findBudget(a.budget_id),
        f = findFund(b.funding_id);
      const period = periods.find((y) => y.academic_year === b.academic_year);
      if (!positive(a.cents) || a.cents > b.remaining) fail('Insufficient budget');
      if (period && (p.purchase_date < period.starts_on || p.purchase_date > period.ends_on))
        fail('Purchase date outside academic year');
      if (f.expiry && p.purchase_date > f.expiry) fail('Funding expired');
      if (f.eligible_supplier && f.eligible_supplier.toLowerCase() !== p.supplier.toLowerCase())
        fail('Supplier not eligible');
      if (
        f.eligible_purchase_type &&
        f.eligible_purchase_type.toLowerCase() !== p.purchase_type.toLowerCase()
      )
        fail('Purchase type not eligible');
      return {
        budget_id: b.id,
        program: b.program_code,
        funding: f.name,
        kind: f.kind,
        academic_year: b.academic_year,
        cents: a.cents,
      };
    });
    if (new Set(allocations.map((a) => a.academic_year)).size !== 1)
      fail('Cannot split across academic years');
    if (
      active().some(
        (t) =>
          t.purchase_date === p.purchase_date &&
          t.supplier.trim().toLowerCase() === p.supplier.trim().toLowerCase() &&
          t.cents === p.cents,
      ) &&
      !p.duplicate_reason?.trim()
    )
      fail('Possible duplicate; enter a review reason');
    const t: Transaction = {
      id: nextId++,
      purchase_date: p.purchase_date,
      supplier: p.supplier,
      purchase_type: p.purchase_type,
      description: p.description || '',
      cents: p.cents,
      allocations,
      status: 'confirmed',
      original_id: null,
      replacement_id: null,
      void_reason: null,
      voided_at: null,
    };
    transactions.unshift(t);
    log('created', 'purchase', t.id, t);
    return t;
  };
  const report = (q: URLSearchParams) => {
    const groups: Record<string, Map<string, Row>> = {
      month: new Map(),
      program: new Map(),
      supplier: new Map(),
      funding: new Map(),
    };
    const totals = { cash_cents: 0, credit_cents: 0 };
    const ids = new Set<number>();
    for (const t of active())
      for (const a of t.allocations) {
        const b = findBudget(a.budget_id);
        if (
          a.academic_year !== (q.get('year') || YEAR) ||
          (q.get('start') && t.purchase_date < q.get('start')!) ||
          (q.get('end') && t.purchase_date > q.get('end')!) ||
          (q.get('program') && a.program !== q.get('program')) ||
          (q.get('supplier') && t.supplier.toLowerCase() !== q.get('supplier')!.toLowerCase()) ||
          (q.get('funding_id') && String(b.funding_id) !== q.get('funding_id')) ||
          (q.get('purchase_type') && t.purchase_type.toLowerCase() !== q.get('purchase_type')!.toLowerCase())
        )
          continue;
        const key = a.kind === 'cash' ? 'cash_cents' : 'credit_cents';
        totals[key] += a.cents;
        ids.add(t.id);
        for (const [g, label] of Object.entries({
          month: t.purchase_date.slice(0, 7),
          program: a.program,
          supplier: t.supplier,
          funding: b.funding_id + ' · ' + a.funding,
        })) {
          const map = groups[g],
            r = map.get(label) || { label, cash_cents: 0, credit_cents: 0 };
          r[key] += a.cents;
          map.set(label, r);
        }
      }
    return {
      totals,
      purchase_count: ids.size,
      ...Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, [...v.values()]])),
    };
  };
  return async <T>(path: string, method = 'GET', body?: unknown, format?: 'blob'): Promise<T> => {
    const url = new URL(path, 'https://demo.invalid'),
      p = url.pathname,
      q = url.searchParams,
      y = q.get('year') || YEAR;
    const b = body as Record<string, any>; // Isolated mock transport, never sends a request.
    let out: unknown;
    if (p === '/auth/session') {
      if (!signed) fail('Enter the public demonstration');
      out = { username: 'demo' };
    } else if (p === '/auth/login') {
      if (b.username !== 'demo' || b.password !== 'demo') fail('Use the public demo credentials');
      signed = true;
      out = { username: 'demo' };
    } else if (p === '/auth/logout') {
      signed = false;
      out = { ok: true };
    } else {
      if (!signed) fail('Enter the public demonstration');
      if (
        format === 'blob' ||
        p.startsWith('/imports/') ||
        p === '/auth/password' ||
        p.includes('/carry-') ||
        p.includes('/funding-transfers/') ||
        p.includes('/semesters') ||
        p.startsWith('/academic-years/')
      )
        fail('This operation requires the real backend; unavailable in the public demo.');
      if (method === 'GET') {
        if (p === '/programs') out = programs;
        else if (p === '/funding') out = fundRows();
        else if (p === '/budgets') out = budgetRows();
        else if (p === '/transactions') out = transactions;
        else if (p === '/audit') out = audit;
        else if (p === '/academic-years') out = periods;
        else if (p === '/funding-transfers') out = [];
        else if (/^\/funding\/\d+\/receipts$/.test(p))
          out = receipts.filter((r) => r.funding_id === Number(p.split('/')[2]));
        else if (p === '/dashboard') {
          const fs = fundRows().filter((f) => f.academic_year === y),
            bs = budgetRows().filter((b) => b.academic_year === y);
          const dashboard: Dashboard = {
            funding: ['cash', 'credit'].map((kind) => {
              const a = fs.filter((f) => f.kind === kind);
              return {
                kind,
                received: a.reduce((s, f) => s + f.received_cents, 0),
                expected: a.reduce((s, f) => s + f.expected_cents - f.received_cents, 0),
                spent: a.reduce((s, f) => s + f.capacity_cents - f.remaining_cents, 0),
                carried_in: 0,
                carried_out: 0,
                capacity: a.reduce((s, f) => s + f.capacity_cents, 0),
              };
            }),
            programs: programs
              .filter((p) => bs.some((b) => b.program_code === p.code))
              .map((p) => {
                const a = bs.filter((b) => b.program_code === p.code);
                return {
                  program_code: p.code,
                  allocated: a.reduce((s, b) => s + b.cents, 0),
                  spent: a.reduce((s, b) => s + b.cents - b.remaining, 0),
                };
              }),
          };
          out = dashboard;
        } else if (p === '/reports/spending') out = report(q);
        else if (p === '/reports/reconciliation')
          out = {
            year: y,
            ok: true,
            issues: [],
            funding: fundRows()
              .filter((f) => f.academic_year === y)
              .map((f) => ({
                ...f,
                allocated_cents: f.capacity_cents - f.unallocated_cents,
                spent_cents: f.capacity_cents - f.remaining_cents,
              })),
            budgets: budgetRows()
              .filter((b) => b.academic_year === y)
              .map((b) => ({
                ...b,
                allocated_cents: b.cents,
                spent_cents: b.cents - b.remaining,
                remaining_cents: b.remaining,
              })),
          };
        else fail('Unavailable in public demo');
      } else if (p === '/programs' && method === 'POST') {
        if (!/^[A-Z0-9&_-]{2,40}$/.test(b.code) || !b.name.trim() || programs.some((p) => p.code === b.code))
          fail('Invalid or duplicate program');
        programs.push({ code: b.code, name: b.name });
        out = programs.at(-1);
        log('created', 'program', 0, out);
      } else if (p === '/funding' && method === 'POST') {
        if (
          !b.name.trim() ||
          !yearValid(b.academic_year) ||
          !Number.isSafeInteger(b.expected_cents) ||
          !Number.isSafeInteger(b.received_cents) ||
          b.received_cents < 0 ||
          b.expected_cents < b.received_cents ||
          b.expected_cents > 1e12
        )
          fail('Invalid funding amounts or year');
        const f = {
          ...seed(nextId++, b.name, b.kind, b.expected_cents, b.received_cents),
          academic_year: b.academic_year,
          expiry: b.expiry,
          eligible_program: b.eligible_program,
          eligible_supplier: b.eligible_supplier,
        };
        funding.push(f);
        if (f.received_cents)
          receipts.push({
            id: nextId++,
            funding_id: f.id,
            cents: f.received_cents,
            received_on: b.received_on,
            recorded_at: new Date().toISOString(),
            actor: 'demo',
          });
        log('created', 'funding', f.id, f);
        out = f;
      } else if (/^\/funding\/\d+\/received$/.test(p) && method === 'PATCH') {
        const f = findFund(Number(p.split('/')[2]));
        if (
          !Number.isSafeInteger(b.received_cents) ||
          b.received_cents < f.received_cents ||
          b.received_cents > f.expected_cents
        )
          fail('Invalid cumulative receipt');
        const delta = b.received_cents - f.received_cents;
        if (delta)
          receipts.push({
            id: nextId++,
            funding_id: f.id,
            cents: delta,
            received_on: b.received_on,
            recorded_at: new Date().toISOString(),
            actor: 'demo',
          });
        f.received_cents = b.received_cents;
        log('receipt_confirmed', 'funding', f.id, { cents: delta });
        out = f;
      } else if (p === '/budgets' && method === 'POST') {
        const f = fundRows().find((f) => f.id === b.funding_id) || fail('Unknown funding');
        if (
          !positive(b.cents) ||
          b.cents > f.unallocated_cents ||
          !programs.some((p) => p.code === b.program_code) ||
          budgets.some((x) => x.funding_id === f.id && x.program_code === b.program_code) ||
          (f.eligible_program && f.eligible_program !== b.program_code)
        )
          fail('Invalid or insufficient budget');
        const row: Budget = {
          id: nextId++,
          funding_id: f.id,
          funding_name: f.name,
          program_code: b.program_code,
          academic_year: f.academic_year,
          kind: f.kind,
          cents: b.cents,
          remaining: b.cents,
          expiry: f.expiry,
        };
        budgets.push(row);
        log('created', 'budget', row.id, row);
        out = row;
      } else if (/^\/budgets\/\d+$/.test(p) && method === 'PATCH') {
        const id = Number(p.split('/')[2]),
          row = budgets.find((x) => x.id === id) || fail('Unknown budget'),
          f = fundRows().find((f) => f.id === row.funding_id)!;
        if (
          !b.reason.trim() ||
          !Number.isSafeInteger(b.cents) ||
          b.cents < spent(id) ||
          b.cents > row.cents + f.unallocated_cents
        )
          fail('Invalid budget adjustment');
        row.cents = b.cents;
        log('adjusted', 'budget', id, b);
        out = row;
      } else if (p === '/transactions' && method === 'POST') out = purchase(b as PurchaseInput);
      else if (/^\/transactions\/\d+\/(void|correct)$/.test(p) && method === 'POST') {
        const t =
          transactions.find((t) => t.id === Number(p.split('/')[2]) && t.status === 'confirmed') ||
          fail('Unknown active purchase');
        if (!b.reason.trim()) fail('Reason required');
        t.status = 'voided';
        t.void_reason = b.reason;
        t.voided_at = new Date().toISOString();
        if (p.endsWith('/correct')) {
          try {
            const replacement = purchase(b.replacement);
            replacement.original_id = t.id;
            t.replacement_id = replacement.id;
            out = replacement;
          } catch (e) {
            t.status = 'confirmed';
            t.void_reason = null;
            t.voided_at = null;
            throw e;
          }
        } else out = t;
        log(p.endsWith('/correct') ? 'corrected' : 'voided', 'purchase', t.id, { reason: b.reason });
      } else if (p === '/allocation-suggestions' && method === 'POST') {
        let left = b.cents;
        const allocations = [];
        for (const row of budgetRows()
          .filter(
            (r) =>
              r.academic_year === b.academic_year && r.program_code === b.program_code && r.kind === b.kind,
          )
          .sort(
            (a, c) =>
              Number(c.funding_id === b.preferred_funding) - Number(a.funding_id === b.preferred_funding),
          )) {
          const f = findFund(row.funding_id);
          if (
            (f.eligible_supplier && f.eligible_supplier.toLowerCase() !== b.supplier.toLowerCase()) ||
            (f.eligible_purchase_type &&
              f.eligible_purchase_type.toLowerCase() !== b.purchase_type.toLowerCase()) ||
            (f.expiry && b.purchase_date > f.expiry)
          )
            continue;
          const n = Math.min(left, row.remaining);
          if (n > 0) {
            allocations.push({ budget_id: row.id, cents: n });
            left -= n;
          }
          if (!left) break;
        }
        out = { allocations, unallocated_cents: left };
      } else if (p === '/academic-years' && method === 'POST') {
        if (
          !yearValid(b.academic_year) ||
          b.starts_on > b.ends_on ||
          periods.some((p) => p.starts_on <= b.ends_on && p.ends_on >= b.starts_on)
        )
          fail('Invalid or overlapping year');
        const row = {
          id: nextId++,
          academic_year: b.academic_year,
          starts_on: b.starts_on,
          ends_on: b.ends_on,
          semesters: [],
        };
        periods.push(row);
        log('created', 'academic_year', row.id, row);
        out = row;
      } else fail('This operation requires the real backend; unavailable in the public demo.');
    }
    return structuredClone(out) as T;
  };
}
