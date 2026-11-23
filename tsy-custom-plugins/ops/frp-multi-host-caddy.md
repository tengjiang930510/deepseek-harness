# FRP multi-host Caddy (百人各机独立 Origin)

Each Desktop rewrites `publicOrigin` to `https://dsh-{installationId12}.{publicBaseDomain}` so frpc `customDomains` no longer collide on one shared Host.

Base domain is stored in `~/.dsh/mobile-access/t4y-frp.json` (not inside dsh-mobile `settings.json`).

## DNS

- Point `*.{publicBaseDomain}` at the frps VPS public IP.
- Trial without a corporate domain: `{ip-with-dashes}.sslip.io`
  (`47.99.34.208` → `47-99-34-208.sslip.io`).

## One-shot deploy (trial sslip.io)

Scripts in this folder:

- `ask-sslip.py` — Caddy `on_demand_tls` allow-list (`dsh-*.47-99-34-208.sslip.io`)
- `deploy-multi-host-caddy.sh` — install ask service + Caddy snippet, reload

```sh
# from a machine that can SSH to the VPS as root (key auth):
scp tsy-custom-plugins/ops/ask-sslip.py \
    tsy-custom-plugins/ops/deploy-multi-host-caddy.sh \
    root@47.99.34.208:/tmp/t4y-frp/
ssh root@47.99.34.208 'bash /tmp/t4y-frp/deploy-multi-host-caddy.sh'
# if :443 conflicts with the old site block:
ssh root@47.99.34.208 'T4Y_CADDY_REPLACE=1 bash /tmp/t4y-frp/deploy-multi-host-caddy.sh'
```

## Caddy (attach mode → frps vhost HTTP on 7080)

Prefer a real wildcard certificate for production:

```caddyfile
*.m.example.com, m.example.com {
	tls /etc/caddy/certs/fullchain.pem /etc/caddy/certs/privkey.pem
	reverse_proxy 127.0.0.1:7080
}
```

Trial / sslip.io (per-host certificates via on-demand TLS — lock down `ask` before production):

```caddyfile
{
	on_demand_tls {
		ask http://127.0.0.1:9099/caddy-ask
	}
}

:443 {
	tls {
		on_demand
	}
	reverse_proxy 127.0.0.1:7080
}
```

frps `vhostHTTPPort` must stay `7080` (seed `vhostHttpPort`).

## Client seed

```sh
node ./tsy-custom-plugins/scripts/seed-enterprise-mobile-frp.mjs
# optional: T4Y_FRP_PUBLIC_BASE_DOMAIN=m.example.com node ...
```

`t4y-mobile-cowatch` calls `ensurePerHostPublicOrigin()` on Host boot; Desktop POSTs `/api/t4y-mobile-cowatch/per-host-origin` then `/api/mobile-access/remote/frp/configure` when Origin changes.
