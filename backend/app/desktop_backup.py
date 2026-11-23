"""Stream authenticated desktop snapshots without writing plaintext archives."""

from hashlib import scrypt
import json
import os
from struct import Struct

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from psycopg import sql

MAGIC = b"ASUFCBK\x00\x01"
BLOCK = 1024 * 1024
FRAME = Struct(">I")
TABLES = (
    "program", "funding", "budget", "purchase", "allocation", "purchase_void", "audit_event",
    "purchase_correction", "funding_receipt", "academic_period", "semester", "funding_transfer",
    "import_entry", "funding_transfer_void", "funding_purchase_type", "funding_eligibility",
    "staff_credential", "purchase_receipt_file", "purchase_intake",
    "catalog_entry", "purchase_refund", "purchase_refund_allocation", "funding_return", "bank_statement",
)
# Backups from version 0.2 lack purchase_intake; backups before 0.5 lack the newer ledger tables.
OLDEST_TABLES = set(TABLES[:TABLES.index("purchase_intake")])


class BackupError(ValueError):
    pass


class LedgerNotEmpty(BackupError):
    pass


def restore_empty_ledger(connection, file, password):
    tables = {table: sql.Identifier("public", table) for table in TABLES}
    connection.execute(sql.SQL("LOCK TABLE {} IN ACCESS EXCLUSIVE MODE NOWAIT").format(
        sql.SQL(", ").join(tables.values()),
    ))
    starter_programs = {
        ("ASUFCGR", "General Restocks"),
        ("ASUFCFSBP", "Foodsharing Breakfast Program"),
        ("ASUFCE&W", "Events & Workshops"),
        ("ASUFCSIR", "Specialty Item Restocks"),
    }
    programs = {(row["code"], row["name"]) for row in connection.execute("SELECT code,name FROM program")}
    if programs != starter_programs or any(
        connection.execute(sql.SQL("SELECT 1 FROM {} LIMIT 1").format(identifier)).fetchone()
        for table, identifier in tables.items() if table not in ("program", "staff_credential")
    ):
        raise LedgerNotEmpty("Restore requires a fresh ledger. Use a new operating-system profile to protect existing records.")
    restore_backup(connection, file, password)


def exact(file, size):
    data = file.read(size)
    if len(data) != size:
        raise BackupError("The backup file is incomplete")
    return data


def cipher_for(password, header):
    return AESGCM(scrypt(password.encode("utf-8"), salt=header[len(MAGIC):], n=2**17, r=8, p=1,
                        maxmem=256 * 1024 * 1024, dklen=32))


class Frames:
    def __init__(self, file, password, *, writing):
        self.file = file
        if writing:
            self.header = MAGIC + os.urandom(16)
            file.write(self.header)
        else:
            self.header = exact(file, len(MAGIC) + 16)
            if not self.header.startswith(MAGIC):
                raise BackupError("This is not a supported ASUFC backup")
        self.cipher = cipher_for(password, self.header)
        self.index = 0

    def nonce(self):
        nonce = self.index.to_bytes(12, "big")
        self.index += 1
        return nonce

    def write(self, data):
        sealed = self.cipher.encrypt(self.nonce(), bytes(data), self.header)
        self.file.write(FRAME.pack(len(sealed)))
        self.file.write(sealed)

    def read(self):
        size, = FRAME.unpack(exact(self.file, FRAME.size))
        if not 16 <= size <= BLOCK + 16:
            raise BackupError("The backup file is damaged")
        try:
            return self.cipher.decrypt(self.nonce(), exact(self.file, size), self.header)
        except InvalidTag:
            raise BackupError("The backup passphrase is incorrect or the file is damaged") from None


def columns_by_table(connection):
    columns = {table: [] for table in TABLES}
    for row in connection.execute("""SELECT table_name,column_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name=ANY(%s) ORDER BY ordinal_position""", (list(TABLES),)):
        columns[row["table_name"]].append(row["column_name"])
    return columns


def copy_command(table, columns, direction):
    return sql.SQL("COPY {} ({}) {} (FORMAT BINARY)").format(
        sql.Identifier("public", table), sql.SQL(", ").join(map(sql.Identifier, columns)), direction,
    )


def write_backup(connection, file, password):
    frames = Frames(file, password, writing=True)
    connection.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
    columns = columns_by_table(connection)
    frames.write(json.dumps(columns, separators=(",", ":")).encode("utf-8"))
    for table, fields in columns.items():
        ordering = sql.Identifier("id") if "id" in fields else sql.Identifier(fields[0])
        query = sql.SQL("COPY (SELECT {} FROM {} ORDER BY {}) TO STDOUT (FORMAT BINARY)").format(
            sql.SQL(", ").join(map(sql.Identifier, fields)), sql.Identifier("public", table), ordering,
        )
        with connection.cursor().copy(query) as copy:
            for data in copy:
                for offset in range(0, len(data), BLOCK):
                    frames.write(data[offset:offset + BLOCK])
        frames.write(b"")


def restore_backup(connection, file, password):
    frames = Frames(file, password, writing=False)
    manifest = frames.read()
    try:
        columns = json.loads(manifest)
    except (ValueError, UnicodeError):
        raise BackupError("The backup header could not be read") from None
    current = columns_by_table(connection)
    if not isinstance(columns, dict) or not OLDEST_TABLES <= set(columns) <= set(TABLES) or any(
        not isinstance(fields, list) or not fields or any(not isinstance(field, str) for field in fields)
        or len(fields) != len(set(fields)) or not set(fields).issubset(current[table])
        for table, fields in columns.items()
    ):
        raise BackupError("This backup requires a compatible version of ASUFC Finance")
    # All changes share the caller's transaction. A wrong passphrase, corrupt final
    # frame or database error leaves the fresh ledger exactly as it was.
    connection.execute(sql.SQL("TRUNCATE {} RESTART IDENTITY").format(
        sql.SQL(", ").join(sql.Identifier("public", table) for table in TABLES),
    ))
    for table in TABLES:
        if table not in columns:
            continue
        fields = columns[table]
        command = copy_command(table, fields, sql.SQL("FROM STDIN"))
        with connection.cursor().copy(command) as copy:
            while data := frames.read():
                copy.write(data)
        if "id" in fields:
            # ALTER SEQUENCE is transactional, unlike setval().
            greatest = connection.execute(sql.SQL("SELECT coalesce(max(id),0) AS id FROM {}").format(
                sql.Identifier("public", table),
            )).fetchone()["id"]
            sequence = connection.execute("SELECT pg_get_serial_sequence(%s,'id') AS name",
                                          ("public." + table,)).fetchone()["name"]
            if sequence:
                connection.execute(sql.SQL("ALTER SEQUENCE {} RESTART WITH {}").format(
                    sql.Identifier(*sequence.split(".")), sql.Literal(greatest + 1),
                ))
    if file.read(1):
        raise BackupError("The backup has unexpected trailing data")
    # Older backups predate consolidated rules, the name catalog and roles.
    connection.execute("SELECT asufc_backfill_eligibility()")
    connection.execute("SELECT asufc_backfill_catalog()")
    connection.execute("""UPDATE staff_credential SET role='admin'
        WHERE NOT EXISTS (SELECT 1 FROM staff_credential WHERE role='admin' AND active)""")
