"""SQLite ledger for t4y-key-broker — one Key per enterprise user, WAL, ThreadingHTTPServer-safe."""
from __future__ import annotations

import json
import sqlite3
import threading
import time
from pathlib import Path


def now() -> int:
    return int(time.time())


class Ledger:
    """
    Canonical session row is one per external_user_id (product: one person ↔ one Key).
    module_id on the row is the New API home project used at first mint; later issue/status
    ignore the request moduleId for cache hits (admin accounts may browse many projects).
    """

    def __init__(self, path: Path) -> None:
        self.path = path
        self._lock = threading.RLock()
        path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        self._db = sqlite3.connect(path, check_same_thread=False, timeout=30)
        self._db.row_factory = sqlite3.Row
        self._db.execute("PRAGMA journal_mode=WAL")
        self._db.execute("PRAGMA synchronous=NORMAL")
        self._db.execute("PRAGMA busy_timeout=30000")
        self._migrate()

    def _migrate(self) -> None:
        with self._lock:
            self._db.executescript(
                """
                CREATE TABLE IF NOT EXISTS enterprises (
                  module_id TEXT PRIMARY KEY,
                  new_api_user_id INTEGER NOT NULL,
                  username TEXT NOT NULL,
                  password TEXT NOT NULL,
                  module_name TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS management_sessions (
                  username TEXT PRIMARY KEY,
                  token TEXT NOT NULL,
                  user_id INTEGER NOT NULL,
                  expires_at INTEGER NOT NULL
                );
                """
            )
            self._db.commit()
            self._ensure_user_keyed_sessions()

    def _ensure_user_keyed_sessions(self) -> None:
        """Create or collapse sessions so PRIMARY KEY is external_user_id only."""
        exists = self._db.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='sessions'"
        ).fetchone()
        if exists is None:
            self._db.executescript(
                """
                CREATE TABLE sessions (
                  external_user_id TEXT PRIMARY KEY,
                  module_id TEXT NOT NULL,
                  tenant_id TEXT NOT NULL,
                  tenant_name TEXT NOT NULL,
                  nick_name TEXT NOT NULL,
                  user_name TEXT NOT NULL,
                  new_api_token_id INTEGER NOT NULL,
                  token_name TEXT NOT NULL,
                  api_key TEXT NOT NULL,
                  expires_at INTEGER NOT NULL,
                  issued_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS sessions_module ON sessions(module_id);
                CREATE INDEX IF NOT EXISTS sessions_expires ON sessions(expires_at);
                """
            )
            self._db.commit()
            return

        # Detect legacy composite PK (user, module): SQLite lists pk columns with pk>0.
        pk_cols = [
            str(row["name"])
            for row in self._db.execute("PRAGMA table_info(sessions)").fetchall()
            if int(row["pk"] or 0) > 0
        ]
        if pk_cols == ["external_user_id"]:
            return

        # Collapse one-row-per-(user,module) into one-row-per-user (keep longest-lived Key).
        self._db.execute("ALTER TABLE sessions RENAME TO sessions_legacy_user_module")
        self._db.executescript(
            """
            CREATE TABLE sessions (
              external_user_id TEXT PRIMARY KEY,
              module_id TEXT NOT NULL,
              tenant_id TEXT NOT NULL,
              tenant_name TEXT NOT NULL,
              nick_name TEXT NOT NULL,
              user_name TEXT NOT NULL,
              new_api_token_id INTEGER NOT NULL,
              token_name TEXT NOT NULL,
              api_key TEXT NOT NULL,
              expires_at INTEGER NOT NULL,
              issued_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS sessions_module ON sessions(module_id);
            CREATE INDEX IF NOT EXISTS sessions_expires ON sessions(expires_at);
            """
        )
        rows = self._db.execute(
            """
            SELECT external_user_id, module_id, tenant_id, tenant_name, nick_name, user_name,
                   new_api_token_id, token_name, api_key, expires_at, issued_at
            FROM sessions_legacy_user_module
            ORDER BY expires_at DESC, issued_at DESC
            """
        ).fetchall()
        seen: set[str] = set()
        for row in rows:
            user_id = str(row["external_user_id"])
            if user_id in seen:
                continue
            api_key = row["api_key"]
            if not isinstance(api_key, str) or not api_key.startswith("sk-"):
                continue
            seen.add(user_id)
            self._db.execute(
                """
                INSERT INTO sessions(
                  external_user_id, module_id, tenant_id, tenant_name, nick_name, user_name,
                  new_api_token_id, token_name, api_key, expires_at, issued_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    user_id,
                    str(row["module_id"]),
                    str(row["tenant_id"] or ""),
                    str(row["tenant_name"] or ""),
                    str(row["nick_name"] or ""),
                    str(row["user_name"] or ""),
                    int(row["new_api_token_id"] or 0),
                    str(row["token_name"] or ""),
                    api_key,
                    int(row["expires_at"] or 0),
                    int(row["issued_at"] or now()),
                ),
            )
        self._db.execute("DROP TABLE sessions_legacy_user_module")
        self._db.commit()

    def close(self) -> None:
        with self._lock:
            self._db.close()

    def import_state_json(self, state_path: Path) -> int:
        """Upsert from legacy state.json. Returns number of session rows considered."""
        if not state_path.is_file():
            return 0
        decoded = json.loads(state_path.read_text())
        imported = 0
        with self._lock:
            for module_id, account in (decoded.get("enterprises") or {}).items():
                if not isinstance(account, dict):
                    continue
                self._db.execute(
                    """
                    INSERT INTO enterprises(module_id, new_api_user_id, username, password, module_name)
                    VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(module_id) DO UPDATE SET
                      new_api_user_id=excluded.new_api_user_id,
                      username=excluded.username,
                      password=excluded.password,
                      module_name=excluded.module_name
                    """,
                    (
                        module_id,
                        int(account["new_api_user_id"]),
                        str(account["username"]),
                        str(account["password"]),
                        str(account.get("module_name") or module_id)[:20],
                    ),
                )
            # Prefer the longest-lived Key when legacy JSON had one row per module.
            best: dict[str, dict] = {}
            for _key, row in (decoded.get("sessions") or {}).items():
                if not isinstance(row, dict):
                    continue
                api_key = row.get("api_key")
                if not isinstance(api_key, str) or not api_key.startswith("sk-"):
                    continue
                user_id = row.get("external_user_id")
                module_id = row.get("module_id")
                if not isinstance(user_id, str) or not isinstance(module_id, str):
                    continue
                expires_at = int(row.get("expires_at") or 0)
                candidate = {
                    "external_user_id": user_id,
                    "module_id": module_id,
                    "tenant_id": str(row.get("tenant_id") or ""),
                    "tenant_name": str(row.get("tenant_name") or ""),
                    "nick_name": str(row.get("nick_name") or ""),
                    "user_name": str(row.get("user_name") or ""),
                    "new_api_token_id": int(row.get("new_api_token_id") or 0),
                    "token_name": str(row.get("token_name") or ""),
                    "api_key": api_key,
                    "expires_at": expires_at,
                    "issued_at": int(row.get("issued_at") or now()),
                }
                prior = best.get(user_id)
                if prior is None or expires_at >= int(prior["expires_at"]):
                    best[user_id] = candidate
                imported += 1
            for record in best.values():
                existing = self._db.execute(
                    "SELECT expires_at FROM sessions WHERE external_user_id = ?",
                    (record["external_user_id"],),
                ).fetchone()
                if existing is not None and int(existing["expires_at"] or 0) > int(record["expires_at"]):
                    continue
                self._db.execute(
                    """
                    INSERT INTO sessions(
                      external_user_id, module_id, tenant_id, tenant_name, nick_name, user_name,
                      new_api_token_id, token_name, api_key, expires_at, issued_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(external_user_id) DO UPDATE SET
                      module_id=excluded.module_id,
                      tenant_id=excluded.tenant_id,
                      tenant_name=excluded.tenant_name,
                      nick_name=excluded.nick_name,
                      user_name=excluded.user_name,
                      new_api_token_id=excluded.new_api_token_id,
                      token_name=excluded.token_name,
                      api_key=excluded.api_key,
                      expires_at=excluded.expires_at,
                      issued_at=excluded.issued_at
                    """,
                    (
                        record["external_user_id"],
                        record["module_id"],
                        record["tenant_id"],
                        record["tenant_name"],
                        record["nick_name"],
                        record["user_name"],
                        record["new_api_token_id"],
                        record["token_name"],
                        record["api_key"],
                        record["expires_at"],
                        record["issued_at"],
                    ),
                )
            for username, session in (decoded.get("management_sessions") or {}).items():
                if not isinstance(session, dict):
                    continue
                self._db.execute(
                    """
                    INSERT INTO management_sessions(username, token, user_id, expires_at)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(username) DO UPDATE SET
                      token=excluded.token, user_id=excluded.user_id, expires_at=excluded.expires_at
                    """,
                    (
                        str(username),
                        str(session.get("token") or ""),
                        int(session.get("user_id") or 0),
                        int(session.get("expires_at") or 0),
                    ),
                )
            self._db.commit()
        return imported

    def get_enterprise(self, module_id: str) -> dict | None:
        with self._lock:
            row = self._db.execute(
                "SELECT module_id, new_api_user_id, username, password, module_name FROM enterprises WHERE module_id = ?",
                (module_id,),
            ).fetchone()
        return dict(row) if row else None

    def put_enterprise(self, account: dict) -> None:
        with self._lock:
            self._db.execute(
                """
                INSERT INTO enterprises(module_id, new_api_user_id, username, password, module_name)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(module_id) DO UPDATE SET
                  new_api_user_id=excluded.new_api_user_id,
                  username=excluded.username,
                  password=excluded.password,
                  module_name=excluded.module_name
                """,
                (
                    account["module_id"],
                    int(account["new_api_user_id"]),
                    account["username"],
                    account["password"],
                    account["module_name"],
                ),
            )
            self._db.commit()

    def list_enterprises(self) -> list[dict]:
        with self._lock:
            rows = self._db.execute(
                "SELECT module_id, new_api_user_id, username, password, module_name FROM enterprises"
            ).fetchall()
        return [dict(row) for row in rows]

    def get_session(self, user_id: str) -> dict | None:
        with self._lock:
            row = self._db.execute(
                """
                SELECT external_user_id, module_id, tenant_id, tenant_name, nick_name, user_name,
                       new_api_token_id, token_name, api_key, expires_at, issued_at
                FROM sessions WHERE external_user_id = ?
                """,
                (user_id,),
            ).fetchone()
        return dict(row) if row else None

    def put_session(self, record: dict) -> None:
        with self._lock:
            self._db.execute(
                """
                INSERT INTO sessions(
                  external_user_id, module_id, tenant_id, tenant_name, nick_name, user_name,
                  new_api_token_id, token_name, api_key, expires_at, issued_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(external_user_id) DO UPDATE SET
                  module_id=excluded.module_id,
                  tenant_id=excluded.tenant_id,
                  tenant_name=excluded.tenant_name,
                  nick_name=excluded.nick_name,
                  user_name=excluded.user_name,
                  new_api_token_id=excluded.new_api_token_id,
                  token_name=excluded.token_name,
                  api_key=excluded.api_key,
                  expires_at=excluded.expires_at,
                  issued_at=excluded.issued_at
                """,
                (
                    record["external_user_id"],
                    record["module_id"],
                    record["tenant_id"],
                    record["tenant_name"],
                    record["nick_name"],
                    record["user_name"],
                    int(record["new_api_token_id"]),
                    record["token_name"],
                    record["api_key"],
                    int(record["expires_at"]),
                    int(record["issued_at"]),
                ),
            )
            self._db.commit()

    def delete_session(self, user_id: str) -> dict | None:
        with self._lock:
            row = self._db.execute(
                "SELECT * FROM sessions WHERE external_user_id = ?",
                (user_id,),
            ).fetchone()
            if not row:
                return None
            known = dict(row)
            self._db.execute("DELETE FROM sessions WHERE external_user_id = ?", (user_id,))
            self._db.commit()
        return known

    def delete_sessions_for_user(self, user_id: str, tenant_id: str | None = None) -> list[dict]:
        with self._lock:
            if tenant_id is None:
                row = self._db.execute(
                    "SELECT * FROM sessions WHERE external_user_id = ?",
                    (user_id,),
                ).fetchone()
            else:
                row = self._db.execute(
                    "SELECT * FROM sessions WHERE external_user_id = ? AND tenant_id = ?",
                    (user_id, tenant_id),
                ).fetchone()
            if not row:
                return []
            known = dict(row)
            self._db.execute(
                "DELETE FROM sessions WHERE external_user_id = ?",
                (user_id,),
            )
            self._db.commit()
        return [known]

    def delete_session_by_id(self, session_id: str) -> dict | None:
        """Admin ids: `external_user_id` or legacy `external_user_id|module_id`."""
        user_id = session_id.split("|", 1)[0].strip() if "|" in session_id else session_id.strip()
        if not user_id:
            return None
        return self.delete_session(user_id)

    def delete_sessions_for_module(self, module_id: str) -> list[dict]:
        """Revoke Keys whose New API home project is this moduleId."""
        with self._lock:
            rows = self._db.execute(
                "SELECT * FROM sessions WHERE module_id = ?",
                (module_id,),
            ).fetchall()
            self._db.execute("DELETE FROM sessions WHERE module_id = ?", (module_id,))
            self._db.commit()
        return [dict(row) for row in rows]

    def list_sessions_for_module(self, module_id: str, *, limit: int = 5000) -> list[dict]:
        with self._lock:
            rows = self._db.execute(
                """
                SELECT external_user_id, module_id, tenant_id, tenant_name, nick_name, user_name,
                       token_name, expires_at, issued_at
                FROM sessions WHERE module_id = ?
                ORDER BY expires_at DESC LIMIT ?
                """,
                (module_id, limit),
            ).fetchall()
        return [dict(row) for row in rows]

    def get_management_session(self, username: str) -> dict | None:
        with self._lock:
            row = self._db.execute(
                "SELECT username, token, user_id, expires_at FROM management_sessions WHERE username = ?",
                (username,),
            ).fetchone()
        return dict(row) if row else None

    def put_management_session(self, username: str, session: dict) -> None:
        with self._lock:
            self._db.execute(
                """
                INSERT INTO management_sessions(username, token, user_id, expires_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(username) DO UPDATE SET
                  token=excluded.token, user_id=excluded.user_id, expires_at=excluded.expires_at
                """,
                (username, session["token"], int(session["user_id"]), int(session["expires_at"])),
            )
            self._db.commit()

    def purge_expired(self, *, before: int | None = None) -> int:
        cutoff = now() if before is None else before
        with self._lock:
            cur = self._db.execute("DELETE FROM sessions WHERE expires_at <= ?", (cutoff,))
            self._db.commit()
            return cur.rowcount
