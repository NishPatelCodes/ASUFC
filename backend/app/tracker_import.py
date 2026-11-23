"""Read the Food Cupboard's budget tracker workbook into a reviewable starter draft.

The tracker keeps a funding section ("Support / Funding Source", "Status",
"Amount", ...) and a spending section ("Date", "Expense / Purchase",
"Category", "Paid From", "Amount", "Program / Purpose", "Notes") on one sheet.
Nothing is saved here: the draft goes through the existing starter review and
``/staff-setup`` validation, and spending lands as pending purchases because the
tracker does not record which funding paid for each one.
"""
import re
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from io import BytesIO
from zipfile import ZipFile

from defusedxml.common import DefusedXmlException
from openpyxl import load_workbook
from xml.etree.ElementTree import ParseError

MAX_BYTES = 5_000_000
MAX_EXPANDED = 30_000_000
MAX_ROWS = 2000
MAX_COLUMNS = 40
FUNDING_HEADERS = ("support / funding source", "status", "amount")
SPENDING_HEADERS = ("date", "expense / purchase", "category", "paid from", "amount", "program / purpose")
STOP_WORDS = {"asufc", "program", "programs", "restock", "restocks", "the", "and", "&", "for"}
MONTHS = "january february march april may june july august september october november december".split()
CREDIT_HINTS = re.compile(r"\bcredits?\b|in-kind", re.I)
VERIFY_HINTS = re.compile(r"\b(check|verify|confirm)\b", re.I)


def text(value):
    return " ".join(str(value).split()) if value is not None else ""


def cents(value):
    try:
        amount = Decimal(str(value)) * 100
    except InvalidOperation:
        raise ValueError("Invalid amount") from None
    if not amount.is_finite() or amount != amount.to_integral_value() or not 0 <= amount <= 10**12:
        raise ValueError("Invalid amount")
    return int(amount)


def tokens(value):
    return {word for word in re.findall(r"[a-z0-9]+", value.casefold()) if word not in STOP_WORDS}


def match_program(label, programs):
    """Return the one program whose code or name best matches a tracker label."""
    wanted = tokens(label)
    for program in programs:
        if program["code"].casefold() in label.casefold().split():
            return program["code"]
    scored = sorted(((len(wanted & tokens(p["name"])), p["code"]) for p in programs), reverse=True)
    if scored and scored[0][0] > 0 and (len(scored) == 1 or scored[1][0] < scored[0][0]):
        return scored[0][1]
    return None


def spend_by(notes):
    match = re.search(r"(?:spend|use|expires?)\s+(?:by|before|on)\s+([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})", notes, re.I)
    if not match or match.group(1).casefold() not in MONTHS:
        return None
    try:
        return date(int(match.group(3)), MONTHS.index(match.group(1).casefold()) + 1, int(match.group(2)))
    except ValueError:
        return None


def suppliers_named(notes):
    """Credits held with a supplier, e.g. "Credits on SYSCO" or "Use on the WFM2Go website"."""
    found = re.findall(r"\b(?i:credits?|use)\s+(?i:on)\s+(?i:the\s+)?([A-Z][A-Za-z0-9&'.-]*)", notes)
    return list(dict.fromkeys(found))


def supplier_from(expense):
    return re.sub(r"\s+(order|purchase|receipt)$", "", expense, flags=re.I).strip() or expense


def find_header(rows, wanted):
    for index, row in enumerate(rows):
        labels = [text(v).casefold() for v in row]
        if all(name in labels for name in wanted):
            return index, {name: labels.index(name) for name in labels if name}
    return None, None


def read_rows(content):
    if len(content) > MAX_BYTES:
        raise ValueError("Workbook exceeds 5 MB")
    try:
        with ZipFile(BytesIO(content)) as archive:
            if sum(item.file_size for item in archive.infolist()) > MAX_EXPANDED:
                raise ValueError("Expanded workbook too large")
        workbook = load_workbook(BytesIO(content), read_only=True, data_only=False, keep_links=False)
    except ValueError:
        raise
    except Exception as error:
        raise ValueError("Invalid or oversized XLSX workbook") from error
    try:
        for sheet in workbook.worksheets:
            rows = []
            for row in sheet.iter_rows(max_row=MAX_ROWS, max_col=MAX_COLUMNS):
                rows.append([cell.value for cell in row])
            if find_header(rows, FUNDING_HEADERS)[0] is not None and find_header(rows, SPENDING_HEADERS)[0] is not None:
                return sheet.title, rows
        raise ValueError("No worksheet has both the funding and spending sections of the ASUFC tracker")
    except (DefusedXmlException, ParseError, KeyError, OSError) as error:
        raise ValueError("Malformed or unsafe worksheet") from error
    finally:
        workbook.close()


def is_formula(value):
    return isinstance(value, str) and value.startswith("=")


def draft_from_workbook(content, academic_year, starts_on, ends_on, programs):
    sheet, rows = read_rows(content)
    warnings, errors = [], []
    funding_at, funding_columns = find_header(rows, FUNDING_HEADERS)
    spending_at, spending_columns = find_header(rows, SPENDING_HEADERS)

    funding, names = [], set()
    end = spending_at if spending_at > funding_at else len(rows)
    for number, row in enumerate(rows[funding_at + 1:end], funding_at + 2):
        get = lambda name: row[funding_columns[name]] if name in funding_columns and funding_columns[name] < len(row) else None
        name = text(get("support / funding source"))
        amount = get("amount")
        if not name or name.casefold().startswith(("total", "current bank", "supports less")) or amount is None:
            continue
        if is_formula(amount):
            continue
        try:
            value = cents(amount)
        except ValueError as error:
            errors.append({"row": number, "error": str(error)})
            continue
        status = text(get("status")).casefold()
        use = text(get("program / use"))
        notes = text(get("notes"))
        if name.casefold() in names:
            errors.append({"row": number, "error": "Funding source names must be unique"})
            continue
        names.add(name.casefold())
        program = match_program(use, programs) if use else None
        credit = bool(CREDIT_HINTS.search(notes) or CREDIT_HINTS.search(use) or "wfm2go" in use.casefold())
        details = [part for part in (use and "Use: " + use, notes, status and "Tracker status: " + status) if part]
        entry = {
            "name": name, "academic_year": academic_year, "kind": "credit" if credit else "cash",
            "expected_cents": value, "received_cents": value if status == "received" else 0,
            "commitment": "committed" if status in ("received", "expected", "") else "unconfirmed",
            "expiry": spend_by(notes) or spend_by(use), "notes": "; ".join(details)[:2000],
            "eligible_programs": [program] if program else [],
            "eligible_suppliers": suppliers_named(notes) if credit else [],
            "carry_status": "prohibited" if re.search(r"must be returned", notes, re.I) else "unconfirmed",
        }
        if entry["expiry"] and not starts_on <= entry["expiry"]:
            entry["expiry"] = None
        funding.append(entry)
        if use and not program and not re.search(r"operations|to confirm|credits?|wfm2go|purchases", use, re.I):
            warnings.append(f"Row {number}: check the eligible program for {name}")
        if credit and not entry["eligible_suppliers"]:
            warnings.append(f"Row {number}: add the supplier where the {name} credits can be used")

    purchases = []
    for number, row in enumerate(rows[spending_at + 1:], spending_at + 2):
        get = lambda name: row[spending_columns[name]] if name in spending_columns and spending_columns[name] < len(row) else None
        when, expense, amount = get("date"), text(get("expense / purchase")), get("amount")
        if when is None and not expense and amount is None:
            continue
        if not isinstance(when, (date, datetime)):
            if text(when).casefold().startswith("how to use") or (text(when) == "" and is_formula(amount)):
                break
            if text(when) == "" and text(get("paid from")).casefold().startswith("total"):
                break
            errors.append({"row": number, "error": "Enter the purchase date as a date"})
            continue
        try:
            if any(is_formula(get(name)) for name in SPENDING_HEADERS):
                raise ValueError("Formulas are not accepted in purchase rows")
            value = cents(amount)
            if not value:
                raise ValueError("Enter a positive amount")
            day = when.date() if isinstance(when, datetime) else when
            if not starts_on <= day <= ends_on:
                raise ValueError("Purchase date is outside the selected reporting year")
            purpose = text(get("program / purpose"))
            program = match_program(purpose, programs)
            if not program:
                raise ValueError("Program / Purpose does not match one program: " + purpose[:80])
            category = text(get("category"))
            if not expense or not category:
                raise ValueError("Enter the expense and category")
        except ValueError as error:
            errors.append({"row": number, "error": str(error)})
            continue
        notes = text(get("notes"))
        paid = text(get("paid from"))
        extra = [] if not paid or paid.casefold() == "to confirm" else ["Tracker paid from: " + paid]
        purchases.append({
            "purchase_date": day.isoformat(), "program_code": program, "supplier": supplier_from(expense)[:200],
            "purchase_type": category[:100], "description": expense[:1000],
            "cents": value, "notes": "; ".join([notes, *extra]).strip("; ")[:1000],
            "verify_charge": bool(VERIFY_HINTS.search(notes)),
        })

    if len(funding) > 50 or len(purchases) > 250:
        errors.append({"row": 0, "error": "A starter file holds at most 50 funding sources and 250 purchases"})
    return {
        "sheet": sheet,
        "starter": {"version": 1, "period": {"academic_year": academic_year, "starts_on": starts_on.isoformat(),
                    "ends_on": ends_on.isoformat()}, "semesters": [], "funding": funding, "purchases": purchases},
        "warnings": warnings, "errors": errors,
    }
