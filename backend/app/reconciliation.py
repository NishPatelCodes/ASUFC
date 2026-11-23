"""Independent ledger checks; no automatic modifications."""
from collections import defaultdict

def reconcile(funds,budgets,purchases,allocations,receipts,transfers,year,refunds=(),returns=()):
    receipt_totals=defaultdict(int)
    incoming=defaultdict(int)
    outgoing=defaultdict(int)
    budget_totals=defaultdict(int)
    budget_spent=defaultdict(int)
    purchase_totals=defaultdict(int)
    purchase_years=defaultdict(set)
    for r in receipts: receipt_totals[r["funding_id"]]+=int(r["cents"])
    returned=defaultdict(int)
    for r in returns: returned[r["funding_id"]]+=int(r["cents"])
    refunded=defaultdict(int)
    for r in refunds: refunded[(r["purchase_id"],r["budget_id"])]+=int(r["cents"])
    for t in transfers:
        incoming[t["destination_id"]]+=int(t["cents"])
        outgoing[t["source_id"]]+=int(t["cents"])
    fm={f["id"]:f for f in funds}
    bm={b["id"]:b for b in budgets}
    pm={p["id"]:p for p in purchases}
    issues=[]
    def flag(code,record_id,expected,actual):
        issues.append(dict(code=code,record_id=record_id,expected=expected,actual=actual))
    for a in allocations:
        p=pm[a["purchase_id"]]
        b=bm[a["budget_id"]]
        purchase_totals[p["id"]]+=int(a["cents"])
        purchase_years[p["id"]].add(fm[b["funding_id"]]["academic_year"])
        refund=refunded.get((a["purchase_id"],a["budget_id"]),0)
        if refund>int(a["cents"]): flag("refund_exceeds_allocation",p["id"],int(a["cents"]),refund)
        if not p["voided"]: budget_spent[b["id"]]+=int(a["cents"])-refund
    for p in purchases:
        years=purchase_years[p["id"]]
        if year not in years and years: continue
        if purchase_totals[p["id"]]!=p["cents"]:
            flag("purchase_allocation_mismatch",p["id"],int(p["cents"]),purchase_totals[p["id"]])
        if len(years)>1: flag("cross_year_purchase",p["id"],1,len(years))
    spending=defaultdict(int)
    budget_rows=[]
    for b in budgets:
        budget_totals[b["funding_id"]]+=int(b["cents"])
        spent=budget_spent[b["id"]]
        spending[b["funding_id"]]+=spent
        if fm[b["funding_id"]]["academic_year"]!=year: continue
        if spent>b["cents"]: flag("budget_overspent",b["id"],int(b["cents"]),spent)
        budget_rows.append(dict(id=b["id"],funding_id=b["funding_id"],program_code=b["program_code"],allocated_cents=int(b["cents"]),spent_cents=spent,remaining_cents=int(b["cents"])-spent))
    funding_rows=[]
    for f in funds:
        if f["academic_year"]!=year: continue
        i=f["id"]; received=int(f["received_cents"]); capacity=received+incoming[i]-outgoing[i]-returned[i]
        if receipt_totals[i]!=received: flag("receipt_mismatch",i,received,receipt_totals[i])
        if budget_totals[i]>capacity: flag("overallocated_funding",i,capacity,budget_totals[i])
        if spending[i]>capacity: flag("funding_overspent",i,capacity,spending[i])
        funding_rows.append(dict(id=i,name=f["name"],kind=f["kind"],expected_cents=int(f["expected_cents"])-received,received_cents=received,carried_in_cents=incoming[i],carried_out_cents=outgoing[i],returned_cents=returned[i],capacity_cents=capacity,allocated_cents=budget_totals[i],spent_cents=spending[i],remaining_cents=capacity-spending[i],unallocated_cents=capacity-budget_totals[i]))
    for t in transfers:
        src,dst=fm[t["source_id"]],fm[t["destination_id"]]
        if year not in (src["academic_year"],dst["academic_year"]): continue
        if src["kind"]!=dst["kind"]: flag("transfer_kind_mismatch",t["id"],src["kind"],dst["kind"])
        if int(dst["academic_year"][:4])!=int(src["academic_year"][:4])+1: flag("transfer_year_mismatch",t["id"],"next academic year",dst["academic_year"])
    return dict(year=year,ok=not issues,issues=issues,funding=funding_rows,budgets=budget_rows)
