import { useState, useEffect, useMemo, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import {
  makeApi,
  CatalogEntry,
  Session,
  Program,
  Funding,
  Budget,
  Transaction,
  Dashboard,
  Api,
  AuditEvent,
  AcademicPeriod,
  FundingTransfer,
} from './api';
import './style.css';
import { makeDemoApi } from './demo';
import { desktop, DesktopBackup } from './desktop-backup';
import { FinancialInsights } from './financial-insights';
import { FinanceAssistant } from './assistant';
import { StaffSetup } from './staff-setup';
import { DEMO, Data, Save, Page, pages, field, Input, Panel } from './ui';
import { Overview } from './pages/overview';
import { FundingPage } from './pages/funding';
import { BudgetsPage } from './pages/budgets';
import { TransactionsPage, History } from './pages/purchases';
import { AuditLog, Reports } from './pages/reports';
import { AcademicYears, Reconciliation, ExcelImport } from './pages/settings';
import { Account, BankBalanceCheck } from './pages/accounts';

function Workspace({ api, logout, session }: { api: Api; logout?: () => void; session?: Session }) {
  const [year, setYear] = useState('2026-2027');
  const [page, setPage] = useState<Page>('Overview');
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [version, setVersion] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const openPage = (next: Page) => {
    setPage(next);
    setMessage('');
    requestAnimationFrame(() => heading.current?.focus());
  };
  useEffect(() => {
    let active = true;
    setData(null);
    setError('');
    Promise.all([
      api<Program[]>('/programs'),
      api<Funding[]>('/funding'),
      api<Budget[]>('/budgets'),
      api<Transaction[]>('/transactions'),
      api<Dashboard>('/dashboard?year=' + encodeURIComponent(year)),
      api<AuditEvent[]>('/audit'),
      api<AcademicPeriod[]>('/academic-years'),
      api<FundingTransfer[]>('/funding-transfers'),
      api<CatalogEntry[]>('/catalog'),
    ])
      .then(([programs, funding, budgets, transactions, dashboard, audit, periods, transfers, catalog]) => {
        if (active)
          setData({
            programs,
            funding,
            budgets,
            transactions,
            dashboard,
            audit,
            periods,
            transfers,
            catalog,
          });
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [api, year, version]);
  const save: Save = async (path, body, method = 'POST') => {
    setBusy(true);
    setMessage('');
    try {
      await api(path, method, body);
      setMessage('Record saved successfully.');
      setVersion((v) => v + 1);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="shell">
      <a className="skip-link" href="#workspace-main">
        Skip to content
      </a>
      <aside>
        <div className="brand">
          ASUFC<span>FINANCE WORKSPACE</span>
        </div>
        <nav aria-label="Finance workspace">
          {pages.map((p) => (
            <button
              className={page === p ? 'active' : ''}
              aria-current={page === p ? 'page' : undefined}
              key={p}
              onClick={() => openPage(p)}
            >
              {p}
            </button>
          ))}
        </nav>
        {session && !DEMO && (
          <p className="signed-in">
            Signed in as <strong>{session.username}</strong>
            {session.role === 'admin' ? ' · Administrator' : ''}
          </p>
        )}
        {logout && (
          <button className="logout" onClick={logout}>
            Sign out
          </button>
        )}
      </aside>
      <main id="workspace-main" tabIndex={-1}>
        {DEMO && (
          <div className="demo-banner" role="note">
            <strong>Public demonstration — fictional data only.</strong> Changes stay in this tab and reset on
            reload. Server-only operations (Excel import/export, grant transfers, restriction edits, password
            changes and period edits) are unavailable. Never enter real records.
          </div>
        )}
        <header>
          <div>
            <div className="eyebrow">
              {desktop ? 'STAFF DESKTOP LEDGER' : 'INTERNAL ADMINISTRATION · DEVELOPMENT'}
            </div>
            <h1 ref={heading} tabIndex={-1}>
              {page}
            </h1>
          </div>
          <label>
            Academic year
            <select aria-label="Academic year" value={year} onChange={(e) => setYear(e.target.value)}>
              {Array.from(
                new Set([
                  year,
                  '2026-2027',
                  ...(data?.periods || []).map((p) => p.academic_year),
                  ...(data?.funding || []).map((f) => f.academic_year),
                ]),
              )
                .sort()
                .map((y) => (
                  <option key={y}>{y}</option>
                ))}
            </select>
          </label>
        </header>
        {message && (
          <p role="status" className="success">
            {message}
          </p>
        )}
        {error ? (
          <p role="alert" className="error">
            {error} <button onClick={() => setVersion((v) => v + 1)}>Retry</button>
          </p>
        ) : !data ? (
          <p>Loading financial records…</p>
        ) : page === 'Overview' ? (
          <Overview data={data} year={year} openPage={openPage} />
        ) : page === 'Funding & grants' ? (
          <FundingPage data={data} year={year} save={save} busy={busy} api={api} />
        ) : page === 'Programs & budgets' ? (
          <BudgetsPage data={data} year={year} save={save} busy={busy} />
        ) : page === 'Transactions' ? (
          <TransactionsPage key={year} data={data} year={year} save={save} busy={busy} api={api} />
        ) : page === 'History' ? (
          <History key={year} data={data} year={year} save={save} busy={busy} api={api} />
        ) : page === 'Audit log' ? (
          <AuditLog events={data.audit} />
        ) : page === 'Reports' ? (
          <Reports key={year} data={data} year={year} api={api} />
        ) : page === 'Financial insights' ? (
          <FinancialInsights year={year} programs={data.programs} api={api} />
        ) : !DEMO && page === 'Assistant' ? (
          <FinanceAssistant key={year} year={year} programs={data.programs} api={api} openPage={openPage} />
        ) : page === 'Academic years' ? (
          <AcademicYears data={data} save={save} busy={busy} />
        ) : page === 'Reconciliation' ? (
          <>
            {!DEMO && <BankBalanceCheck api={api} />}
            <Reconciliation api={api} year={year} />
          </>
        ) : page === 'Account' ? (
          desktop ? (
            <DesktopBackup api={api} />
          ) : (
            logout && <Account api={api} onChanged={logout} session={session} />
          )
        ) : (
          <>
            {!DEMO && !data.periods.length && !data.funding.length && (
              <StaffSetup
                api={api}
                onApplied={(text) => {
                  setMessage(text);
                  setVersion((v) => v + 1);
                }}
              />
            )}
            <ExcelImport
              api={api}
              data={data}
              onImported={(count) => {
                setMessage(count + ' purchases imported.');
                setVersion((v) => v + 1);
              }}
            />
          </>
        )}
      </main>
    </div>
  );
}
function WebApp() {
  const api = useMemo(() => (DEMO ? makeDemoApi() : makeApi()), []);
  const [session, setSession] = useState<Session | null>(null);
  const authenticated = session !== null;
  const setAuthenticated = (signedIn: boolean) => {
    if (!signedIn) setSession(null);
    else
      api<Session>('/auth/session')
        .then(setSession)
        .catch(() => setSession(null));
  };
  const [checking, setChecking] = useState(true),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    api<Session>('/auth/session')
      .then(setSession)
      .catch(() => {})
      .finally(() => setChecking(false));
  }, [api]);
  if (checking) return <p>Checking staff session…</p>;
  if (authenticated)
    return (
      <Workspace
        api={api}
        session={session}
        logout={() => {
          api('/auth/logout', 'POST')
            .then(() => setAuthenticated(false))
            .catch((e) => {
              setError(e.message);
              setAuthenticated(false);
            });
        }}
      />
    );
  return (
    <div className="login">
      <Panel title="ASUFC Finance">
        <p>
          {DEMO
            ? 'Public demonstration. All records are fictional. No server or real authentication is connected.'
            : 'Staff-only development workspace. Use fictional records only.'}
        </p>
        {DEMO ? (
          <button
            onClick={async () => {
              await api('/auth/login', 'POST', { username: 'demo', password: 'demo' });
              setAuthenticated(true);
            }}
          >
            Enter public demo
          </button>
        ) : (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const el = e.currentTarget;
              const f = new FormData(el);
              setBusy(true);
              setError('');
              try {
                await api('/auth/login', 'POST', {
                  username: field(f, 'user'),
                  password: field(f, 'password'),
                });
                el.reset();
                setAuthenticated(true);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Input name="user" label="Username" />
            <Input name="password" label="Password" type="password" />
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <button disabled={busy}>Sign in</button>
          </form>
        )}
      </Panel>
    </div>
  );
}
function DesktopApp() {
  const api = useMemo(makeApi, []);
  return <Workspace api={api} />;
}

createRoot(document.getElementById('root')!).render(desktop && !DEMO ? <DesktopApp /> : <WebApp />);
