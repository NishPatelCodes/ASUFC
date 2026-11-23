"""Shared supplier and purchase type names.

Spending rules and reports match names, so every purchase, pending purchase and
rule stores the catalog spelling. Names that differ only by case or spacing
resolve to one entry. Staff merge true variants, such as a typo, with a reason.
"""
from typing import Literal

from fastapi import HTTPException
from pydantic import BaseModel, Field

Kind = Literal["supplier", "purchase_type"]
COLUMN = {"supplier": "supplier", "purchase_type": "purchase_type"}
RULE = {"supplier": "eligible_suppliers", "purchase_type": "eligible_purchase_types"}


def label(name: str) -> str:
    return " ".join(name.split())


def canonical(c, kind: Kind, name: str) -> str:
    """Return the catalog spelling of a name, adding the name when it is new."""
    value = label(name)
    if not value:
        raise HTTPException(422, "Enter a supplier and purchase type")
    if "\x00" in value:
        raise HTTPException(422, "Names cannot contain control characters")
    return c.execute("""INSERT INTO catalog_entry(kind,name,name_key) VALUES (%s,%s,asufc_name_key(%s))
        ON CONFLICT (kind,name_key) DO UPDATE SET kind=excluded.kind RETURNING name""", (kind, value, value)).fetchone()["name"]


def canonical_rules(c, rules: dict) -> dict:
    result = dict(rules)
    for kind, field in RULE.items():
        names = []
        for value in rules[field]:
            name = canonical(c, kind, value)
            if name not in names:
                names.append(name)
        result[field] = names
    return result


class CatalogName(BaseModel):
    kind: Kind
    name: str = Field(min_length=1, max_length=200)


class CatalogMerge(BaseModel):
    into_id: int
    reason: str = Field(min_length=1, max_length=1000)


def register_catalog(router, db, audit):
    @router.get("/catalog")
    def catalog():
        with db() as c:
            return c.execute("""SELECT e.id,e.kind,e.name,
                (SELECT count(*) FROM purchase p WHERE asufc_name_key(CASE WHEN e.kind='supplier' THEN p.supplier ELSE p.purchase_type END)=e.name_key) AS purchase_count
                FROM catalog_entry e ORDER BY e.kind,lower(e.name)""").fetchall()

    @router.post("/catalog", status_code=201)
    def add_name(p: CatalogName):
        with db() as c:
            if c.execute("SELECT 1 FROM catalog_entry WHERE kind=%s AND name_key=asufc_name_key(%s)", (p.kind, p.name)).fetchone():
                raise HTTPException(409, "That name is already in the list")
            name = canonical(c, p.kind, p.name)
            row = c.execute("SELECT id,kind,name FROM catalog_entry WHERE kind=%s AND name=%s", (p.kind, name)).fetchone()
            audit(c, "catalog_added", "catalog_entry", row["id"], row)
            return row

    @router.post("/catalog/{entry_id}/merge")
    def merge(entry_id: int, p: CatalogMerge):
        reason = p.reason.strip()
        if not reason:
            raise HTTPException(422, "Reason required")
        if entry_id == p.into_id:
            raise HTTPException(422, "Choose a different name to merge into")
        with db() as c:
            # Rule edits and purchases take this lock; renaming must not interleave with them.
            c.execute("SELECT pg_advisory_xact_lock(2663001)")
            rows = {r["id"]: r for r in c.execute(
                "SELECT * FROM catalog_entry WHERE id=ANY(%s) FOR UPDATE", ([entry_id, p.into_id],))}
            if len(rows) != 2:
                raise HTTPException(404, "Unknown name")
            old, new = rows[entry_id], rows[p.into_id]
            if old["kind"] != new["kind"]:
                raise HTTPException(422, "Merge suppliers with suppliers and purchase types with purchase types")
            column, field = COLUMN[old["kind"]], RULE[old["kind"]]
            # Column names come from fixed mappings above, never from input.
            purchases = [r["id"] for r in c.execute(
                f"UPDATE purchase SET {column}=%s WHERE asufc_name_key({column})=%s RETURNING id", (new["name"], old["name_key"]))]
            pending = [r["id"] for r in c.execute(
                f"UPDATE purchase_intake SET {column}=%s WHERE asufc_name_key({column})=%s RETURNING id", (new["name"], old["name_key"]))]
            funding = []
            for rule in c.execute(f"SELECT funding_id,{field} AS names FROM funding_eligibility FOR UPDATE").fetchall():
                if not any(name.casefold() == old["name"].casefold() for name in rule["names"]):
                    continue
                names = []
                for name in rule["names"]:
                    name = new["name"] if name.casefold() == old["name"].casefold() else name
                    if name not in names:
                        names.append(name)
                c.execute(f"UPDATE funding_eligibility SET {field}=%s WHERE funding_id=%s", (names, rule["funding_id"]))
                funding.append(rule["funding_id"])
            c.execute("DELETE FROM catalog_entry WHERE id=%s", (entry_id,))
            details = {"kind": old["kind"], "from": old["name"], "into": new["name"], "reason": reason,
                       "purchase_ids": purchases, "pending_ids": pending, "funding_ids": funding}
            audit(c, "catalog_merged", "catalog_entry", p.into_id, details)
            return details
