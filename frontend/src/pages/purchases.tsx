import React, { useState, useEffect, useRef } from 'react';
import { cents, money, Transaction, Api } from '../api';
import { DEMO, Data, Save, field, Input, ProgramSelect, Panel, Form } from '../ui';
import { ReceiptFiles } from '../receipt-files';
import type { PendingPurchase } from '../staff-setup';
import { desktop } from '../desktop-backup';
import type { ReceiptFields } from '../receipt-text';
const ReceiptScanner = React.lazy(() => import('../receipt-scanner'));

export function PurchasePage({
  data,
  year,
  save,
  busy,
  api,
  original,
  pending,
}: {
  data: Data;
  year: string;
  save: Save;
  busy: boolean;
  api: Api;
  original?: Transaction;
  pending?: PendingPurchase;
}) {
  const source = original ?? pending;
  const form = useRef<HTMLFormElement>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [total, setTotal] = useState(source ? (source.cents / 100).toFixed(2) : '');
  const [splits, setSplits] = useState(
    original
      ? original.allocations.map((a, i) => ({
          id: i + 1,
          budget: String(a.budget_id),
          amount: (a.cents / 100).toFixed(2),
        }))
      : [{ id: 1, budget: '', amount: '' }],
  );
  const [next, setNext] = useState((original?.allocations.length || 1) + 1);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestionMessage, setSuggestionMessage] = useState('');
  const safe = (v: string) => {
    try {
      return cents(v);
    } catch {
      return 0;
    }
  };
  const assigned = splits.reduce((n, s) => n + safe(s.amount), 0);
  const update = (id: number, key: 'budget' | 'amount', value: string) =>
    setSplits((old) => old.map((s) => (s.id === id ? { ...s, [key]: value } : s)));
  return (
    <Panel
      title={
        original
          ? 'Correct purchase #' + original.id
          : pending
            ? 'Review pending purchase #' + pending.id
            : 'Record a purchase'
      }
    >
      {!DEMO && desktop && (
        <details className="suggestion" onToggle={(event) => setScannerOpen(event.currentTarget.open)}>
          <summary>Read a receipt photo</summary>
          {scannerOpen && (
            <React.Suspense fallback={<p role="status">Opening receipt reader…</p>}>
              <ReceiptScanner
                apply={(fields: ReceiptFields) => {
                  if (fields.total) setTotal(fields.total);
                  for (const [name, value] of [
                    ['supplier', fields.supplier],
                    ['date', fields.date],
                    ['description', fields.description],
                    ['type', fields.purchaseType],
                  ]) {
                    const input = form.current?.elements.namedItem(name);
                    if (value && input instanceof HTMLInputElement) input.value = value;
                  }
                }}
              />
            </React.Suspense>
          )}
        </details>
      )}
      <Form
        formRef={form}
        busy={busy || suggesting}
        button={original ? 'Confirm linked correction' : 'Confirm and save purchase'}
        onSubmit={async (f) => {
          const amount = cents(total);
          if (assigned !== amount) throw new Error('Split allocations must match total.');
          const payload = {
            duplicate_reason: field(f, 'duplicate_reason'),
            purchase_date: field(f, 'date'),
            supplier: field(f, 'supplier'),
            purchase_type: field(f, 'type'),
            description: field(f, 'description'),
            cents: amount,
            allocations: splits.map((s) => ({ budget_id: Number(s.budget), cents: cents(s.amount) })),
          };
          if (original) {
            if (!window.confirm('Replace the original purchase and preserve its history?'))
              throw new Error('No changes made.');
            await save('/transactions/' + original.id + '/correct', {
              reason: field(f, 'reason'),
              replacement: payload,
            });
          } else if (pending)
            await save('/purchase-intake/' + pending.id + '/confirm', {
              ...payload,
              verification: field(f, 'verification'),
            });
          else await save('/transactions', payload);
          setTotal('');
          setSplits([{ id: next, budget: '', amount: '' }]);
          setNext(next + 1);
        }}
      >
        <div className="twocol">
          <Input name="date" label="Purchase date" type="date" defaultValue={source?.purchase_date} />
          <Input name="supplier" label="Supplier" defaultValue={source?.supplier} />
          <Input name="type" label="Purchase type" defaultValue={source?.purchase_type} />
          <Input name="description" label="Description" required={false} defaultValue={source?.description} />
        </div>
        <label>
          Purchase total (CAD)
          <input
            type="number"
            required
            min=".01"
            step=".01"
            value={total}
            onChange={(e) => setTotal(e.target.value)}
          />
        </label>
        {original ? (
          <Input name="reason" label="Correction reason" />
        ) : (
          <div className="suggestion">
            <h3>Find eligible funding</h3>
            <p className="muted">
              Optional: select one program and payment type. The selected preferred grant is tried first,
              followed by eligible grants with earlier expiry dates. Review the suggested split before saving.
            </p>
            <div className="twocol">
              <label>
                Program for suggestion
                <ProgramSelect
                  programs={
                    pending ? data.programs.filter((p) => p.code === pending.program_code) : data.programs
                  }
                  name="suggestProgram"
                />
              </label>
              <label>
                Payment type
                <select name="suggestKind">
                  <option value="cash">Cash</option>
                  <option value="credit">Purchasing credit</option>
                </select>
              </label>
            </div>
            <label>
              Preferred funding
              <select name="suggestPreferred">
                <option value="">No preference</option>
                {data.funding
                  .filter((f) => f.academic_year === year)
                  .map((f) => (
                    <option value={f.id} key={f.id}>
                      {f.name} ({f.kind})
                    </option>
                  ))}
              </select>
            </label>
            <button
              type="button"
              className="secondary"
              disabled={busy || suggesting}
              onClick={async (e) => {
                const form = e.currentTarget.form;
                if (!form) return;
                const f = new FormData(form);
                setSuggestionMessage('');
                setSuggesting(true);
                try {
                  const date = field(f, 'date'),
                    supplier = field(f, 'supplier'),
                    amount = cents(total);
                  if (!date || !supplier.trim() || amount <= 0)
                    throw new Error('Enter purchase date, supplier and positive total first.');
                  const result = await api<{
                    allocations: { budget_id: number; cents: number }[];
                    unallocated_cents: number;
                  }>('/allocation-suggestions', 'POST', {
                    program_code: field(f, 'suggestProgram'),
                    academic_year: year,
                    kind: field(f, 'suggestKind'),
                    supplier,
                    purchase_type: field(f, 'type'),
                    purchase_date: date,
                    cents: amount,
                    preferred_funding: Number(field(f, 'suggestPreferred')) || null,
                  });
                  if (result.allocations.length) {
                    setSplits(
                      result.allocations.map((a, i) => ({
                        id: next + i,
                        budget: String(a.budget_id),
                        amount: (a.cents / 100).toFixed(2),
                      })),
                    );
                    setNext(next + result.allocations.length);
                  }
                  setSuggestionMessage(
                    result.unallocated_cents > 0
                      ? 'Eligible allocated funding is short by ' +
                          money(result.unallocated_cents) +
                          '. Review or adjust the allocations.'
                      : 'Suggested allocations are ready for review. Nothing has been saved.',
                  );
                } catch (e) {
                  setSuggestionMessage((e as Error).message);
                } finally {
                  setSuggesting(false);
                }
              }}
            >
              {suggesting ? 'Checking funding…' : 'Suggest allocations'}
            </button>
            {suggestionMessage && <p role="status">{suggestionMessage}</p>}
          </div>
        )}
        {pending && (
          <>
            <p>{pending.notes}</p>
            <Input
              name="verification"
              label="How the date and final charge were verified"
              required={pending.verify_charge}
            />
          </>
        )}
        <Input
          name="duplicate_reason"
          label="Duplicate review reason (only if a matching purchase is legitimate)"
          required={false}
        />
        <h3>Program and funding allocations</h3>
        {splits.map((s) => (
          <div className="split" key={s.id}>
            <label>
              Program / funding
              <select required value={s.budget} onChange={(e) => update(s.id, 'budget', e.target.value)}>
                <option value="">Select budget</option>
                {data.budgets
                  .filter(
                    (b) => b.academic_year === year && (!pending || b.program_code === pending.program_code),
                  )
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.program_code} · {b.funding_name} · {money(b.remaining)} left
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Amount (CAD)
              <input
                required
                min=".01"
                step=".01"
                type="number"
                value={s.amount}
                onChange={(e) => update(s.id, 'amount', e.target.value)}
              />
            </label>
            <button
              type="button"
              className="secondary"
              disabled={splits.length === 1}
              onClick={() => setSplits(splits.filter((x) => x.id !== s.id))}
            >
              Remove
            </button>
          </div>
        ))}
        <button
          className="secondary"
          type="button"
          onClick={() => {
            setSplits([...splits, { id: next, budget: '', amount: '' }]);
            setNext(next + 1);
          }}
        >
          + Add allocation
        </button>
        <p>
          Allocated: <b>{money(assigned)}</b> · Unassigned: <b>{money(safe(total) - assigned)}</b>
        </p>
      </Form>
    </Panel>
  );
}
export function TransactionsPage({
  data,
  year,
  save,
  busy,
  api,
}: {
  data: Data;
  year: string;
  save: Save;
  busy: boolean;
  api: Api;
}) {
  const [pending, setPending] = useState<PendingPurchase[]>([]);
  const [selectedId, setSelected] = useState('');
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (DEMO) return;
    let active = true;
    setError('');
    api<PendingPurchase[]>('/purchase-intake?year=' + encodeURIComponent(year))
      .then((rows) => {
        if (active) setPending(rows);
      })
      .catch((failure: Error) => {
        if (active) setError(failure.message);
      });
    return () => {
      active = false;
    };
  }, [api, version, year]);
  const selected = pending.find((row) => String(row.id) === selectedId);
  return (
    <>
      {error && (
        <p role="alert" className="error">
          {error} <button onClick={() => setVersion((value) => value + 1)}>Retry</button>
        </p>
      )}
      {pending.length > 0 && (
        <Panel title="Pending purchases">
          <p>
            {pending.length} awaiting review · {money(pending.reduce((sum, row) => sum + row.cents, 0))}{' '}
            recorded in the source file
          </p>
          <label>
            Pending purchase
            <select
              aria-label="Pending purchase"
              value={selectedId}
              onChange={(event) => setSelected(event.target.value)}
              disabled={busy}
            >
              <option value="">Select a purchase to review</option>
              {pending.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.purchase_date} · {row.supplier} · {money(row.cents)}
                  {row.verify_charge ? ' · Verify final charge' : ''}
                </option>
              ))}
            </select>
          </label>
          {selected && (
            <p>
              Choose funding for{' '}
              {data.programs.find((row) => row.code === selected.program_code)?.name || selected.program_code}
              .
            </p>
          )}
        </Panel>
      )}
      <PurchasePage
        key={selected?.id ?? 'new'}
        data={data}
        year={year}
        save={save}
        busy={busy}
        api={api}
        pending={selected}
      />
    </>
  );
}
export function History({
  data,
  year,
  save,
  busy,
  api,
}: {
  data: Data;
  year: string;
  save: Save;
  busy: boolean;
  api: Api;
}) {
  const [query, setQuery] = useState('');
  const [month, setMonth] = useState('');
  const [program, setProgram] = useState('');
  const [selected, setSelected] = useState('');
  const [correction, setCorrection] = useState('');
  const rows = data.transactions.filter(
    (t) =>
      t.allocations.some((a) => a.academic_year === year) &&
      (!month || t.purchase_date.startsWith(month)) &&
      (!program || t.allocations.some((a) => a.program === program)) &&
      JSON.stringify(t).toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <Panel title="Correct a transaction">
        <label>
          Confirmed purchase
          <select value={correction} onChange={(e) => setCorrection(e.target.value)}>
            <option value="">Select a purchase</option>
            {data.transactions
              .filter((t) => t.status === 'confirmed' && t.allocations.some((a) => a.academic_year === year))
              .map((t) => (
                <option key={t.id} value={t.id}>
                  #{t.id} · {t.supplier} · {money(t.cents)}
                </option>
              ))}
          </select>
        </label>
      </Panel>
      {correction && (
        <PurchasePage
          key={correction}
          original={data.transactions.find((t) => String(t.id) === correction && t.status === 'confirmed')}
          data={data}
          year={year}
          save={async (path, body, method) => {
            await save(path, body, method);
            setCorrection('');
          }}
          busy={busy}
          api={api}
        />
      )}
      {!DEMO && (
        <ReceiptFiles
          api={api}
          transactions={data.transactions.filter((t) => t.allocations.some((a) => a.academic_year === year))}
        />
      )}
      <Panel title="Transaction history">
        <Form
          busy={busy}
          button="Confirm void"
          onSubmit={async (f) => {
            if (
              !window.confirm(
                'Void this purchase and restore its balances? The original record will remain in history.',
              )
            )
              throw new Error('No changes made.');
            await save('/transactions/' + selected + '/void', { reason: field(f, 'reason') });
            setSelected('');
          }}
        >
          <label>
            Purchase to void
            <select required value={selected} onChange={(e) => setSelected(e.target.value)}>
              <option value="">Select confirmed purchase</option>
              {data.transactions
                .filter(
                  (t) => t.status === 'confirmed' && t.allocations.some((a) => a.academic_year === year),
                )
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    #{t.id} · {t.supplier} · {money(t.cents)}
                  </option>
                ))}
            </select>
          </label>
          <Input name="reason" label="Reason for voiding" />
        </Form>
        <p className="muted">
          Voiding restores balances without deleting history. Use the linked correction form above to replace
          a purchase atomically.
        </p>
        <div className="filters">
          <label>
            Search
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Supplier, description, funding…"
            />
          </label>
          <label>
            Month
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          </label>
          <label>
            Program
            <select value={program} onChange={(e) => setProgram(e.target.value)}>
              <option value="">All</option>
              {data.programs.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Date / ID</th>
                <th>Supplier</th>
                <th>Description</th>
                <th>Total</th>
                <th>Status</th>
                <th>Allocations</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id}>
                  <td>
                    {t.purchase_date}
                    <small>#{t.id}</small>
                  </td>
                  <td>
                    {t.supplier}
                    <small>{t.purchase_type}</small>
                  </td>
                  <td>{t.description}</td>
                  <td>{money(t.cents)}</td>
                  <td>
                    {t.status}
                    <small>{t.void_reason}</small>
                    {t.original_id && <small>Corrects #{t.original_id}</small>}
                    {t.replacement_id && <small>Replaced by #{t.replacement_id}</small>}
                  </td>
                  <td>
                    {t.allocations.map((a) => (
                      <small key={a.budget_id}>
                        {a.program} · {a.funding} ({a.kind}) · {money(a.cents)}
                      </small>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && <p>No matching transactions.</p>}
        </div>
      </Panel>
    </>
  );
}
