# Progress
Initial backend foundation: PostgreSQL schema, default program codes, funding confirmation, budget allocation, split purchase validation, transaction list and dashboard aggregates. Integer cents. Local-only development authentication. Unit tests authored; execution not yet verified.
Next: integration tests against PostgreSQL, proper session authentication, audit/correction lifecycle, React dashboard and forms, academic year rules, migrations, Excel and AI. No production deployment or real data.

Verification: 9 of 9 financial validation unit tests passed using Python pytest in an isolated environment. Git blob hashes of rules.py and test_rules.py matched the committed files. PostgreSQL/API integration and Docker startup were not tested because Docker and PostgreSQL were unavailable. No production readiness claim.

## Frontend milestone
Added React/TypeScript/Vite interface with local in-memory credentials, live API dashboard, funding and receipt confirmation forms, program budget allocations, split expense entry, searchable transaction history and academic-year/month/program filters. Basic CSS chosen instead of Tailwind/shadcn to minimize dependencies. No hardcoded balances. Frontend build and browser/API integration have not been verified in this milestone.

## Remaining work (priority order)
- Run dependency install, type check, build, browser tests and PostgreSQL integration tests; add CI.
- Production staff authentication, account handover, sessions, CSRF protections as applicable, HTTPS and deployment review.
- Full grant metadata and restrictions, configurable funding priorities, budget adjustments and custom program codes.
- Academic-year dates and validation, carry-forward; funding receipt history.
- Immutable audit trail, corrections/voids, receipt attachments and backups.
- Dashboard monthly charts, recent transactions, expiry thresholds, eligible funding recommendations.
- Reports, Excel export/import, duplicate detection and approved AI integration.

## Testing and allocation recommendation milestone
- Re-ran the 9 existing backend financial rule tests: 9 passed. Ran 6 frontend API and money utility tests using Node with mocked fetch: 6 passed. TypeScript compilation of the API utility module passed.
- Added 4 funding suggestion unit tests: 4 passed; total observed unit test results: 19 passed, 0 failed. Verified local tested suggestion source/test Git blob hashes match repository files (176f564a83327e1f0cf233a4ccc0d6ffa18d0ca4 and 702b8e0297a1f69d703595ba51a920e2852200ce).
- Added GitHub Actions workflow for full frontend build, frontend tests and PostgreSQL API integration tests using disposable test credentials. CI results not yet available via connector; integration tests authored but not executed locally. Direct Git clone/network dependencies and PostgreSQL/Docker were unavailable in execution environment. Browser rendering not verified.
- Added read-only POST /allocation-suggestions and purchase form integration. Supports a selected program, payment type, supplier, date, amount, academic year and optional preferred funding source. Proposed priority: preferred source, then earliest expiry, then stable budget ID. Only eligible existing budget allocations considered; shows shortfall if insufficient. Staff must review and explicitly save. Manual multi-program and mixed cash/credit allocations remain supported through existing purchase form. This is deterministic assistance, not AI. Priority policy and actual grant rules require stakeholder confirmation.
- Next: verify CI and resolve failures, implement comprehensive audit/corrections and secure staff sessions, add budget adjustments, expand dashboard analytics and reporting, then Excel and approved AI features. Not production-ready.

## Financial record integrity milestone
- Added additive schema changes: purchase_void, audit_event, active_allocation view. Original allocations remain in history; balance and recommendation queries exclude voided purchases.
- Added POST /transactions/{id}/void, PATCH /budgets/{id}, GET /audit. Changes require a reason for voids and budget adjustments; writes and audit entries share a transaction. Frontend includes audit log, void confirmation, budget adjustment and transaction status.
- Audit UI returns latest 500 events; pre-existing records are not backfilled. Staff identity uses the existing development credential. Audit log is application-level, not tamper-proof against DB administrators. Corrections are void plus separately recorded replacement, not atomic or explicitly linked yet.
- Reconstructed committed financial rules and suggestion modules and tests locally; git blob hashes matched, including updated test_rules.py cdcc4c0a9b06bd3b3407bc71beaf7bdf9161335b. Executed python -m pytest: 15 passed, zero failed, including two new regression tests (duplicate budget and cross-year rejection). Previous six frontend utility results were not rerun this round.
- Added PostgreSQL integration regression for voiding, balance restoration, duplicate void rejection, budget limits and audit events. Not executed: PostgreSQL, psycopg and Docker unavailable. Git clone failed DNS lookup. Connector returned no workflow runs or combined statuses; full UI build and integration remain unverified.
- Next: verify CI, add linked atomic correction, audit pagination and secure staff sessions, then reporting, Excel, academic-year rollover, receipt handling and approved AI. Do not use real data yet.

## Spending reports milestone
- Added allocation-level reporting service, GET /reports/spending and React Reports page. Filters: academic year, date interval, program, exact case-insensitive supplier, funding ID. Cash and purchasing credits are separate; voided purchases excluded; count distinct purchases rather than allocations. Filtered totals reflect matching allocations only.
- Four new reporting unit tests executed locally: 4 passed in 0.06s. Tested Git blob hashes matched repository (reporting.py a4726c8965a2c1ab412f6737b705f2683d64c745; test_reporting.py 0a0e57bfbc479d6903132c329af5dc4fd8c15a52). Added PostgreSQL reporting regression test but not executed. Cumulative historical unit-test count 25; not a single full-suite run.
- Reports currently use tables and summary cards, not charts. Semester configuration, zero-spend month filling, supplier normalization, exports, and secure production sessions remain outstanding. Git clone still fails DNS; PostgreSQL/Docker and full frontend integration not verified. No real financial data.

## Finance-first milestone
- Added spending Excel export with six sheets, shared report filters, purchase type filter and monthly cash/credit chart. Text cells forced to string to prevent formula execution. Export is allocation-level, not a full ledger backup.
- Executed two Excel unit tests locally with openpyxl 3.1.5: 2 passed in 0.18s. Git blob hashes matched export.py c22be31e84401fa2773b8de59535b59ff2a60d47, reporting.py a4726c8965a2c1ab412f6737b705f2683d64c745 and test_export.py abcc2b5850212ee9950d65f4ab2f9dcb0a31cd8b. No full-suite rerun. Git DNS access remains blocked.
- Finance acceptance gates outstanding: full PostgreSQL and frontend build/browser tests; atomic linked corrections; academic-year/semester configuration and carry-forward; full grant restrictions and receipt history; funding and budget balance report/export; Excel migration with duplicate prevention; financial reconciliation, concurrency and security checks. Do not claim 100% until verified. Defer AI and unrelated enhancements.

## CI incident resolution — 2026-11-19
- Failed run [44553037436](https://github.com/JayJPatel223/ASUFC/actions/runs/44553037436), backend job 135661566452: pytest collection failed with ModuleNotFoundError: No module named 'openpyxl' because Excel tests landed before the dependency manifest update.
- Fixed by existing commit 834c239729ce9c80b028eda247711d5fe6a55e07 adding openpyxl>=3.1,<4. Verified subsequent runs; latest tested commit 40b7254b1f5f3c193e427f4d5343aba860f5cad2 [CI run 44553207681](https://github.com/JayJPatel223/ASUFC/actions/runs/44553207681) succeeded in both jobs. Backend log: 24 passed, 1 warning in 0.76s, including three real PostgreSQL integration tests. Frontend log: TypeScript/Vite build succeeded; 6 tests passed, zero failed/skipped. Total 30 passing tests in this single CI run. Browser end-to-end testing, concurrent writes, full financial acceptance and production security still pending.
- Nonblocking warnings: Starlette TestClient httpx deprecation and GitHub Actions runtime deprecation. Review dependency compatibility separately; not the cause of the failed run.
- Process improvement: commit dependency manifests, implementation and corresponding tests together in one atomic Git commit, and verify the current CI job logs before declaring a milestone tested. Earlier local integration limitations do not negate the successful CI tests above.

## Linked corrections and grant receipts
- Atomic correction endpoint, rollback on invalid replacement, original/replacement linkage and receipt history. Added grant organization, classification, recurrence, expected date, notes. Frontend correction and receipt views added. CI verification pending for this commit; further restriction and year management work remains.

## Academic period configuration
Added configurable consecutive academic years and non-overlapping semesters; purchase dates validated when a year has been configured. Legacy unconfigured year buckets still supported until dates are confirmed. No assumed Acadia dates seeded. New integration test added; CI pending. Carry-forward remains outstanding.

Academic period configuration UI, year selector and semester report presets added. CI pending. Year configuration is creation-only; edits and funding rollover require separate safeguarded workflows.

## Funding carry-forward backend
Separate transfer records preserve new receipts vs transferred balances. Only explicitly permitted grants can transfer unallocated capacity to the configured next academic year; expiry and existing restrictions preserved, no new receipt, destination eligibility defaults false. Zero-spend budgets can be reduced to zero. Transfer timing policy (pre-year planning allowed) needs stakeholder confirmation. Frontend and CI verification pending.

Carry-forward permission and transfer forms, transfer history, separate carried-in/out dashboard metrics, and capacity-based balances connected to frontend. CI pending. Transfers are not reversible through the UI yet; stakeholder timing and permissions require confirmation.

## Internal reconciliation and balance reports
Added independent raw-ledger calculations under a consistent read-only PostgreSQL snapshot; detects mismatched receipts and purchase allocations, cross-year purchases, overspent budgets/funding, overallocations, transfer year/type mismatch. New Reconciliation page with source and budget balances. No external bank reconciliation or automatic repair. Added three unit tests and one PostgreSQL integration regression with deliberately inconsistent disposable test data. CI pending.

Added reconciliation workbook export with funding, budget and issue worksheets, formula-safe text and authenticated download. Added workbook and download regression tests. Internal reconciliation is not external bank verification. CI pending.

## Excel migration and custom programs
Added bounded XLSX parsing, explicit seven-column mapping, formula rejection, transaction-path preview with rollback, atomic import and stable external ID deduplication. Conservative date/supplier/amount collision blocks potential duplicate imports. Single-budget rows only; split historical purchases require manual entry. Custom program creation added. Actual ASUFC workbook not supplied; mapping and historical expiry policy require confirmation. CI pending.

Added audited transfer reversals (blocked if destination capacity would fall below allocations/spending), active-transfer accounting and frontend reversal form. Added PostgreSQL reversal and concurrent overspending regressions. CI pending.

## Financial closure improvements
Added split-row Excel import (repeated external ID with identical metadata and distinct budget IDs; amount per allocation), automatic refresh, manual duplicate review reason and serialized purchase duplicate checks, audited academic-year/semester edits with overlap and existing-record safeguards. Three parser regression tests and one API integration regression added. CI pending. Actual workbook and stakeholder grant policies remain unverified.

Added enforceable purchase-type restrictions to purchases, corrections, imports and allocation recommendations; carry-forward inherits restrictions, and editing is audited and blocked for conflicting historical spending or active transfers. CI pending.

Connected purchase-type restriction display and suggestion requests, with additional API regression. Actual stakeholder terms and production/browser acceptance remain pending.

## Staff session authentication
Replaced repeated Basic credentials with opaque hashed database sessions, 8-hour expiration, HttpOnly SameSite Strict cookies, HTTPS Secure by default outside local Compose, custom mutation header, login throttle and server logout. All financial endpoints use protected router; no public registration or API docs. Existing single staff environment credentials remain bootstrap mechanism, not full account lifecycle. Added session/expiry/throttle regression tests and updated frontend utilities. CI pending. Production TLS, credential rotation, recovery, browser security tests still required.

## Credential lifecycle
Added salted scrypt credential persistence, authenticated password rotation, all-session revocation, operator-only interactive recovery and account UI. Bootstrap environment password no longer authenticates after rotation. Tests added; CI pending. Single designated account retained; full institutional identity and handover policy not assumed.

Added HTTPS deployment candidate (Caddy, same-origin API, isolated backend, security headers), plus Chromium Playwright security regression and CI browser job. Real domain/TLS issuance and institutional approval remain outstanding. Browser test uses local HTTP and verifies HttpOnly/SameSite, not HTTPS Secure behavior. CI pending.

## Backup and recovery
Added restrictive-permission PostgreSQL custom-format backup and non-destructive disposable restore check, checksum, excluded active sessions, recovery runbook and CI restore test with fictional records. Production retention, encrypted storage, automated schedule and real recovery drill require approval. CI pending.

## Infrastructure limitations follow-up
Previous backup/restore CI passed. Added streaming age encryption and encrypted restore drill, inactive systemd daily schedule template, recovery regression and HTTPS Secure-cookie API test. CI pending. Real host, trust/keys, retention, offsite storage, schedule activation and public TLS remain unapproved; no production changes made.

Added dependency audit CI, backup freshness and corruption monitoring tests, proposed local journal failure-alert units, full browser financial workflow (funding, budget, purchase, reporting, export, reconciliation, void), and isolated localhost HTTPS Caddy gateway smoke test. Gateway test uses curl -k for local test certificates only; production certificate trust not verified. CI pending; actual alert routing and institutional deployment approvals outstanding.

## Security review and dependency remediation
CI 44604770221: Python audit clean; npm reported moderate esbuild and high Vite dependency vulnerability. Upgrade Vite to audit-recommended 8.3.8, preserve audit gate. Backend/frontend/restore/backup-monitor/gateway passed; financial browser result pending at review. Added safe validation error responses (no raw passwords or uploaded data), Docker context exclusions, and documented security review with unresolved release gates. New CI pending.

## Pre-AI regression review
CI 44605369849: dependency audit, backend/frontend, gateway, restore, monitor pass; finance browser failed at Program select locator. Added explicit accessible program label, consistent dashboard/suggestion database snapshots, report year validation and suggestion period boundary check, defusedxml parsing dependency and malformed worksheet handling. Full CI reruns on this commit. No AI integration yet.

## Public Pages demo
Added isolated compile-time Pages mode, fictional in-memory mock transport and clearly marked demo entry, repository base path, compiled artifact deployment workflow and browser regression. Public demo exercises basic financial flows; backend-only operations are unavailable. Pages source must be switched to GitHub Actions by repository owner. No real data or secrets included. CI and deployment pending.

## 2026-11-20 — Public Pages deployment investigation

At `11ef66f`, both the legacy branch build and the custom React workflow deployed on November 19. The legacy artifact (run `44607406476`) used a Jekyll-generated root `index.html` containing the README. The custom artifact (run `44607406654`) put the compiled React entry point at the root with JavaScript and CSS under `assets/`. The custom deployment finished last, and the public HTML, JavaScript and CSS matched its artifact byte for byte before this change. The exact client-side duration of the README display is unknown.

Pages is configured to use GitHub Actions and enforce HTTPS. The dedicated workflow serializes runs and verifies the deployed HTML against the tested entry point before a live Chromium check. The browser regression also tests the seeded balances and rejects API traffic, unexpected origins and browser errors. Updated the workflow, the Pages Playwright configuration and spec, and added the persistent development, context and roadmap files. Future repository review and staff milestone work should use fictional regression data.

Pages verification passed on `6ead0dd` in [run 44787974681](https://github.com/JayJPatel223/ASUFC/actions/runs/44787974681). The uploaded archive contained the root entry point and its JavaScript and CSS, which matched the public files byte for byte. Both preview and live Chromium verified entry, seed balances, purchase, report, void and reload, with zero unexpected requests or browser errors. An earlier attempt stalled during browser installation and was canceled before publication. [Application CI](https://github.com/JayJPatel223/ASUFC/actions/runs/44787974658) passed 49 backend, six frontend and two staff browser tests, plus dependency audits, gateway, restore and backup monitoring.

## 2026-11-20 — Staff funding and reporting controls

Added an audited edit for funding-source expiry, including validation against existing spending and active transfers. Custom report dates now stay in sync with the semester selector and can be cleared in one action. Editable academic-year and semester settings still use the existing audited API. Added PostgreSQL and staff browser coverage with fictional records. Local frontend unit tests, both frontend builds and the Pages preview browser check passed. [Staff-branch CI](https://github.com/JayJPatel223/ASUFC/actions/runs/44787862347) passed 50 backend, six frontend and two staff browser tests, plus the infrastructure and dependency checks. The staff change is in [draft pull request 1](https://github.com/JayJPatel223/ASUFC/pull/1). Source-specific settings still require an authorized staff environment.

## 2026-11-20 — Staff application review and spending rules

Completed the first file-by-file repository review. Added lists of approved programs, suppliers and purchase types with a staff editor and a shared server-side eligibility check. Eligibility applies to new budgets, increases, purchases, suggestions, imports and corrections. Audited edits reject changes that conflict with existing allocations, spending or active transfers. Carry-forward copies the rules, and the additive schema keeps older restrictions effective.

Fixed narrow layout overflow in the funding interface. Locked frontend dependencies and switched builds to `npm ci`. Updated the separate backend build context to exclude local data and upgraded the Python installer after the local audit flagged pip 25.0.1. The audit passed after the upgrade. Updated the README, architecture and security notes, and added the repository checklist.

Local verification passed 52 backend tests, six frontend unit tests, two staff browser tests and one Pages browser test. The funding screen passed keyboard focus and overflow checks at desktop, tablet and phone widths. Both frontend builds, npm and Python audits, and an upgrade of a disposable legacy PostgreSQL database passed. CI verifies the locked install, HTTPS gateway, backup monitoring and plain and encrypted restore. The next roadmap milestone is the broader staff interface review.

## 2026-11-20 — Private staff development workspace

Integrated the verified staff funding changes into `main` at `687aaba`. Added a loopback-only Compose profile for the authenticated staff app that publishes the Caddy gateway and keeps the API and PostgreSQL internal. The profile has its own persistent database volume. Local verification rejected anonymous API access and confirmed that fictional cash, purchasing credits and pending funds reconciled with the recorded purchases. The shared cloud browser was unavailable, so local browser verification used Chromium directly.

Updated the overview to distinguish cash, credits and expected funds, show funding alerts and recent confirmed purchases, and provide direct access to purchase entry and reports. Keyboard navigation now moves focus to the destination heading. The production and Pages builds, six frontend unit tests and the Pages browser check passed locally. The application workflow adds a test for the private Compose profile, and the staff browser regression checks the new dashboard.

## 2026-11-20 — Offline desktop development

The staff desktop edition targets a single computer with Windows, macOS or Linux. Added a launcher that bundles the existing interface, FastAPI and PostgreSQL 16, keeps both services on loopback, and prompts for a staff password on first launch. The database lives in the operating-system user's app data folder. The original local runtime check on Linux recorded a fictional purchase, exported a workbook, shut down and reopened the same ledger successfully. Added a GitHub Actions matrix for the packaged runtime, desktop window and candidate installers. Signing, clean offline installation and the staff backup and recovery flow remain release work.

The candidate workflow passed on Windows x64, Linux x64, macOS Apple Silicon and macOS Intel. Each target passed the bundled runtime and desktop-window checks and produced a candidate installer. The Linux package also passed with all non-loopback browser requests blocked. The packaged runtime's observed IP connections stayed on loopback. [Desktop candidate verification](https://github.com/JayJPatel223/ASUFC/actions/runs/44802686125) · [Main application regression checks](https://github.com/JayJPatel223/ASUFC/actions/runs/44802686129)

## 2026-11-21 — Desktop handover build

Added staff-only receipt files and replacement history, encrypted backup and fresh-profile recovery, editable funding decisions, a reviewed starter-file import and financial insights. The private ASUFC starter file stays outside the repository. The application, dependency and infrastructure checks passed. Local testing passed 54 backend tests, six frontend unit tests and the Pages browser test. A narrow-window staff test exercised intake, purchase confirmation, receipt download and backup with external browser requests blocked. A ledger created by the 0.1 Linux runtime retained its sign-in, spending and balances when opened by 0.2. [Application checks](https://github.com/JayJPatel223/ASUFC/actions/runs/44907601536)

Windows x64, Linux x64 and both macOS architectures passed the desktop-window check and the recovery check using the runtime shipped in the installer. Linux ran the package check with only loopback networking. Windows packaging now includes the app-local Microsoft C++ runtime, and the desktop service bounds graceful shutdown. The package workflow supports optional institutional signing. The signing credentials and the designated computer's disconnected acceptance drill remain release gates. [Installer verification](https://github.com/JayJPatel223/ASUFC/actions/runs/44907601566)

## 2026-11-21 — Local assistant and receipt-photo reader

Version 0.3 adds a local text classifier for common staff questions and a built-in English OCR model for receipt photos. The assistant uses approved read-only queries, reports the year and program, and offers topic selection for unclear questions. The photo reader requires review before its suggestions enter an unsaved purchase form. The public Pages archive omits OCR assets, and the private starter file stays outside Git.

Verified 64 backend tests, nine frontend unit tests, the public demo browser check, and a loopback-only receipt-photo scan in Chromium. The application workflow also passed the staff browser checks, dependency audits and infrastructure regressions. The four desktop targets passed native window OCR, the bundled runtime and installed-package recovery checks. PDF files are supported as attachments. PDF extraction, institutional signing and a disconnected acceptance drill on the designated staff computer remain open. [Application checks](https://github.com/JayJPatel223/ASUFC/actions/runs/44909451094) · [Desktop packaging checks](https://github.com/JayJPatel223/ASUFC/actions/runs/44909451120)

## 2026-11-23 — Staff workflow review against the 2026–27 tracker

Reviewed the application against the staff tracker layout (kept private and outside Git) and addressed the gaps it showed. Added versioned migrations, local business dates, late entry of purchases made before a grant expired, a shared supplier and purchase type catalog with audited merges, partial refunds, returns to funders, unconfirmed pledges, automatic budgets for single-program grants, a bank balance comparison, named staff accounts with roles and per-account sign-in throttling, and a reader for the tracker workbook that produces a reviewable starter draft. Removed the duplicate program route and form, and split the staff interface into page modules. Desktop backups include the new tables, and restores of older backups backfill rules, names and an administrator.

Local verification on a disposable PostgreSQL 16 database: 81 backend tests passed, 9 frontend unit tests passed, both frontend builds passed, the Pages browser check passed, and three staff browser tests passed (the two existing tests and a new refund, bank check, catalog and account test). The tracker reader was checked against the private workbook locally without saving it: 9 funding sources and 17 pending purchases totalling $3,271.23, with one warning for a grant whose program needs review. CI, the desktop packaging matrix and a disconnected desktop upgrade drill were not run for this change.

Pending decisions: whether late entries need a deadline or approval, whether supplier names should be a closed list, whether purchases need a second person's approval, and the bank account's opening balance before this ledger.
