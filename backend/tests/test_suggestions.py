from datetime import date, timedelta
from app.suggestions import suggest_allocations


def row(i=1, **changes):
    return dict(id=i, funding_id=i, program_code='ASUFCGR', academic_year='2026-2027', kind='cash', expiry=None, eligible_program=None, eligible_supplier=None, remaining=10000, fund_remaining=10000) | changes


def propose(rows, total=25000, preferred=None):
    return suggest_allocations(rows,total,'ASUFCGR','2026-2027','cash','Test supplier',date.today(),preferred)


def test_preferred_then_alternative():
    result=propose([row(1,remaining=15000,fund_remaining=15000),row(2,remaining=20000,fund_remaining=20000)],preferred=2)
    assert result == {'allocations':[{'budget_id':2,'cents':20000},{'budget_id':1,'cents':5000}],'unallocated_cents':0}


def test_excludes_ineligible_sources():
    result=propose([row(1,kind='credit'),row(2,expiry=date.today()-timedelta(days=1)),row(3,eligible_supplier='Other'),row(4,program_code='ASUFCFSBP'),row(5,academic_year='2027-2028'),row(6,fund_remaining=0),row(7,eligible_program='ASUFCFSBP'),row(8)])
    assert result == {'allocations':[{'budget_id':8,'cents':10000}],'unallocated_cents':15000}


def test_earliest_expiry_first():
    assert propose([row(1),row(2,expiry=date.today()+timedelta(days=5))],5000)['allocations'][0]['budget_id']==2


def test_shared_funding_capacity():
    result=propose([row(1,fund_remaining=12000),row(2,funding_id=1,fund_remaining=12000)])
    assert result['unallocated_cents']==13000


def test_late_entry_suggests_source_valid_on_purchase_date():
    expired = date.today() - timedelta(days=2)
    result = suggest_allocations([row(1, expiry=expired)], 5000, 'ASUFCGR', '2026-2027', 'cash', 'Test supplier',
                                 expired - timedelta(days=1))
    assert result['allocations'] == [{'budget_id': 1, 'cents': 5000}]
