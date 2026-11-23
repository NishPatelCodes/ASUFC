from datetime import date, timedelta
import pytest
from app.rules import validate_purchase

def split(**kw):
    return dict(budget_id=1,cents=25000,remaining=50000,academic_year="2026-2027",expiry=None,eligible_program=None,eligible_supplier=None,program_code="ASUFCFSBP",funding_id=1,fund_remaining=50000)|kw

def check(rows,total=25000):
    validate_purchase(total,rows,date.today(),"Example supplier")

def test_valid(): check([split()])
def test_split(): check([split(cents=10000),split(budget_id=2,cents=15000)])
@pytest.mark.parametrize("row",[
    dict(cents=100),dict(remaining=100),dict(fund_remaining=100),
    dict(expiry=date.today()-timedelta(days=1)),dict(eligible_program="ASUFCGR"),
    dict(eligible_supplier="Other supplier")])
def test_invalid(row):
    with pytest.raises(ValueError): check([split(**row)])
def test_shared_fund():
    with pytest.raises(ValueError):
        check([split(cents=10000,fund_remaining=20000),split(budget_id=2,cents=15000,fund_remaining=20000)])

def test_duplicate_budget_rejected():
    with pytest.raises(ValueError, match="Duplicate budget"):
        check([split(cents=10000),split(cents=15000)])

def test_cross_year_rejected():
    with pytest.raises(ValueError, match="academic years"):
        check([split(cents=10000),split(budget_id=2,cents=15000,academic_year="2027-2028")])

def test_late_entry_requires_reason():
    expired = date.today() - timedelta(days=3)
    rows = [split(expiry=expired)]
    with pytest.raises(ValueError, match="late-entry reason"):
        validate_purchase(25000, rows, expired, "Example supplier", today=date.today())
    validate_purchase(25000, rows, expired, "Example supplier", today=date.today(), late_entry_reason="Receipt arrived late")

def test_purchase_after_expiry_rejected_even_with_reason():
    expired = date.today() - timedelta(days=3)
    with pytest.raises(ValueError, match="Funding expired"):
        validate_purchase(25000, [split(expiry=expired)], date.today(), "Example supplier",
                          today=date.today(), late_entry_reason="Late")
