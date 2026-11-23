import { CatalogEntry } from '../api';
import { Form, Input, Panel, Save, field } from '../ui';

const LABELS = { supplier: 'Suppliers', purchase_type: 'Purchase types' } as const;

/**
 * Spending rules and reports match these names exactly, so keep one spelling for each
 * supplier and purchase type. Merging a typo renames its purchases and rules.
 */
export function CatalogManager({
  catalog,
  save,
  busy,
}: {
  catalog: CatalogEntry[];
  save: Save;
  busy: boolean;
}) {
  return (
    <>
      <div className="twocol">
        {(['supplier', 'purchase_type'] as const).map((kind) => (
          <Panel title={LABELS[kind]} key={kind}>
            <ul className="catalog-list">
              {catalog
                .filter((entry) => entry.kind === kind)
                .map((entry) => (
                  <li key={entry.id}>
                    {entry.name} <small>{entry.purchase_count} purchases</small>
                  </li>
                ))}
            </ul>
            <Form
              busy={busy}
              button={'Add to ' + LABELS[kind].toLowerCase()}
              onSubmit={async (f) => save('/catalog', { kind, name: field(f, 'name') })}
            >
              <Input name="name" label={kind === 'supplier' ? 'Supplier name' : 'Purchase type'} />
            </Form>
          </Panel>
        ))}
      </div>
      <Panel title="Merge duplicate names">
        <p className="muted">
          Use this when the same supplier or purchase type was entered with different spellings, such as a
          typo. Every purchase, pending purchase and spending rule that uses the first name switches to the
          second.
        </p>
        <Form
          busy={busy}
          button="Merge names"
          onSubmit={async (f) => {
            const from = catalog.find((entry) => String(entry.id) === field(f, 'from'));
            const into = catalog.find((entry) => String(entry.id) === field(f, 'into'));
            if (!from || !into) throw new Error('Choose both names.');
            if (!window.confirm(`Rename every use of "${from.name}" to "${into.name}"?`))
              throw new Error('No changes made.');
            await save('/catalog/' + from.id + '/merge', { into_id: into.id, reason: field(f, 'reason') });
          }}
        >
          {(['from', 'into'] as const).map((role) => (
            <label key={role}>
              {role === 'from' ? 'Replace this name' : 'With this name'}
              <select name={role} required>
                <option value="">Choose name</option>
                {(['supplier', 'purchase_type'] as const).map((kind) => (
                  <optgroup label={LABELS[kind]} key={kind}>
                    {catalog
                      .filter((entry) => entry.kind === kind)
                      .map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.name}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </select>
            </label>
          ))}
          <Input name="reason" label="Reason" />
        </Form>
      </Panel>
    </>
  );
}
