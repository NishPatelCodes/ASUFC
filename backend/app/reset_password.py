"""Operator-only password recovery. Requires trusted database access.

Resets the bootstrap STAFF_USER administrator, or the account named with
``--username``. The account is reactivated so an operator can always recover
administrator access. Only that account's sessions are revoked.
"""
import argparse
import getpass
import os
from .main import db,audit
from .credentials import hash_password,validate_password

def reset_password(password, username=None):
    validate_password(password)
    user=username or os.environ.get("STAFF_USER","staff")
    bootstrap=user==os.environ.get("STAFF_USER","staff")
    with db() as c:
        c.execute("SELECT pg_advisory_xact_lock(2663002)")
        row=c.execute("""UPDATE staff_credential SET password_hash=%s,active=true,
            role=CASE WHEN %s THEN 'admin' ELSE role END,updated_at=now() WHERE username=%s RETURNING username""",
            (hash_password(password),bootstrap,user)).fetchone()
        if not row: raise SystemExit("Unknown staff account. Initialize the application first.")
        c.execute("DELETE FROM staff_session WHERE username=%s",(user,))
        c.execute("DELETE FROM staff_login_attempt WHERE username=%s",(user,))
        audit(c,"password_reset","staff_account",0,{"method":"operator","username":user})

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--username",help="Account to reset (default: STAFF_USER)")
    args=parser.parse_args()
    password=getpass.getpass("New staff password: ")
    if password!=getpass.getpass("Repeat password: "): raise SystemExit("Passwords differ")
    reset_password(password,args.username)
    print("Password reset. That account's sessions were revoked.")
if __name__=="__main__": main()
