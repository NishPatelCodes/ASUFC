import { useEffect, useState } from 'react';
import { Api, BankStatement, Session, StaffAccount, cents, money } from '../api';
import { Form, Input, Panel, field } from '../ui';

/** Signed-dollar input: bank balances can be overdrawn. */
function signedCents(value: string) {
  const negative = value.trim().startsWith('-');
  const amount = cents(value.trim().replace(/^-/, ''));
  return negative ? -amount : amount;
}

export function Account({ api, onChanged, session }: { api: Api; onChanged: () => void; session?: Session }) {
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Panel title="Change your password">
        <p>Changing your password signs out your active sessions.</p>
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
      {session?.role === 'admin' && <StaffAccounts api={api} self={session.username} />}
    </>
  );
}

function StaffAccounts({ api, self }: { api: Api; self: string }) {
  const [accounts, setAccounts] = useState<StaffAccount[] | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true;
    api<StaffAccount[]>('/staff-accounts')
      .then((rows) => active && setAccounts(rows))
      .catch((failure: Error) => active && setError(failure.message));
    return () => {
      active = false;
    };
  }, [api, version]);
  const run = async (action: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setMessage('');
    try {
      await action();
      setMessage(done);
      setVersion((value) => value + 1);
    } finally {
      setBusy(false);
    }
  };
  const others = (accounts ?? []).filter((account) => account.username !== self);
  return (
    <>
      <Panel title="Staff accounts">
        <p className="muted">
          Give each person their own sign-in so the audit log shows who made each change. Administrators
          manage accounts; everyone can record finances. Disable an account when someone leaves the board.
        </p>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {message && (
          <p role="status" className="success">
            {message}
          </p>
        )}
        {accounts && (
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Username</th>
                  <th scope="col">Role</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((account) => (
                  <tr key={account.username}>
                    <td>
                      {account.username}
                      {account.username === self && <small>You</small>}
                    </td>
                    <td>{account.role === 'admin' ? 'Administrator' : 'Staff'}</td>
                    <td>{account.active ? 'Active' : 'Disabled'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <div className="twocol">
        <Panel title="Add a staff account">
          <Form
            busy={busy}
            button="Create account"
            onSubmit={(f) =>
              run(
                () =>
                  api('/staff-accounts', 'POST', {
                    username: field(f, 'username'),
                    password: field(f, 'password'),
                    role: field(f, 'role'),
                  }),
                'Account created. Share the temporary password privately and ask them to change it.',
              )
            }
          >
            <Input name="username" label="Username" />
            <Input name="password" label="Temporary password (minimum 16 characters)" type="password" />
            <label>
              Role
              <select name="role">
                <option value="staff">Staff</option>
                <option value="admin">Administrator</option>
              </select>
            </label>
          </Form>
        </Panel>
        <Panel title="Change an account">
          <Form
            busy={busy}
            button="Save account change"
            onSubmit={(f) => {
              const change = field(f, 'change');
              const body =
                change === 'disable'
                  ? { active: false }
                  : change === 'enable'
                    ? { active: true }
                    : { role: change };
              return run(
                () =>
                  api('/staff-accounts/' + encodeURIComponent(field(f, 'username')), 'PATCH', {
                    ...body,
                    reason: field(f, 'reason'),
                  }),
                'Account updated.',
              );
            }}
          >
            <label>
              Account
              <select name="username" required>
                <option value="">Choose account</option>
                {others.map((account) => (
                  <option key={account.username}>{account.username}</option>
                ))}
              </select>
            </label>
            <label>
              Change
              <select name="change">
                <option value="disable">Disable sign-in</option>
                <option value="enable">Enable sign-in</option>
                <option value="admin">Make administrator</option>
                <option value="staff">Make staff</option>
              </select>
            </label>
            <Input name="reason" label="Reason" />
          </Form>
          <Form
            busy={busy}
            button="Reset password"
            onSubmit={(f) =>
              run(
                () =>
                  api('/staff-accounts/' + encodeURIComponent(field(f, 'username')) + '/password', 'POST', {
                    password: field(f, 'password'),
                    reason: field(f, 'reason'),
                  }),
                'Password reset. Their sessions were signed out.',
              )
            }
          >
            <label>
              Account
              <select name="username" required>
                <option value="">Choose account</option>
                {others.map((account) => (
                  <option key={account.username}>{account.username}</option>
                ))}
              </select>
            </label>
            <Input name="password" label="New temporary password" type="password" />
            <Input name="reason" label="Reason" />
          </Form>
        </Panel>
      </div>
    </>
  );
}

export function BankBalanceCheck({ api }: { api: Api }) {
  const [rows, setRows] = useState<BankStatement[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true;
    api<BankStatement[]>('/bank-statements')
      .then((result) => active && setRows(result))
      .catch((failure: Error) => active && setError(failure.message));
    return () => {
      active = false;
    };
  }, [api, version]);
  const latest = rows?.[0];
  return (
    <Panel title="Bank balance check">
      <p className="muted">
        Enter the balance from a bank statement or online banking. The ledger figure is cash receipts less
        cash spending, refunds and returned funds up to that date, across all academic years. Purchasing
        credits are excluded because they are not in the bank.
      </p>
      <Form
        busy={busy}
        button="Record bank balance"
        onSubmit={async (f) => {
          setBusy(true);
          try {
            await api('/bank-statements', 'POST', {
              statement_date: field(f, 'date'),
              cents: signedCents(field(f, 'balance')),
              note: field(f, 'note'),
            });
            setVersion((value) => value + 1);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="twocol">
          <Input name="date" label="Statement date" type="date" />
          <label>
            Bank balance (CAD)
            <input name="balance" required inputMode="decimal" pattern="-?\d+(\.\d{1,2})?" />
          </label>
        </div>
        <Input name="note" label="Statement or account note" required={false} />
      </Form>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {latest && (
        <div className="bank-check">
          <p className={latest.difference_cents === 0 ? 'success' : 'warning'}>
            {latest.difference_cents === 0
              ? `The ${latest.statement_date} balance matches the ledger.`
              : `The bank shows ${money(Math.abs(latest.difference_cents))} ${latest.difference_cents > 0 ? 'more' : 'less'} than the ledger on ${latest.statement_date}.`}
          </p>
          {latest.difference_cents !== 0 && (
            <ul>
              {latest.pending_count > 0 && (
                <li>
                  {latest.pending_count} pending purchases ({money(latest.pending_cents)}) are not yet
                  assigned to funding.
                </li>
              )}
              {latest.undated_received_cents > 0 && (
                <li>
                  {money(latest.undated_received_cents)} of receipts have no received date and are counted as
                  already deposited.
                </li>
              )}
              <li>
                Card charges that have not cleared, bank fees and money held before this ledger also differ.
              </li>
            </ul>
          )}
        </div>
      )}
      {rows && rows.length > 0 && (
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Bank</th>
                <th scope="col">Ledger cash</th>
                <th scope="col">Difference</th>
                <th scope="col">Recorded by</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    {row.statement_date}
                    {row.note && <small>{row.note}</small>}
                  </td>
                  <td>{money(row.cents)}</td>
                  <td>{money(row.ledger_cash_cents)}</td>
                  <td>{money(row.difference_cents)}</td>
                  <td>{row.actor}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
