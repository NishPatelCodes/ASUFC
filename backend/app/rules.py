from datetime import date

LATE_ENTRY = "This funding has expired. Enter a late-entry reason to record a purchase made on or before the expiry date"

def restriction_allows(row: dict, field: str, value: str) -> bool:
    allowed = row.get(field + "s")
    if allowed is None:
        legacy = row.get(field)
        allowed = [legacy] if legacy else []
    if not allowed:
        return True
    if field == "eligible_program":
        return value in allowed
    if field == "eligible_supplier":
        return any(value.casefold() == item.casefold() for item in allowed)
    return any(value.strip().casefold() == item.strip().casefold() for item in allowed)

def spending_restriction(row: dict, program: str, supplier: str, purchase_type: str) -> str | None:
    if not restriction_allows(row, "eligible_program", program):
        return "Program not eligible"
    if not restriction_allows(row, "eligible_purchase_type", purchase_type):
        return "Purchase type not eligible"
    if not restriction_allows(row, "eligible_supplier", supplier):
        return "Supplier not eligible"
    return None

def late_entry(allocations: list[dict], today: date) -> bool:
    """True when the purchase is being recorded after a funding source expired."""
    return any(a["expiry"] and today > a["expiry"] for a in allocations)

def validate_purchase(total: int, allocations: list[dict], purchase_date: date, supplier: str, purchase_type: str = '',
                      today: date | None = None, late_entry_reason: str = ''):
    if total <= 0 or not allocations or sum(a["cents"] for a in allocations) != total:
        raise ValueError("Allocations must equal a positive purchase total")
    if len({a["budget_id"] for a in allocations}) != len(allocations):
        raise ValueError("Duplicate budget allocation")
    if len({a["academic_year"] for a in allocations}) != 1:
        raise ValueError("Cannot split across academic years")
    for a in allocations:
        if a["cents"] <= 0 or a["cents"] > a["remaining"]:
            raise ValueError("Insufficient budget")
        # Eligibility depends on when the purchase was made. A receipt entered
        # after expiry is accepted only with a recorded reason.
        if a["expiry"] and purchase_date > a["expiry"]:
            raise ValueError("Funding expired")
        if error := spending_restriction(a, a["program_code"], supplier, purchase_type):
            raise ValueError(error)
    for fund in {a["funding_id"] for a in allocations}:
        group = [a for a in allocations if a["funding_id"] == fund]
        if sum(a["cents"] for a in group) > group[0]["fund_remaining"]:
            raise ValueError("Insufficient confirmed funding")
    if late_entry(allocations, today or date.today()) and not late_entry_reason.strip():
        raise ValueError(LATE_ENTRY)
