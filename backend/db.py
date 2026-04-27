"""SQLite storage layer for the Account Reconciliation prototype."""
import sqlite3
import os
import json
from contextlib import contextmanager
from pathlib import Path

# The workspace folder may be on a filesystem where SQLite's journal creation
# fails (e.g. FUSE mount). If RECON_DB_PATH env var is provided, use that.
# Otherwise try the local backend/data dir first, falling back to the user home.
_ENV = os.environ.get("RECON_DB_PATH")


def _probe_ok(path: Path) -> bool:
    """Probe a path with real SQLite operations, including a transaction that
    exercises journaling — this is what fails on FUSE mounts like the workspace."""
    try:
        path.parent.mkdir(exist_ok=True, parents=True)
        conn = sqlite3.connect(str(path))
        conn.execute("CREATE TABLE IF NOT EXISTS _probe (id INTEGER PRIMARY KEY, v TEXT)")
        conn.execute("INSERT INTO _probe (v) VALUES ('ok')")
        conn.commit()
        conn.execute("DELETE FROM _probe")
        conn.commit()
        conn.close()
        return True
    except Exception as e:
        print(f"[db] probe failed for {path}: {e}")
        return False


if _ENV:
    DB_PATH = Path(_ENV)
else:
    _local = Path(__file__).parent / "data" / "recon.db"
    _home  = Path.home() / ".recon-app" / "recon.db"
    if _probe_ok(_local):
        DB_PATH = _local
    else:
        # Clean up any zombie probe file left in the workspace
        for p in (_local, _local.parent / "recon.db-journal"):
            try: p.unlink()
            except Exception: pass
        _home.parent.mkdir(exist_ok=True, parents=True)
        DB_PATH = _home
print(f"[db] using {DB_PATH}")


def _conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


@contextmanager
def tx():
    conn = _conn()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id          TEXT PRIMARY KEY,
    username    TEXT UNIQUE NOT NULL,
    password    TEXT NOT NULL,
    name        TEXT NOT NULL,
    email       TEXT NOT NULL,
    role        TEXT NOT NULL  -- Admin, Preparer, Approver, Auditor
);

CREATE TABLE IF NOT EXISTS account_groups (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    description TEXT,
    created_at  TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS accounts (
    id              TEXT PRIMARY KEY,
    entity          TEXT NOT NULL,
    entity_code     TEXT NOT NULL,
    account_number  TEXT NOT NULL,
    description     TEXT NOT NULL,
    template        TEXT NOT NULL DEFAULT 'General List',
    preparer        TEXT,
    approver        TEXT,
    currency        TEXT DEFAULT 'USD',
    cert_threshold_pct  REAL DEFAULT 0,
    cert_threshold_amt  REAL DEFAULT 0,
    group_id        TEXT,
    created_at      TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (entity_code, account_number),
    FOREIGN KEY (group_id) REFERENCES account_groups(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS reconciliations (
    id              TEXT PRIMARY KEY,
    account_id      TEXT NOT NULL,
    period          TEXT NOT NULL,   -- e.g. "2026-04"
    gl_balance      REAL DEFAULT 0,
    status          TEXT NOT NULL DEFAULT 'Not Prepared',
    prep_date       TEXT,
    app_date        TEXT,
    certified_by    TEXT,
    approved_by     TEXT,
    reject_reason   TEXT,
    updated_at      TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (account_id) REFERENCES accounts(id),
    UNIQUE (account_id, period)
);

CREATE TABLE IF NOT EXISTS supporting_items (
    id          TEXT PRIMARY KEY,
    recon_id    TEXT NOT NULL,
    amount      REAL NOT NULL,
    item_class  TEXT,                 -- Required Adjustment, List Component, Timing Item
    origination TEXT,                 -- date as mm/dd/yyyy
    description TEXT,
    extra       TEXT,                 -- JSON blob for template-specific fields
    created_at  TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (recon_id) REFERENCES reconciliations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS comments (
    id          TEXT PRIMARY KEY,
    recon_id    TEXT NOT NULL,
    author      TEXT NOT NULL,
    text        TEXT NOT NULL,
    created_at  TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (recon_id) REFERENCES reconciliations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS documents (
    id          TEXT PRIMARY KEY,
    recon_id    TEXT,                 -- null if this is a group-level doc
    group_id    TEXT,                 -- null if this is a per-recon doc
    period      TEXT,                 -- set when group-level, identifies which period it applies to
    filename    TEXT NOT NULL,
    stored_path TEXT NOT NULL,
    uploaded_by TEXT NOT NULL,
    size_bytes  INTEGER,
    created_at  TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (recon_id) REFERENCES reconciliations(id) ON DELETE CASCADE,
    FOREIGN KEY (group_id) REFERENCES account_groups(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS imports (
    id          TEXT PRIMARY KEY,
    period      TEXT NOT NULL,
    filename    TEXT NOT NULL,
    uploaded_by TEXT NOT NULL,
    row_count   INTEGER,
    accounts_created INTEGER DEFAULT 0,
    accounts_updated INTEGER DEFAULT 0,
    created_at  TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    actor       TEXT NOT NULL,
    action      TEXT NOT NULL,
    target_type TEXT,
    target_id   TEXT,
    details     TEXT,
    created_at  TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS period_statuses (
    period      TEXT PRIMARY KEY,    -- YYYY-MM
    status      TEXT NOT NULL,       -- Future / Open / Soft-Close / Closed / Reopened
    changed_by  TEXT,
    changed_at  TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS auto_recon_rules (
    id          TEXT PRIMARY KEY,    -- rule1, rule2, rule3
    name        TEXT NOT NULL,
    description TEXT,
    enabled     INTEGER NOT NULL DEFAULT 1,
    updated_at  TEXT DEFAULT CURRENT_TIMESTAMP
);

-- A scheduled trial-balance data source (Local folder / SFTP / S3).
CREATE TABLE IF NOT EXISTS data_sources (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    type         TEXT NOT NULL,          -- 'local' | 'sftp' | 's3'
    config       TEXT NOT NULL,          -- JSON blob with connection params
    file_pattern TEXT,                   -- glob: '*.csv', '*.xlsx', 'tb-*.xlsx'
    period_rule  TEXT DEFAULT 'mtime',   -- 'mtime' | 'filename' | 'current-month'
    period_regex TEXT,                   -- when period_rule='filename'
    auto_classify    INTEGER NOT NULL DEFAULT 0,
    schedule_minutes INTEGER,            -- NULL = manual only; else interval
    enabled          INTEGER NOT NULL DEFAULT 1,
    last_run_at  TEXT,
    last_mtime   REAL,                   -- max file mtime already ingested
    last_status  TEXT,                   -- 'ok' | 'error' | 'no-new-files'
    last_error   TEXT,
    created_by   TEXT,
    created_at   TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at   TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS data_source_runs (
    id              TEXT PRIMARY KEY,
    source_id       TEXT NOT NULL,
    started_at      TEXT DEFAULT CURRENT_TIMESTAMP,
    ended_at        TEXT,
    status          TEXT,
    files_processed INTEGER DEFAULT 0,
    accounts_created INTEGER DEFAULT 0,
    accounts_updated INTEGER DEFAULT 0,
    error           TEXT,
    details         TEXT,                -- JSON (per-file outcomes)
    triggered_by    TEXT,                -- username or 'scheduler'
    FOREIGN KEY (source_id) REFERENCES data_sources(id) ON DELETE CASCADE
);

-- Application-wide key/value settings (date format, etc.). Admin-editable.
CREATE TABLE IF NOT EXISTS app_settings (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    updated_by  TEXT,
    updated_at  TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Flux (variance) analysis commentary. One row per (account, current period,
-- prior period) triple — a preparer explains why the balance changed vs. the
-- prior period, an approver reviews/accepts, and the CFO gets a narrative.
CREATE TABLE IF NOT EXISTS flux_comments (
    id              TEXT PRIMARY KEY,
    account_id      TEXT NOT NULL,
    current_period  TEXT NOT NULL,
    prior_period    TEXT NOT NULL,
    current_balance REAL NOT NULL,
    prior_balance   REAL NOT NULL,
    delta_abs       REAL NOT NULL,
    delta_pct       REAL,
    comment         TEXT,
    status          TEXT NOT NULL DEFAULT 'needs_explanation',
        -- needs_explanation | explained | reviewed
    ai_generated    INTEGER NOT NULL DEFAULT 0,
    author          TEXT,        -- preparer who wrote the comment
    reviewer        TEXT,        -- approver / CFO who signed off
    reviewed_at     TEXT,
    created_at      TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at      TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
    UNIQUE (account_id, current_period, prior_period)
);
"""


def init_db():
    with tx() as conn:
        conn.executescript(SCHEMA)
        _migrate(conn)
        _seed_settings(conn)
        _seed_rules(conn)


def _seed_settings(conn):
    """Seed default app-wide settings."""
    defaults = {
        "date_format": "MM-DD-YYYY",
    }
    for k, v in defaults.items():
        exists = conn.execute("SELECT 1 FROM app_settings WHERE key=?", (k,)).fetchone()
        if not exists:
            conn.execute(
                "INSERT INTO app_settings (key, value, updated_by) VALUES (?, ?, 'system')",
                (k, v),
            )


def _seed_rules(conn):
    """Seed the three PRD auto-recon rules if the table is empty. Enabled by
    default; Admin can toggle each off in the UI."""
    n = conn.execute("SELECT COUNT(*) FROM auto_recon_rules").fetchone()[0]
    if n > 0:
        return
    conn.executemany(
        "INSERT INTO auto_recon_rules (id, name, description, enabled) VALUES (?, ?, ?, 1)",
        [
            ("rule1", "Zero Balance with No Activity",
                "GL balance is $0.00 AND no supporting items were entered for the period. "
                "The account exists but had no journal entries — system auto-certifies."),
            ("rule2", "Schedule Match (Amortization / Accrual)",
                "For Amortizable or Accrual templates: the supporting-item sum matches the "
                "GL balance within the account's tolerance. Auto-certifies when the schedule "
                "agrees with GL."),
            ("rule3", "Balance Unchanged from Prior Period",
                "Current period's GL balance is identical to the prior period's, the prior "
                "period is already Reviewed / Approved / System Certified, and no supporting "
                "items were added this period — nothing changed, auto-certify."),
        ],
    )


def _migrate(conn):
    """Additive migrations for pre-existing databases."""
    # Columns added after v1:
    cols = lambda t: {r["name"] for r in conn.execute(f"PRAGMA table_info({t})").fetchall()}
    if "group_id" not in cols("accounts"):
        conn.execute("ALTER TABLE accounts ADD COLUMN group_id TEXT")
    doc_cols = cols("documents")
    if "group_id" not in doc_cols:
        conn.execute("ALTER TABLE documents ADD COLUMN group_id TEXT")
    if "period" not in doc_cols:
        conn.execute("ALTER TABLE documents ADD COLUMN period TEXT")
    # data_sources.last_mtime tracks the max file-mtime already ingested, so we
    # skip files we've already seen even when last_run_at floor-rounded to a
    # second that overlaps a file's fractional mtime.
    try:
        ds_cols = cols("data_sources")
        if "last_mtime" not in ds_cols:
            conn.execute("ALTER TABLE data_sources ADD COLUMN last_mtime REAL")
    except Exception:
        pass


def seed_users():
    """Seed demo users if none exist.

    Users we want now:
      - Preparer:  Bob Waldoff       (username "bob")
      - Admin:     Stacy Sparks      (username "stacy")
      - Approver:  Edith Grayson     (username "edith", unchanged)
      - Auditor:   Sam Humphrey      (username "sam",   unchanged)

    If an older seed is already in the DB (with Kim Wilson / Bob-as-Admin), we
    migrate it in-place so logins and any referenced names keep working.
    """
    with tx() as conn:
        existing = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
        target = [
            # id    username password    name              email                         role
            ("u1",  "bob",    "demo123", "Waldoff, Bob",    "bob.waldoff@citadel.com",    "Preparer"),
            ("u2",  "stacy",  "demo123", "Sparks, Stacy",   "stacy.sparks@citadel.com",   "Admin"),
            ("u3",  "edith",  "demo123", "Grayson, Edith",  "edith.grayson@citadel.com",  "Approver"),
            ("u4",  "sam",    "demo123", "Humphrey, Sam",   "sam.humphrey@citadel.com",   "Auditor"),
        ]
        if existing == 0:
            conn.executemany(
                "INSERT INTO users (id, username, password, name, email, role) VALUES (?, ?, ?, ?, ?, ?)",
                target,
            )
            return

        # Already-seeded DB → migrate any stale user rows in place.
        _migrate_users(conn, target)


def _migrate_users(conn, target):
    """Rename legacy users → current names, and rename any existing data that
    referenced the old usernames / full names. Idempotent — skips when the
    DB already reflects the target state."""
    # If every target username is already present with the right name, nothing
    # to migrate. Prevents running the rename plan twice (would error on the
    # UNIQUE constraint).
    existing_by_user = {r["username"]: dict(r) for r in conn.execute(
        "SELECT username, name FROM users"
    ).fetchall()}
    if all(
        existing_by_user.get(t[1]) and existing_by_user[t[1]]["name"] == t[3]
        for t in target
    ):
        return

    # Map legacy → target for rows where we want both username and name changed
    # in the same seat (same role on the same ID).
    rename_plan = [
        # old_username → (new_username, new_name, new_email)
        ("kim", ("bob",   "Waldoff, Bob",  "bob.waldoff@citadel.com")),
        ("bob", ("stacy", "Sparks, Stacy", "stacy.sparks@citadel.com")),
    ]

    # Because renaming "bob" → "stacy" and simultaneously renaming "kim" → "bob"
    # could collide on the UNIQUE username constraint, do it in two passes:
    # step 1 — move every old username to a temp, step 2 — move temp → final.
    TEMP = "__recon_tmp_{n}__"
    temps = {}
    for i, (old, (new_u, new_n, new_e)) in enumerate(rename_plan):
        row = conn.execute("SELECT * FROM users WHERE username=?", (old,)).fetchone()
        if not row:
            continue
        # Skip if already migrated (e.g. we already renamed to the target name)
        if row["username"] == new_u and row["name"] == new_n:
            continue
        t = TEMP.format(n=i)
        conn.execute("UPDATE users SET username=? WHERE id=?", (t, row["id"]))
        temps[t] = (new_u, new_n, new_e, row["name"])

    # Second pass: apply final username/name, and rebind references elsewhere.
    for t, (new_u, new_n, new_e, old_name) in temps.items():
        conn.execute(
            "UPDATE users SET username=?, name=?, email=? WHERE username=?",
            (new_u, new_n, new_e, t),
        )
        # Legacy username may have been stored on accounts.preparer / approver
        old_u = None
        for old, (u, _, _) in rename_plan:
            if u == new_u:
                old_u = old
                break
        if old_u:
            conn.execute("UPDATE accounts SET preparer=? WHERE preparer=?", (new_u, old_u))
            conn.execute("UPDATE accounts SET approver=? WHERE approver=?", (new_u, old_u))
        # Reconciliations stash the full "Last, First" name at certify/approve time.
        conn.execute(
            "UPDATE reconciliations SET certified_by=? WHERE certified_by=?",
            (new_n, old_name),
        )
        conn.execute(
            "UPDATE reconciliations SET approved_by=? WHERE approved_by=?",
            (new_n, old_name),
        )
        # Comments authored by the old name
        conn.execute("UPDATE comments SET author=? WHERE author=?", (new_n, old_name))
        # Audit log actor (which stored username, not display name)
        if old_u:
            conn.execute("UPDATE audit_log SET actor=? WHERE actor=?", (new_u, old_u))


def log(actor: str, action: str, target_type: str = None, target_id: str = None, details: dict = None):
    with tx() as conn:
        conn.execute(
            "INSERT INTO audit_log (actor, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)",
            (actor, action, target_type, target_id, json.dumps(details) if details else None),
        )
