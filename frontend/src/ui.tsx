import React, { useState } from 'react';
import { money } from './api';
import type {
  Program,
  Funding,
  Budget,
  Transaction,
  Dashboard,
  AuditEvent,
  AcademicPeriod,
  FundingTransfer,
} from './api';

export const DEMO = import.meta.env.MODE === 'pages';
export type Data = {
  programs: Program[];
  funding: Funding[];
  budgets: Budget[];
  transactions: Transaction[];
  dashboard: Dashboard;
  audit: AuditEvent[];
  periods: AcademicPeriod[];
  transfers: FundingTransfer[];
};
export type Save = (path: string, body: unknown, method?: string) => Promise<void>;
export const pages = [
  'Overview',
  'Funding & grants',
  'Programs & budgets',
  'Transactions',
  'History',
  'Audit log',
  'Reports',
  ...(!DEMO ? (['Financial insights', 'Assistant'] as const) : []),
  'Academic years',
  'Reconciliation',
  'Excel import',
  'Account',
] as const;
export type Page = (typeof pages)[number];
export const field = (f: FormData, k: string) => String(f.get(k) || '');
export function Input({
  name,
  label,
  type = 'text',
  required = true,
  defaultValue,
}: {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  defaultValue?: string;
}) {
  return (
    <label>
      {label}
      <input
        name={name}
        type={type}
        required={required}
        defaultValue={defaultValue}
        step={type === 'number' ? '0.01' : undefined}
        min={type === 'number' ? '0' : undefined}
      />
    </label>
  );
}
export function ProgramSelect({
  programs,
  name = 'program',
  optional = false,
}: {
  programs: Program[];
  name?: string;
  optional?: boolean;
}) {
  return (
    <select
      aria-label={
        name === 'suggestProgram' ? 'Program for suggestion' : optional ? 'Program restriction' : 'Program'
      }
      name={name}
      required={!optional}
    >
      {optional && <option value="">All programs</option>}
      {programs.map((p) => (
        <option key={p.code} value={p.code}>
          {p.name} · {p.code}
        </option>
      ))}
    </select>
  );
}
export function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="panel">
      <h2>{title}</h2>
      {children}
    </section>
  );
}
export function Form({
  children,
  onSubmit,
  button,
  busy,
  formRef,
}: {
  children: React.ReactNode;
  onSubmit: (data: FormData) => Promise<void>;
  button: string;
  busy: boolean;
  formRef?: React.Ref<HTMLFormElement>;
}) {
  const [error, setError] = useState('');
  return (
    <form
      ref={formRef}
      onSubmit={async (e) => {
        e.preventDefault();
        setError('');
        const el = e.currentTarget;
        try {
          await onSubmit(new FormData(el));
          el.reset();
        } catch (e) {
          setError(String((e as Error).message));
        }
      }}
    >
      {children}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <button disabled={busy} type="submit">
        {button}
      </button>
    </form>
  );
}
export function BalanceMetrics({ values }: { values: [string, number][] }) {
  return (
    <div className="balance-metrics">
      {values.map(([label, amount]) => (
        <div className="metric" key={label}>
          <span>{label}</span>
          <strong>{money(amount)}</strong>
        </div>
      ))}
    </div>
  );
}
