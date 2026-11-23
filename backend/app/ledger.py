"""Refunds, money returned to funders, pledge status and bank balance checks."""
from datetime import date
from typing import Literal

from fastapi import HTTPException
from pydantic import BaseModel, Field

from .auth import current_actor
from .clock import today

PURCHASE_LOCK = 2663001


class RefundSplit(BaseModel):
    budget_id: int
    cents: int = Field(gt=0, le=10**12)


class Refund(BaseModel):
    refund_date: date
    reason: str = Field(min_length=1, max_length=1000)
    allocations: list[RefundSplit] = Field(min_length=1, max_length=100)


class FundingReturn(BaseModel):
    cents: int = Field(gt=0, le=10**12)
    returned_on: date
    reason: str = Field(min_length=1, max_length=1000)


class Commitment(BaseModel):
    commitment: Literal["committed", "unconfirmed"]
    reason: str = Field(min_length=1, max_length=1000)


class BankStatement(BaseModel):
    statement_date: date
    cents: int = Field(ge=-10**12, le=10**12)
    note: str = Field(default="", max_length=1000)


def ledger_cash(c, as_of: date):
    """Cash the ledger expects in the bank on a date, with the gaps staff must explain.

    Receipts without a date are counted as received and reported separately.
    Carry-forward transfers move capacity between years, not money, so they are
    excluded. Purchasing credits are never bank cash.
    """
    return c.execute("""SELECT
      (SELECT COALESCE(sum(r.cents),0) FROM funding_receipt r JOIN funding f ON f.id=r.funding_id
        WHERE f.kind='cash' AND (r.received_on IS NULL OR r.received_on<=%(d)s)) AS received_cents,
      (SELECT COALESCE(sum(r.cents),0) FROM funding_receipt r JOIN funding f ON f.id=r.funding_id
        WHERE f.kind='cash' AND r.received_on IS NULL) AS undated_received_cents,
      (SELECT COALESCE(sum(a.cents),0) FROM allocation a JOIN purchase p ON p.id=a.purchase_id
        JOIN budget b ON b.id=a.budget_id JOIN funding f ON f.id=b.funding_id
        LEFT JOIN purchase_void v ON v.purchase_id=p.id
        WHERE f.kind='cash' AND v.purchase_id IS NULL AND p.purchase_date<=%(d)s) AS spent_cents,
      (SELECT COALESCE(sum(ra.cents),0) FROM purchase_refund_allocation ra JOIN purchase_refund r ON r.id=ra.refund_id
        JOIN budget b ON b.id=ra.budget_id JOIN funding f ON f.id=b.funding_id
        LEFT JOIN purchase_void v ON v.purchase_id=r.purchase_id
        WHERE f.kind='cash' AND v.purchase_id IS NULL AND r.refund_date<=%(d)s) AS refunded_cents,
      (SELECT COALESCE(sum(x.cents),0) FROM funding_return x JOIN funding f ON f.id=x.funding_id
        WHERE f.kind='cash' AND x.returned_on<=%(d)s) AS returned_cents,
      (SELECT count(*) FROM purchase_intake WHERE confirmed_purchase_id IS NULL AND purchase_date<=%(d)s) AS pending_count,
      (SELECT COALESCE(sum(cents),0) FROM purchase_intake WHERE confirmed_purchase_id IS NULL AND purchase_date<=%(d)s) AS pending_cents
    """, {"d": as_of}).fetchone()


def register_ledger(router, db, audit, bad):
    @router.post("/transactions/{purchase_id}/refunds", status_code=201)
    def record_refund(purchase_id: int, p: Refund):
        reason = p.reason.strip()
        if not reason:
            bad("Reason required")
        if p.refund_date > today():
            bad("Refund date cannot be in the future")
        if len({a.budget_id for a in p.allocations}) != len(p.allocations):
            bad("Duplicate budget in refund")
        with db() as c:
            c.execute("SELECT pg_advisory_xact_lock(%s)", (PURCHASE_LOCK,))
            purchase = c.execute("SELECT * FROM purchase WHERE id=%s FOR UPDATE", (purchase_id,)).fetchone()
            if not purchase:
                raise HTTPException(404, "Unknown purchase")
            c.execute("""SELECT id FROM funding WHERE id IN (SELECT b.funding_id FROM budget b
                JOIN allocation a ON a.budget_id=b.id WHERE a.purchase_id=%s) ORDER BY id FOR UPDATE""", (purchase_id,)).fetchall()
            if c.execute("SELECT 1 FROM purchase_void WHERE purchase_id=%s", (purchase_id,)).fetchone():
                raise HTTPException(409, "Purchase already voided")
            if p.refund_date < purchase["purchase_date"]:
                bad("A refund cannot be dated before the purchase")
            net = {r["budget_id"]: r["cents"] for r in c.execute(
                "SELECT budget_id,cents FROM active_allocation WHERE purchase_id=%s", (purchase_id,))}
            for split in p.allocations:
                if split.budget_id not in net:
                    bad("Refund a budget that paid for this purchase")
                if split.cents > net[split.budget_id]:
                    bad("Refund exceeds the remaining amount paid from that budget")
            refund = c.execute("""INSERT INTO purchase_refund(purchase_id,refund_date,reason,actor)
                VALUES (%s,%s,%s,%s) RETURNING *""", (purchase_id, p.refund_date, reason, current_actor())).fetchone()
            for split in p.allocations:
                c.execute("""INSERT INTO purchase_refund_allocation(refund_id,purchase_id,budget_id,cents)
                    VALUES (%s,%s,%s,%s)""", (refund["id"], purchase_id, split.budget_id, split.cents))
            total = sum(split.cents for split in p.allocations)
            audit(c, "refunded", "purchase", purchase_id, {
                "refund_id": refund["id"], "refund_date": p.refund_date, "cents": total, "reason": reason,
                "allocations": [split.model_dump() for split in p.allocations]})
            return refund | {"cents": total}

    @router.post("/funding/{funding_id}/returns", status_code=201)
    def return_funding(funding_id: int, p: FundingReturn):
        reason = p.reason.strip()
        if not reason:
            bad("Reason required")
        if p.returned_on > today():
            bad("Return date cannot be in the future")
        with db() as c:
            if not c.execute("SELECT 1 FROM funding WHERE id=%s FOR UPDATE", (funding_id,)).fetchone():
                raise HTTPException(404, "Unknown funding")
            balances = c.execute("""SELECT f.capacity_cents,
                COALESCE((SELECT sum(b.cents) FROM budget b WHERE b.funding_id=f.id),0) AS budgeted,
                COALESCE((SELECT sum(a.cents) FROM active_allocation a JOIN budget b ON b.id=a.budget_id WHERE b.funding_id=f.id),0) AS spent
                FROM funding_capacity f WHERE f.id=%s""", (funding_id,)).fetchone()
            if p.cents > balances["capacity_cents"] - max(balances["budgeted"], balances["spent"]):
                bad("Release unused budget allocations before returning funds")
            row = c.execute("""INSERT INTO funding_return(funding_id,cents,returned_on,reason,actor)
                VALUES (%s,%s,%s,%s,%s) RETURNING *""", (funding_id, p.cents, p.returned_on, reason, current_actor())).fetchone()
            audit(c, "funds_returned", "funding", funding_id, row)
            return row

    @router.get("/funding/{funding_id}/returns")
    def funding_returns(funding_id: int):
        with db() as c:
            if not c.execute("SELECT 1 FROM funding WHERE id=%s", (funding_id,)).fetchone():
                raise HTTPException(404, "Unknown funding")
            return c.execute("SELECT * FROM funding_return WHERE funding_id=%s ORDER BY id", (funding_id,)).fetchall()

    @router.patch("/funding/{funding_id}/commitment")
    def change_commitment(funding_id: int, p: Commitment):
        reason = p.reason.strip()
        if not reason:
            bad("Reason required")
        with db() as c:
            before = c.execute("SELECT commitment FROM funding WHERE id=%s FOR UPDATE", (funding_id,)).fetchone()
            if not before:
                raise HTTPException(404, "Unknown funding")
            row = c.execute("UPDATE funding SET commitment=%s WHERE id=%s RETURNING id,commitment",
                            (p.commitment, funding_id)).fetchone()
            audit(c, "commitment_changed", "funding", funding_id,
                  {"before": before["commitment"], "after": p.commitment, "reason": reason})
            return row

    def with_comparison(c, statement):
        expected = ledger_cash(c, statement["statement_date"])
        ledger = expected["received_cents"] - expected["spent_cents"] + expected["refunded_cents"] - expected["returned_cents"]
        return statement | {
            "ledger_cash_cents": ledger, "difference_cents": statement["cents"] - ledger,
            "undated_received_cents": expected["undated_received_cents"],
            "pending_count": expected["pending_count"], "pending_cents": expected["pending_cents"],
        }

    @router.get("/bank-statements")
    def bank_statements():
        with db() as c:
            c.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
            rows = c.execute("SELECT * FROM bank_statement ORDER BY statement_date DESC,id DESC LIMIT 100").fetchall()
            return [with_comparison(c, row) for row in rows]

    @router.post("/bank-statements", status_code=201)
    def record_bank_statement(p: BankStatement):
        if p.statement_date > today():
            bad("Statement date cannot be in the future")
        with db() as c:
            row = c.execute("""INSERT INTO bank_statement(statement_date,cents,note,actor)
                VALUES (%s,%s,%s,%s) RETURNING *""", (p.statement_date, p.cents, p.note.strip(), current_actor())).fetchone()
            audit(c, "bank_balance_recorded", "bank_statement", row["id"], row)
            return with_comparison(c, row)
