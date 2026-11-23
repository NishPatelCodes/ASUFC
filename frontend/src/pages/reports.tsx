import { useState, useEffect } from 'react';
import { money, Api, AuditEvent, downloadReport } from '../api';
import { Data, Panel, CatalogSelect } from '../ui';

export function AuditLog({ events }: { events: AuditEvent[] }) {
  return (
    <Panel title="Financial audit log">
      <p className="muted">
        Latest 500 events across all academic years. Existing records made before audit tracking began may not
        have an event.
      </p>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Recorded</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Record</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id}>
                <td>{new Date(e.created_at).toLocaleString()}</td>
                <td>{e.actor}</td>
                <td>{e.action}</td>
                <td>
                  {e.entity} #{e.entity_id}
                </td>
                <td>
                  <details>
                    <summary>View details</summary>
                    <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                      {JSON.stringify(e.details, null, 2)}
                    </pre>
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!events.length && <p>No audit events yet.</p>}
      </div>
    </Panel>
  );
}
export type ReportRow = { label: string; cash_cents: number; credit_cents: number };
export type SpendingReport = {
  totals: { cash_cents: number; credit_cents: number };
  purchase_count: number;
  month: ReportRow[];
  program: ReportRow[];
  supplier: ReportRow[];
  funding: ReportRow[];
};
export function Reports({ api, year, data }: { api: Api; year: string; data: Data }) {
  const [start, setStart] = useState(''),
    [end, setEnd] = useState(''),
    [program, setProgram] = useState(''),
    [supplier, setSupplier] = useState(''),
    [funding, setFunding] = useState(''),
    [purchaseType, setPurchaseType] = useState('');
  const [exporting, setExporting] = useState(false),
    [exportError, setExportError] = useState('');
  const semesters = data.periods.find((period) => period.academic_year === year)?.semesters ?? [];
  const selectedSemester = semesters.find(
    (semester) => semester.starts_on === start && semester.ends_on === end,
  );
  const params = new URLSearchParams({ year });
  for (const [k, v] of Object.entries({
    start,
    end,
    program,
    supplier,
    funding_id: funding,
    purchase_type: purchaseType,
  }))
    if (v) params.set(k, v);
  const query = params.toString();
  const [report, setReport] = useState<SpendingReport | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setReport(null);
    setError('');
    api<SpendingReport>('/reports/spending?' + query)
      .then((r) => {
        if (active) setReport(r);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [api, query]);
  const table = (title: string, rows: ReportRow[]) => (
    <Panel title={title}>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Group</th>
              <th>Cash spent</th>
              <th>Credit used</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <td>{r.label}</td>
                <td>{money(r.cash_cents)}</td>
                <td>{money(r.credit_cents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <p>No matching spending.</p>}
      </div>
    </Panel>
  );
  return (
    <>
      <Panel title="Spending report filters">
        <label>
          Configured semester
          <select
            value={selectedSemester?.id ?? ''}
            onChange={(e) => {
              const semester = semesters.find((term) => String(term.id) === e.target.value);
              setStart(semester?.starts_on ?? '');
              setEnd(semester?.ends_on ?? '');
            }}
          >
            <option value="">Custom dates / entire year</option>
            {semesters.map((term) => (
              <option key={term.id} value={term.id}>
                {term.name}
              </option>
            ))}
          </select>
        </label>
        <p className="muted">
          Set From and To to include summer and between-term purchases within the selected academic year.
        </p>
        {(start || end) && (
          <button
            type="button"
            onClick={() => {
              setStart('');
              setEnd('');
            }}
          >
            Clear report dates
          </button>
        )}
        <div className="filters">
          <label>
            From
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </label>
          <label>
            To
            <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
          </label>
          <label>
            Program
            <select value={program} onChange={(e) => setProgram(e.target.value)}>
              <option value="">All programs</option>
              {data.programs.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <CatalogSelect
            catalog={data.catalog}
            kind="supplier"
            label="Supplier"
            value={supplier}
            onChange={setSupplier}
          />
          <label>
            Funding source
            <select value={funding} onChange={(e) => setFunding(e.target.value)}>
              <option value="">All sources</option>
              {data.funding
                .filter((f) => f.academic_year === year)
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
            </select>
          </label>
        </div>
        <CatalogSelect
          catalog={data.catalog}
          kind="purchase_type"
          label="Purchase type"
          value={purchaseType}
          onChange={setPurchaseType}
        />
        <button
          disabled={!report || exporting}
          onClick={async () => {
            setExporting(true);
            setExportError('');
            try {
              await downloadReport(api, '/reports/spending.xlsx?' + query);
            } catch (e) {
              setExportError((e as Error).message);
            } finally {
              setExporting(false);
            }
          }}
        >
          {exporting ? 'Exporting…' : 'Download Excel report'}
        </button>
        {exportError && (
          <p role="alert" className="error">
            {exportError}
          </p>
        )}
        <p className="muted">
          Reports exclude voided purchases. Filtered totals reflect only matching allocations, not the entire
          purchase.
        </p>
      </Panel>
      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : !report ? (
        <p>Loading report…</p>
      ) : (
        <>
          <div className="metrics">
            {[
              ['Cash spent', money(report.totals.cash_cents)],
              ['Credit used', money(report.totals.credit_cents)],
              ['Matching purchases', report.purchase_count],
            ].map(([k, v]) => (
              <article className="metric" key={k}>
                <span>{k}</span>
                <strong>{v}</strong>
              </article>
            ))}
          </div>
          <Panel title="Monthly spending trend">
            {report.month.length ? (
              report.month.map((r) => (
                <div className="barrow" key={r.label}>
                  <div>
                    <b>{r.label}</b>
                    <span>
                      {money(r.cash_cents)} cash · {money(r.credit_cents)} credit
                    </span>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      height: 12,
                      background: '#eee',
                      borderRadius: 6,
                      overflow: 'hidden',
                      gap: 0,
                    }}
                  >
                    <span
                      style={{
                        background: '#702d42',
                        width:
                          (100 * r.cash_cents) /
                            Math.max(1, ...report.month.map((x) => x.cash_cents + x.credit_cents)) +
                          '%',
                      }}
                    />
                    <span
                      style={{
                        background: '#487d70',
                        width:
                          (100 * r.credit_cents) /
                            Math.max(1, ...report.month.map((x) => x.cash_cents + x.credit_cents)) +
                          '%',
                      }}
                    />
                  </div>
                </div>
              ))
            ) : (
              <p>No spending in selected period.</p>
            )}
          </Panel>
          {table('Monthly spending', report.month)}
          {table('Program spending', report.program)}
          {table('Supplier spending', report.supplier)}
          {table('Funding source spending', report.funding)}
        </>
      )}
    </>
  );
}
