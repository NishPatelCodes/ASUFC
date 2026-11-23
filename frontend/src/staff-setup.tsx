import { useState } from 'react';
import { Api, fileBase64, money } from './api';

export type PendingPurchase = {
  id: number;
  program_code: string;
  purchase_date: string;
  supplier: string;
  purchase_type: string;
  description: string;
  cents: number;
  notes: string;
  verify_charge: boolean;
};

type StarterFunding = {
  name: string;
  kind: 'cash' | 'credit';
  expected_cents: number;
  received_cents: number;
  expiry?: string | null;
  carry_status?: string;
  commitment?: 'committed' | 'unconfirmed';
  eligible_programs?: string[];
  eligible_suppliers?: string[];
  notes?: string;
};
type Draft = {
  starter: Starter;
  warnings: string[];
  errors: { row: number; error: string }[];
  sheet: string;
};
type Starter = {
  version: number;
  period: { academic_year: string; starts_on: string; ends_on: string };
  semesters: { name: string; starts_on: string; ends_on: string }[];
  funding: StarterFunding[];
  purchases: Omit<PendingPurchase, 'id'>[];
};

export function StaffSetup({ api, onApplied }: { api: Api; onApplied: (message: string) => void }) {
  const [starter, setStarter] = useState<Starter | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [year, setYear] = useState('2026-2027');
  const [issues, setIssues] = useState<Pick<Draft, 'warnings' | 'errors'>>({ warnings: [], errors: [] });
  const yearStart = year.slice(0, 4) + '-09-01',
    yearEnd = year.slice(5) + '-08-31';

  async function readWorkbook(file: File) {
    if (file.size > 5_000_000) throw new Error('Maximum workbook size is 5 MB.');
    if (!/^\d{4}-\d{4}$/.test(year)) throw new Error('Enter the academic year first, e.g. 2026-2027.');
    const draft = await api<Draft>('/staff-setup/workbook-draft', 'POST', {
      content_base64: await fileBase64(file),
      academic_year: year,
      starts_on: yearStart,
      ends_on: yearEnd,
    });
    setIssues(draft);
    setStarter(draft.starter);
  }

  async function read(file: File | undefined) {
    setStarter(null);
    setError('');
    setIssues({ warnings: [], errors: [] });
    if (!file) return;
    if (file.name.toLowerCase().endsWith('.xlsx')) {
      setBusy(true);
      try {
        await readWorkbook(file);
      } catch (failure) {
        setError((failure as Error).message);
      } finally {
        setBusy(false);
      }
      return;
    }
    try {
      if (file.size > 500_000) throw new Error();
      const data = JSON.parse(await file.text());
      if (
        data?.version !== 1 ||
        typeof data.period?.academic_year !== 'string' ||
        !Array.isArray(data.semesters) ||
        !Array.isArray(data.funding) ||
        !Array.isArray(data.purchases) ||
        data.funding.some(
          (row: StarterFunding) =>
            typeof row?.name !== 'string' ||
            !Number.isSafeInteger(row.received_cents) ||
            !Number.isSafeInteger(row.expected_cents),
        ) ||
        data.purchases.some((row: PendingPurchase) => !Number.isSafeInteger(row?.cents)) ||
        data.semesters.some((row: Starter['semesters'][number]) => typeof row?.name !== 'string')
      ) {
        throw new Error();
      }
      setStarter(data);
    } catch {
      setError('Choose a valid ASUFC starter file under 500 KB.');
    }
  }

  async function apply() {
    if (
      !starter ||
      !window.confirm(
        'Apply these funding and reporting settings and add the purchases to Pending purchases?',
      )
    )
      return;
    setError('');
    setBusy(true);
    try {
      const result = await api<{ funding_sources: number; pending_purchases: number }>(
        '/staff-setup',
        'POST',
        starter,
      );
      setStarter(null);
      onApplied(
        `Applied ${result.funding_sources} funding sources and staged ${result.pending_purchases} purchases for review.`,
      );
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <h2>Set up a new ledger from a starter file</h2>
      <p>
        Upload the ASUFC budget tracker workbook (.xlsx) or a starter file (.json). Funding sources and
        reporting dates are added, and each tracker expense becomes a pending purchase. Pending purchases
        leave funding balances unchanged until someone confirms which funding paid for them.
      </p>
      <label>
        Academic year for a tracker workbook
        <input value={year} onChange={(event) => setYear(event.target.value.trim())} disabled={busy} />
      </label>
      <label>
        Budget tracker or starter file
        <input
          type="file"
          accept=".xlsx,.json"
          disabled={busy}
          onChange={(event) => read(event.target.files?.[0])}
        />
      </label>
      {busy && !starter && <p role="status">Reading the workbook…</p>}
      {starter && (
        <>
          <h3>Reporting year {starter.period.academic_year}</h3>
          <p>Check the reporting range. It is editable here and in Academic years after setup.</p>
          <div className="twocol">
            <label>
              Reporting start
              <input
                type="date"
                value={starter.period.starts_on}
                onChange={(event) => {
                  const date = event.target.value;
                  setStarter((value) => value && { ...value, period: { ...value.period, starts_on: date } });
                }}
              />
            </label>
            <label>
              Reporting end
              <input
                type="date"
                value={starter.period.ends_on}
                onChange={(event) => {
                  const date = event.target.value;
                  setStarter((value) => value && { ...value, period: { ...value.period, ends_on: date } });
                }}
              />
            </label>
          </div>
          <ul>
            {starter.semesters.map((term, i) => (
              <li key={i}>
                {term.name} · {term.starts_on} to {term.ends_on}
              </li>
            ))}
          </ul>
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Funding source</th>
                  <th>Award</th>
                  <th>Received</th>
                  <th>Expiry</th>
                  <th>Carry-forward</th>
                </tr>
              </thead>
              <tbody>
                {starter.funding.map((grant, i) => (
                  <tr key={i}>
                    <th scope="row">
                      {grant.name}
                      <small>
                        {grant.kind === 'credit' ? 'Purchasing credit' : 'Cash'}
                        {grant.commitment === 'unconfirmed' ? ' · Unconfirmed pledge' : ''}
                      </small>
                      {!!grant.eligible_programs?.length && (
                        <small>Programs: {grant.eligible_programs.join(', ')}</small>
                      )}
                      {!!grant.eligible_suppliers?.length && (
                        <small>Suppliers: {grant.eligible_suppliers.join(', ')}</small>
                      )}
                      {grant.notes && <small>{grant.notes}</small>}
                    </th>
                    <td>{money(grant.expected_cents)}</td>
                    <td>{money(grant.received_cents)}</td>
                    <td>{grant.expiry || '—'}</td>
                    <td>
                      {grant.carry_status === 'prohibited'
                        ? 'Prohibited'
                        : grant.carry_status === 'allowed'
                          ? 'Allowed'
                          : 'To confirm'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            {starter.purchases.length} pending purchases ·{' '}
            {money(starter.purchases.reduce((sum, row) => sum + row.cents, 0))} recorded in the source file
          </p>
          {issues.warnings.length > 0 && (
            <ul className="funding-alerts">
              {issues.warnings.map((text) => (
                <li className="warning" key={text}>
                  {text}
                </li>
              ))}
            </ul>
          )}
          {issues.errors.length > 0 && (
            <div role="alert" className="error">
              <p>Fix these workbook rows, then upload it again:</p>
              <ul>
                {issues.errors.map((item) => (
                  <li key={item.row + item.error}>
                    Row {item.row}: {item.error}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="muted">
            Check each funding source's programs, suppliers and expiry after setup under Funding &amp; grants.
          </p>
          <button
            disabled={
              busy || issues.errors.length > 0 || !starter.period.starts_on || !starter.period.ends_on
            }
            onClick={apply}
          >
            {busy ? 'Applying…' : 'Apply starter file'}
          </button>
        </>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </section>
  );
}
