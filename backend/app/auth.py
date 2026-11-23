"""Staff sign-in, sessions and named accounts.

Each person signs in with their own account so the audit log records who made
every change. The bootstrap ``STAFF_USER`` is the first administrator.
Administrators create, disable and reset other accounts.
"""
import os
import secrets
from contextvars import ContextVar
from hashlib import sha256
from typing import Literal

from fastapi import Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

from .credentials import hash_password, validate_password, verify_password

COOKIE = "asufc_session"
LOCK = 2663002
USER_ATTEMPTS = 10
GLOBAL_ATTEMPTS = 50
# Unknown usernames still pay the scrypt cost, so timing does not reveal accounts.
DUMMY_HASH = hash_password(secrets.token_hex(16))
_actor: ContextVar[str] = ContextVar("asufc_actor", default="")

Role = Literal["admin", "staff"]
Username = str


def current_actor() -> str:
    return _actor.get() or os.environ.get("STAFF_USER", "staff")


def token_hash(token):
    return sha256(token.encode()).hexdigest()


def secure_cookie():
    return os.getenv("SESSION_SECURE", "1") != "0"


def request_protection(request: Request):
    if request.method not in ("GET", "HEAD", "OPTIONS") and request.headers.get("X-ASUFC-Request") != "1":
        raise HTTPException(403, "Missing request protection header")


def make_staff(db):
    def staff(request: Request):
        token = request.cookies.get(COOKIE, "")
        if not token or len(token) > 128:
            raise HTTPException(401, "Staff session required")
        request_protection(request)
        with db() as c:
            row = c.execute("""SELECT s.username FROM staff_session s
                JOIN staff_credential a ON a.username=s.username AND a.active
                WHERE s.token_hash=%s AND s.expires_at>now()""", (token_hash(token),)).fetchone()
        if not row:
            raise HTTPException(401, "Staff session expired")
        return row["username"]
    return staff


def make_bind_actor(staff):
    # An async dependency runs in the request's own context, so the value it
    # sets is visible to the synchronous endpoint that follows.
    async def bind_actor(username: str = Depends(staff)):
        _actor.set(username)
        return username
    return bind_actor


class Login(BaseModel):
    username: str = Field(max_length=200)
    password: str = Field(max_length=1024)


class PasswordChange(BaseModel):
    current_password: str = Field(max_length=1024)
    new_password: str = Field(max_length=1024)


class NewAccount(BaseModel):
    username: str = Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9._@-]{1,79}$")
    password: str = Field(max_length=1024)
    role: Role = "staff"


class AccountChange(BaseModel):
    active: bool | None = None
    role: Role | None = None
    reason: str = Field(min_length=1, max_length=1000)


class AccountPassword(BaseModel):
    password: str = Field(max_length=1024)
    reason: str = Field(min_length=1, max_length=1000)


def throttled(c, username):
    c.execute("DELETE FROM staff_login_attempt WHERE attempted_at<now()-interval '15 minutes'")
    counts = c.execute("""SELECT count(*) AS total, count(*) FILTER (WHERE username=%s) AS mine
        FROM staff_login_attempt""", (username,)).fetchone()
    return counts["mine"] >= USER_ATTEMPTS or counts["total"] >= GLOBAL_ATTEMPTS


def password_or_422(password):
    try:
        validate_password(password)
    except ValueError as error:
        raise HTTPException(422, str(error))


def register_auth(app, router, db, audit, staff):
    def account(c, username):
        return c.execute("SELECT username,role,active,created_at,updated_at FROM staff_credential WHERE username=%s",
                         (username,)).fetchone()

    def require_admin(username: str = Depends(staff)):
        with db() as c:
            row = account(c, username)
        if not row or row["role"] != "admin" or not row["active"]:
            raise HTTPException(403, "Administrator access required")
        return username

    @app.post("/auth/login")
    def login(p: Login, request: Request, response: Response):
        if request.headers.get("X-ASUFC-Request") != "1":
            raise HTTPException(403, "Missing request protection header")
        username = p.username.strip()
        with db() as c:
            c.execute("SELECT pg_advisory_xact_lock(%s)", (LOCK,))
            if throttled(c, username):
                raise HTTPException(429, "Too many attempts; try again in 15 minutes")
            credential = c.execute("SELECT password_hash,active FROM staff_credential WHERE username=%s",
                                   (username,)).fetchone()
            matches = verify_password(p.password, credential["password_hash"] if credential else DUMMY_HASH)
            valid = bool(credential and credential["active"] and matches)
            if not valid:
                c.execute("INSERT INTO staff_login_attempt(username) VALUES (%s)", (username[:200],))
            else:
                c.execute("DELETE FROM staff_login_attempt WHERE username=%s", (username,))
                c.execute("DELETE FROM staff_session WHERE expires_at<=now()")
                previous = request.cookies.get(COOKIE, "")
                if previous and len(previous) <= 128:
                    c.execute("DELETE FROM staff_session WHERE token_hash=%s", (token_hash(previous),))
                token = secrets.token_urlsafe(32)
                c.execute("""INSERT INTO staff_session(token_hash,username,expires_at)
                    VALUES (%s,%s,now()+interval '8 hours')""", (token_hash(token), username))
        if not valid:
            raise HTTPException(401, "Invalid staff credentials")
        response.set_cookie(COOKIE, token, max_age=28800, httponly=True, secure=secure_cookie(), samesite="strict", path="/")
        response.headers["Cache-Control"] = "no-store"
        return {"username": username}

    @router.get("/auth/session")
    def session(username: str = Depends(staff)):
        with db() as c:
            row = account(c, username)
        return {"username": username, "role": row["role"] if row else "staff"}

    @router.post("/auth/logout")
    def logout(request: Request, response: Response):
        with db() as c:
            c.execute("DELETE FROM staff_session WHERE token_hash=%s", (token_hash(request.cookies.get(COOKIE, "")),))
        response.delete_cookie(COOKIE, path="/", secure=secure_cookie(), httponly=True, samesite="strict")
        return {"ok": True}

    @router.post("/auth/password")
    def change_password(p: PasswordChange, request: Request, response: Response, username: str = Depends(staff)):
        password_or_422(p.new_password)
        with db() as c:
            c.execute("SELECT pg_advisory_xact_lock(%s)", (LOCK,))
            if throttled(c, username):
                raise HTTPException(429, "Too many attempts")
            credential = c.execute("SELECT password_hash FROM staff_credential WHERE username=%s", (username,)).fetchone()
            valid = verify_password(p.current_password, credential["password_hash"])
            if not valid:
                c.execute("INSERT INTO staff_login_attempt(username) VALUES (%s)", (username,))
            else:
                if p.current_password == p.new_password:
                    raise HTTPException(422, "Choose a different password")
                c.execute("UPDATE staff_credential SET password_hash=%s,updated_at=now() WHERE username=%s",
                          (hash_password(p.new_password), username))
                c.execute("DELETE FROM staff_session WHERE username=%s", (username,))
                c.execute("DELETE FROM staff_login_attempt WHERE username=%s", (username,))
                audit(c, "password_changed", "staff_account", 0, {"username": username})
        if not valid:
            raise HTTPException(401, "Current password incorrect")
        response.delete_cookie(COOKIE, path="/", secure=secure_cookie(), httponly=True, samesite="strict")
        return {"ok": True}

    @router.get("/staff-accounts")
    def staff_accounts(_: str = Depends(require_admin)):
        with db() as c:
            return c.execute("""SELECT username,role,active,created_at,updated_at FROM staff_credential
                ORDER BY username""").fetchall()

    @router.post("/staff-accounts", status_code=201)
    def create_account(p: NewAccount, _: str = Depends(require_admin)):
        password_or_422(p.password)
        with db() as c:
            c.execute("SELECT pg_advisory_xact_lock(%s)", (LOCK,))
            if c.execute("SELECT 1 FROM staff_credential WHERE lower(username)=lower(%s)", (p.username,)).fetchone():
                raise HTTPException(409, "That username is already in use")
            c.execute("INSERT INTO staff_credential(username,password_hash,role) VALUES (%s,%s,%s)",
                      (p.username, hash_password(p.password), p.role))
            audit(c, "account_created", "staff_account", 0, {"username": p.username, "role": p.role})
            return account(c, p.username)

    def remaining_admins(c, excluding):
        return c.execute("""SELECT count(*) AS n FROM staff_credential
            WHERE role='admin' AND active AND username<>%s""", (excluding,)).fetchone()["n"]

    @router.patch("/staff-accounts/{username}")
    def change_account(username: str, p: AccountChange, _: str = Depends(require_admin)):
        reason = p.reason.strip()
        if not reason:
            raise HTTPException(422, "Reason required")
        with db() as c:
            c.execute("SELECT pg_advisory_xact_lock(%s)", (LOCK,))
            before = c.execute("SELECT username,role,active FROM staff_credential WHERE username=%s FOR UPDATE",
                               (username,)).fetchone()
            if not before:
                raise HTTPException(404, "Unknown staff account")
            after = before | {k: v for k, v in (("active", p.active), ("role", p.role)) if v is not None}
            losing_admin = before["role"] == "admin" and before["active"] and (after["role"] != "admin" or not after["active"])
            if losing_admin and not remaining_admins(c, username):
                raise HTTPException(422, "Keep at least one active administrator")
            c.execute("UPDATE staff_credential SET role=%s,active=%s,updated_at=now() WHERE username=%s",
                      (after["role"], after["active"], username))
            if not after["active"]:
                c.execute("DELETE FROM staff_session WHERE username=%s", (username,))
            audit(c, "account_changed", "staff_account", 0, {"username": username, "before": before, "after": after, "reason": reason})
            return account(c, username)

    @router.post("/staff-accounts/{username}/password")
    def reset_account_password(username: str, p: AccountPassword, _: str = Depends(require_admin)):
        reason = p.reason.strip()
        if not reason:
            raise HTTPException(422, "Reason required")
        password_or_422(p.password)
        with db() as c:
            c.execute("SELECT pg_advisory_xact_lock(%s)", (LOCK,))
            if not c.execute("UPDATE staff_credential SET password_hash=%s,updated_at=now() WHERE username=%s RETURNING 1",
                             (hash_password(p.password), username)).fetchone():
                raise HTTPException(404, "Unknown staff account")
            c.execute("DELETE FROM staff_session WHERE username=%s", (username,))
            c.execute("DELETE FROM staff_login_attempt WHERE username=%s", (username,))
            audit(c, "password_reset", "staff_account", 0, {"username": username, "method": "administrator", "reason": reason})
            return {"ok": True}
