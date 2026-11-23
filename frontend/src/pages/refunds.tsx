import { useState } from 'react';
import { Transaction, cents, money } from '../api';
import { Form, Input, Panel, Save, field } from '../ui';

/** Record money returned on a purchase, such as a missing item or a delivery refund. */
export function RefundForm({
  transactions,
  save,
  busy,
}: {
  transactions: Transaction[];
  save: Save;
  busy: boolean;
}) {
  const [selected, setSelected] = useState('');
  const purchase = transactions.find((t) => String(t.id) === selected);
  return (
    <Panel title="Record a refund">
      <p className="muted">
        A refund lowers the spending on each budget that paid for the purchase, so those balances become
        available again. The original purchase stays unchanged in history.
      </p>
      <Form
        busy={busy}
        button="Save refund"
        onSubmit={async (f) => {
          if (!purchase) throw new Error('Choose a purchase.');
          const allocations = purchase.allocations
            .map((a) => ({
              budget_id: a.budget_id,
              cents: field(f, 'refund-' + a.budget_id) ? cents(field(f, 'refund-' + a.budget_id)) : 0,
            }))
            .filter((a) => a.cents > 0);
          if (!allocations.length) throw new Error('Enter the refunded amount for at least one budget.');
          await save('/transactions/' + purchase.id + '/refunds', {
            refund_date: field(f, 'refund_date'),
            reason: field(f, 'reason'),
            allocations,
          });
          setSelected('');
        }}
      >
        <label>
          Purchase
          <select required value={selected} onChange={(e) => setSelected(e.target.value)}>
            <option value="">Select confirmed purchase</option>
            {transactions.map((t) => (
              <option key={t.id} value={t.id}>
                #{t.id} · {t.purchase_date} · {t.supplier} · {money(t.cents - (t.refunded_cents ?? 0))} net
              </option>
            ))}
          </select>
        </label>
        {purchase?.allocations.map((a) => (
          <label key={a.budget_id}>
            Refunded to {a.program} · {a.funding} (paid {money(a.cents)}, CAD)
            <input
              name={'refund-' + a.budget_id}
              type="number"
              min="0"
              step="0.01"
              defaultValue={purchase.allocations.length === 1 ? '' : '0'}
            />
          </label>
        ))}
        <Input name="refund_date" label="Refund date" type="date" />
        <Input name="reason" label="Reason, e.g. missing items refunded by the store" />
      </Form>
    </Panel>
  );
}
