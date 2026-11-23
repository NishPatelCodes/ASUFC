import { cents, money } from '../api';
import { DEMO, Data, Save, field, Input, ProgramSelect, Panel, Form } from '../ui';
import { CatalogManager } from './catalog';

export function BudgetsPage({
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
  return (
    <>
      <Panel title="Add a program">
        <Form
          busy={busy}
          button="Add program"
          onSubmit={async (f) =>
            save('/programs', { code: field(f, 'code').toUpperCase(), name: field(f, 'name') })
          }
        >
          <Input name="code" label="Program code" />
          <Input name="name" label="Program name" />
        </Form>
      </Panel>
      <Panel title="Allocate funding to a program">
        <Form
          busy={busy}
          button="Create budget allocation"
          onSubmit={async (f) =>
            save('/budgets', {
              funding_id: Number(field(f, 'funding')),
              program_code: field(f, 'program'),
              cents: cents(field(f, 'amount')),
            })
          }
        >
          <label>
            Funding source
            <select name="funding" required>
              <option value="">Select funding</option>
              {data.funding
                .filter((f) => f.academic_year === year)
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name} · {money(f.unallocated_cents)} unallocated
                  </option>
                ))}
            </select>
          </label>
          <label>
            Program
            <ProgramSelect programs={data.programs} />
          </label>
          <Input name="amount" label="Budget amount (CAD)" type="number" />
        </Form>
      </Panel>
      <Panel title="Adjust an existing budget">
        <Form
          busy={busy}
          button="Save adjustment"
          onSubmit={async (f) =>
            save(
              '/budgets/' + field(f, 'budget'),
              { cents: cents(field(f, 'amount')), reason: field(f, 'reason') },
              'PATCH',
            )
          }
        >
          <label>
            Budget
            <select name="budget" required>
              <option value="">Select budget</option>
              {data.budgets
                .filter((b) => b.academic_year === year)
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.program_code} · {b.funding_name} · {money(b.cents)}
                  </option>
                ))}
            </select>
          </label>
          <Input name="amount" label="New total budget (CAD)" type="number" />
          <Input name="reason" label="Reason for adjustment" />
        </Form>
      </Panel>
      <Panel title="Budget allocations">
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Program</th>
                <th>Funding</th>
                <th>Allocated</th>
                <th>Spent</th>
                <th>Remaining</th>
              </tr>
            </thead>
            <tbody>
              {data.budgets
                .filter((b) => b.academic_year === year)
                .map((b) => (
                  <tr key={b.id}>
                    <td>{b.program_code}</td>
                    <td>
                      {b.funding_name} ({b.kind})
                    </td>
                    <td>{money(b.cents)}</td>
                    <td>{money(b.cents - b.remaining)}</td>
                    <td>{money(b.remaining)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </Panel>
      {!DEMO && <CatalogManager catalog={data.catalog} save={save} busy={busy} />}
    </>
  );
}
