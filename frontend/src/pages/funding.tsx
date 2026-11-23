import { useState, useEffect } from 'react';
import { cents, money, Program, Funding, FundingEligibility, Api, FundingReceipt } from '../api';
import { DEMO, Data, Save, field, Input, ProgramSelect, Panel, Form } from '../ui';

export const carryLabel = (funding: Funding) =>
  funding.carry_eligible ? 'Allowed' : funding.carry_prohibited ? 'Prohibited' : 'To confirm';
export function CarryOptions() {
  return (
    <>
      <option value="unconfirmed">To confirm</option>
      <option value="prohibited">Prohibited</option>
      <option value="allowed">Allowed</option>
    </>
  );
}
export function FundingTable({ rows }: { rows: Funding[] }) {
  return (
    <div className="tablewrap">
      <table>
        <thead>
          <tr>
            <th scope="col">Source</th>
            <th scope="col">Type</th>
            <th scope="col">Received</th>
            <th scope="col">Carried in</th>
            <th scope="col">Carried out</th>
            <th scope="col">Expected outstanding</th>
            <th scope="col">Remaining</th>
            <th scope="col">Unallocated</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((f) => (
            <tr key={f.id}>
              <td>
                {f.name}
                <small>{fundingRuleSummary(f)}</small>
                {f.expiry && (
                  <small>
                    Expires <time dateTime={f.expiry}>{f.expiry}</time>
                  </small>
                )}
                {f.commitment === 'unconfirmed' && <small className="warning">Unconfirmed pledge</small>}
                {!!f.returned_cents && <small>Returned to funder {money(f.returned_cents)}</small>}
                {!DEMO && <small>Carry-forward · {carryLabel(f)}</small>}
                {!DEMO && f.notes && <small>{f.notes}</small>}
              </td>
              <td>{f.kind}</td>
              <td>{money(f.received_cents)}</td>
              <td>{money(f.carried_in_cents)}</td>
              <td>{money(f.carried_out_cents)}</td>
              <td>{money(f.expected_cents - f.received_cents)}</td>
              <td>{money(f.remaining_cents)}</td>
              <td>{money(f.unallocated_cents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && <p>No funding recorded.</p>}
    </div>
  );
}
export function FundingPage({
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
  const rows = data.funding.filter((f) => f.academic_year === year);
  return (
    <>
      <div className="twocol">
        <Panel title="Add funding">
          <Form
            busy={busy}
            button="Save funding"
            onSubmit={async (f) =>
              save('/funding', {
                name: field(f, 'name'),
                academic_year: year,
                kind: field(f, 'kind'),
                expected_cents: cents(field(f, 'award')),
                received_cents: cents(field(f, 'received')),
                expiry: field(f, 'expiry') || null,
                ...(DEMO
                  ? {
                      eligible_program: field(f, 'program') || null,
                      eligible_supplier: field(f, 'supplier') || null,
                    }
                  : readFundingRuleFields(f)),
                organization: field(f, 'organization'),
                source_type: field(f, 'source_type'),
                recurring: field(f, 'recurring') === 'yes',
                expected_date: field(f, 'expected_date') || null,
                notes: field(f, 'notes'),
                received_on: field(f, 'received_on') || null,
                ...(!DEMO
                  ? {
                      carry_status: field(f, 'carry_status'),
                      commitment: field(f, 'commitment'),
                      auto_budget: field(f, 'auto_budget') === 'yes',
                    }
                  : {}),
              })
            }
          >
            <Input name="name" label="Funding source" />
            <Input name="organization" label="Funding organization" required={false} />
            <Input name="source_type" label="Funding classification" required={false} />
            <label>
              Recurring funding
              <select name="recurring">
                <option value="no">No / not confirmed</option>
                <option value="yes">Yes</option>
              </select>
            </label>
            <Input name="expected_date" label="Expected receipt date" type="date" required={false} />
            <Input name="received_on" label="Actual receipt date (if known)" type="date" required={false} />
            <Input name="notes" label="Grant notes" required={false} />
            <label>
              Funding type
              <select name="kind">
                <option value="cash">Cash</option>
                <option value="credit">Purchasing credit</option>
              </select>
            </label>
            <Input name="award" label="Total award (CAD)" type="number" />
            <Input name="received" label="Confirmed received (CAD)" type="number" defaultValue="0" />
            {DEMO ? (
              <>
                <label>
                  Program restriction
                  <ProgramSelect programs={data.programs} optional />
                </label>
                <Input name="supplier" label="Supplier restriction" required={false} />
              </>
            ) : (
              <FundingRuleFields programs={data.programs} />
            )}
            <Input name="expiry" label="Expiry date" type="date" required={false} />
            {!DEMO && (
              <>
                <label>
                  Carry-forward
                  <select name="carry_status">
                    <CarryOptions />
                  </select>
                </label>
                <label>
                  Expected amount
                  <select name="commitment">
                    <option value="committed">Committed by the funder</option>
                    <option value="unconfirmed">Unconfirmed pledge or estimate</option>
                  </select>
                </label>
                <label className="checkbox">
                  <input type="checkbox" name="auto_budget" value="yes" />
                  Create the budget automatically (one eligible program only)
                </label>
              </>
            )}
          </Form>
        </Panel>
        <Panel title="Confirm funding received">
          <Form
            busy={busy}
            button="Update confirmed amount"
            onSubmit={async (f) =>
              save(
                '/funding/' + field(f, 'id') + '/received',
                { received_cents: cents(field(f, 'total')), received_on: field(f, 'received_on') || null },
                'PATCH',
              )
            }
          >
            <label>
              Funding source
              <select name="id" required>
                <option value="">Select source</option>
                {rows.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name} · received {money(f.received_cents)}
                  </option>
                ))}
              </select>
            </label>
            <Input name="total" label="New cumulative received amount (CAD)" type="number" />
            <Input name="received_on" label="Receipt date (if known)" type="date" required={false} />
          </Form>
        </Panel>
      </div>
      <Panel title="Funding records">
        <FundingTable rows={rows} />
      </Panel>
      {!DEMO && (
        <>
          <FundingRulesForm programs={data.programs} rows={rows} save={save} busy={busy} />
          <FundingExpiryForm rows={rows} save={save} busy={busy} />
          <FundingAwardForm rows={rows} save={save} busy={busy} />
          <div className="twocol">
            <FundingCommitmentForm rows={rows} save={save} busy={busy} />
            <FundingReturnForm rows={rows} save={save} busy={busy} />
          </div>
        </>
      )}
      <ReceiptHistory api={api} rows={rows} />
      <CarryForward data={data} year={year} save={save} busy={busy} />
    </>
  );
}
export function fundingRules(funding?: Funding): FundingEligibility {
  return {
    eligible_programs:
      funding?.eligible_programs ?? (funding?.eligible_program ? [funding.eligible_program] : []),
    eligible_suppliers:
      funding?.eligible_suppliers ?? (funding?.eligible_supplier ? [funding.eligible_supplier] : []),
    eligible_purchase_types:
      funding?.eligible_purchase_types ??
      (funding?.eligible_purchase_type ? [funding.eligible_purchase_type] : []),
  };
}
export function fundingRuleSummary(funding: Funding) {
  const rules = fundingRules(funding);
  return [
    rules.eligible_programs.join(', ') || 'All programs',
    rules.eligible_suppliers.join(', '),
    rules.eligible_purchase_types.join(', '),
  ]
    .filter(Boolean)
    .join(' · ');
}
export function readFundingRuleFields(form: FormData): FundingEligibility {
  return {
    eligible_programs: form.getAll('eligible_programs').map(String),
    eligible_suppliers: field(form, 'eligible_suppliers')
      .split('\n')
      .map((label) => label.trim())
      .filter(Boolean),
    eligible_purchase_types: field(form, 'eligible_purchase_types')
      .split('\n')
      .map((label) => label.trim())
      .filter(Boolean),
  };
}
export function FundingRuleFields({
  programs,
  initial = fundingRules(),
}: {
  programs: Program[];
  initial?: FundingEligibility;
}) {
  return (
    <>
      <fieldset className="funding-programs">
        <legend>Eligible programs</legend>
        <p className="muted">Leave all unchecked to allow any program.</p>
        {programs.map((program) => (
          <label key={program.code}>
            <input
              type="checkbox"
              name="eligible_programs"
              value={program.code}
              defaultChecked={initial.eligible_programs.includes(program.code)}
            />
            {program.name}
          </label>
        ))}
      </fieldset>
      <label>
        Eligible suppliers (one per line)
        <textarea name="eligible_suppliers" rows={3} defaultValue={initial.eligible_suppliers.join('\n')} />
      </label>
      <label>
        Eligible purchase types (one per line)
        <textarea
          name="eligible_purchase_types"
          rows={3}
          defaultValue={initial.eligible_purchase_types.join('\n')}
        />
      </label>
      <p className="muted">
        Leave a list blank to allow any value. Use the supplier and purchase type names staff enter on
        purchases.
      </p>
    </>
  );
}
export function FundingRulesForm({
  programs,
  rows,
  save,
  busy,
}: {
  programs: Program[];
  rows: Funding[];
  save: Save;
  busy: boolean;
}) {
  const [sourceId, setSourceId] = useState('');
  const source = rows.find((row) => String(row.id) === sourceId);
  const initial = fundingRules(source);
  return (
    <Panel title="Edit spending rules">
      <label>
        Funding source
        <select value={source ? sourceId : ''} onChange={(event) => setSourceId(event.target.value)}>
          <option value="">Choose source</option>
          {rows.map((row) => (
            <option key={row.id} value={row.id}>
              {row.name}
            </option>
          ))}
        </select>
      </label>
      {source && (
        <Form
          key={source.id}
          busy={busy}
          button="Save spending rules"
          onSubmit={async (form) =>
            save(
              '/funding/' + source.id + '/eligibility',
              { ...readFundingRuleFields(form), expected: initial, reason: field(form, 'reason') },
              'PATCH',
            )
          }
        >
          <FundingRuleFields programs={programs} initial={initial} />
          <Input name="reason" label="Reason" />
        </Form>
      )}
    </Panel>
  );
}
export function FundingAwardForm({ rows, save, busy }: { rows: Funding[]; save: Save; busy: boolean }) {
  return (
    <Panel title="Update an award or expected donation">
      <Form
        busy={busy}
        button="Save updated award"
        onSubmit={async (f) =>
          save(
            '/funding/' + field(f, 'source') + '/award',
            {
              expected_cents: cents(field(f, 'award')),
              reason: field(f, 'reason'),
            },
            'PATCH',
          )
        }
      >
        <label>
          Funding source to update
          <select name="source" required>
            <option value="">Choose source</option>
            {rows.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name} · {money(row.expected_cents)}
              </option>
            ))}
          </select>
        </label>
        <Input name="award" label="Updated total award (CAD)" type="number" />
        <Input name="reason" label="Reason for updating the award" />
      </Form>
    </Panel>
  );
}
export function FundingExpiryForm({ rows, save, busy }: { rows: Funding[]; save: Save; busy: boolean }) {
  return (
    <Panel title="Update funding expiry">
      <Form
        busy={busy}
        button="Save expiry"
        onSubmit={async (form) =>
          save(
            '/funding/' + field(form, 'id') + '/expiry',
            { expiry: field(form, 'expiry') || null, reason: field(form, 'reason') },
            'PATCH',
          )
        }
      >
        <label>
          Funding source
          <select name="id" required>
            <option value="">Choose source</option>
            {rows.map((source) => (
              <option key={source.id} value={source.id}>
                {source.name} · {source.expiry ? 'Expires ' + source.expiry : 'No expiry recorded'}
              </option>
            ))}
          </select>
        </label>
        <Input name="expiry" label="New expiry date (leave blank to clear)" type="date" required={false} />
        <Input name="reason" label="Reason" />
      </Form>
    </Panel>
  );
}
export function CarryForward({
  data,
  year,
  save,
  busy,
}: {
  data: Data;
  year: string;
  save: Save;
  busy: boolean;
}) {
  const rows = data.funding.filter((f) => f.academic_year === year);
  const next = String(Number(year.slice(0, 4)) + 1) + '-' + String(Number(year.slice(5)) + 1);
  return (
    <>
      <Panel title="Grant carry-forward permission">
        <Form
          busy={busy}
          button="Record permission"
          onSubmit={async (f) =>
            save(
              '/funding/' + field(f, 'id') + '/carry-permission',
              {
                ...(DEMO ? { eligible: field(f, 'eligible') === 'yes' } : { status: field(f, 'eligible') }),
                reason: field(f, 'reason'),
              },
              'PATCH',
            )
          }
        >
          <label>
            Funding source
            <select name="id" required>
              <option value="">Choose source</option>
              {rows.map((r) => (
                <option value={r.id} key={r.id}>
                  {r.name} · {carryLabel(r)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Grant permits carry-forward
            <select name="eligible">
              {DEMO ? (
                <>
                  <option value="no">No / to confirm</option>
                  <option value="yes">Yes</option>
                </>
              ) : (
                <CarryOptions />
              )}
            </select>
          </label>
          <Input name="reason" label="Evidence or reason" />
        </Form>
      </Panel>
      <Panel title="Transfer unused funding">
        <p className="muted">
          Release unused budget allocations first. Transfers preserve grant restrictions and do not create a
          new receipt. Both years must be configured.
        </p>
        <Form
          busy={busy}
          button="Confirm transfer"
          onSubmit={async (f) => {
            if (!window.confirm('Transfer this balance to the next academic year?'))
              throw new Error('No changes made.');
            await save('/funding/' + field(f, 'id') + '/carry-forward', {
              destination_year: next,
              cents: cents(field(f, 'amount')),
              reason: field(f, 'reason'),
            });
          }}
        >
          <label>
            Eligible funding
            <select name="id" required>
              <option value="">Choose source</option>
              {rows
                .filter((r) => r.carry_eligible)
                .map((r) => (
                  <option value={r.id} key={r.id}>
                    {r.name} · {money(r.unallocated_cents)} unallocated
                  </option>
                ))}
            </select>
          </label>
          <p>
            Destination: {next} {data.periods.some((p) => p.academic_year === next) ? '' : '(not configured)'}
          </p>
          <Input name="amount" label="Transfer amount (CAD)" type="number" />
          <Input name="reason" label="Transfer reason" />
        </Form>
      </Panel>
      <Panel title="Transfer history">
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Source</th>
                <th>From</th>
                <th>To</th>
                <th>Amount</th>
                <th>Reason</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.transfers
                .filter((t) => t.source_year === year || t.destination_year === year)
                .map((t) => (
                  <tr key={t.id}>
                    <td>
                      {t.funding_name} ({t.kind})
                    </td>
                    <td>{t.source_year}</td>
                    <td>{t.destination_year}</td>
                    <td>{money(t.cents)}</td>
                    <td>{t.reason}</td>
                    <td>{t.reversed ? 'Reversed: ' + t.reversal_reason : 'Active'}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <Form
          busy={busy}
          button="Reverse transfer"
          onSubmit={async (f) => {
            if (!window.confirm('Reverse this transfer?')) throw new Error('No changes made.');
            await save('/funding-transfers/' + field(f, 'transfer') + '/reverse', {
              reason: field(f, 'reason'),
            });
          }}
        >
          <label>
            Transfer
            <select name="transfer" required>
              <option value="">Choose active transfer</option>
              {data.transfers
                .filter((t) => !t.reversed && (t.source_year === year || t.destination_year === year))
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.funding_name} · {money(t.cents)}
                  </option>
                ))}
            </select>
          </label>
          <Input name="reason" label="Reversal reason" />
        </Form>
      </Panel>
    </>
  );
}
export function ReceiptHistory({ api, rows }: { api: Api; rows: Funding[] }) {
  const [id, setId] = useState('');
  const [receipts, setReceipts] = useState<FundingReceipt[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setReceipts(null);
    setError('');
    if (id)
      api<FundingReceipt[]>('/funding/' + id + '/receipts')
        .then((r) => {
          if (active) setReceipts(r);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    return () => {
      active = false;
    };
  }, [api, id, rows]);
  return (
    <Panel title="Funding receipt history">
      <label>
        Funding source
        <select value={id} onChange={(e) => setId(e.target.value)}>
          <option value="">Select funding source</option>
          {rows.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </label>
      {error && <p role="alert">{error}</p>}
      {receipts && (
        <table>
          <thead>
            <tr>
              <th>Received date</th>
              <th>Amount</th>
              <th>Recorded by</th>
            </tr>
          </thead>
          <tbody>
            {receipts.map((r) => (
              <tr key={r.id}>
                <td>{r.received_on || 'Unknown'}</td>
                <td>{money(r.cents)}</td>
                <td>{r.actor}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

function FundingCommitmentForm({ rows, save, busy }: { rows: Funding[]; save: Save; busy: boolean }) {
  return (
    <Panel title="Confirm or downgrade a pledge">
      <p className="muted">Unconfirmed pledges are shown apart from committed expected funds.</p>
      <Form
        busy={busy}
        button="Save pledge status"
        onSubmit={async (f) =>
          save(
            '/funding/' + field(f, 'id') + '/commitment',
            { commitment: field(f, 'commitment'), reason: field(f, 'reason') },
            'PATCH',
          )
        }
      >
        <label>
          Funding source
          <select name="id" required>
            <option value="">Choose source</option>
            {rows.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name} · {row.commitment === 'unconfirmed' ? 'Unconfirmed' : 'Committed'}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select name="commitment">
            <option value="committed">Committed by the funder</option>
            <option value="unconfirmed">Unconfirmed pledge or estimate</option>
          </select>
        </label>
        <Input name="reason" label="Evidence or reason" />
      </Form>
    </Panel>
  );
}

function FundingReturnForm({ rows, save, busy }: { rows: Funding[]; save: Save; busy: boolean }) {
  return (
    <Panel title="Return unused funds to a funder">
      <p className="muted">
        Some grants require unspent money to be paid back. Release unused budget allocations first. The return
        lowers the source's available funding and is counted as cash leaving the bank.
      </p>
      <Form
        busy={busy}
        button="Record return"
        onSubmit={async (f) => {
          if (!window.confirm('Record this return to the funder? It cannot be edited afterwards.'))
            throw new Error('No changes made.');
          await save('/funding/' + field(f, 'id') + '/returns', {
            cents: cents(field(f, 'amount')),
            returned_on: field(f, 'returned_on'),
            reason: field(f, 'reason'),
          });
        }}
      >
        <label>
          Funding source
          <select name="id" required>
            <option value="">Choose source</option>
            {rows.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name} · {money(row.unallocated_cents)} unallocated
              </option>
            ))}
          </select>
        </label>
        <Input name="amount" label="Amount returned (CAD)" type="number" />
        <Input name="returned_on" label="Date returned" type="date" />
        <Input name="reason" label="Reason, e.g. grant terms require unused funds back" />
      </Form>
    </Panel>
  );
}
