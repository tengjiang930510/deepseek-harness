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


CONFIG = {
    "host": os.environ.get("BROKER_LISTEN_HOST", "127.0.0.1"),
    "port": int(os.environ.get("BROKER_LISTEN_PORT", "4010")),
    "state": Path(required("BROKER_DATA_FILE")),
    "external": required("EXTERNAL_API_BASE_URL").rstrip("/"),
    "new_api": required("NEW_API_BASE_URL").rstrip("/"),
    "root_user": required("NEW_API_ROOT_USERNAME"),
    "root_password": required("NEW_API_ROOT_PASSWORD"),
    "max_seconds": int(os.environ.get("BROKER_MAX_SESSION_SECONDS", "2592000")),
    "enterprise_quota": int(os.environ.get("BROKER_ENTERPRISE_QUOTA", "9007199254740991")),
    # Empty disables /admin and /v1/admin/*. Set a long random value for the ops console.
    "admin_token": os.environ.get("BROKER_ADMIN_TOKEN", "").strip(),
}
LOCK = threading.RLock()
STATE: dict = {"enterprises": {}, "sessions": {}, "management_sessions": {}}
# Refresh root JWT this many seconds before access_expires_at.
ROOT_SESSION_REFRESH_SKEW_SECONDS = int(os.environ.get("BROKER_ROOT_SESSION_REFRESH_SKEW_SECONDS", "60"))
ADMIN_HTML = Path(__file__).with_name("admin.html")


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def now() -> int:
    return int(time.time())


def load_state() -> None:
    global STATE
    try:
        decoded = json.loads(CONFIG["state"].read_text())
        if not isinstance(decoded.get("enterprises"), dict) or not isinstance(decoded.get("sessions"), dict):
            raise ValueError("invalid state")
        if not isinstance(decoded.get("management_sessions"), dict):
            decoded["management_sessions"] = {}
        STATE = decoded
    except FileNotFoundError:
        persist()


def persist() -> None:
    path = CONFIG["state"]
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    temporary = path.with_name(f"{path.name}.{secrets.token_hex(6)}.tmp")
    temporary.write_text(json.dumps(STATE) + "\n")
    temporary.chmod(0o600)
    temporary.replace(path)


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
    session = {
        "token": data["access_token"],
        "user_id": data["user"]["id"],
        "expires_at": int(expires_at),
    }
    STATE["management_sessions"][username] = session
    persist()
    return {"token": session["token"], "user_id": session["user_id"]}


def password_session(username: str, password: str, *, force: bool = False) -> dict:
    """Login as a New API user and cache the JWT under management_sessions."""
    cached = STATE["management_sessions"].get(username)
    if (
        not force
        and isinstance(cached, dict)
        and isinstance(cached.get("token"), str)
        and isinstance(cached.get("user_id"), int)
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
    cached = STATE["management_sessions"].get(CONFIG["root_user"])
    if (
        not force
        and isinstance(cached, dict)
        and isinstance(cached.get("token"), str)
        and isinstance(cached.get("user_id"), int)
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
    data = call(f"{CONFIG['external']}/system/user/getInfo", headers={"Authorization": token})
    enterprise, user = data.get("enterprise", {}), data.get("user", {})
    if not isinstance(enterprise.get("id"), str) or not isinstance(user.get("id"), str):
        raise PermissionError("identity response has no enterprise or user id")
    nick = user.get("nickName") if isinstance(user.get("nickName"), str) else ""
    user_name = user.get("userName") if isinstance(user.get("userName"), str) else ""
    return {
        "tenant_id": enterprise["id"],
        "tenant_name": enterprise.get("name") or enterprise["id"],
        "user_id": user["id"],
        "nick_name": nick.strip() or user_name.strip() or user["id"],
        "user_name": user_name.strip(),
    }


def session_key(token: str, module_id: str) -> str:
    return digest(f"{token}\n{module_id}")


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
    saved = STATE["enterprises"].get(module_id)
    if saved:
        return saved
    username = f"mod_{digest(module_id)[:16]}"
    password = secrets.token_urlsafe(32)
    display = (module_name or module_id)[:20]

    def search_account():
        found = manage(f"/api/user/search?keyword={quote(username)}&p=0&page_size=20")
        return next((item for item in found.get("items", []) if item.get("username") == username), None)

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
    STATE["enterprises"][module_id] = saved
    persist()
    return saved


def issue(token: str, expires_in: int, module_id: object, module_name: object = None) -> dict:
    if expires_in < 1:
        raise ValueError("expiresIn must be positive")
    project_id = require_module_id(module_id)
    label = module_name.strip()[:20] if isinstance(module_name, str) and module_name.strip() else project_id
    subject = identity(token)
    key_hash = session_key(token, project_id)
    prior = STATE["sessions"].get(key_hash)
    if prior and prior["expires_at"] <= now():
        raise PermissionError("login session has expired")
    expires_at = prior["expires_at"] if prior else now() + min(expires_in, CONFIG["max_seconds"])
    account = project_account(project_id, label)
    ent_uid = int(account["new_api_user_id"])
    name = prior["token_name"] if prior else f"usr_{digest(subject['user_id'])[:16]}_{key_hash[:8]}"

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
    revealed = manage(
        f"/api/token/{row['id']}/key",
        "POST",
        as_user_id=ent_uid,
        account=account,
    )
    STATE["sessions"][key_hash] = {
        "tenant_id": subject["tenant_id"],
        "tenant_name": subject["tenant_name"],
        "module_id": project_id,
        "module_name": account.get("module_name") or label,
        "external_user_id": subject["user_id"],
        "nick_name": subject["nick_name"],
        "user_name": subject["user_name"],
        "new_api_token_id": row["id"],
        "token_name": name,
        "expires_at": expires_at,
        "issued_at": prior.get("issued_at", now()) if prior else now(),
    }
    persist()
    return {
        "apiKey": f"sk-{revealed['key']}",
        "expiresAt": expires_at * 1000,
        "tenantId": subject["tenant_id"],
        "moduleId": project_id,
        "userId": subject["user_id"],
    }


def status(token: str, module_id: object) -> dict:
    """Minute-level check: broker local state only (no New API login or token lookup)."""
    subject = identity(token)
    project_id = require_module_id(module_id)
    known = STATE["sessions"].get(session_key(token, project_id))
    if (
        not known
        or known.get("module_id") != project_id
        or known.get("tenant_id") != subject["tenant_id"]
        or known.get("external_user_id") != subject["user_id"]
    ):
        return {"active": False, "reason": "key_not_issued"}
    if known["expires_at"] <= now():
        return {"active": False, "reason": "key_expired", "expiresAt": known["expires_at"] * 1000}
    return {"active": True, "reason": None, "expiresAt": known["expires_at"] * 1000}


def revoke(token: str, module_id: object = None) -> dict:
    """Revoke one project Key, or every Key for this access token when moduleId is omitted."""
    subject = identity(token)
    if module_id is None or (isinstance(module_id, str) and module_id.strip() == ""):
        targets = [
            (key, row)
            for key, row in list(STATE["sessions"].items())
            if row.get("tenant_id") == subject["tenant_id"] and row.get("external_user_id") == subject["user_id"]
        ]
    else:
        project_id = require_module_id(module_id)
        key_hash = session_key(token, project_id)
        row = STATE["sessions"].get(key_hash)
        targets = [(key_hash, row)] if row else []

    revoked = False
    for key_hash, known in targets:
        if not known:
            continue
        if known.get("tenant_id") != subject["tenant_id"] or known.get("external_user_id") != subject["user_id"]:
            continue
        account = STATE["enterprises"].get(known.get("module_id"))
        if not account:
            del STATE["sessions"][key_hash]
            revoked = True
            continue
        ent_uid = int(account["new_api_user_id"])
        manage(
            f"/api/token/{known['new_api_token_id']}",
            "DELETE",
            as_user_id=ent_uid,
            account=account,
        )
        del STATE["sessions"][key_hash]
        revoked = True
    if revoked:
        persist()
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
    account = STATE["enterprises"].get(known.get("module_id"))
    if not account:
        return
    ent_uid = int(account["new_api_user_id"])
    manage(
        f"/api/token/{known['new_api_token_id']}",
        "DELETE",
        as_user_id=ent_uid,
        account=account,
    )


def admin_overview() -> dict:
    """Project-first ledger for the ops console (no sk- secrets)."""
    projects = []
    for module_id, account in sorted(
        STATE["enterprises"].items(),
        key=lambda item: (str(item[1].get("module_name") or ""), item[0]),
    ):
        sessions = []
        for session_id, row in STATE["sessions"].items():
            if row.get("module_id") != module_id:
                continue
            expires_at = int(row.get("expires_at") or 0)
            sessions.append(
                {
                    "id": session_id,
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
    if not isinstance(session_id, str) or not session_id.strip():
        raise ValueError("sessionId is required")
    key = session_id.strip()
    known = STATE["sessions"].get(key)
    if not known:
        return {"revoked": False}
    try:
        _delete_new_api_token(known)
    except Exception:
        # Ledger still drops; orphan New API tokens can be cleaned from New API UI.
        pass
    del STATE["sessions"][key]
    persist()
    return {"revoked": True}


def admin_revoke_project_sessions(module_id: object) -> dict:
    project_id = require_module_id(module_id)
    removed = 0
    for key, known in list(STATE["sessions"].items()):
        if known.get("module_id") != project_id:
            continue
        try:
            _delete_new_api_token(known)
        except Exception:
            pass
        del STATE["sessions"][key]
        removed += 1
    if removed:
        persist()
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
                with LOCK:
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
            with LOCK:
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
    load_state()
    ThreadingHTTPServer((CONFIG["host"], CONFIG["port"]), Handler).serve_forever()
