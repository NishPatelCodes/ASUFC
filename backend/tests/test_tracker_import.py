"""The tracker importer reads a fictional workbook laid out like the staff tracker."""
import os
from base64 import b64encode
from datetime import date, datetime
from io import BytesIO

import pytest
from openpyxl import Workbook

from app.tracker_import import draft_from_workbook, match_program

PROGRAMS = [
    {"code": "ASUFCGR", "name": "General Restocks"},
    {"code": "ASUFCFSBP", "name": "Foodsharing Breakfast Program"},
    {"code": "ASUFCE&W", "name": "Events & Workshops"},
    {"code": "ASUFCSIR", "name": "Specialty Item Restocks"},
]


def tracker(extra_rows=()):
    wb = Workbook()
    ws = wb.active
    ws.title = "Fictional Tracker"
    ws["A1"] = "Fictional operational budget tracker"
    ws["A5"], ws["C5"] = "Confirmed / Expected Supports", "=SUM(C11:C14)"
    ws.append([])
    rows = [
        ["Support / Funding Source", "Status", "Amount", "Program / Use", "Notes"],
        ["Example Catering - Fall", "Expected", 1500, "ASUFC Operations", "Credits on SUPPLYCO; not cash in bank"],
        ["Example Food Council", "Received", 3000, "MARKET credits", "Credits on MARKET; not cash in bank"],
        ["Example Family Gift", "Received", 10000, "FoodSharing Breakfast Program", "Designated for breakfast"],
        ["Example Provincial Fund", "Received", 10000, "Direct food purchases only", "Spend by March 31, 2027"],
        ["Example Bake Sale", "Pending", 1500, "To confirm", "Estimated amount"],
        ["TOTAL RECEIVED SUPPORTS", None, '=SUMIF(B11:B15,"Received",C11:C15)'],
        ["CURRENT BANK ACCOUNT BALANCE", None, None, "To confirm"],
        ["SPENDING / EXPENSE TRACKER"],
        ["Date", "Expense / Purchase", "Category", "Paid From", "Amount", "Program / Purpose", "Notes"],
        [datetime(2026, 9, 1), "Example Mart order", "Groceries", "To confirm", 228.69, "ASUFC General Restocks", "Receipt total"],
        [datetime(2026, 10, 27), "Example Delivery order", "Event food", "To confirm", 52.54, "ASUFC Events & Workshops", "Verify net on statement."],
        [datetime(2026, 11, 3), "Example Mart order", "Groceries", "Card", 256.77, "ASUFC Breakfast Program Restocks", "Check final card charge"],
        *extra_rows,
        [],
        [None, None, None, "TOTAL SPENDING", "=SUM(E20:E30)"],
        ["HOW TO USE THIS TRACKER"],
    ]
    for row in rows:
        ws.append(row)
    out = BytesIO()
    wb.save(out)
    return out.getvalue()


def draft(content):
    return draft_from_workbook(content, "2026-2027", date(2026, 9, 1), date(2027, 8, 31), PROGRAMS)


def test_reads_funding_and_pending_purchases():
    result = draft(tracker())
    assert result["errors"] == []
    funding = {f["name"]: f for f in result["starter"]["funding"]}
    assert set(funding) == {"Example Catering - Fall", "Example Food Council", "Example Family Gift",
                            "Example Provincial Fund", "Example Bake Sale"}
    catering, council = funding["Example Catering - Fall"], funding["Example Food Council"]
    assert (catering["kind"], catering["received_cents"], catering["commitment"]) == ("credit", 0, "committed")
    assert catering["eligible_suppliers"] == ["SUPPLYCO"]
    assert (council["kind"], council["received_cents"], council["eligible_suppliers"]) == ("credit", 300000, ["MARKET"])
    assert funding["Example Family Gift"]["eligible_programs"] == ["ASUFCFSBP"]
    assert funding["Example Provincial Fund"]["expiry"] == date(2027, 3, 31)
    assert funding["Example Provincial Fund"]["kind"] == "cash"
    assert funding["Example Bake Sale"]["commitment"] == "unconfirmed"
    purchases = result["starter"]["purchases"]
    assert [(p["program_code"], p["supplier"], p["cents"]) for p in purchases] == [
        ("ASUFCGR", "Example Mart", 22869), ("ASUFCE&W", "Example Delivery", 5254), ("ASUFCFSBP", "Example Mart", 25677)]
    assert [p["verify_charge"] for p in purchases] == [False, True, True]
    assert "Tracker paid from: Card" in purchases[2]["notes"]


def test_reports_rows_it_cannot_read():
    result = draft(tracker([
        [datetime(2025, 1, 1), "Old order", "Groceries", "To confirm", 10, "ASUFC General Restocks", ""],
        [datetime(2026, 12, 1), "Unclear order", "Groceries", "To confirm", 10, "Mystery fund", ""],
        [datetime(2026, 12, 2), "Formula order", "Groceries", "To confirm", "=1+1", "ASUFC General Restocks", ""],
        ["soon", "Bad date", "Groceries", "To confirm", 10, "ASUFC General Restocks", ""],
    ]))
    assert [e["row"] for e in result["errors"]] == [20, 21, 22, 23]
    assert len(result["starter"]["purchases"]) == 3


def test_rejects_other_workbooks():
    wb = Workbook()
    wb.active.append(["Something", "Else"])
    out = BytesIO()
    wb.save(out)
    with pytest.raises(ValueError, match="funding and spending sections"):
        draft(out.getvalue())
    with pytest.raises(ValueError):
        draft(b"not a workbook")


def test_program_matching_needs_one_clear_match():
    assert match_program("ASUFC Breakfast Program Restocks", PROGRAMS) == "ASUFCFSBP"
    assert match_program("ASUFCSIR", PROGRAMS) == "ASUFCSIR"
    assert match_program("Restocks", PROGRAMS) is None


@pytest.mark.skipif(os.getenv("ASUFC_TEST_DATABASE") != "1", reason="Requires disposable PostgreSQL database")
def test_draft_applies_as_starter_ledger():
    from fastapi.testclient import TestClient
    from app.credentials import hash_password
    from app.main import app, db
    user, password = os.environ["STAFF_USER"], os.environ["STAFF_PASSWORD"]
    with TestClient(app) as client:
        with db() as c:
            c.execute("""TRUNCATE staff_session,staff_login_attempt,funding_transfer,semester,academic_period,purchase_correction,
                funding_receipt,audit_event,purchase_void,allocation,purchase,budget,funding,purchase_intake,catalog_entry RESTART IDENTITY CASCADE""")
            c.execute("UPDATE staff_credential SET password_hash=%s WHERE username=%s", (hash_password(password), user))
        client.headers["X-ASUFC-Request"] = "1"
        assert client.post("/auth/login", json={"username": user, "password": password}).status_code == 200
        body = {"content_base64": b64encode(tracker()).decode(), "academic_year": "2026-2027",
                "starts_on": "2026-09-01", "ends_on": "2027-08-31"}
        assert client.post("/staff-setup/workbook-draft", json=body | {"ends_on": "2028-08-31"}).status_code == 422
        result = client.post("/staff-setup/workbook-draft", json=body)
        assert result.status_code == 200, result.text
        applied = client.post("/staff-setup", json=result.json()["starter"])
        assert applied.status_code == 201, applied.text
        assert applied.json()["pending_purchases"] == 3
        cash = {r["kind"]: r for r in client.get("/dashboard").json()["funding"]}
        assert cash["cash"]["received"] == 2_000_000 and cash["credit"]["received"] == 300_000
        assert cash["cash"]["unconfirmed"] == 150_000
