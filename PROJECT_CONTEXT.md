# ASUFC Finance project context

The Acadia Students' Union Food Cupboard partnered with the COMP 2663 Software Engineering 1 team to replace manual Excel spending and funding tracking. Staff must be able to trace purchases to eligible budgets and distinguish confirmed cash, purchasing credits and expected funding. The requirements cover the four existing program codes and custom programs, split allocations, purchase review and corrections, expiry, audited budget and funding changes, historical academic years and reporting.

React and Vite provide the interface. FastAPI authenticates staff, applies financial and eligibility rules and reads and writes a PostgreSQL ledger through Psycopg. Budget balances represent allocations to a program and funding source. A confirmed purchase spends from one or more budgets. Voiding preserves the recorded purchase and restores its available balances. Internal reconciliation checks the ledger. Bank or card settlement requires separate evidence.

The staff application implements funding receipts, separate cash and credit accounting, audited financial mutations and funding expiry edits, allocation suggestions, duplicate review, purchasing restrictions, program budgets, reports, bounded XLSX import and export, editable academic periods and semesters, authorized carry-forward and reversals. The Caddy Compose configuration supports a private HTTPS gateway. The recovery runbook covers encrypted backups and disposable restore checks. Each staff member signs in with a named account, so the audit log records who made each change. Administrators create, disable and reset accounts, and an operator recovery procedure restores administrator access. Refunds, money returned to funders, unconfirmed pledges and recorded bank balances are kept as separate audited records. Supplier and purchase type names share one catalog spelling.

The [public demonstration](https://jayjpatel223.github.io/ASUFC/) uses a separate Vite build and an in-memory mock transport. Reloading resets the fictional records. The demo supports core spending workflows. Server features such as Excel processing, credential management and actual grants are handled by the staff application.

The single-computer desktop build bundles its own staff interface, API and database. It adds private receipt files, encrypted fresh-profile recovery and reviewed starter-file intake. Pending historical charges stay out of confirmed spending until staff assign them to eligible budgets.

The staff assistant classifies common questions locally and reads verified ledger totals through approved queries. Desktop receipt-photo reading runs an English OCR model locally and copies suggestions to an unsaved form only after staff review.

Institutional access, formal reporting cutoffs, signing, retention and backup custody require confirmed stakeholder decisions. A source can specify several eligible programs, suppliers and purchase types. Rules apply to those fields, so staff still review item-level terms. Keep stakeholder records private and use fictional fixtures in development.

See [architecture](docs/architecture.md), [recovery](docs/recovery.md), [security review](docs/security-review.md), [roadmap](ROADMAP.md) and [progress](PROGRESS.md).
