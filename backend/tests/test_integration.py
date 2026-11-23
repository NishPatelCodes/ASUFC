"""Destructive tests against an explicitly designated disposable database."""
import os
from datetime import date, timedelta
import pytest

pytestmark = pytest.mark.skipif(os.getenv("ASUFC_TEST_DATABASE") != "1", reason="Requires disposable PostgreSQL database")
@pytest.fixture
def client():
    from app.main import app, db
    from app.credentials import hash_password
    from fastapi.testclient import TestClient
    assert os.environ["PGDATABASE"] == "asufc_test"
    with TestClient(app) as client:
        with db() as conn:
            conn.execute("TRUNCATE staff_session,staff_login_attempt,funding_transfer,semester,academic_period,purchase_correction,funding_receipt,audit_event,purchase_void,allocation,purchase,budget,funding,catalog_entry,bank_statement RESTART IDENTITY CASCADE")
            conn.execute("UPDATE staff_credential SET password_hash=%s WHERE username=%s",(hash_password(os.environ["STAFF_PASSWORD"]),os.environ["STAFF_USER"]))
        client.headers["X-ASUFC-Request"]="1"
        assert client.post("/auth/login",json={"username":os.environ["STAFF_USER"],"password":os.environ["STAFF_PASSWORD"]}).status_code==200
        yield client

def create(client,path,data):
    r=client.post(path,json=data)
    assert r.status_code==201,r.text
    return r.json()

def test_financial_workflow(client):
    f=create(client,"/funding",dict(name="Fictional test grant",academic_year="2026-2027",kind="cash",expected_cents=100000,received_cents=60000))
    g=create(client,"/funding",dict(name="Fictional credit",academic_year="2026-2027",kind="credit",expected_cents=300000,received_cents=300000))
    b=create(client,"/budgets",dict(funding_id=f["id"],program_code="ASUFCFSBP",cents=50000))
    c=create(client,"/budgets",dict(funding_id=g["id"],program_code="ASUFCFSBP",cents=100000))
    payload=dict(purchase_date=date.today().isoformat(),supplier="Test supplier",purchase_type="Groceries",cents=25000,allocations=[dict(budget_id=b["id"],cents=15000),dict(budget_id=c["id"],cents=10000)])
    tx=create(client,"/transactions",payload)
    assert tx["cents"]==25000
    data=client.get("/dashboard").json()
    totals={r["kind"]:r for r in data["funding"]}
    assert totals["cash"]["received"]==60000
    assert totals["cash"]["expected"]==40000
    assert totals["cash"]["spent"]==15000
    assert totals["credit"]["spent"]==10000
    assert data["programs"][0]["spent"]==25000
    assert len(client.get("/transactions").json())==1
    payload["allocations"][0]["cents"]=1
    assert client.post("/transactions",json=payload).status_code==422
    assert len(client.get("/transactions").json())==1
    from fastapi.testclient import TestClient
    from app.main import app
    with TestClient(app) as anonymous:
        assert anonymous.get("/funding").status_code==401

def test_void_and_adjustment(client):
    f=create(client,"/funding",dict(name="Test",academic_year="2026-2027",kind="cash",expected_cents=100000,received_cents=100000))
    b=create(client,"/budgets",dict(funding_id=f["id"],program_code="ASUFCGR",cents=50000))
    tx=create(client,"/transactions",dict(purchase_date=date.today().isoformat(),supplier="Test",purchase_type="Groceries",cents=25000,allocations=[dict(budget_id=b["id"],cents=25000)]))
    assert client.patch(f"/budgets/{b['id']}",json=dict(cents=20000,reason="Reduce")).status_code==422
    assert client.post(f"/transactions/{tx['id']}/void",json=dict(reason="Duplicate entry")).status_code==200
    assert client.post(f"/transactions/{tx['id']}/void",json=dict(reason="Again")).status_code==409
    history=client.get("/transactions").json()
    assert len(history)==1 and history[0]["status"]=="voided"
    assert history[0]["allocations"][0]["cents"]==25000
    assert client.get("/dashboard").json()["funding"][0]["spent"]==0
    assert client.get("/funding").json()[0]["remaining_cents"]==100000
    assert client.patch(f"/budgets/{b['id']}",json=dict(cents=20000,reason="Reduce")).status_code==200
    assert client.patch(f"/budgets/{b['id']}",json=dict(cents=110000,reason="Excess")).status_code==422
    actions={e["action"] for e in client.get("/audit").json()}
    assert {"created","voided","adjusted"} <= actions

def test_filtered_spending_report(client):
    f=create(client,"/funding",dict(name="Report test grant",academic_year="2026-2027",kind="cash",expected_cents=100000,received_cents=100000))
    g=create(client,"/funding",dict(name="Report test credit",academic_year="2026-2027",kind="credit",expected_cents=100000,received_cents=100000))
    b=create(client,"/budgets",dict(funding_id=f["id"],program_code="ASUFCGR",cents=50000))
    c=create(client,"/budgets",dict(funding_id=g["id"],program_code="ASUFCFSBP",cents=50000))
    tx=create(client,"/transactions",dict(purchase_date=date.today().isoformat(),supplier="Example",purchase_type="Groceries",cents=25000,allocations=[dict(budget_id=b["id"],cents=15000),dict(budget_id=c["id"],cents=10000)]))
    report=client.get("/reports/spending").json()
    assert report["purchase_count"] == 1
    assert report["totals"] == {"cash_cents":15000,"credit_cents":10000}
    assert client.get("/reports/spending",params={"program":"ASUFCGR"}).json()["totals"] == {"cash_cents":15000,"credit_cents":0}
    assert client.get("/reports/spending",params={"supplier":"Other"}).json()["purchase_count"] == 0
    assert client.post(f"/transactions/{tx['id']}/void",json={"reason":"Test reversal"}).status_code==200
    assert client.get("/reports/spending").json()["purchase_count"]==0

def test_atomic_correction_and_receipt_history(client):
    f=create(client,"/funding",dict(name="Test grant",academic_year="2026-2027",kind="cash",expected_cents=100000,received_cents=50000,organization="Test organization",received_on="2026-01-01",eligible_purchase_types=["Groceries", "Supplies"]))
    assert client.patch(f"/funding/{f['id']}/received",json={"received_cents":80000}).status_code==200
    receipts=client.get(f"/funding/{f['id']}/receipts").json()
    assert [x["cents"] for x in receipts]==[50000,30000]
    b=create(client,"/budgets",dict(funding_id=f["id"],program_code="ASUFCGR",cents=50000))
    payload=dict(purchase_date=date.today().isoformat(),supplier="Test",purchase_type="Groceries",cents=25000,allocations=[dict(budget_id=b["id"],cents=25000)])
    tx=create(client,"/transactions",payload)
    url=f"/transactions/{tx['id']}/correct"
    invalid=payload|{"cents":60000,"allocations":[dict(budget_id=b["id"],cents=60000)]}
    assert client.post(url,json={"reason":"Incorrect","replacement":invalid}).status_code==422
    assert client.post(url,json={"reason":"Incorrect category","replacement":payload | {"purchase_type":"Equipment"}}).json()["detail"] == "Purchase type not eligible"
    assert client.get("/transactions").json()[0]["status"]=="confirmed"
    valid=payload|{"cents":30000,"allocations":[dict(budget_id=b["id"],cents=30000)]}
    replacement=create(client,url,{"reason":"Correct amount","replacement":valid})
    history=client.get("/transactions").json()
    assert history[0]["original_id"]==tx["id"]
    assert history[1]["replacement_id"]==replacement["id"]
    assert client.get("/dashboard").json()["funding"][0]["spent"]==30000
    assert client.post(url,json={"reason":"Again","replacement":valid}).status_code==409

def test_academic_period_configuration(client):
    year=create(client,"/academic-years",dict(academic_year="2026-2027",starts_on="2026-09-01",ends_on="2027-08-31"))
    create(client,"/academic-years/2026-2027/semesters",dict(name="Fall",starts_on="2026-09-01",ends_on="2026-12-31"))
    assert client.post("/academic-years/2026-2027/semesters",json=dict(name="Overlap",starts_on="2026-11-01",ends_on="2027-01-01")).status_code==422
    assert client.post("/academic-years",json=dict(academic_year="2027-2028",starts_on="2027-08-01",ends_on="2028-08-31")).status_code==422
    assert client.get("/academic-years").json()[0]["semesters"][0]["name"]=="Fall"
    f=create(client,"/funding",dict(name="Test",academic_year="2026-2027",kind="cash",expected_cents=100000,received_cents=100000))
    b=create(client,"/budgets",dict(funding_id=f["id"],program_code="ASUFCGR",cents=50000))
    payload=dict(purchase_date="2026-08-31",supplier="Test",purchase_type="Groceries",cents=1000,allocations=[dict(budget_id=b["id"],cents=1000)])
    assert client.post("/transactions",json=payload).status_code==422
    create(client,"/transactions",payload|{"purchase_date":"2026-09-01"})

def test_carry_forward_conservation(client):
    for y,start,end in [("2026-2027","2026-09-01","2027-08-31"),("2027-2028","2027-09-01","2028-08-31")]:
        create(client,"/academic-years",dict(academic_year=y,starts_on=start,ends_on=end))
    f=create(client,"/funding",dict(name="Carry grant",academic_year="2026-2027",kind="cash",expected_cents=100000,received_cents=100000,eligible_supplier="Test"))
    rules = dict(eligible_programs=["ASUFCGR", "ASUFCFSBP"], eligible_suppliers=["Test"], eligible_purchase_types=["Food", "Supplies"])
    initial = dict(eligible_programs=[], eligible_suppliers=["Test"], eligible_purchase_types=[])
    rules_url = f"/funding/{f['id']}/eligibility"
    assert client.patch(rules_url, json=rules | {"expected": initial, "reason": "Grant terms"}).status_code == 200
    b=create(client,"/budgets",dict(funding_id=f["id"],program_code="ASUFCGR",cents=80000))
    url=f"/funding/{f['id']}/carry-forward"
    payload=dict(destination_year="2027-2028",cents=30000,reason="Approved carry")
    assert client.post(url,json=payload).status_code==422
    assert client.patch(f"/funding/{f['id']}/carry-permission",json=dict(eligible=True,reason="Grant permits")).status_code==200
    assert client.post(url,json=payload).status_code==422
    assert client.patch(f"/budgets/{b['id']}",json=dict(cents=0,reason="Release")).status_code==200
    t=create(client,url,payload)
    rows={r["id"]:r for r in client.get("/funding").json()}
    assert rows[f["id"]]["remaining_cents"]==70000
    dest=rows[t["destination_id"]]
    assert dest["remaining_cents"]==30000 and dest["received_cents"]==0
    assert dest["eligible_supplier"]=="Test"
    assert {name: dest[name] for name in rules} == rules
    assert client.patch(rules_url, json=initial | {"expected": rules, "reason": "Updated terms"}).status_code == 422
    expiry_change = dict(expiry="2028-06-30", reason="Updated grant terms")
    assert client.patch(f"/funding/{f['id']}/expiry", json=expiry_change).status_code == 422
    assert client.patch(f"/funding/{dest['id']}/expiry", json=expiry_change).status_code == 422
    assert client.get(f"/funding/{dest['id']}/receipts").json()==[]
    assert client.get("/dashboard",params={"year":"2027-2028"}).json()["funding"][0]["carried_in"]==30000
    assert client.post(url,json=payload|{"cents":70001}).status_code==422
    create(client,"/budgets",dict(funding_id=dest["id"],program_code="ASUFCGR",cents=30000))
    assert len(client.get("/funding-transfers").json())==1

def test_reconciliation_report(client):
    from app.main import db
    f=create(client,"/funding",dict(name="Reconcile",academic_year="2026-2027",kind="cash",expected_cents=100000,received_cents=80000))
    b=create(client,"/budgets",dict(funding_id=f["id"],program_code="ASUFCGR",cents=50000))
    create(client,"/transactions",dict(purchase_date=date.today().isoformat(),supplier="Test",purchase_type="Groceries",cents=25000,allocations=[dict(budget_id=b["id"],cents=25000)]))
    report=client.get("/reports/reconciliation").json()
    assert report["ok"]
    assert report["funding"][0]["remaining_cents"]==55000
    assert report["budgets"][0]["remaining_cents"]==25000
    with db() as c:
        c.execute("UPDATE funding_receipt SET cents=70000 WHERE funding_id=%s",(f["id"],))
    report=client.get("/reports/reconciliation").json()
    assert not report["ok"]
    assert report["issues"][0]["code"]=="receipt_mismatch"

def test_reconciliation_download(client):
    from io import BytesIO
    from openpyxl import load_workbook
    response=client.get("/reports/reconciliation.xlsx")
    assert response.status_code==200
    assert response.headers["content-type"]=="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    wb=load_workbook(BytesIO(response.content))
    assert wb["Reconciliation"]["B2"].value=="PASS"

def test_excel_import_atomic_and_duplicate(client):
    from io import BytesIO
    from base64 import b64encode
    from openpyxl import Workbook
    f=create(client,"/funding",dict(name="Import grant",academic_year="2026-2027",kind="cash",expected_cents=100000,received_cents=100000,eligible_suppliers=["Test", "Alternate shop"]))
    b=create(client,"/budgets",dict(funding_id=f["id"],program_code="ASUFCGR",cents=50000))
    headers=["external_id","purchase_date","supplier","purchase_type","description","amount","budget_id"]
    def payload(amount, supplier="Test"):
        w=Workbook(); s=w.active;s.append(headers);s.append(["legacy-1","2026-11-01","Test","Groceries","",100,b["id"]]);s.append(["legacy-2","2026-11-02",supplier,"Groceries","",amount,b["id"]]);out=BytesIO();w.save(out)
        return dict(content_base64=b64encode(out.getvalue()).decode(),sheet=s.title,mapping={k:k for k in headers})
    assert not client.post("/imports/preview",json=payload(500)).json()["valid"]
    assert client.post("/imports/commit",json=payload(500)).status_code==422
    assert client.post("/imports/preview",json=payload(200, "Other shop")).json()["validation_error"] == "Supplier not eligible"
    assert client.post("/imports/commit",json=payload(200, "Other shop")).status_code==422
    assert client.get("/transactions").json()==[]
    assert client.post("/imports/preview",json=payload(200)).json()["valid"]
    assert client.get("/transactions").json()==[]
    assert create(client,"/imports/commit",payload(200))["imported"]==2
    assert client.post("/imports/commit",json=payload(200)).status_code==422
    assert len(client.get("/transactions").json())==2

def test_carry_forward_reversal(client):
    for y,start,end in [("2026-2027","2026-09-01","2027-08-31"),("2027-2028","2027-09-01","2028-08-31")]:
        create(client,"/academic-years",dict(academic_year=y,starts_on=start,ends_on=end))
    f=create(client,"/funding",dict(name="Carry",academic_year="2026-2027",kind="cash",expected_cents=100000,received_cents=100000,carry_eligible=True))
    t=create(client,f"/funding/{f['id']}/carry-forward",dict(destination_year="2027-2028",cents=25000,reason="Approved"))
    b=create(client,"/budgets",dict(funding_id=t["destination_id"],program_code="ASUFCGR",cents=25000))
    url=f"/funding-transfers/{t['id']}/reverse"
    assert client.post(url,json={"reason":"Correction"}).status_code==422
    assert client.patch(f"/budgets/{b['id']}",json={"cents":0,"reason":"Release"}).status_code==200
    assert client.post(url,json={"reason":"Correction"}).status_code==200
    assert client.post(url,json={"reason":"Again"}).status_code==409
    rows={r["id"]:r for r in client.get("/funding").json()}
    assert rows[f["id"]]["remaining_cents"]==100000
    assert rows[t["destination_id"]]["remaining_cents"]==0
    assert client.get("/funding-transfers").json()[0]["reversed"]
    assert client.get("/reports/reconciliation").json()["ok"]

def test_concurrent_spending_cannot_exceed_budget(client):
    from concurrent.futures import ThreadPoolExecutor
    f=create(client,"/funding",dict(name="Concurrent",academic_year="2026-2027",kind="cash",expected_cents=10000,received_cents=10000))
    b=create(client,"/budgets",dict(funding_id=f["id"],program_code="ASUFCGR",cents=10000))
    def spend(i):
        return client.post("/transactions",json=dict(purchase_date="2026-11-01",supplier=f"Supplier {i}",purchase_type="Groceries",cents=7000,allocations=[dict(budget_id=b["id"],cents=7000)])).status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        results=list(pool.map(spend,range(2)))
    assert sorted(results)==[201,422]
    assert client.get("/budgets").json()[0]["remaining"]==3000

def test_manual_duplicate_review_and_period_edit(client):
    create(client,"/academic-years",dict(academic_year="2026-2027",starts_on="2026-09-01",ends_on="2027-08-31"))
    s=create(client,"/academic-years/2026-2027/semesters",dict(name="Fall",starts_on="2026-09-01",ends_on="2026-12-31"))
    f=create(client,"/funding",dict(name="Review",academic_year="2026-2027",kind="cash",expected_cents=100000,received_cents=100000))
    b=create(client,"/budgets",dict(funding_id=f["id"],program_code="ASUFCGR",cents=50000))
    payload=dict(purchase_date="2026-11-01",supplier="Shop",purchase_type="Groceries",cents=1000,allocations=[dict(budget_id=b["id"],cents=1000)])
    create(client,"/transactions",payload)
    assert client.post("/transactions",json=payload).status_code==422
    create(client,"/transactions",payload|{"duplicate_reason":"Separate receipt reviewed"})
    url=f"/academic-years/2026-2027/semesters/{s['id']}"
    assert client.patch(url,json=dict(name="Fall term",starts_on="2026-09-01",ends_on="2026-12-20",reason="Calendar correction")).status_code==200
    assert client.patch("/academic-years/2026-2027",json=dict(starts_on="2026-10-01",ends_on="2027-08-31",reason="Test")).status_code==422
    assert client.patch("/academic-years/2026-2027",json=dict(starts_on="2026-08-01",ends_on="2027-08-31",reason="Calendar correction")).status_code==200

def test_funding_expiry_can_be_edited_with_audit(client):
    fund = create(client, "/funding", dict(
        name="Fictional expiring grant", academic_year="2026-2027", kind="cash",
        expected_cents=10_000, received_cents=10_000,
    ))
    budget = create(client, "/budgets", dict(funding_id=fund["id"], program_code="ASUFCGR", cents=10_000))
    today = date.today()
    tomorrow = (today + timedelta(days=1)).isoformat()
    yesterday = (today - timedelta(days=1)).isoformat()
    url = f"/funding/{fund['id']}/expiry"
    assert client.patch(url, json=dict(expiry=tomorrow, reason=" ")).status_code == 422
    response = client.patch(url, json=dict(expiry=tomorrow, reason="Grant deadline confirmed"))
    assert response.status_code == 200
    assert response.json()["expiry"] == tomorrow
    assert client.get("/budgets").json()[0]["expiry"] == tomorrow
    purchase = dict(purchase_date=today.isoformat(), supplier="Shop", purchase_type="Food", cents=500,
                    allocations=[dict(budget_id=budget["id"], cents=500)])
    assert client.post("/transactions", json=purchase | {"purchase_date": (today + timedelta(days=2)).isoformat()}).status_code == 422
    create(client, "/transactions", purchase)
    assert client.patch(url, json=dict(expiry=yesterday, reason="Would invalidate spending")).status_code == 422
    assert client.patch(url, json=dict(expiry=None, reason="Deadline removed by funder")).status_code == 200
    assert client.get("/funding").json()[0]["expiry"] is None
    events = [event["details"] for event in client.get("/audit").json() if event["action"] == "expiry_changed"]
    assert events == [
        {"before": tomorrow, "after": None, "reason": "Deadline removed by funder"},
        {"before": None, "after": tomorrow, "reason": "Grant deadline confirmed"},
    ]

def test_purchase_type_restriction(client):
    f=create(client,"/funding",dict(name="Restricted",academic_year="2026-2027",kind="cash",expected_cents=100000,received_cents=100000))
    b=create(client,"/budgets",dict(funding_id=f["id"],program_code="ASUFCGR",cents=50000))
    assert client.patch(f"/funding/{f['id']}/purchase-type",json=dict(purchase_type="Groceries",reason="Grant terms")).status_code==200
    payload=dict(purchase_date="2026-11-01",supplier="Shop",purchase_type="Equipment",cents=1000,allocations=[dict(budget_id=b["id"],cents=1000)])
    assert client.post("/transactions",json=payload).status_code==422
    create(client,"/transactions",payload|{"purchase_type":"Groceries"})
    assert client.patch(f"/funding/{f['id']}/purchase-type",json=dict(purchase_type="Equipment",reason="Invalid change")).status_code==422

def test_restriction_suggestions(client):
    f=create(client,"/funding",dict(name="Restricted suggestions",academic_year="2026-2027",kind="cash",expected_cents=10000,received_cents=10000))
    b=create(client,"/budgets",dict(funding_id=f["id"],program_code="ASUFCGR",cents=10000))
    assert client.patch(f"/funding/{f['id']}/purchase-type",json=dict(purchase_type="Groceries",reason="Terms")).status_code==200
    p=dict(program_code="ASUFCGR",academic_year="2026-2027",kind="cash",supplier="Shop",purchase_date="2026-11-01",cents=1000,purchase_type="Equipment")
    assert client.post("/allocation-suggestions",json=p).json()["unallocated_cents"]==1000
    assert client.post("/allocation-suggestions",json=p|{"purchase_type":"Groceries"}).json()["allocations"]==[{"budget_id":b["id"],"cents":1000}]

def test_funding_spending_rules_match_purchases_and_suggestions(client):
    rules = dict(
        eligible_programs=["ASUFCGR", "ASUFCFSBP"],
        eligible_suppliers=["Fictional Market", "Fictional Distributor"],
        eligible_purchase_types=["Food", "Supplies"],
    )
    source = create(client, "/funding", dict(
        name="Fictional restricted credits", academic_year="2026-2027", kind="credit",
        expected_cents=10_000, received_cents=10_000,
    ) | rules | {"eligible_suppliers": [*rules["eligible_suppliers"], " FICTIONAL MARKET "]})
    assert {name: source[name] for name in rules} == rules

    budget = create(client, "/budgets", dict(funding_id=source["id"], program_code="ASUFCGR", cents=6_000))
    create(client, "/budgets", dict(funding_id=source["id"], program_code="ASUFCFSBP", cents=4_000))
    assert client.post("/budgets", json=dict(funding_id=source["id"], program_code="ASUFCSIR", cents=1)).json()["detail"] == "Program not eligible"

    purchase = dict(purchase_date="2026-10-03", cents=1_000, supplier="fictional distributor", purchase_type="Supplies")
    suggestion = purchase | dict(program_code="ASUFCGR", academic_year="2026-2027", kind="credit")
    allocation = dict(budget_id=budget["id"], cents=1_000)
    assert client.post("/allocation-suggestions", json=suggestion).json()["allocations"] == [allocation]
    for invalid in ({"supplier": "Other Store"}, {"purchase_type": "Equipment"}):
        assert client.post("/allocation-suggestions", json=suggestion | invalid).json()["allocations"] == []
        assert client.post("/transactions", json=purchase | invalid | {"allocations": [allocation]}).status_code == 422
    create(client, "/transactions", purchase | {"allocations": [allocation]})

    url = f"/funding/{source['id']}/eligibility"
    change = rules | {"expected": rules, "reason": "Fictional award amendment"}
    assert "budget" in client.patch(url, json=change | {"eligible_programs": ["ASUFCGR"]}).json()["detail"]
    assert "spending" in client.patch(url, json=change | {"eligible_purchase_types": ["Food"]}).json()["detail"]
    assert client.patch(f"/funding/{source['id']}/purchase-type", json={"purchase_type": None, "reason": "Legacy editor"}).status_code == 422
    status = client.patch(url, json=change | {"eligible_purchase_types": ["Supplies"]})
    assert status.status_code == 200, status.text
    assert client.patch(url, json=change).status_code == 409
    audit = next(event for event in client.get("/audit").json() if event["action"] == "restriction_changed")
    assert audit["details"]["before"] == rules
    assert audit["details"]["after"]["eligible_purchase_types"] == ["Supplies"]

def test_legacy_funding_rules_can_be_cleared_without_reappearing(client):
    from app.main import db
    source = create(client, "/funding", dict(
        name="Fictional legacy source", academic_year="2026-2027", kind="cash", expected_cents=5_000,
        received_cents=5_000,
    ))
    # Recreate a record written before rules moved to funding_eligibility, then run the migration backfill.
    with db() as c:
        c.execute("DELETE FROM funding_eligibility WHERE funding_id=%s", (source["id"],))
        c.execute("UPDATE funding SET eligible_program='ASUFCGR', eligible_supplier='Fictional Store' WHERE id=%s", (source["id"],))
        c.execute("INSERT INTO funding_purchase_type VALUES (%s,%s)", (source["id"], "Food"))
        c.execute("SELECT asufc_backfill_eligibility()")
    previous = dict(eligible_programs=["ASUFCGR"], eligible_suppliers=["Fictional Store"], eligible_purchase_types=["Food"])
    listed = client.get("/funding").json()[0]
    assert {name: listed[name] for name in previous} == previous
    assert listed["eligible_purchase_type"] == "Food"
    empty = dict(eligible_programs=[], eligible_suppliers=[], eligible_purchase_types=[])
    response = client.patch(f"/funding/{source['id']}/eligibility", json=empty | {"expected": previous, "reason": "Fictional approval"})
    assert response.status_code == 200, response.text
    listed = client.get("/funding").json()[0]
    assert {name: listed[name] for name in empty} == empty
    assert listed["eligible_program"] is None
    create(client, "/budgets", dict(funding_id=source["id"], program_code="ASUFCFSBP", cents=5_000))

def test_session_security(client):
    from app.main import db, COOKIE
    assert client.get("/auth/session").status_code==200
    token=client.cookies.get(COOKIE)
    assert token
    with db() as c:
        assert not c.execute("SELECT 1 FROM staff_session WHERE token_hash=%s",(token,)).fetchone()
    client.headers.pop("X-ASUFC-Request")
    assert client.post("/auth/logout").status_code==403
    client.headers["X-ASUFC-Request"]="1"
    assert client.post("/auth/logout").status_code==200
    client.cookies.set(COOKIE,token)
    assert client.get("/funding").status_code==401

def test_login_throttle_and_expiry(client):
    from app.main import db
    with db() as c: c.execute("UPDATE staff_session SET expires_at=now()-interval '1 second'")
    assert client.get("/funding").status_code==401
    # Failed attempts against one username do not lock out other accounts.
    for _ in range(10):
        assert client.post("/auth/login",json={"username":"wrong","password":"wrong"}).status_code==401
    assert client.post("/auth/login",json={"username":"wrong","password":"wrong"}).status_code==429
    assert client.post("/auth/login",json={"username":os.environ["STAFF_USER"],"password":os.environ["STAFF_PASSWORD"]}).status_code==200
    for _ in range(10):
        assert client.post("/auth/login",json={"username":os.environ["STAFF_USER"],"password":"wrong-password"}).status_code==401
    assert client.post("/auth/login",json={"username":os.environ["STAFF_USER"],"password":os.environ["STAFF_PASSWORD"]}).status_code==429

def test_password_rotation_revokes_sessions(client):
    from fastapi.testclient import TestClient
    from app.main import app
    old=os.environ["STAFF_PASSWORD"]
    user=os.environ["STAFF_USER"]
    new="new-test-password-unique"
    with TestClient(app) as other:
        other.headers["X-ASUFC-Request"]="1"
        assert other.post("/auth/login",json={"username":user,"password":old}).status_code==200
        assert client.post("/auth/password",json={"current_password":"wrong","new_password":new}).status_code==401
        assert client.post("/auth/password",json={"current_password":old,"new_password":new}).status_code==200
        assert other.get("/funding").status_code==401
        assert other.post("/auth/login",json={"username":user,"password":old}).status_code==401
        assert other.post("/auth/login",json={"username":user,"password":new}).status_code==200

def test_operator_password_recovery(client):
    from app.reset_password import reset_password
    from app.main import db
    user=os.environ["STAFF_USER"]
    old=os.environ["STAFF_PASSWORD"]
    new="operator-reset-test-password"
    reset_password(new)
    assert client.get("/funding").status_code==401
    assert client.post("/auth/login",json={"username":user,"password":old}).status_code==401
    assert client.post("/auth/login",json={"username":user,"password":new}).status_code==200
    assert any(x["action"]=="password_reset" for x in client.get("/audit").json())

def test_secure_cookie_over_https(client,monkeypatch):
    from fastapi.testclient import TestClient
    from app.main import app
    monkeypatch.setenv("SESSION_SECURE","1")
    with TestClient(app,base_url="https://testserver") as tls:
        r=tls.post("/auth/login",headers={"X-ASUFC-Request":"1"},json={"username":os.environ["STAFF_USER"],"password":os.environ["STAFF_PASSWORD"]})
        assert r.status_code==200
        assert "Secure" in r.headers["set-cookie"]
        assert "HttpOnly" in r.headers["set-cookie"]
        assert tls.get("/funding").status_code==200
        assert tls.get("http://testserver/funding").status_code==401

def test_validation_does_not_echo_password(client):
    secret="fictional-secret-"+"x"*1100
    r=client.post("/auth/login",json={"username":"teststaff","password":secret})
    assert r.status_code==422
    assert "fictional-secret-" not in r.text
    assert r.headers["cache-control"]=="no-store"

def test_report_year_and_suggestion_boundaries(client):
    assert client.get("/dashboard?year=2026-2028").status_code==422
    assert client.get("/reports/spending?year=invalid").status_code==422
    create(client,"/academic-years",dict(academic_year="2026-2027",starts_on="2026-09-01",ends_on="2027-08-31"))
    p=dict(program_code="ASUFCGR",academic_year="2026-2027",kind="cash",supplier="Shop",purchase_date="2026-08-31",cents=1000)
    assert client.post("/allocation-suggestions",json=p).status_code==422
