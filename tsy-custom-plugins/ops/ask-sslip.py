#!/usr/bin/env python3
"""Caddy on_demand_tls ask: allow dsh-*.{base} and optional bare IP."""
from __future__ import annotations

import os
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

BASE = os.environ.get("T4Y_FRP_PUBLIC_BASE_DOMAIN", "47-99-34-208.sslip.io").lower().strip(".")
ALLOW_IP = os.environ.get("T4Y_FRP_ALLOW_IP_HOST", "47.99.34.208").strip()
LABEL = re.compile(r"^dsh-[a-f0-9]{12}\." + re.escape(BASE) + r"$", re.I)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:
        return

    def do_GET(self) -> None:
        qs = parse_qs(urlparse(self.path).query)
        domain = (qs.get("domain") or [""])[0].strip().lower()
        ok = bool(domain) and (LABEL.match(domain) is not None or domain == ALLOW_IP.lower())
        self.send_response(200 if ok else 400)
        self.end_headers()
        self.wfile.write(b"ok\n" if ok else b"deny\n")


if __name__ == "__main__":
    port = int(os.environ.get("T4Y_CADDY_ASK_PORT", "9099"))
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
