import { useState, useEffect } from 'react';
import { money, Api, downloadReport } from '../api';
import { DEMO, Data, Save, field, Input, Panel, Form } from '../ui';

export function AcademicYears({ data, save, busy }: { data: Data; save: Save; busy: boolean }) {
  return (
    <>
      <Panel title="Create academic year">
        <Form
          busy={busy}
          button="Create year"
          onSubmit={async (f) =>
            save('/academic-years', {
              academic_year: field(f, 'year'),
              starts_on: field(f, 'start'),
              ends_on: field(f, 'end'),
            })
          }
        >
          <Input name="year" label="Academic year (YYYY-YYYY)" />
          <Input name="start" label="Start date" type="date" />
          <Input name="end" label="End date" type="date" />
        </Form>
      </Panel>
      <Panel title="Configure semester">
        <Form
          busy={busy}
          button="Add semester"
          onSubmit={async (f) =>
            save('/academic-years/' + encodeURIComponent(field(f, 'year')) + '/semesters', {
              name: field(f, 'name'),
              starts_on: field(f, 'start'),
              ends_on: field(f, 'end'),
            })
          }
        >
          <label>
            Academic year
            <select name="year" required>
              <option value="">Select configured year</option>
              {data.periods.map((p) => (
                <option key={p.id} value={p.academic_year}>
                  {p.academic_year}
                </option>
              ))}
            </select>
          </label>
          <Input name="name" label="Semester name" />
          <Input name="start" label="Start date" type="date" />
          <Input name="end" label="End date" type="date" />
        </Form>
      </Panel>
      <Panel title="Adjust configured periods">
        <Form
          busy={busy}
          button="Save year dates"
          onSubmit={async (f) =>
            save(
              '/academic-years/' + field(f, 'year'),
              { starts_on: field(f, 'start'), ends_on: field(f, 'end'), reason: field(f, 'reason') },
              'PATCH',
            )
          }
        >
          <label>
            Year
            <select name="year" required>
              <option value="">Select year</option>
              {data.periods.map((p) => (
                <option key={p.id}>{p.academic_year}</option>
              ))}
            </select>
          </label>
          <Input name="start" label="New start date" type="date" />
          <Input name="end" label="New end date" type="date" />
          <Input name="reason" label="Reason" />
        </Form>
        <Form
          busy={busy}
          button="Save semester dates"
          onSubmit={async (f) => {
            const [year, id] = field(f, 'semester').split('/');
            await save(
              '/academic-years/' + year + '/semesters/' + id,
              {
                name: field(f, 'name'),
                starts_on: field(f, 'start'),
                ends_on: field(f, 'end'),
                reason: field(f, 'reason'),
              },
              'PATCH',
            );
          }}
        >
          <label>
            Semester
            <select name="semester" required>
              <option value="">Select semester</option>
              {data.periods.flatMap((p) =>
                p.semesters.map((t) => (
                  <option key={t.id} value={p.academic_year + '/' + t.id}>
                    {p.academic_year} · {t.name}
                  </option>
                )),
              )}
            </select>
          </label>
          <Input name="name" label="Semester name" />
          <Input name="start" label="New start date" type="date" />
          <Input name="end" label="New end date" type="date" />
          <Input name="reason" label="Reason" />
        </Form>
      </Panel>
      {data.periods.map((p) => (
        <Panel key={p.id} title={p.academic_year}>
          <p>
            {p.starts_on} – {p.ends_on}
          </p>
          <table>
            <thead>
              <tr>
                <th>Semester</th>
                <th>Start</th>
                <th>End</th>
              </tr>
            </thead>
            <tbody>
              {p.semesters.map((t) => (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td>{t.starts_on}</td>
                  <td>{t.ends_on}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      ))}
    </>
  );
}
export type ReconciliationResult = {
  ok: boolean;
  issues: { code: string; record_id: number; expected: number | string; actual: number | string }[];
  funding: {
    id: number;
    name: string;
    kind: string;
    received_cents: number;
    carried_in_cents: number;
    carried_out_cents: number;
    allocated_cents: number;
    spent_cents: number;
    remaining_cents: number;
    unallocated_cents: number;
  }[];
  budgets: {
    id: number;
    funding_id: number;
    program_code: string;
    allocated_cents: number;
    spent_cents: number;
    remaining_cents: number;
  }[];
};
export function Reconciliation({ api, year }: { api: Api; year: string }) {
  const [r, setR] = useState<ReconciliationResult | null>(null),
    [error, setError] = useState(''),
    [version, setVersion] = useState(0),
    [exporting, setExporting] = useState(false);
  useEffect(() => {
    let active = true;
    setR(null);
    setError('');
    api<ReconciliationResult>('/reports/reconciliation?year=' + encodeURIComponent(year))
      .then((x) => {
        if (active) setR(x);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [api, year, version]);
  return (
    <>
      <Panel title="Internal ledger consistency">
        <p className="muted">
          Checks recorded receipts, transfers, budget limits and purchase allocations. Does not verify
          external bank statements.
        </p>
        <button onClick={() => setVersion((v) => v + 1)}>Run checks</button>{' '}
        <button
          disabled={!r || exporting}
          onClick={async () => {
            setExporting(true);
            try {
              await downloadReport(
                api,
                '/reports/reconciliation.xlsx?year=' + encodeURIComponent(year),
                'asufc-balances.xlsx',
              );
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setExporting(false);
            }
          }}
        >
          {exporting ? 'Exporting…' : 'Download balance workbook'}
        </button>
        {error && <p role="alert">{error}</p>}
        {r ? (
          <p className={r.ok ? 'success' : 'error'}>
            {r.ok
              ? DEMO
                ? 'Demo balance summary — not server reconciliation'
                : 'No internal inconsistencies detected'
              : r.issues.length + ' inconsistencies detected'}
          </p>
        ) : (
          !error && <p>Checking…</p>
        )}
        {r?.issues.map((i, n) => (
          <p key={n}>
            {i.code} · record #{i.record_id} · expected {i.expected}, actual {i.actual}
          </p>
        ))}
      </Panel>
      {r && (
        <>
          <Panel title="Funding balances">
            <div className="tablewrap">
              <table>
                <thead>
                  <tr>
                    {[
                      'Source',
                      'Received',
                      'Carry in',
                      'Carry out',
                      'Allocated',
                      'Spent',
                      'Remaining',
                      'Unallocated',
                    ].map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {r.funding.map((f) => (
                    <tr key={f.id}>
                      <td>
                        {f.name} ({f.kind})
                      </td>
                      {[
                        f.received_cents,
                        f.carried_in_cents,
                        f.carried_out_cents,
                        f.allocated_cents,
                        f.spent_cents,
                        f.remaining_cents,
                        f.unallocated_cents,
                      ].map((v, i) => (
                        <td key={i}>{money(v)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
          <Panel title="Budget balances">
            <div className="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th>Program</th>
                    <th>Funding ID</th>
                    <th>Allocated</th>
                    <th>Spent</th>
                    <th>Remaining</th>
                  </tr>
                </thead>
                <tbody>
                  {r.budgets.map((b) => (
                    <tr key={b.id}>
                      <td>{b.program_code}</td>
                      <td>{b.funding_id}</td>
                      <td>{money(b.allocated_cents)}</td>
                      <td>{money(b.spent_cents)}</td>
                      <td>{money(b.remaining_cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}
    </>
  );
}
export function ExcelImport({
  api,
  data,
  onImported,
}: {
  api: Api;
  data: Data;
  onImported: (count: number) => void;
}) {
  const keys = [
    'external_id',
    'purchase_date',
    'supplier',
    'purchase_type',
    'description',
    'amount',
    'budget_id',
  ];
  const [content, setContent] = useState(''),
    [sheet, setSheet] = useState('Sheet'),
    [mapping, setMapping] = useState<Record<string, string>>(Object.fromEntries(keys.map((k) => [k, k]))),
    [result, setResult] = useState<{
      valid: boolean;
      rows: { row: number; external_id: string; supplier: string; cents: number }[];
      errors: { row: number; error: string }[];
      validation_error?: string;
    } | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const payload = { content_base64: content, sheet, mapping };
  return (
    <>
      <Panel title="Import historical transactions">
        <p>
          Upload XLSX with one allocation per row. For split purchases, repeat the external ID and identical
          purchase details with a different budget ID and allocation amount. Map all seven fields.
        </p>
        <input
          type="file"
          accept=".xlsx"
          onChange={async (e) => {
            setResult(null);
            setContent('');
            setError('');
            const file = e.target.files?.[0];
            if (!file) return;
            if (file.size > 5000000) {
              setError('Maximum file size is 5 MB');
              return;
            }
            try {
              const bytes = new Uint8Array(await file.arrayBuffer());
              let raw = '';
              for (let i = 0; i < bytes.length; i += 8192)
                raw += String.fromCharCode(...bytes.subarray(i, i + 8192));
              setContent(btoa(raw));
            } catch {
              setError('Unable to read workbook');
            }
          }}
        />
        <label>
          Worksheet name
          <input
            value={sheet}
            onChange={(e) => {
              setSheet(e.target.value);
              setResult(null);
            }}
          />
        </label>
        <div className="twocol">
          {keys.map((k) => (
            <label key={k}>
              {k}
              <input
                value={mapping[k]}
                onChange={(e) => {
                  setMapping({ ...mapping, [k]: e.target.value });
                  setResult(null);
                }}
              />
            </label>
          ))}
        </div>
        <button
          disabled={!content || busy}
          onClick={async () => {
            setBusy(true);
            setError('');
            setResult(null);
            try {
              setResult(await api('/imports/preview', 'POST', payload));
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Validate and preview
        </button>
        {error && <p role="alert">{error}</p>}
        {result && (
          <>
            <p>{result.valid ? 'Validation passed; nothing saved.' : 'Validation failed.'}</p>
            {result.validation_error && <p>{result.validation_error}</p>}
            {result.errors.map((e) => (
              <p key={e.row}>
                Row {e.row}: {e.error}
              </p>
            ))}
            <table>
              <thead>
                <tr>
                  <th>Row</th>
                  <th>External ID</th>
                  <th>Supplier</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((r) => (
                  <tr key={r.row}>
                    <td>{r.row}</td>
                    <td>{r.external_id}</td>
                    <td>{r.supplier}</td>
                    <td>{money(r.cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button
              disabled={!result.valid || busy}
              onClick={async () => {
                if (!window.confirm('Import all validated purchases?')) return;
                setBusy(true);
                try {
                  const r = await api<{ imported: number }>('/imports/commit', 'POST', payload);
                  setResult(null);
                  setContent('');
                  onImported(r.imported);
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Confirm import
            </button>
          </>
        )}
      </Panel>
      <Panel title="Budget IDs for mapping">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Year</th>
              <th>Program</th>
              <th>Funding</th>
            </tr>
          </thead>
          <tbody>
            {data.budgets.map((b) => (
              <tr key={b.id}>
                <td>{b.id}</td>
                <td>{b.academic_year}</td>
                <td>{b.program_code}</td>
                <td>{b.funding_name}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </>
  );
}
export function Account({ api, onChanged }: { api: Api; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Panel title="Change staff password">
      <p>Changing your password signs out every active session.</p>
      <Form
        busy={busy}
        button="Change password"
        onSubmit={async (f) => {
          if (field(f, 'new') !== field(f, 'repeat')) throw new Error('Passwords differ');
          setBusy(true);
          try {
            await api('/auth/password', 'POST', {
              current_password: field(f, 'current'),
              new_password: field(f, 'new'),
            });
            onChanged();
          } finally {
            setBusy(false);
          }
        }}
      >
        <Input name="current" label="Current password" type="password" />
        <Input name="new" label="New password (minimum 16 characters)" type="password" />
        <Input name="repeat" label="Repeat new password" type="password" />
      </Form>
    </Panel>
  );
}
