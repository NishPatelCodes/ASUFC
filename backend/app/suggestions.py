from datetime import date

from .rules import spending_restriction

def suggest_allocations(rows, total, program, year, kind, supplier, purchase_date, preferred_funding=None, purchase_type=''):
    """Read-only proposal for one program and one payment kind; never saves records."""
    if total <= 0 or not supplier.strip() or kind not in ('cash', 'credit'):
        raise ValueError('Provide a positive amount, supplier and payment type')
    eligible = []
    for row in rows:
        if (row['program_code'], row['academic_year'], row['kind']) != (program, year, kind):
            continue
        if row['expiry'] and row['expiry'] < purchase_date:
            continue
        if spending_restriction(row, program, supplier, purchase_type):
            continue
        if min(row['remaining'], row['fund_remaining']) > 0:
            eligible.append(row)
    # Staff-selected preferred source first; then earliest expiry, then stable ID.
    eligible.sort(key=lambda r: (r['funding_id'] != preferred_funding, r['expiry'] or date.max, r['id']))
    left = total
    allocations = []
    used = {}
    for row in eligible:
        fund = row['funding_id']
        available = min(row['remaining'], row['fund_remaining'] - used.get(fund, 0))
        amount = int(min(left, available))
        if amount <= 0:
            continue
        allocations.append({'budget_id': row['id'], 'cents': amount})
        used[fund] = used.get(fund, 0) + amount
        left -= amount
        if left == 0:
            break
    return {'allocations': allocations, 'unallocated_cents': left}
