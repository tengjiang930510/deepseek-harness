"""Private-network implementation of the T4Y New API key broker."""
from __future__ import annotations

import hashlib
import json
import os
import secrets
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen


def required(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"{name} must be configured")
    return value


_STATE_PATH = Path(required("BROKER_DATA_FILE"))
# SQLite ledger beside the legacy state.json (or override with BROKER_SQLITE_PATH).
_SQLITE_PATH = Path(os.environ["BROKER_SQLITE_PATH"]) if os.environ.get("BROKER_SQLITE_PATH") else _STATE_PATH.with_name("broker.db")
CONFIG = {
    "host": os.environ.get("BROKER_LISTEN_HOST", "127.0.0.1"),
    "port": int(os.environ.get("BROKER_LISTEN_PORT", "4010")),
    "state": _STATE_PATH,
    "sqlite": _SQLITE_PATH,
    "external": required("EXTERNAL_API_BASE_URL").rstrip("/"),
    "new_api": required("NEW_API_BASE_URL").rstrip("/"),
    "root_user": required("NEW_API_ROOT_USERNAME"),
    "root_password": required("NEW_API_ROOT_PASSWORD"),
    "max_seconds": int(os.environ.get("BROKER_MAX_SESSION_SECONDS", "2592000")),
    "enterprise_quota": int(os.environ.get("BROKER_ENTERPRISE_QUOTA", "9007199254740991")),
    # Empty disables /admin and /v1/admin/*. Set a long random value for the ops console.
    "admin_token": os.environ.get("BROKER_ADMIN_TOKEN", "").strip(),
    # Optional same-host New API SQLite — read token secrets without /api/token/{id}/key (avoids 429).
    "new_api_sqlite": Path(os.environ["NEW_API_SQLITE_PATH"]) if os.environ.get("NEW_API_SQLITE_PATH") else None,
    # Cache enterprise getInfo this many seconds (status polls + issue share the same token).
    "identity_cache_ttl": int(os.environ.get("BROKER_IDENTITY_CACHE_TTL_SECONDS", "45")),
}
# Refresh root JWT this many seconds before access_expires_at.
ROOT_SESSION_REFRESH_SKEW_SECONDS = int(os.environ.get("BROKER_ROOT_SESSION_REFRESH_SKEW_SECONDS", "60"))
ADMIN_HTML = Path(__file__).with_name("admin.html")
LEDGER = None  # set in main
# token_digest -> (expires_monotonic, subject)
_IDENTITY_CACHE: dict[str, tuple[float, dict]] = {}
_IDENTITY_CACHE_LOCK = threading.Lock()
# Serialize first-time provision per (user, module); cache hits never take this lock.
_ISSUE_LOCKS_GUARD = threading.Lock()
_ISSUE_LOCKS: dict[str, threading.Lock] = {}


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def now() -> int:
    return int(time.time())


def issue_lock_for(user_id: str, module_id: str) -> threading.Lock:
    key = f"{user_id}\n{module_id}"
    with _ISSUE_LOCKS_GUARD:
        lock = _ISSUE_LOCKS.get(key)
        if lock is None:
            lock = threading.Lock()
            _ISSUE_LOCKS[key] = lock
        return lock


def load_ledger():
    """Open SQLite WAL ledger; upsert any rows still present in legacy state.json."""
    global LEDGER
    from ledger import Ledger

    LEDGER = Ledger(CONFIG["sqlite"])
    # Idempotent: fills an empty DB and repairs a partial import without wiping newer rows.
    imported = LEDGER.import_state_json(CONFIG["state"])
    if imported:
        print(f"t4y-key-broker: upserted {imported} session rows from {CONFIG['state']}", flush=True)
    return LEDGER


def call(url: str, method: str = "GET", headers: dict | None = None, payload: dict | None = None) -> dict:
    request_headers = headers or {}
    body = None if payload is None else json.dumps(payload).encode()
    if body is not None:
        request_headers = {**request_headers, "Content-Type": "application/json"}
    request = Request(url, data=body, method=method, headers=request_headers)
    try:
        with urlopen(request, timeout=15) as response:
            decoded = json.loads(response.read())
    except HTTPError as error:
        detail = ""
        try:
            raw = error.read().decode("utf-8", errors="replace")
            parsed = json.loads(raw) if raw else {}
            detail = str(parsed.get("message") or parsed.get("msg") or raw or "")
        except Exception:
            detail = ""
        suffix = f": {detail}" if detail else ""
        raise RuntimeError(f"upstream HTTP {error.code}{suffix}") from error
    except (URLError, json.JSONDecodeError) as error:
        raise RuntimeError("upstream request failed") from error
    if decoded.get("success") is False or decoded.get("code") not in (None, 200):
        raise RuntimeError(str(decoded.get("message") or decoded.get("msg") or "upstream rejected request"))
    return decoded.get("data", decoded)


def new_api_headers(session: dict, *, as_user_id: int | None = None) -> dict:
    """Root JWT can manage another user's tokens when New-Api-User is that user id."""
    user_id = session["user_id"] if as_user_id is None else as_user_id
    return {"Authorization": f"Bearer {session['token']}", "New-Api-User": str(user_id)}


def _store_management_session(username: str, data: dict) -> dict:
    if not isinstance(data.get("access_token"), str) or not isinstance(data.get("user", {}).get("id"), int):
        raise RuntimeError("New API login returned no usable session")
    expires_at = data.get("access_expires_at")
    if not isinstance(expires_at, (int, float)) or int(expires_at) <= now():
        # Fallback when upstream omits expiry: keep a short cache, not forever.
        expires_at = now() + 600
    assert LEDGER is not None
    LEDGER.put_management_session(
        username,
        {
            "token": data["access_token"],
            "user_id": int(data["user"]["id"]),
            "expires_at": int(expires_at),
        },
    )
    return {"token": data["access_token"], "user_id": int(data["user"]["id"])}


def password_session(username: str, password: str, *, force: bool = False) -> dict:
    """Login as a New API user and cache the JWT under management_sessions."""
    assert LEDGER is not None
    cached = None if force else LEDGER.get_management_session(username)
    if (
        cached is not None
        and int(cached.get("expires_at") or 0) - ROOT_SESSION_REFRESH_SKEW_SECONDS > now()
    ):
        return {"token": cached["token"], "user_id": cached["user_id"]}
    data = call(
        f"{CONFIG['new_api']}/api/user/login",
        "POST",
        payload={"username": username, "password": password},
    )
    return _store_management_session(username, data)


def _is_session_limit_error(error: Exception) -> bool:
    text = str(error)
    return "AUTH_SESSION_LIMIT" in text or ("409" in text and "Conflict" in text)


def root_session(*, force: bool = False) -> dict:
    """
    Long-lived management credential for the hot path: one cached root JWT.
    New API sk- keys cannot call management APIs; only the login JWT can.
    """
    assert LEDGER is not None
    cached = None if force else LEDGER.get_management_session(CONFIG["root_user"])
    if (
        cached is not None
        and int(cached.get("expires_at") or 0) - ROOT_SESSION_REFRESH_SKEW_SECONDS > now()
    ):
        return {"token": cached["token"], "user_id": cached["user_id"]}

    last_error: Exception | None = None
    for attempt in range(6):
        try:
            return password_session(CONFIG["root_user"], CONFIG["root_password"], force=True)
        except Exception as error:
            last_error = error
            if _is_session_limit_error(error):
                raise RuntimeError(
                    "New API root login hit AUTH_SESSION_LIMIT; "
                    "revoke stale user_sessions for the root user or use enterprise fallback"
                ) from error
            if "429" not in str(error) or attempt == 5:
                break
            time.sleep(min(60, 3 * (2 ** attempt)))
    assert last_error is not None
    raise last_error


def manage(
    path: str,
    method: str = "GET",
    *,
    as_user_id: int | None = None,
    payload: dict | None = None,
    account: dict | None = None,
) -> dict:
    """
    Call a New API management route via root impersonation.
    When root login is blocked by AUTH_SESSION_LIMIT and an enterprise account
    password is available, fall back to logging in as that enterprise user.
    """
    try:
        session = root_session()
        try:
            return call(f"{CONFIG['new_api']}{path}", method, new_api_headers(session, as_user_id=as_user_id), payload)
        except Exception as error:
            if "401" not in str(error) and "Unauthorized" not in str(error):
                raise
            session = root_session(force=True)
            return call(f"{CONFIG['new_api']}{path}", method, new_api_headers(session, as_user_id=as_user_id), payload)
    except Exception as error:
        if account is None or not _is_session_limit_error(error):
            raise
        session = password_session(account["username"], account["password"])
        return call(f"{CONFIG['new_api']}{path}", method, new_api_headers(session), payload)


def identity(token: str) -> dict:
    """Validate the parent-account access token. Billing projects are moduleId, not tenant id."""
    token_digest = digest(token)
    ttl = CONFIG["identity_cache_ttl"]
    if ttl > 0:
        with _IDENTITY_CACHE_LOCK:
            hit = _IDENTITY_CACHE.get(token_digest)
            if hit is not None and hit[0] > time.monotonic():
                return dict(hit[1])
    data = call(f"{CONFIG['external']}/system/user/getInfo", headers={"Authorization": token})
    enterprise, user = data.get("enterprise", {}), data.get("user", {})
    if not isinstance(enterprise.get("id"), str) or not isinstance(user.get("id"), str):
        raise PermissionError("identity response has no enterprise or user id")
    nick = user.get("nickName") if isinstance(user.get("nickName"), str) else ""
    user_name = user.get("userName") if isinstance(user.get("userName"), str) else ""
    subject = {
        "tenant_id": enterprise["id"],
        "tenant_name": enterprise.get("name") or enterprise["id"],
        "user_id": user["id"],
        "nick_name": nick.strip() or user_name.strip() or user["id"],
        "user_name": user_name.strip(),
    }
    if ttl > 0:
        with _IDENTITY_CACHE_LOCK:
            _IDENTITY_CACHE[token_digest] = (time.monotonic() + ttl, subject)
            if len(_IDENTITY_CACHE) > 50_000:
                cutoff = time.monotonic()
                expired = [k for k, (exp, _) in _IDENTITY_CACHE.items() if exp <= cutoff]
                for k in expired:
                    del _IDENTITY_CACHE[k]
    return dict(subject)


def find_cached_api_key(*, user_id: str) -> tuple[str | None, dict | None]:
    """O(1) ledger lookup: one unexpired Key per enterprise user (any project)."""
    assert LEDGER is not None
    prior = LEDGER.get_session(user_id)
    if prior is None:
        return None, None
    cached = prior.get("api_key")
    if isinstance(cached, str) and cached.startswith("sk-") and int(prior.get("expires_at") or 0) > now():
        return cached, prior
    return None, prior


def require_module_id(module_id: object) -> str:
    if not isinstance(module_id, str) or module_id.strip() == "":
        raise ValueError("moduleId is required")
    value = module_id.strip()
    if "/" in value or ".." in value or len(value) > 128:
        raise ValueError("moduleId is invalid")
    return value


def project_account(module_id: str, module_name: str) -> dict:
    """
    One New API user per product project (moduleId), e.g. 武汉地铁 / 襄阳铁路公安.
    The login tenant above them is only the parent account.
    """
    assert LEDGER is not None
    saved = LEDGER.get_enterprise(module_id)
    if saved:
        return saved
    username = f"mod_{digest(module_id)[:16]}"
    password = secrets.token_urlsafe(32)
    display = (module_name or module_id)[:20]

    def search_account():
        found = manage(f"/api/user/search?keyword={quote(username)}&p=0&page_size=20")
        return next((item for item in found.get("items", []) if item.get("username") == username), None)

    # Serialize first-time provision for the same module; concurrent issuers share the row after.
    with issue_lock_for("__enterprise__", module_id):
        saved = LEDGER.get_enterprise(module_id)
        if saved:
            return saved
        account = search_account()
        if account is None:
            try:
                manage(
                    "/api/user/",
                    "POST",
                    payload={
                        "username": username,
                        "password": password,
                        "display_name": display,
                        "role": 1,
                    },
                )
            except RuntimeError as error:
                if "409" not in str(error):
                    raise
            account = search_account()
        if not account:
            raise RuntimeError("New API did not return the project account")
        try:
            manage(
                "/api/user/",
                "PUT",
                payload={
                    "id": account["id"],
                    "username": username,
                    "password": password,
                    "display_name": display,
                },
            )
        except RuntimeError:
            pass
        manage(
            "/api/user/manage",
            "POST",
            payload={"id": account["id"], "action": "add_quota", "mode": "override", "value": CONFIG["enterprise_quota"]},
        )
        saved = {
            "new_api_user_id": account["id"],
            "username": username,
            "password": password,
            "module_id": module_id,
            "module_name": display,
        }
        LEDGER.put_enterprise(saved)
        return saved


def _is_rate_limited(error: Exception) -> bool:
    text = str(error)
    return "429" in text or "Too Many Requests" in text or "rate" in text.lower()


# New API rate-limits POST /api/token/{id}/key; serialize reveals across requests.
_REVEAL_LOCK = threading.Lock()
_REVEAL_NEXT_OK_AT = 0.0
_REVEAL_MIN_INTERVAL_SECONDS = 2.0


def read_token_key_from_sqlite(token_id: int) -> str | None:
    """Read the sk- secret from New API's tokens table when NEW_API_SQLITE_PATH is configured."""
    path = CONFIG["new_api_sqlite"]
    if path is None or not path.is_file():
        return None
    try:
        import sqlite3

        with sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=5) as connection:
            row = connection.execute(
                "SELECT key FROM tokens WHERE id = ? AND (deleted_at IS NULL OR deleted_at = '')",
                (token_id,),
            ).fetchone()
        if not row or not isinstance(row[0], str) or row[0] == "":
            return None
        key = row[0]
        return key if key.startswith("sk-") else f"sk-{key}"
    except Exception:
        return None


def reveal_token_key(token_id: int, *, ent_uid: int, account: dict) -> str:
    """
    Obtain a New API token secret. Prefer same-host SQLite when configured (no rate limit);
    otherwise POST /api/token/{id}/key with 429 backoff — rapid project switches previously
    exhausted that endpoint and returned 502 to the client.
    """
    from_db = read_token_key_from_sqlite(token_id)
    if from_db is not None:
        return from_db
    global _REVEAL_NEXT_OK_AT
    last_error: Exception | None = None
    with _REVEAL_LOCK:
        for attempt in range(8):
            wait = _REVEAL_NEXT_OK_AT - time.time()
            if wait > 0:
                time.sleep(wait)
            try:
                revealed = manage(
                    f"/api/token/{token_id}/key",
                    "POST",
                    as_user_id=ent_uid,
                    account=account,
                )
                key = revealed.get("key") if isinstance(revealed, dict) else None
                if not isinstance(key, str) or key == "":
                    raise RuntimeError("New API did not return the user key material")
                _REVEAL_NEXT_OK_AT = time.time() + _REVEAL_MIN_INTERVAL_SECONDS
                return key if key.startswith("sk-") else f"sk-{key}"
            except Exception as error:
                last_error = error
                if not _is_rate_limited(error) or attempt == 7:
                    break
                # Cool down longer than New API's short burst window before the next reveal.
                delay = min(30, 2 * (2 ** attempt))
                _REVEAL_NEXT_OK_AT = time.time() + delay
                time.sleep(delay)
    assert last_error is not None
    if _is_rate_limited(last_error):
        raise RuntimeError(
            "New API rate-limited key reveal; wait a few seconds and switch project again"
        ) from last_error
    raise last_error


def issue(token: str, expires_in: int, module_id: object, module_name: object = None) -> dict:
    """
    One Key per enterprise user. moduleId is only required for the first mint (New API home
    project); later calls — including admin accounts switching projects — reuse the same Key.

    Unexpired ledger rows reuse the Key and original expiresAt (no silent renew).
    Expired rows are re-issued on a fresh enterprise login: keep Key material when present
    (no New API reveal), write a new expiresAt from expires_in.
    """
    # expires_in is seconds (identity converts enterprise login minutes → seconds).
    if expires_in < 1:
        raise ValueError("expiresIn must be a positive number of seconds")
    ttl = min(int(expires_in), CONFIG["max_seconds"])
    project_id = require_module_id(module_id)
    label = module_name.strip()[:20] if isinstance(module_name, str) and module_name.strip() else project_id
    subject = identity(token)
    cached_key, prior = find_cached_api_key(user_id=subject["user_id"])
    # Same user already has an unexpired Key (any home module): reuse, skip New API.
    if isinstance(cached_key, str) and cached_key.startswith("sk-") and isinstance(prior, dict):
        return {
            "apiKey": cached_key,
            "expiresAt": int(prior["expires_at"]) * 1000,
            "tenantId": subject["tenant_id"],
            "moduleId": project_id,
            "homeModuleId": prior.get("module_id") or project_id,
            "userId": subject["user_id"],
        }

    # Serialize first-time mint / post-expiry re-issue per user only; cache hits above never wait.
    with issue_lock_for(subject["user_id"], "__user__"):
        cached_key, prior = find_cached_api_key(user_id=subject["user_id"])
        if isinstance(cached_key, str) and cached_key.startswith("sk-") and isinstance(prior, dict):
            return {
                "apiKey": cached_key,
                "expiresAt": int(prior["expires_at"]) * 1000,
                "tenantId": subject["tenant_id"],
                "moduleId": project_id,
                "homeModuleId": prior.get("module_id") or project_id,
                "userId": subject["user_id"],
            }
        expires_at = now() + ttl
        prior_key = prior.get("api_key") if isinstance(prior, dict) else None
        prior_token_id = prior.get("new_api_token_id") if isinstance(prior, dict) else None
        prior_token_name = prior.get("token_name") if isinstance(prior, dict) else None
        # Expired (or otherwise inactive) row still holds Key material: renew expiry only.
        if (
            isinstance(prior, dict)
            and isinstance(prior_key, str)
            and prior_key.startswith("sk-")
            and prior_token_id is not None
            and isinstance(prior_token_name, str)
            and prior_token_name != ""
        ):
            home_module = prior.get("module_id") if isinstance(prior.get("module_id"), str) and prior.get("module_id") else project_id
            record = {
                "tenant_id": subject["tenant_id"],
                "tenant_name": subject["tenant_name"],
                "module_id": home_module,
                "module_name": prior.get("module_name") or label,
                "external_user_id": subject["user_id"],
                "nick_name": subject["nick_name"],
                "user_name": subject["user_name"],
                "new_api_token_id": prior_token_id,
                "token_name": prior_token_name,
                "api_key": prior_key,
                "expires_at": expires_at,
                "issued_at": now(),
            }
            assert LEDGER is not None
            LEDGER.put_session(record)
            return {
                "apiKey": prior_key,
                "expiresAt": expires_at * 1000,
                "tenantId": subject["tenant_id"],
                "moduleId": project_id,
                "homeModuleId": home_module,
                "userId": subject["user_id"],
            }

        account = project_account(project_id, label)
        ent_uid = int(account["new_api_user_id"])
        # Stable token name per user so re-login does not mint endless New API tokens.
        stable_name = f"usr_{digest(subject['user_id'])[:20]}"
        name = prior["token_name"] if prior and prior.get("token_name") else stable_name

        def find_token(token_name: str):
            items = manage(
                "/api/token/?p=0&page_size=100",
                as_user_id=ent_uid,
                account=account,
            ).get("items", [])
            return next((item for item in items if item.get("name") == token_name), None)

        row = find_token(name)
        if not row:
            try:
                manage(
                    "/api/token/",
                    "POST",
                    as_user_id=ent_uid,
                    account=account,
                    payload={"name": name, "expired_time": -1, "unlimited_quota": True, "group": "default"},
                )
            except RuntimeError as error:
                if "409" not in str(error):
                    raise
            row = find_token(name)
        if not row:
            name = f"{name}_{secrets.token_hex(3)}"
            manage(
                "/api/token/",
                "POST",
                as_user_id=ent_uid,
                account=account,
                payload={"name": name, "expired_time": -1, "unlimited_quota": True, "group": "default"},
            )
            row = find_token(name)
        if not row:
            raise RuntimeError("New API did not return the user key")
        api_key = reveal_token_key(int(row["id"]), ent_uid=ent_uid, account=account)
        record = {
            "tenant_id": subject["tenant_id"],
            "tenant_name": subject["tenant_name"],
            "module_id": project_id,
            "module_name": account.get("module_name") or label,
            "external_user_id": subject["user_id"],
            "nick_name": subject["nick_name"],
            "user_name": subject["user_name"],
            "new_api_token_id": row["id"],
            "token_name": name,
            "api_key": api_key,
            "expires_at": expires_at,
            "issued_at": now(),
        }
        assert LEDGER is not None
        LEDGER.put_session(record)
        return {
            "apiKey": api_key,
            "expiresAt": expires_at * 1000,
            "tenantId": subject["tenant_id"],
            "moduleId": project_id,
            "homeModuleId": project_id,
            "userId": subject["user_id"],
        }


def status(token: str, module_id: object = None) -> dict:
    """Minute-level check: user Key in ledger (moduleId kept for API compat, not used for lookup)."""
    subject = identity(token)
    if module_id is not None and not (isinstance(module_id, str) and module_id.strip() == ""):
        require_module_id(module_id)
    # Use the ledger row directly: find_cached_api_key clears the Key when expired.
    assert LEDGER is not None
    known = LEDGER.get_session(subject["user_id"])
    ledger_key = known.get("api_key") if isinstance(known, dict) else None
    if (
        not known
        or known.get("tenant_id") != subject["tenant_id"]
        or known.get("external_user_id") != subject["user_id"]
        or not (isinstance(ledger_key, str) and ledger_key.startswith("sk-"))
    ):
        return {"active": False, "reason": "key_not_issued"}
    if int(known["expires_at"]) <= now():
        return {"active": False, "reason": "key_expired", "expiresAt": int(known["expires_at"]) * 1000}
    return {
        "active": True,
        "reason": None,
        "expiresAt": int(known["expires_at"]) * 1000,
        "homeModuleId": known.get("module_id"),
    }


def revoke(token: str, module_id: object = None) -> dict:
    """Revoke this user's single Key. moduleId is ignored (API compat)."""
    assert LEDGER is not None
    subject = identity(token)
    if module_id is not None and not (isinstance(module_id, str) and module_id.strip() == ""):
        require_module_id(module_id)
    targets = LEDGER.delete_sessions_for_user(subject["user_id"], subject["tenant_id"])

    revoked = False
    for known in targets:
        if not known:
            continue
        if known.get("tenant_id") != subject["tenant_id"] or known.get("external_user_id") != subject["user_id"]:
            continue
        account = LEDGER.get_enterprise(str(known.get("module_id") or ""))
        if not account:
            revoked = True
            continue
        ent_uid = int(account["new_api_user_id"])
        manage(
            f"/api/token/{known['new_api_token_id']}",
            "DELETE",
            as_user_id=ent_uid,
            account=account,
        )
        revoked = True
    return {"revoked": revoked}


def require_admin(authorization: str | None) -> None:
    expected = CONFIG["admin_token"]
    if not expected:
        raise PermissionError("admin console is disabled (BROKER_ADMIN_TOKEN unset)")
    if not authorization:
        raise PermissionError("Authorization is required")
    value = authorization[7:].strip() if authorization.lower().startswith("bearer ") else authorization.strip()
    if not value or not secrets.compare_digest(value, expected):
        raise PermissionError("admin token is invalid")


def _delete_new_api_token(known: dict) -> None:
    assert LEDGER is not None
    account = LEDGER.get_enterprise(str(known.get("module_id") or ""))
    if not account:
        return
    ent_uid = int(account["new_api_user_id"])
    manage(
        f"/api/token/{known['new_api_token_id']}",
        "DELETE",
        as_user_id=ent_uid,
        account=account,
    )


def admin_session_id(row: dict) -> str:
    # Keep `|homeModuleId` suffix so older admin UI still shows home project; revoke parses user id.
    return f"{row['external_user_id']}|{row['module_id']}"


def admin_overview() -> dict:
    """Project-first ledger for the ops console (no sk- secrets)."""
    assert LEDGER is not None
    projects = []
    for account in sorted(
        LEDGER.list_enterprises(),
        key=lambda item: (str(item.get("module_name") or ""), str(item.get("module_id") or "")),
    ):
        module_id = account["module_id"]
        sessions = []
        for row in LEDGER.list_sessions_for_module(module_id):
            expires_at = int(row.get("expires_at") or 0)
            sessions.append(
                {
                    "id": admin_session_id(row),
                    "externalUserId": row.get("external_user_id"),
                    "nickName": row.get("nick_name") or row.get("user_name") or row.get("external_user_id"),
                    "userName": row.get("user_name") or "",
                    "tenantId": row.get("tenant_id"),
                    "tenantName": row.get("tenant_name") or row.get("tenant_id"),
                    "tokenName": row.get("token_name"),
                    "expiresAt": expires_at * 1000,
                    "issuedAt": int(row.get("issued_at") or 0) * 1000 or None,
                    "active": expires_at > now(),
                }
            )
        sessions.sort(key=lambda item: (not item["active"], str(item.get("nickName") or "")))
        projects.append(
            {
                "moduleId": module_id,
                "moduleName": account.get("module_name") or module_id,
                "newApiUserId": account.get("new_api_user_id"),
                "username": account.get("username"),
                "sessions": sessions,
            }
        )
    return {"serverTime": now(), "projects": projects}


def admin_revoke_session(session_id: object) -> dict:
    assert LEDGER is not None
    if not isinstance(session_id, str) or not session_id.strip():
        raise ValueError("sessionId is required")
    key = session_id.strip()
    known = LEDGER.delete_session_by_id(key)
    if not known:
        return {"revoked": False}
    try:
        _delete_new_api_token(known)
    except Exception:
        # Ledger already dropped; orphan New API tokens can be cleaned from New API UI.
        pass
    return {"revoked": True}


def admin_revoke_project_sessions(module_id: object) -> dict:
    assert LEDGER is not None
    project_id = require_module_id(module_id)
    known_rows = LEDGER.delete_sessions_for_module(project_id)
    removed = 0
    for known in known_rows:
        try:
            _delete_new_api_token(known)
        except Exception:
            pass
        removed += 1
    return {"revoked": removed > 0, "count": removed}


class Handler(BaseHTTPRequestHandler):
    def response(self, status: int, value: dict) -> None:
        encoded = json.dumps(value, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()
        self.wfile.write(encoded)

    def html(self, status: int, body: bytes) -> None:
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.response(204, {})

    def do_GET(self):
        try:
            path = self.path.split("?", 1)[0]
            if path == "/healthz":
                return self.response(200, {"ok": True})
            if path in ("/admin", "/admin/"):
                if not CONFIG["admin_token"]:
                    return self.html(
                        503,
                        b"<html><body><p>Admin console disabled: set BROKER_ADMIN_TOKEN.</p></body></html>",
                    )
                if not ADMIN_HTML.is_file():
                    return self.html(500, b"<html><body><p>admin.html missing</p></body></html>")
                return self.html(200, ADMIN_HTML.read_bytes())
            if path == "/v1/admin/overview":
                require_admin(self.headers.get("Authorization"))
                return self.response(200, admin_overview())
            return self.response(404, {"error": "not_found"})
        except PermissionError as error:
            self.response(401, {"error": "admin_unauthorized", "message": str(error)})
        except Exception as error:
            self.response(502, {"error": "admin_failed", "message": str(error)})

    def do_POST(self):
        try:
            token = self.headers.get("Authorization")
            length = int(self.headers.get("Content-Length", "0"))
            if length > 16384:
                raise ValueError("request body is too large")
            body = json.loads(self.rfile.read(length) or b"{}")
            path = self.path.split("?", 1)[0]
            # No global lock: SQLite WAL + per-user issue locks; upstream HTTP stays concurrent.
            if path == "/v1/admin/session/revoke":
                require_admin(token)
                return self.response(200, admin_revoke_session(body.get("sessionId")))
            if path == "/v1/admin/project/revoke-sessions":
                require_admin(token)
                return self.response(200, admin_revoke_project_sessions(body.get("moduleId")))
            if not token:
                raise PermissionError("Authorization is required")
            if path == "/v1/session/issue":
                return self.response(
                    200,
                    issue(
                        token,
                        int(body.get("expiresIn", 0)),
                        body.get("moduleId"),
                        body.get("moduleName"),
                    ),
                )
            if path == "/v1/session/status":
                return self.response(200, status(token, body.get("moduleId")))
            if path == "/v1/session/revoke":
                return self.response(200, revoke(token, body.get("moduleId")))
            return self.response(404, {"error": "not_found"})
        except PermissionError as error:
            code = "admin_unauthorized" if self.path.startswith("/v1/admin/") else "identity_invalid"
            self.response(401, {"error": code, "message": str(error)})
        except Exception as error:
            self.response(502, {"error": "provisioning_failed", "message": str(error)})


if __name__ == "__main__":
    load_ledger()
    print(
        f"t4y-key-broker listening on {CONFIG['host']}:{CONFIG['port']} "
        f"sqlite={CONFIG['sqlite']} identity_cache_ttl={CONFIG['identity_cache_ttl']}s",
        flush=True,
    )
    ThreadingHTTPServer((CONFIG["host"], CONFIG["port"]), Handler).serve_forever()
