# ASUFC Financial Management
Development prototype. Use fictional data only; never upload real records or secrets.

## Local setup
1. Install Docker Compose and Node.js 22.12+ (or a supported Node 20.19+ release).
2. Copy .env.example to .env and replace both passwords with random values.
3. Run `docker compose up --build` from the repository root.
4. In another terminal run `cd frontend`, `npm ci`, then `npm run dev`.
5. Open the local Vite URL printed in the terminal (usually http://127.0.0.1:5173). Sign in with configured STAFF_USER and STAFF_PASSWORD.

The Vite development proxy connects to the API at 127.0.0.1:8000. Public API documentation is disabled. Do not expose this development configuration publicly.

Schema changes run automatically at startup as numbered migrations. Set `ASUFC_TIMEZONE` if the Food Cupboard is not on Atlantic time.

Run `docker compose run --rm api python -m pytest` for backend unit tests. The PostgreSQL integration suite requires the disposable `asufc_test` database and environment in `.github/workflows/ci.yml`. Run `npm run build` and `npm test` from `frontend/` after `npm ci`.

See docs/architecture.md and PROGRESS.md for limitations. No production readiness claim.

## Offline desktop edition

Version 0.4 opens directly to **Overview** under the designated operating-system account. The desktop launcher authorizes the local API for each launch. Use **Account** to save or restore an encrypted backup. An existing 0.3 ledger opens in place when the update runs under the same operating-system profile.

See the [staff handbook](docs/staff-handbook.md) for everyday use, the [offline desktop guide](docs/offline-desktop.md) for building, signing and testing installers, and the [project handover](docs/university-handover.md) for requirements, diagrams and verification.

## Private staff workspace

For a local workspace with fictional records, set the two passwords in your private Compose environment and run the staff profile from the repository root with Docker Compose 2.24.4 or newer.

```sh
docker compose -p asufc-staff -f docker-compose.yml -f docker-compose.staff.yml up --build -d
```

Open `http://127.0.0.1:8080` on the host. The gateway binds to loopback, and the API and PostgreSQL stay on the Compose network. Set `ASUFC_STAFF_PORT` in your private Compose environment if port 8080 is taken. The Compose project keeps its own PostgreSQL volume across restarts. Use the separate HTTPS configuration on an approved production host.

## Web staff credentials
STAFF_USER and STAFF_PASSWORD create the first administrator account (password minimum 16 characters); later changes are stored as salted scrypt hashes. Administrators add, disable and reset other named accounts under Account, and the audit log records which account made each change. Changing your password signs out your own sessions. Trusted host operator recovery: `docker compose exec api python -m app.reset_password` (add `--username NAME` for another account; the account is reactivated). Password is entered interactively, never as a shell argument. Keep STAFF_USER stable; changing it is not an account handover procedure.

## Funding rules

Under Funding & grants, choose eligible programs and enter supplier and purchase type names, one per line. A blank list allows any value in that category. A purchase needs to satisfy every configured category. Edit a source's rules or expiry with a reason. Existing spending and carry-forward transfers can prevent an edit. Keep item-level requirements in the grant notes for staff review.

## HTTPS deployment candidate
Use Docker Compose 2.24.4+ on an authorized host, configure ASUFC_DOMAIN to its actual DNS hostname, set unique secrets, and run `docker compose -f docker-compose.yml -f docker-compose.production.yml up --build -d`. The Caddy gateway serves the built frontend and same-origin API, obtains certificates when DNS and ports are configured, and enables secure cookies and security headers. Do not expose the local development configuration. Deployment must be validated with the actual domain and institutional approval; this is not a live deployment.

Browser checks: `cd frontend && npx playwright install chromium && npm run test:e2e` with local API running and STAFF_USER/STAFF_PASSWORD exported; use disposable data only.

## Backup and recovery
See [recovery runbook](docs/recovery.md). Create an archive with `bash scripts/backup.sh` and validate it using `bash scripts/restore-check.sh PATH.dump`. Use approved encrypted storage; never commit archives.

## Public GitHub Pages demo
Set Settings > Pages > Source to GitHub Actions. The dedicated Pages workflow builds with `npm run build:pages`, tests the compiled demo and publishes only frontend/dist. The public demo uses fictional in-memory records and a single Enter public demo button; no real login, API, database, persistence or file processing. Refresh resets all records. Core funding, budgets, purchase, void and reports can be exercised; server-only operations are explicitly unavailable. Never enter real data. Normal local and production builds continue to use the authenticated backend.
