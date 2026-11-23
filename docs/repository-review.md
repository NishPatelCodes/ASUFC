# Repository review

Reviewed November 20, 2026 against the staff branch based on `6ead0dd`. Sources, test coverage, build files and runbooks were inspected using fictional records. This review covers the repository and disposable test environments. Institutional deployment, external identity, actual grant data, and independent security testing remain outside its evidence.

## Application

| File | Review and disposition |
| --- | --- |
| `backend/app/__init__.py` | Empty package marker. |
| `backend/app/main.py` | Protected routes and parameterized SQL. Budget allocation, adjustments, purchases, imports, corrections and transfer rules now consult the effective eligibility lists. Duplicate purchases are serialized. The one shared account and unpaginated finance reads remain limitations. |
| `backend/app/schema.sql` | Additive eligibility storage preserves existing single-value controls. Voids feed views used for active spending and transfers. Startup applies numbered migrations from `migrations.py` once each, recorded in `schema_migration`. |
| `backend/app/rules.py` | Checks exact integer-cent allocation totals, budget and funding capacity, expiry and program, supplier and purchase type. |
| `backend/app/suggestions.py` | Shares spending eligibility and orders available sources by staff preference, then expiry and stable ID. Suggestions reserve no balance. |
| `backend/app/reporting.py` | Groups allocation cents and deduplicates purchase counts. Checks reversed date bounds. |
| `backend/app/reconciliation.py` | Recalculates ledger totals from raw rows in one snapshot. It covers internal records. Bank settlement requires its own evidence. |
| `backend/app/importing.py` | Bounds workbook size and row count, validates explicit mappings, rejects formulas and stages rows. Imports require a confirmed budget ID, so purchases with unresolved funding require prior review. |
| `backend/app/export.py` | Exports records to XLSX with literal text cells and money formatting. |
| `backend/app/credentials.py` | Scrypt and constant-time digest comparison. Work factor and institutional identity remain follow-up items. |
| `backend/app/reset_password.py` | Operator reads password interactively, then rotates credentials and revokes sessions. |
| `frontend/index.html` | Declares language, mobile viewport and React mount. |
| `frontend/src/main.tsx` | Staff rules can be added or edited together. Reports accept custom date bounds. The file still combines most screens, and the initial workspace load fetches unrelated resources. |
| `frontend/src/api.ts` | Uses same-origin session requests and exact input conversion to cents. |
| `frontend/src/demo.ts` | Uses fictional memory state and a separate transport. Staff-only list editing stays outside the demo. |
| `frontend/src/style.css` | The narrow grid now keeps scrolling navigation and tables within the viewport. The funding form is checked at 1440px, 820px and 390px widths. Full keyboard and screen-reader review is still pending. |
| `frontend/src/vite-env.d.ts` | Vite environment typing. |
| `frontend/tsconfig.json` | Strict application source checking. Playwright transpiles the test files separately. |
| `frontend/vite.config.ts` | The staff development proxy targets localhost. Pages uses its own base and transport. |

## Tests and builds

| File | Review and disposition |
| --- | --- |
| `backend/tests/test_export.py` | Covers literal spreadsheet text, split reporting and empty exports. |
| `backend/tests/test_financial_final.py` | Covers parsing split rows and rejecting duplicate allocations or divergent metadata. |
| `backend/tests/test_integration.py` | Checks PostgreSQL transactions, reports, auth, carry-forward and concurrent capacity. Added coverage for combined funding rules, legacy rows and stale edits. |
| `backend/tests/test_reconciliation.py` | Exercises conservation, voids, inconsistency detection and empty ledgers. |
| `backend/tests/test_reporting.py` | Exercises date bounds, grouping and split totals. |
| `backend/tests/test_rules.py` | Exercises invalid amounts, physical budget capacity and year boundaries. |
| `backend/tests/test_suggestions.py` | Verifies preferred ordering, availability and expiry. |
| `frontend/tests/api.test.cjs` | Covers cents conversion and shared API error handling. |
| `frontend/e2e/finance.spec.ts` | Covers staff finance, funding rules, expiry, report filters, export, reconciliation and void. |
| `frontend/e2e/security.spec.ts` | Covers staff login, session cookies, mutation header enforcement and logout through the browser. |
| `frontend/e2e-pages/demo.spec.ts` | Checks the compiled site's entry, assets, financial workflow and absence of backend traffic. Live verification checks entry digest. |
| `frontend/playwright.config.ts` | Starts the staff Vite client against a separately configured API. |
| `frontend/playwright.pages.config.ts` | Supports local preview and live Pages. Blocks service workers during checks. |
| `frontend/package.json` | Node version guards reflect Vite support. |
| `frontend/package-lock.json` | Locks frontend dependency resolution with integrity hashes and optional platform packages. |
| `backend/requirements.txt` | Bounded direct dependency ranges. Python transitive pinning remains open. |
| `.github/workflows/ci.yml` | Uses disposable databases and tests the gateway, restores and dependency audits. JavaScript now installs from the lockfile, browser downloads have a limit and pip is upgraded before the audit. |
| `.github/workflows/pages.yml` | Uploads only the tested Pages build. Deployment is limited to `main`, with live browser verification afterward. |

## Infrastructure

| File | Review and disposition |
| --- | --- |
| `.dockerignore` | Excludes database dumps, environment files, Excel records and receipt directories from the root build context. |
| `backend/.dockerignore` | Applies exclusions to the separate backend build context. |
| `.gitignore` | Excludes local credentials, build output, receipt directories and data artifacts. |
| `.env.example` | Contains placeholders and local cookie defaults. |
| `backend/Dockerfile` | Upgrades pip, then installs requirements. Copies the app and tests explicitly. Base image digest pinning is pending. |
| `deploy/Dockerfile` | Uses the lockfile for the production frontend and serves the build through Caddy. Base image digest pinning is pending. |
| `docker-compose.yml` | Local services keep PostgreSQL internal and the API bound to loopback. |
| `docker-compose.staff.yml` | Local staff gateway binds to loopback. The API and PostgreSQL ports stay unpublished. CI verifies the binding and staff authentication. |
| `docker-compose.production.yml` | Caddy exposes HTTPS and the override removes the direct API port. |
| `deploy/Caddyfile` | Same-origin API, request bounds and security headers. Actual public TLS validation requires an approved host. |
| `deploy/asufc-backup.service` | Template provides a restricted umask, path and service account. Host-specific paths and access are pending. |
| `deploy/asufc-backup.timer` | Proposed daily schedule. |
| `deploy/asufc-backup-check.service` | Invokes freshness and checksum check. |
| `deploy/asufc-backup-check.timer` | Proposed monitoring schedule. |
| `deploy/asufc-backup-alert.service` | Writes to the host journal. External alert routing remains pending. |
| `scripts/backup.sh` | Creates and checks a restricted-permission database archive without live session data. |
| `scripts/backup-encrypted.sh` | Encrypts the database dump as it streams. |
| `scripts/check-backup.sh` | Checks for an archive, checksum and freshness. |
| `scripts/restore-check.sh` | Restores to a disposable database and checks record counts and absence of sessions. |
| `scripts/restore-encrypted-check.sh` | Decrypts into a disposable restore and checks session exclusion. |

## Project guidance

| File | Review and disposition |
| --- | --- |
| `AGENTS.md` | Captures development guardrails, demo isolation and disposable testing requirements. |
| `PROJECT_CONTEXT.md` | Updated to reflect lists of eligible values and staff review of item-level terms. |
| `ROADMAP.md` | Tracks acceptance criteria and outstanding staff, receipt and production milestones. |
| `PROGRESS.md` | Records implementation and verification milestones. |
| `README.md` | Uses the locked frontend setup, describes disposable integration testing and explains the staff rule editor. |
| `docs/architecture.md` | Replaces obsolete Basic Auth and future-phase descriptions with the current design and eligibility compatibility. |
| `docs/recovery.md` | Retains restricted archives, disposable restoration and pending retention and key management. |
| `docs/security-review.md` | Records the reviewed controls and unresolved production gates. |

The next staff interface review should prioritize the dashboard and financial forms, keyboard navigation, and desktop, tablet and mobile layouts. Secure receipt attachments, financial query services and production hosting remain later milestones.
