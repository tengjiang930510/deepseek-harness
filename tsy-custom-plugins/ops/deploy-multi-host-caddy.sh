#!/usr/bin/env bash
# Apply multi-host / on-demand TLS Caddy in front of frps vhost :7080.
# Trial sslip.io: only issues certs for dsh-*.47-99-34-208.sslip.io (+ raw IP Host).
#
# On the VPS as root:
#   bash deploy-multi-host-caddy.sh
# If validate fails due to duplicate :443 blocks:
#   T4Y_CADDY_REPLACE=1 bash deploy-multi-host-caddy.sh
set -euo pipefail

BASE_DOMAIN="${T4Y_FRP_PUBLIC_BASE_DOMAIN:-47-99-34-208.sslip.io}"
ASK_PORT="${T4Y_CADDY_ASK_PORT:-9099}"
FRPS_VHOST="${T4Y_FRPS_VHOST:-127.0.0.1:7080}"
INSTALL_DIR="${T4Y_CADDY_INSTALL_DIR:-/opt/t4y-frp-edge}"
CADDY_MAIN="${T4Y_CADDYFILE:-/etc/caddy/Caddyfile}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || { echo "missing command: $1" >&2; exit 1; }
}

need_cmd caddy
need_cmd python3
need_cmd systemctl
need_cmd curl

mkdir -p "$INSTALL_DIR"

if [[ -f "$SCRIPT_DIR/ask-sslip.py" ]]; then
  cp -a "$SCRIPT_DIR/ask-sslip.py" "$INSTALL_DIR/ask-sslip.py"
else
  echo "ask-sslip.py missing next to this script" >&2
  exit 1
fi
chmod 755 "$INSTALL_DIR/ask-sslip.py"

cat >"$INSTALL_DIR/ask-sslip.env" <<EOF
T4Y_FRP_PUBLIC_BASE_DOMAIN=$BASE_DOMAIN
T4Y_FRP_ALLOW_IP_HOST=47.99.34.208
T4Y_CADDY_ASK_PORT=$ASK_PORT
EOF

cat >/etc/systemd/system/t4y-caddy-ask.service <<EOF
[Unit]
Description=t4y Caddy on_demand_tls ask (sslip / per-Desktop FRP)
After=network.target

[Service]
Type=simple
EnvironmentFile=$INSTALL_DIR/ask-sslip.env
ExecStart=/usr/bin/python3 $INSTALL_DIR/ask-sslip.py
Restart=on-failure
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now t4y-caddy-ask.service
sleep 0.5

code_ok=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${ASK_PORT}/?domain=dsh-f8d0d7c3e02e.${BASE_DOMAIN}" || true)
code_bad=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${ASK_PORT}/?domain=evil.example.com" || true)
if [[ "$code_ok" != "200" || "$code_bad" != "400" ]]; then
  echo "ask endpoint check failed ok=$code_ok bad=$code_bad" >&2
  systemctl status t4y-caddy-ask.service --no-pager || true
  exit 1
fi

SNIPPET="$INSTALL_DIR/Caddyfile.multi-host"
cat >"$SNIPPET" <<EOF
# Managed by t4y deploy-multi-host-caddy.sh — per-Desktop Origins via on-demand TLS.
{
	on_demand_tls {
		ask http://127.0.0.1:${ASK_PORT}
	}
}

:443 {
	tls {
		on_demand
	}
	reverse_proxy ${FRPS_VHOST}
}

47.99.34.208 {
	reverse_proxy ${FRPS_VHOST}
}
EOF

BACKUP=""
if [[ -f "$CADDY_MAIN" ]]; then
  BACKUP="${CADDY_MAIN}.bak.t4y.$(date +%Y%m%d%H%M%S)"
  cp -a "$CADDY_MAIN" "$BACKUP"
  echo "backed up $CADDY_MAIN -> $BACKUP"
fi

if [[ -f "$CADDY_MAIN" ]] && grep -q 'Caddyfile.multi-host' "$CADDY_MAIN" 2>/dev/null; then
  echo "import already present in $CADDY_MAIN"
elif [[ "${T4Y_CADDY_REPLACE:-0}" == "1" ]]; then
  printf 'import %s\n' "$SNIPPET" >"$CADDY_MAIN"
  echo "replaced $CADDY_MAIN (T4Y_CADDY_REPLACE=1)"
elif [[ -f "$CADDY_MAIN" ]]; then
  printf '\n# t4y multi-host FRP edge\nimport %s\n' "$SNIPPET" >>"$CADDY_MAIN"
  echo "appended import to $CADDY_MAIN"
else
  mkdir -p "$(dirname "$CADDY_MAIN")"
  printf 'import %s\n' "$SNIPPET" >"$CADDY_MAIN"
  echo "created $CADDY_MAIN"
fi

if ! caddy validate --config "$CADDY_MAIN"; then
  echo "caddy validate failed; restoring backup if any" >&2
  if [[ -n "$BACKUP" && -f "$BACKUP" ]]; then
    cp -a "$BACKUP" "$CADDY_MAIN"
  fi
  echo "Re-run with T4Y_CADDY_REPLACE=1 if the old Caddyfile conflicts on :443." >&2
  exit 1
fi

systemctl reload caddy || systemctl restart caddy
systemctl --no-pager --full status caddy | head -n 20 || true
systemctl --no-pager --full status t4y-caddy-ask | head -n 15 || true

echo
echo "OK: on-demand TLS for dsh-*.${BASE_DOMAIN} → ${FRPS_VHOST}"
echo "Test: curl -sI --max-time 30 https://dsh-f8d0d7c3e02e.${BASE_DOMAIN}/ | head"
