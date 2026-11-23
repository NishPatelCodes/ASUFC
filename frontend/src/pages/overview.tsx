import { money, Funding } from '../api';
import { Data, Page, Panel, BalanceMetrics } from '../ui';
import { FundingTable } from './funding';

export function Overview({
  data,
  year,
  openPage,
}: {
  data: Data;
  year: string;
  openPage: (page: Page) => void;
}) {
  const cash = data.dashboard.funding.find((source) => source.kind === 'cash');
  const credit = data.dashboard.funding.find((source) => source.kind === 'credit');
  const funding = data.funding.filter((source) => source.academic_year === year);
  const unallocated = (kind: Funding['kind']) =>
    funding
      .filter((source) => source.kind === kind)
      .reduce((total, source) => total + Number(source.unallocated_cents), 0);
  const today = new Date();
  const cutoff = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 30);
  const dateKey = (date: Date) =>
    [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ].join('-');
  const todayKey = dateKey(today);
  const cutoffKey = dateKey(cutoff);
  const alerts = funding.flatMap((source) => {
    const details = [];
    if (source.expiry && source.expiry <= cutoffKey && source.remaining_cents > 0) {
      details.push((source.expiry < todayKey ? 'Expired ' : 'Expires ') + source.expiry);
    }
    if (source.capacity_cents > 0 && source.remaining_cents <= source.capacity_cents * 0.15) {
      details.push('Low balance (' + money(source.remaining_cents) + ')');
    }
    return details.length ? [{ source, details }] : [];
  });
  const recent = data.transactions
    .filter(
      (purchase) =>
        purchase.status === 'confirmed' && purchase.allocations.some((row) => row.academic_year === year),
    )
    .sort((a, b) => b.purchase_date.localeCompare(a.purchase_date) || b.id - a.id)
    .slice(0, 5);

  return (
    <>
      <div className="overview-actions">
        <button onClick={() => openPage('Transactions')}>Record a purchase</button>
        <button className="secondary" onClick={() => openPage('Reports')}>
          Open spending reports
        </button>
      </div>
      {data.dashboard.pending && data.dashboard.pending.count > 0 && (
        <Panel title="Pending purchases">
          <p>
            {data.dashboard.pending.count} awaiting review · {money(data.dashboard.pending.cents)} recorded in
            the source workbook. Balances reflect confirmed allocations. Review these purchases before using
            the remaining funds.
          </p>
          <button className="secondary" onClick={() => openPage('Transactions')}>
            Review pending purchases
          </button>
        </Panel>
      )}
      <div className="overview-columns">
        <section className="panel balance-panel" aria-labelledby="cash-overview">
          <h2 id="cash-overview">Cash</h2>
          <BalanceMetrics
            values={[
              ['Cash remaining', (cash?.capacity ?? 0) - (cash?.spent ?? 0)],
              ['Cash received', cash?.received ?? 0],
              ['Cash spent', cash?.spent ?? 0],
            ]}
          />
        </section>
        <section className="panel balance-panel" aria-labelledby="credit-overview">
          <h2 id="credit-overview">Purchasing credits</h2>
          <BalanceMetrics
            values={[
              ['Credit remaining', (credit?.capacity ?? 0) - (credit?.spent ?? 0)],
              ['Credit received', credit?.received ?? 0],
              ['Credit used', credit?.spent ?? 0],
            ]}
          />
        </section>
      </div>
      <div className="overview-columns">
        <section className="panel" aria-labelledby="funding-overview">
          <h2 id="funding-overview">Expected and unallocated funding</h2>
          <BalanceMetrics
            values={[
              ['Expected cash', cash?.expected ?? 0],
              ['Expected credit', credit?.expected ?? 0],
              ['Unallocated cash', unallocated('cash')],
              ['Unallocated credit', unallocated('credit')],
              ...((cash?.unconfirmed ?? 0) + (credit?.unconfirmed ?? 0) > 0
                ? ([['Unconfirmed pledges', (cash?.unconfirmed ?? 0) + (credit?.unconfirmed ?? 0)]] as [
                    string,
                    number,
                  ][])
                : []),
              ...((cash?.returned ?? 0) + (credit?.returned ?? 0) > 0
                ? ([['Returned to funders', (cash?.returned ?? 0) + (credit?.returned ?? 0)]] as [
                    string,
                    number,
                  ][])
                : []),
            ]}
          />
          <p className="muted">
            Expected funds become available after receipt is confirmed. Check restrictions and expiry before
            allocating a balance.
          </p>
          <details>
            <summary>Carry-forward totals</summary>
            <dl className="carry-totals">
              <dt>Cash carried in</dt>
              <dd>{money(cash?.carried_in ?? 0)}</dd>
              <dt>Cash carried out</dt>
              <dd>{money(cash?.carried_out ?? 0)}</dd>
              <dt>Credit carried in</dt>
              <dd>{money(credit?.carried_in ?? 0)}</dd>
              <dt>Credit carried out</dt>
              <dd>{money(credit?.carried_out ?? 0)}</dd>
            </dl>
          </details>
        </section>
        <Panel title="Funding alerts">
          {alerts.length ? (
            <ul className="funding-alerts">
              {alerts.map(({ source, details }) => (
                <li className="warning" key={source.id}>
                  <strong>{source.name}</strong>
                  <span>{details.join(' · ')}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p>No low balances, upcoming expiry dates or expired balances in this year.</p>
          )}
        </Panel>
      </div>
      <Panel title="Program utilization">
        {data.dashboard.programs.length ? (
          data.dashboard.programs.map((program) => {
            const name =
              data.programs.find((row) => row.code === program.program_code)?.name ?? program.program_code;
            return (
              <div className="barrow" key={program.program_code}>
                <div>
                  <b>{name}</b>
                  <span>
                    {money(program.spent)} / {money(program.allocated)}
                  </span>
                </div>
                <progress
                  aria-label={name + ' budget used'}
                  max={program.allocated || 1}
                  value={program.spent}
                />
                <small>{money(program.allocated - program.spent)} remaining</small>
              </div>
            );
          })
        ) : (
          <p>No budgets for this year.</p>
        )}
      </Panel>
      <Panel title="Recent confirmed purchases">
        {recent.length ? (
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Supplier</th>
                  <th scope="col">Total</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((purchase) => (
                  <tr key={purchase.id}>
                    <td>{purchase.purchase_date}</td>
                    <td>{purchase.supplier}</td>
                    <td>{money(purchase.cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>No confirmed purchases for this year.</p>
        )}
        <button className="secondary overview-link" onClick={() => openPage('History')}>
          View transaction history
        </button>
      </Panel>
      <Panel title="Funding balances">
        <FundingTable rows={funding} />
      </Panel>
    </>
  );
}
