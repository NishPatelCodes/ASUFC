"""Destructive checks for refunds, returns, bank balances, names and staff accounts.

All records are fictional and the suite runs only against the disposable database.
"""
import os
from datetime import date, timedelta

import pytest

pytestmark = pytest.mark.skipif(os.getenv("ASUFC_TEST_DATABASE") != "1", reason="Requires disposable PostgreSQL database")

USER = os.environ.get("STAFF_USER", "teststaff")
PASSWORD = os.environ.get("STAFF_PASSWORD", "")


@pytest.fixture
def client():
    from fastapi.testclient import TestClient
    from app.credentials import hash_password
    from app.main import app, db
    assert os.environ["PGDATABASE"] == "asufc_test"
    with TestClient(app) as client:
        with db() as conn:
            conn.execute("""TRUNCATE staff_session,staff_login_attempt,funding_transfer,semester,academic_period,
                purchase_correction,funding_receipt,audit_event,purchase_void,allocation,purchase,budget,funding,
                bank_statement,catalog_entry,purchase_intake RESTART IDENTITY CASCADE""")
            conn.execute("DELETE FROM staff_credential WHERE username<>%s", (USER,))
            conn.execute("UPDATE staff_credential SET password_hash=%s,role='admin',active=true WHERE username=%s",
                         (hash_password(PASSWORD), USER))
        client.headers["X-ASUFC-Request"] = "1"
        assert client.post("/auth/login", json={"username": USER, "password": PASSWORD}).status_code == 200
        yield client


def create(client, path, data, status=201):
    response = client.post(path, json=data)
    assert response.status_code == status, response.text
    return response.json()


def funded_budget(client, kind="cash", cents=100_000, program="ASUFCGR", **extra):
    source = create(client, "/funding", dict(name="Fictional " + kind + " source " + str(extra.get("n", "")),
                    academic_year="2026-2027", kind=kind, expected_cents=cents, received_cents=cents,
                    **{k: v for k, v in extra.items() if k != "n"}))
    budget = create(client, "/budgets", dict(funding_id=source["id"], program_code=program, cents=cents))
    return source, budget


def purchase(client, budget, cents=10_000, **extra):
    return create(client, "/transactions", dict(purchase_date=extra.pop("purchase_date", date.today().isoformat()),
                  supplier=extra.pop("supplier", "Fictional Grocer"), purchase_type=extra.pop("purchase_type", "Groceries"),
                  cents=cents, allocations=[dict(budget_id=budget["id"], cents=cents)], **extra))


def test_names_resolve_to_one_catalog_spelling_and_merge(client):
    source, budget = funded_budget(client, eligible_suppliers=["Fictional Grocer"])
    first = purchase(client, budget, supplier="  fictional   GROCER ")
    assert first["supplier"] == "Fictional Grocer"
    other_source, other_budget = funded_budget(client, n=2)
    typo = purchase(client, other_budget, cents=500, supplier="Fictionl Grocer")
    names = {row["name"]: row for row in client.get("/catalog").json() if row["kind"] == "supplier"}
    assert set(names) == {"Fictional Grocer", "Fictionl Grocer"}
    assert client.post(f"/catalog/{names['Fictionl Grocer']['id']}/merge",
                       json={"into_id": names["Fictional Grocer"]["id"], "reason": ""}).status_code == 422
    merged = client.post(f"/catalog/{names['Fictionl Grocer']['id']}/merge",
                         json={"into_id": names["Fictional Grocer"]["id"], "reason": "Typo"}).json()
    assert merged["purchase_ids"] == [typo["id"]]
    suppliers = {t["id"]: t["supplier"] for t in client.get("/transactions").json()}
    assert suppliers == {first["id"]: "Fictional Grocer", typo["id"]: "Fictional Grocer"}
    report = client.get("/reports/spending").json()
    assert [row["label"] for row in report["supplier"]] == ["Fictional Grocer"]
    assert any(e["action"] == "catalog_merged" for e in client.get("/audit").json())


def test_late_entry_for_purchase_made_before_expiry(client):
    from app.main import db
    source, budget = funded_budget(client)
    expired = date.today() - timedelta(days=5)
    with db() as c:
        c.execute("UPDATE funding SET expiry=%s WHERE id=%s", (expired, source["id"]))
    payload = dict(purchase_date=expired.isoformat(), supplier="Fictional Grocer", purchase_type="Groceries",
                   cents=1_000, allocations=[dict(budget_id=budget["id"], cents=1_000)])
    response = client.post("/transactions", json=payload)
    assert response.status_code == 422 and "late-entry reason" in response.json()["detail"]
    created = create(client, "/transactions", payload | {"late_entry_reason": "Receipt handed in after the deadline"})
    assert created["late_entry_reason"] == "Receipt handed in after the deadline"
    after = payload | {"purchase_date": (expired + timedelta(days=1)).isoformat(), "late_entry_reason": "Late"}
    assert client.post("/transactions", json=after).json()["detail"] == "Funding expired"
    future = payload | {"purchase_date": (date.today() + timedelta(days=2)).isoformat()}
    assert client.post("/transactions", json=future).status_code == 422


def test_refund_restores_balances_and_reports_net(client):
    source, budget = funded_budget(client)
    tx = purchase(client, budget, cents=7_258, supplier="Fictional Delivery")
    url = f"/transactions/{tx['id']}/refunds"
    refund = dict(refund_date=date.today().isoformat(), reason="Missing items refunded",
                  allocations=[dict(budget_id=budget["id"], cents=2_004)])
    assert client.post(url, json=refund | {"allocations": [dict(budget_id=budget["id"], cents=9_000)]}).status_code == 422
    assert client.post(url, json=refund | {"refund_date": "2020-01-01"}).status_code == 422
    create(client, url, refund)
    listed = next(t for t in client.get("/transactions").json() if t["id"] == tx["id"])
    assert listed["refunded_cents"] == 2_004 and listed["refunds"][0]["reason"] == "Missing items refunded"
    assert client.get("/budgets").json()[0]["remaining"] == 100_000 - 5_254
    assert client.get("/reports/spending").json()["totals"]["cash_cents"] == 5_254
    assert client.get("/dashboard").json()["funding"][0]["spent"] == 5_254
    assert client.get("/reports/reconciliation").json()["ok"]
    correction = dict(reason="Fix", replacement=dict(purchase_date=date.today().isoformat(), supplier="Fictional Delivery",
                      purchase_type="Groceries", cents=5_254, allocations=[dict(budget_id=budget["id"], cents=5_254)]))
    assert client.post(f"/transactions/{tx['id']}/correct", json=correction).status_code == 422
    create(client, url, refund | {"allocations": [dict(budget_id=budget["id"], cents=5_254)]})
    assert client.get("/reports/spending").json()["purchase_count"] == 0
    assert client.post(url, json=refund | {"allocations": [dict(budget_id=budget["id"], cents=1)]}).status_code == 422


def test_returned_funds_reduce_capacity(client):
    source = create(client, "/funding", dict(name="Fictional restricted grant", academic_year="2026-2027", kind="cash",
                    expected_cents=50_000, received_cents=50_000))
    budget = create(client, "/budgets", dict(funding_id=source["id"], program_code="ASUFCGR", cents=40_000))
    payload = dict(cents=20_000, returned_on=date.today().isoformat(), reason="Unused funds returned to funder")
    assert client.post(f"/funding/{source['id']}/returns", json=payload).status_code == 422
    create(client, f"/funding/{source['id']}/returns", payload | {"cents": 10_000})
    listed = client.get("/funding").json()[0]
    assert listed["returned_cents"] == 10_000 and listed["capacity_cents"] == 40_000 and listed["unallocated_cents"] == 0
    assert client.patch(f"/budgets/{budget['id']}", json=dict(cents=45_000, reason="More")).status_code == 422
    assert client.get("/dashboard").json()["funding"][0]["returned"] == 10_000
    reconciliation = client.get("/reports/reconciliation").json()
    assert reconciliation["ok"] and reconciliation["funding"][0]["returned_cents"] == 10_000
    assert len(client.get(f"/funding/{source['id']}/returns").json()) == 1


def test_pledge_status_and_automatic_budget(client):
    pledge = create(client, "/funding", dict(name="Fictional bake sale", academic_year="2026-2027", kind="cash",
                    expected_cents=15_000, received_cents=0, commitment="unconfirmed"))
    create(client, "/funding", dict(name="Fictional committed", academic_year="2026-2027", kind="cash",
           expected_cents=20_000, received_cents=0))
    cash = client.get("/dashboard").json()["funding"][0]
    assert cash["expected"] == 20_000 and cash["unconfirmed"] == 15_000
    assert client.patch(f"/funding/{pledge['id']}/commitment", json={"commitment": "committed", "reason": "Confirmed by email"}).status_code == 200
    assert client.get("/dashboard").json()["funding"][0]["expected"] == 35_000
    assert client.post("/funding", json=dict(name="Two programs", academic_year="2026-2027", kind="cash", expected_cents=100,
                       received_cents=100, auto_budget=True)).status_code == 422
    breakfast = create(client, "/funding", dict(name="Fictional breakfast donation", academic_year="2026-2027", kind="cash",
                       expected_cents=1_000_000, received_cents=1_000_000, eligible_programs=["ASUFCFSBP"], auto_budget=True))
    budgets = [b for b in client.get("/budgets").json() if b["funding_id"] == breakfast["id"]]
    assert [(b["program_code"], b["cents"]) for b in budgets] == [("ASUFCFSBP", 1_000_000)]


def test_bank_balance_compares_cash_only(client):
    from app.main import db
    source, budget = funded_budget(client, cents=250_000)
    funded_budget(client, kind="credit", cents=300_000, n=2)
    purchase(client, budget, cents=22_869)
    with db() as c:
        c.execute("INSERT INTO academic_period(academic_year,starts_on,ends_on) VALUES ('2026-2027','2026-09-01','2027-08-31')")
        c.execute("""INSERT INTO purchase_intake(academic_year,program_code,purchase_date,supplier,purchase_type,description,cents,notes,verify_charge)
            SELECT '2026-2027','ASUFCGR',%s,'Fictional Grocer','Groceries','',5000,'',true""", (date.today(),))
    assert client.post("/bank-statements", json={"statement_date": "2999-01-01", "cents": 0}).status_code == 422
    row = create(client, "/bank-statements", {"statement_date": date.today().isoformat(), "cents": 220_000, "note": "Fictional statement"})
    assert row["ledger_cash_cents"] == 250_000 - 22_869
    assert row["difference_cents"] == 220_000 - (250_000 - 22_869)
    assert row["undated_received_cents"] == 250_000
    assert row["pending_count"] == 1 and row["pending_cents"] == 5_000
    assert client.get("/bank-statements").json()[0]["id"] == row["id"]


def test_named_accounts_attribute_audit_and_can_be_disabled(client):
    from fastapi.testclient import TestClient
    from app.main import app
    account = dict(username="fictional.treasurer", password="fictional-treasurer-pass", role="staff")
    assert client.post("/staff-accounts", json=account | {"password": "short"}).status_code == 422
    create(client, "/staff-accounts", account)
    assert client.post("/staff-accounts", json=account | {"username": "FICTIONAL.treasurer"}).status_code == 409
    with TestClient(app) as other:
        other.headers["X-ASUFC-Request"] = "1"
        assert other.post("/auth/login", json={"username": account["username"], "password": account["password"]}).status_code == 200
        assert other.get("/auth/session").json() == {"username": account["username"], "role": "staff"}
        create(other, "/funding", dict(name="Fictional attributed", academic_year="2026-2027", kind="cash", expected_cents=1, received_cents=0))
        assert other.get("/staff-accounts").status_code == 403
        events = client.get("/audit").json()
        assert next(e for e in events if e["entity"] == "funding")["actor"] == account["username"]
        assert client.patch(f"/staff-accounts/{account['username']}", json={"active": False, "reason": "Left the board"}).status_code == 200
        assert other.get("/funding").status_code == 401
        assert other.post("/auth/login", json={"username": account["username"], "password": account["password"]}).status_code == 401
    assert client.patch(f"/staff-accounts/{USER}", json={"role": "staff", "reason": "Test"}).status_code == 422
    assert client.post(f"/staff-accounts/{account['username']}/password",
                       json={"password": "replacement-fictional-pass", "reason": "Forgotten"}).status_code == 200
    roles = {a["username"]: (a["role"], a["active"]) for a in client.get("/staff-accounts").json()}
    assert roles == {USER: ("admin", True), account["username"]: ("staff", False)}


def test_migrations_are_recorded_once(client):
    from app.main import db
    from app.migrations import MIGRATIONS, migrate
    with db() as c:
        migrate(c)
        versions = [r["version"] for r in c.execute("SELECT version FROM schema_migration ORDER BY version")]
    assert versions == [version for version, _, _ in MIGRATIONS]
