"""Versioned, forward-only schema changes.

Version 1 is the original idempotent ``schema.sql``. Existing ledgers have no
``schema_migration`` table, so they run version 1 again (a no-op for them) and
then each later version once. Never edit an applied migration; add a new one.
"""
from pathlib import Path

MIGRATION_LOCK = 2663003

ELIGIBILITY = r"""
-- Every funding source keeps its rules in funding_eligibility. The legacy
-- single-value columns and funding_purchase_type remain readable for older
-- backups, which are backfilled after restore.
CREATE OR REPLACE FUNCTION asufc_backfill_eligibility() RETURNS void LANGUAGE sql AS $$
 INSERT INTO funding_eligibility(funding_id,eligible_programs,eligible_suppliers,eligible_purchase_types)
 SELECT f.id,
  array_remove(ARRAY[NULLIF(f.eligible_program,'')], NULL),
  array_remove(ARRAY[NULLIF(f.eligible_supplier,'')], NULL),
  array_remove(ARRAY[t.purchase_type], NULL)
 FROM funding f LEFT JOIN funding_purchase_type t ON t.funding_id=f.id
 WHERE NOT EXISTS (SELECT 1 FROM funding_eligibility e WHERE e.funding_id=f.id);
$$;
SELECT asufc_backfill_eligibility();
"""

CATALOG = r"""
CREATE OR REPLACE FUNCTION asufc_name_key(value text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT lower(regexp_replace(btrim(value), '\s+', ' ', 'g'))
$$;
CREATE TABLE IF NOT EXISTS catalog_entry (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 kind text NOT NULL CHECK (kind IN ('supplier','purchase_type')),
 name text NOT NULL CHECK (length(btrim(name)) > 0),
 name_key text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (kind, name_key)
);
INSERT INTO catalog_entry(kind,name,name_key)
 SELECT DISTINCT ON (kind, asufc_name_key(name)) kind, regexp_replace(btrim(name), '\s+', ' ', 'g'), asufc_name_key(name)
 FROM (
  SELECT 'supplier' AS kind, supplier AS name FROM purchase
  UNION ALL SELECT 'purchase_type', purchase_type FROM purchase
  UNION ALL SELECT 'supplier', supplier FROM purchase_intake
  UNION ALL SELECT 'purchase_type', purchase_type FROM purchase_intake
  UNION ALL SELECT 'supplier', unnest(eligible_suppliers) FROM funding_eligibility
  UNION ALL SELECT 'purchase_type', unnest(eligible_purchase_types) FROM funding_eligibility
 ) names WHERE length(btrim(name)) > 0
 ORDER BY kind, asufc_name_key(name), name
 ON CONFLICT DO NOTHING;
"""

REFUNDS_AND_RETURNS = r"""
ALTER TABLE purchase ADD COLUMN IF NOT EXISTS late_entry_reason text NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS purchase_refund (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 purchase_id bigint NOT NULL REFERENCES purchase(id),
 refund_date date NOT NULL,
 reason text NOT NULL CHECK (length(btrim(reason)) > 0),
 actor text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS purchase_refund_allocation (
 refund_id bigint NOT NULL REFERENCES purchase_refund(id),
 purchase_id bigint NOT NULL,
 budget_id bigint NOT NULL,
 cents bigint NOT NULL CHECK (cents > 0),
 PRIMARY KEY (refund_id, budget_id),
 FOREIGN KEY (purchase_id, budget_id) REFERENCES allocation(purchase_id, budget_id)
);
-- Active spending is each allocation less its recorded refunds.
CREATE OR REPLACE VIEW active_allocation AS
 SELECT a.purchase_id, a.budget_id, (a.cents - COALESCE(r.cents, 0))::bigint AS cents
 FROM allocation a
 LEFT JOIN purchase_void v ON v.purchase_id = a.purchase_id
 LEFT JOIN (SELECT purchase_id, budget_id, sum(cents) AS cents FROM purchase_refund_allocation GROUP BY purchase_id, budget_id) r
  ON r.purchase_id = a.purchase_id AND r.budget_id = a.budget_id
 WHERE v.purchase_id IS NULL;

CREATE TABLE IF NOT EXISTS funding_return (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 funding_id bigint NOT NULL REFERENCES funding(id),
 cents bigint NOT NULL CHECK (cents > 0),
 returned_on date NOT NULL,
 reason text NOT NULL CHECK (length(btrim(reason)) > 0),
 actor text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE funding ADD COLUMN IF NOT EXISTS commitment text NOT NULL DEFAULT 'committed';
ALTER TABLE funding DROP CONSTRAINT IF EXISTS funding_commitment_check;
ALTER TABLE funding ADD CONSTRAINT funding_commitment_check CHECK (commitment IN ('committed','unconfirmed'));
-- Columns may only be appended to an existing view.
CREATE OR REPLACE VIEW funding_capacity AS
 SELECT f.id,f.name,f.academic_year,f.kind,f.expected_cents,f.received_cents,f.expiry,f.eligible_program,
 f.eligible_supplier,f.organization,f.source_type,f.recurring,f.expected_date,f.notes,f.carry_eligible,
 COALESCE(i.cents,0) AS carried_in_cents, COALESCE(o.cents,0) AS carried_out_cents,
 f.received_cents + COALESCE(i.cents,0) - COALESCE(o.cents,0) - COALESCE(r.cents,0) AS capacity_cents, f.carry_prohibited,
 COALESCE(r.cents,0) AS returned_cents, f.commitment
 FROM funding f
 LEFT JOIN (SELECT destination_id,sum(cents) AS cents FROM active_funding_transfer GROUP BY destination_id) i ON i.destination_id=f.id
 LEFT JOIN (SELECT source_id,sum(cents) AS cents FROM active_funding_transfer GROUP BY source_id) o ON o.source_id=f.id
 LEFT JOIN (SELECT funding_id,sum(cents) AS cents FROM funding_return GROUP BY funding_id) r ON r.funding_id=f.id;
"""

BANK_STATEMENTS = r"""
CREATE TABLE IF NOT EXISTS bank_statement (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 statement_date date NOT NULL,
 cents bigint NOT NULL CHECK (cents BETWEEN -1000000000000 AND 1000000000000),
 note text NOT NULL DEFAULT '',
 actor text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
"""

STAFF_ACCOUNTS = r"""
ALTER TABLE staff_credential ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'admin';
ALTER TABLE staff_credential ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
ALTER TABLE staff_credential ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE staff_credential DROP CONSTRAINT IF EXISTS staff_credential_role_check;
ALTER TABLE staff_credential ADD CONSTRAINT staff_credential_role_check CHECK (role IN ('admin','staff'));
-- New accounts are ordinary staff unless an administrator says otherwise.
ALTER TABLE staff_credential ALTER COLUMN role SET DEFAULT 'staff';
ALTER TABLE staff_login_attempt ADD COLUMN IF NOT EXISTS username text NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS staff_login_attempt_user_idx ON staff_login_attempt(username, attempted_at);
"""


CATALOG_BACKFILL = r"""
CREATE OR REPLACE FUNCTION asufc_backfill_catalog() RETURNS void LANGUAGE sql AS $$
 INSERT INTO catalog_entry(kind,name,name_key)
 SELECT DISTINCT ON (kind, asufc_name_key(name)) kind, regexp_replace(btrim(name), '\s+', ' ', 'g'), asufc_name_key(name)
 FROM (
  SELECT 'supplier' AS kind, supplier AS name FROM purchase
  UNION ALL SELECT 'purchase_type', purchase_type FROM purchase
  UNION ALL SELECT 'supplier', supplier FROM purchase_intake
  UNION ALL SELECT 'purchase_type', purchase_type FROM purchase_intake
  UNION ALL SELECT 'supplier', unnest(eligible_suppliers) FROM funding_eligibility
  UNION ALL SELECT 'purchase_type', unnest(eligible_purchase_types) FROM funding_eligibility
 ) names WHERE length(btrim(name)) > 0
 ORDER BY kind, asufc_name_key(name), name
 ON CONFLICT DO NOTHING;
$$;
SELECT asufc_backfill_catalog();
"""


def baseline():
    return Path(__file__).with_name("schema.sql").read_text(encoding="utf-8")


MIGRATIONS = (
    (1, "baseline schema", baseline),
    (2, "consolidate funding eligibility", lambda: ELIGIBILITY),
    (3, "supplier and purchase type catalog", lambda: CATALOG),
    (4, "refunds, funding returns and pledge status", lambda: REFUNDS_AND_RETURNS),
    (5, "bank statement balances", lambda: BANK_STATEMENTS),
    (6, "named staff accounts", lambda: STAFF_ACCOUNTS),
    (7, "reusable catalog backfill", lambda: CATALOG_BACKFILL),
)


def migrate(connection):
    """Apply pending migrations inside the caller's transaction."""
    connection.execute("SELECT pg_advisory_xact_lock(%s)", (MIGRATION_LOCK,))
    connection.execute("""CREATE TABLE IF NOT EXISTS schema_migration (
        version integer PRIMARY KEY, name text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())""")
    applied = {row["version"] for row in connection.execute("SELECT version FROM schema_migration")}
    for version, name, statements in MIGRATIONS:
        if version in applied:
            continue
        connection.execute(statements())
        connection.execute("INSERT INTO schema_migration(version,name) VALUES (%s,%s)", (version, name))
