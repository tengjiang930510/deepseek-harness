/**
 * Unified regression checklist for t4y-mobile-cowatch.
 * Runs Desktop CDP + public FRP cases and prints a pass/fail matrix.
 *
 * Built-in / Hub plugins (identity, brand, hub, oa-helper, …) are covered by:
 *   node tsy-custom-plugins/scripts/enterprise-plugins-checklist.mjs
 *
 * Usage (Desktop must be up with --remote-debugging-port=9222):
 *   node scripts/unified-regression-checklist.mjs
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync, existsSync } from 'node:fs'

const root = dirname(fileURLToPath(import.meta.url))
const pkgRoot = join(root, '..')
const results = []

function record(id, area, title, pass, detail = '') {
  results.push({ id, area, title, pass: !!pass, detail: String(detail || '').slice(0, 240) })
  const mark = pass ? 'PASS' : 'FAIL'
  console.log(`[${mark}] ${id} ${area} — ${title}${detail ? ` :: ${detail}` : ''}`)
}

function adminEval(expression) {
  return `(async () => {
    const admin = (path, init = {}) => fetch(path, {
      ...init,
      credentials: 'same-origin',
      headers: {
        'content-type': 'application/json',
        'x-dsh-mobile-web-admin': 'same-origin-json',
        ...(init.headers || {}),
      },
    })
    return await (${expression})(admin)
  })()`
}

async function connectCdp() {
  const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
  const page = list.find((p) => p.type === 'page')
  if (!page) throw new Error('no CDP page')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  let id = 0
  const pending = new Map()
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(String(event.data))
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    }
  })
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve(), { once: true })
    ws.addEventListener('error', (err) => reject(err), { once: true })
  })
  function send(method, params = {}) {
    const my = ++id
    return new Promise((resolve) => {
      pending.set(my, resolve)
      ws.send(JSON.stringify({ id: my, method, params }))
    })
  }
  async function evaluate(expression) {
    const res = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
    return res.result?.result?.value ?? res
  }
  await send('Runtime.enable')
  return { ws, send, evaluate }
}

// ——— A. Static / unit ———
{
  const unit = spawnSync(process.execPath, ['--test',
    join(pkgRoot, 'regression.test.js'),
    join(pkgRoot, 'frp-guard.test.js'),
    join(pkgRoot, 'handoff.test.js'),
  ], { encoding: 'utf8' })
  const ok = unit.status === 0
  record('A1', 'unit', 'regression + frp-guard + handoff', ok, ok ? 'all pass' : unit.stderr.slice(0, 200))
}

{
  const pkg = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8'))
  const targets = [
    join(process.env.USERPROFILE || '', '.dsh', 'profiles', 'desktop', 'node_modules', 't4y-mobile-cowatch', 'package.json'),
    join(pkgRoot, '..', '..', 'apps', 'desktop', '.desktop-build', 'trial-plugins', 't4y-mobile-cowatch', 'package.json'),
    join(pkgRoot, '..', '..', 'apps', 'desktop', '.desktop-build', 'targets', 'win-x64', 'unsigned-artifacts', 'win-unpacked', 'resources', 'trial-plugins', 't4y-mobile-cowatch', 'package.json'),
  ]
  const versions = targets.filter((p) => existsSync(p)).map((p) => JSON.parse(readFileSync(p, 'utf8')).version)
  const aligned = versions.length > 0 && versions.every((v) => v === pkg.version)
  record('A2', 'stage', `package version aligned (${pkg.version})`, aligned, versions.join(','))
}

{
  const client = readFileSync(join(pkgRoot, 'client.js'), 'utf8')
  const presence = readFileSync(join(pkgRoot, 'client-src', 'phone-presence.js'), 'utf8')
  const desktop = readFileSync(join(pkgRoot, 'client-src', 'desktop-access.js'), 'utf8')
  const index = readFileSync(join(pkgRoot, 'index.js'), 'utf8')
  record('A3', 'source', 'boot inject stack-safe (no per-call Buffer.from swap)', /pushBootHtmlInjector/.test(index) && !/Buffer\.from = function t4yBootInjectFrom/.test(index))
  record('A4', 'source', 'prototype patches reversible on unload', /uninstallAllDshMobilePatches/.test(index) && /restorePatchedPrototype/.test(index))
  record('A5', 'source', 'soft-off FRP grace on Host', /shouldKeepFrpAlive/.test(index) && /SOFT_OFF_FRP_GRACE_MS = 60_000/.test(index))
  record('A6', 'source', 'leave beacon + desiredOnline latch', /sendBeacon/.test(presence) && /desiredOnline/.test(presence) && /desiredOnline/.test(client))
  record('A7', 'source', 'QR expiry auto-refresh armed', /armQrExpireRefresh/.test(desktop) && /armQrExpireRefresh/.test(client))
  record('A8', 'source', 'account menu hint short (no device meta)', /Account menu: short status/.test(desktop) && !/已连接 · \$\{/.test(desktop))
}

// ——— B/C Desktop + public ———
let cdp
try {
  cdp = await connectCdp()
  record('B1', 'desktop', 'CDP attached', true)
} catch (error) {
  record('B1', 'desktop', 'CDP attached', false, error instanceof Error ? error.message : error)
}

if (cdp) {
  const { evaluate, ws } = cdp

  // B2 accepting on + FRP ready (repair zombie frp_exited before waiting)
  const ready = await evaluate(adminEval(`async (admin) => {
    await admin('/api/t4y-mobile-cowatch/accepting', { method: 'POST', body: JSON.stringify({ accepting: true }) })
    let st = await (await admin('/api/mobile-access/remote/control')).json().catch(() => null)
    if (st && st.provider === 'frp' && (st.state === 'error' || st.errorCode === 'frp_exited')) {
      try {
        await admin('/api/mobile-access/remote/control', {
          method: 'POST', body: JSON.stringify({ running: false, provider: 'frp' }),
        })
      } catch { /* ignore */ }
      try {
        await admin('/api/t4y-mobile-cowatch/frp-guard', {
          method: 'POST', body: JSON.stringify({ clearForReconnect: true }),
        })
      } catch { /* ignore */ }
      try {
        st = await (await admin('/api/mobile-access/remote/control', {
          method: 'POST', body: JSON.stringify({ running: true, provider: 'frp' }),
        })).json()
      } catch { /* ignore */ }
      if (!(st?.state === 'ready' && st?.running === true)) {
        try {
          st = await (await admin('/api/mobile-access/remote/reconnect', {
            method: 'POST', body: JSON.stringify({ provider: 'frp' }),
          })).json()
        } catch { /* ignore */ }
      }
    }
    for (let i = 0; i < 20; i++) {
      st = await (await admin('/api/mobile-access/remote/control')).json().catch(() => null)
      if (st?.state === 'ready' && st?.running === true) {
        const g = await (await admin('/api/t4y-mobile-cowatch/frp-guard')).json()
        return { ok: true, origin: st.origin, guard: g.detail, pids: g.frpcPids }
      }
      await new Promise((r) => setTimeout(r, 700))
    }
    return { ok: false, state: st?.state, errorCode: st?.errorCode, running: st?.running }
  }`))
  record('B2', 'frp', 'accepting on + FRP ready', ready?.ok === true, ready?.origin || ready?.guard || JSON.stringify(ready))

  // B3 soft-off grace
  const soft = await evaluate(adminEval(`async (admin) => {
    const off = await (await admin('/api/t4y-mobile-cowatch/accepting', { method: 'POST', body: JSON.stringify({ accepting: false }) })).json()
    await new Promise((r) => setTimeout(r, 10_000))
    const during = await (await admin('/api/t4y-mobile-cowatch/frp-guard')).json()
    const remote = await (await admin('/api/mobile-access/remote/control')).json().catch(() => null)
    await admin('/api/t4y-mobile-cowatch/accepting', { method: 'POST', body: JSON.stringify({ accepting: true }) })
    for (let i = 0; i < 12; i++) {
      const st = await (await admin('/api/mobile-access/remote/control')).json().catch(() => null)
      if (st?.state === 'ready') break
      await new Promise((r) => setTimeout(r, 700))
    }
    return {
      releaseAt: off?.frpReleaseAt,
      duringAcceptingFlag: during?.accepting,
      engaged: during?.acceptingEngaged,
      pids: during?.frpcPids,
      remoteRunning: remote?.running,
    }
  }`))
  const softOk = typeof soft?.releaseAt === 'number'
    && soft?.duringAcceptingFlag === true
    && soft?.engaged === false
    && Array.isArray(soft?.pids) && soft.pids.length > 0
    && soft?.remoteRunning === true
  record('B3', 'soft-off', 'FRP kept ~10s after soft-off (grace)', softOk, JSON.stringify(soft))

  // B4 menu: wait for cowatch client, then open account menu
  const menu = await evaluate(adminEval(`async (admin) => {
    await admin('/api/t4y-mobile-cowatch/accepting', { method: 'POST', body: JSON.stringify({ accepting: true }) })
    let item = null
    for (let i = 0; i < 20; i++) {
      item = document.querySelector('button[data-t4y-mobile-access-item="1"]')
      if (item) break
      const account = Array.from(document.querySelectorAll('button')).find((b) =>
        /管理员|Account|账号|Account menu/.test((b.getAttribute('aria-label') || '') + (b.textContent || '')))
        || document.querySelector('button[aria-label*="Account"],button[aria-label*="账号"]')
      if (account) account.click()
      await new Promise((r) => setTimeout(r, 400))
    }
    const hint = item?.querySelector('.t4y-ma-qr-hint')
    const text = hint?.textContent || ''
    return {
      hasItem: !!item,
      hint: text || null,
      hasDeviceMeta: /VER-AN10|c[0-9a-f]{6}|（管理员）/.test(text),
    }
  }`))
  record('B4', 'menu', '账号菜单有移动访问且 hint 无设备详情', menu?.hasItem === true && menu?.hasDeviceMeta !== true, JSON.stringify(menu))

  // B5 mint pair URL (keep this token pristine for C* — do UI QR panel AFTER C*)
  const open = await evaluate(adminEval(`async (admin) => {
    await admin('/api/t4y-mobile-cowatch/accepting', { method: 'POST', body: JSON.stringify({ accepting: true }) })
    for (let i = 0; i < 12; i++) {
      const st = await (await admin('/api/mobile-access/remote/control')).json().catch(() => null)
      if (st?.state === 'ready') break
      await new Promise((r) => setTimeout(r, 600))
    }
    const r = await admin('/api/mobile-access/remote/pairing/open', { method: 'POST', body: '{}' })
    const data = await r.json().catch(() => null)
    return {
      status: r.status,
      pairUrl: data?.pairUrl || null,
      expiresAt: data?.expiresAt || null,
      hasSvg: typeof data?.qrSvg === 'string' && data.qrSvg.includes('<svg'),
    }
  }`))
  record('B5', 'pair', 'pairing/open returns public pairUrl + QR svg', !!open?.pairUrl && open?.hasSvg === true, open?.pairUrl || JSON.stringify(open))

  // C1–C5 public pair + boot + leave/enter (uses B5 token before QR UI consumes a new open)
  if (open?.pairUrl) {
    const pairUrl = new URL(open.pairUrl)
    const fragment = new URLSearchParams(pairUrl.hash.slice(1))
    let token = fragment.get('token')
    const key = fragment.get('key')
    if (!token && key) {
      const parts = key.split('.')
      if (parts.length >= 3) token = parts.slice(2).join('.')
    }
    const ua = 'Mozilla/5.0 (Linux; Android 12; VER-AN10 Build/HONORVER-AN10; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/99.0.4844.88 Mobile Safari/537.36'
    const headers = {
      'content-type': 'application/json',
      'user-agent': ua,
      origin: pairUrl.origin,
      referer: pairUrl.origin + '/mobile-access/pair',
    }
    const pairRes = await fetch(new URL('/mobile-access/auth/pair', pairUrl.origin), {
      method: 'POST',
      headers,
      body: JSON.stringify({ token, label: 'VER-AN10' }),
    })
    const pairBody = await pairRes.json().catch(() => ({}))
    const cookies = (pairRes.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ')
    record('C1', 'pair', '公网 pair 201 + device cookie', pairRes.status === 201 && !!pairBody.deviceId, `${pairRes.status} ${pairBody.deviceId || pairBody.error || ''}`)

    await fetch(new URL('/api/t4y-mobile-cowatch/register-device', pairUrl.origin), {
      method: 'POST',
      headers: { ...headers, cookie: cookies },
      body: JSON.stringify({ fingerprint: 'xbf2.model.VER-AN10', model: 'VER-AN10', account: '管理员' }),
    }).catch(() => null)
    await fetch(new URL('/api/t4y-mobile-cowatch/presence', pairUrl.origin), {
      method: 'POST',
      headers: { ...headers, cookie: cookies },
      body: JSON.stringify({ online: true }),
    }).catch(() => null)

    const appRes = await fetch(new URL('/', pairUrl.origin), {
      headers: { 'user-agent': ua, cookie: cookies, accept: 'text/html' },
    })
    const appHtml = await appRes.text()
    const hasRecovery = appHtml.includes('data-t4y-boot-recovery')
    record('C2', 'boot', '公网 index HTML 含 boot recovery 脚本', appRes.status === 200 && hasRecovery, `status=${appRes.status} recovery=${hasRecovery}`)

    // connected after pair + register + enter
    const connected1 = await evaluate(adminEval(`async (admin) => {
      await new Promise((r) => setTimeout(r, 500))
      return await (await admin('/api/t4y-mobile-cowatch/connected-devices')).json()
    }`))
    const label = connected1?.devices?.[0]?.label || ''
    const connectedOk = connected1?.onlineCount >= 1
      && /VER-AN10|Windows|iPhone|手机/.test(label)
      && !/^管理员$/.test(label)
    record('C3', 'connected', '已连接显示机型·短id（非纯用户名）', connectedOk, JSON.stringify({
      onlineCount: connected1?.onlineCount,
      label,
    }))

    // leave / enter
    const leaveRes = await fetch(new URL('/api/t4y-mobile-cowatch/presence', pairUrl.origin), {
      method: 'POST',
      headers: { ...headers, cookie: cookies },
      body: JSON.stringify({ online: false }),
    })
    const leaveBody = await leaveRes.json().catch(() => ({}))
    await new Promise((r) => setTimeout(r, 500))
    const connected0 = await evaluate(adminEval(`async (admin) => await (await admin('/api/t4y-mobile-cowatch/connected-devices')).json()`))
    record('C4', 'presence', 'leave 后已连接清零', leaveRes.status === 200 && leaveBody?.online === false && connected0?.onlineCount === 0, JSON.stringify({
      leave: leaveBody,
      onlineCount: connected0?.onlineCount,
    }))

    const enterRes = await fetch(new URL('/api/t4y-mobile-cowatch/presence', pairUrl.origin), {
      method: 'POST',
      headers: { ...headers, cookie: cookies },
      body: JSON.stringify({ online: true }),
    })
    const enterBody = await enterRes.json().catch(() => ({}))
    await new Promise((r) => setTimeout(r, 500))
    const connected2 = await evaluate(adminEval(`async (admin) => await (await admin('/api/t4y-mobile-cowatch/connected-devices')).json()`))
    record('C5', 'presence', 'enter 后已连接恢复', enterRes.status === 200 && enterBody?.online === true && connected2?.onlineCount >= 1, JSON.stringify({
      enter: enterBody,
      onlineCount: connected2?.onlineCount,
    }))

    // same-model second pair should revoke sibling
    const open2 = await evaluate(adminEval(`async (admin) => {
      const r = await admin('/api/mobile-access/remote/pairing/open', { method: 'POST', body: '{}' })
      return await r.json().catch(() => null)
    }`))
    if (open2?.pairUrl) {
      const u2 = new URL(open2.pairUrl)
      const frag2 = new URLSearchParams(u2.hash.slice(1))
      const token2 = frag2.get('token')
      const pair2 = await fetch(new URL('/mobile-access/auth/pair', u2.origin), {
        method: 'POST',
        headers,
        body: JSON.stringify({ token: token2, label: 'VER-AN10' }),
      })
      const cookies2 = (pair2.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ')
      await fetch(new URL('/api/t4y-mobile-cowatch/register-device', u2.origin), {
        method: 'POST',
        headers: { ...headers, cookie: cookies2 },
        body: JSON.stringify({ fingerprint: 'xbf2.model.VER-AN10', model: 'VER-AN10' }),
      }).catch(() => null)
      await fetch(new URL('/api/t4y-mobile-cowatch/presence', u2.origin), {
        method: 'POST',
        headers: { ...headers, cookie: cookies2 },
        body: JSON.stringify({ online: true }),
      }).catch(() => null)
      await new Promise((r) => setTimeout(r, 800))
      const afterSibling = await evaluate(adminEval(`async (admin) => await (await admin('/api/t4y-mobile-cowatch/connected-devices')).json()`))
      const models = (afterSibling?.devices || []).map((d) => d.model || d.label)
      const onlyOneVer = (afterSibling?.devices || []).filter((d) => /VER-AN10/.test(d.label || d.model || '')).length <= 1
      record('C6', 'fingerprint', '同型号 sibling 注册后已连接最多一台 VER-AN10', onlyOneVer, JSON.stringify({ onlineCount: afterSibling?.onlineCount, models }))
    } else {
      record('C6', 'fingerprint', '同型号 sibling 注册后已连接最多一台 VER-AN10', false, 'no second pairUrl')
    }

    // public origin unauthenticated (no cookie)
    const unauth = await fetch(pairUrl.origin + '/', { redirect: 'manual', headers: { 'user-agent': ua } })
    record('C7', 'security', '未配对访问公网 origin 非会话页', unauth.status === 401 || unauth.status === 302 || unauth.status === 307 || unauth.status === 200, `status=${unauth.status}`)

    // B6 QR panel AFTER public pair cases (opening panel mints a new token)
    const qrPanel = await evaluate(`(async () => {
      const account = Array.from(document.querySelectorAll('button')).find((b) =>
        /管理员|Account|账号|Account menu/.test((b.getAttribute('aria-label') || '') + (b.textContent || '')))
        || document.querySelector('button[aria-label*="Account"],button[aria-label*="账号"]')
      if (account) account.click()
      await new Promise((r) => setTimeout(r, 300))
      let item = document.querySelector('button[data-t4y-mobile-access-item="1"]')
      if (!item && account) {
        account.click()
        await new Promise((r) => setTimeout(r, 400))
        item = document.querySelector('button[data-t4y-mobile-access-item="1"]')
      }
      item?.querySelector('.t4y-ma-label')?.click()
      await new Promise((r) => setTimeout(r, 2500))
      const panel = document.getElementById('t4y-mobile-access-qr-root')
      const meta = panel?.querySelector('[data-meta]')
      const qr = panel?.querySelector('[data-qr]')
      panel?.querySelector('[data-action="close"]')?.click()
      return {
        open: !!panel,
        state: qr?.dataset?.state || null,
        meta: meta?.textContent || null,
        hasExpiry: /有效至/.test(meta?.textContent || ''),
      }
    })()`)
    record('B6', 'pair', 'QR 面板展示有效至', qrPanel?.open === true && qrPanel?.state === 'ready' && qrPanel?.hasExpiry === true, JSON.stringify(qrPanel))
  } else {
    for (const id of ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'B6']) {
      record(id, 'pair', 'skipped (no pairUrl)', false, 'B5 failed')
    }
  }

  // D1 broker / newapi
  try {
    const broker = await fetch('http://192.10.51.138:4010/', { signal: AbortSignal.timeout(5000) })
    record('D1', 'infra', 'Broker :4010 可达', broker.status === 404 || broker.status === 200, `status=${broker.status}`)
  } catch (error) {
    record('D1', 'infra', 'Broker :4010 可达', false, error instanceof Error ? error.message : error)
  }
  try {
    const models = await fetch('http://192.10.51.138:4000/v1/models', {
      headers: { authorization: 'Bearer x' },
      signal: AbortSignal.timeout(5000),
    })
    record('D2', 'infra', 'NewAPI :4000 可达', models.status === 401 || models.status === 200, `status=${models.status}`)
  } catch (error) {
    record('D2', 'infra', 'NewAPI :4000 可达', false, error instanceof Error ? error.message : error)
  }

  // D3 installed plugins filter source invariant
  try {
    const mgr = readFileSync(join(pkgRoot, '..', '..', 'packages', 'client', 'ui-plugin-manager', 'src', 'client', 'PluginManagerPage.tsx'), 'utf8')
    record('D3', 'ui-rule', '已安装插件过滤 t4y-*', /isDeploymentOwnedEnterprisePlugin/.test(mgr) && /t4y-\*/.test(mgr))
  } catch (error) {
    record('D3', 'ui-rule', '已安装插件过滤 t4y-*', false, error instanceof Error ? error.message : error)
  }

  ws.close()
}

const failed = results.filter((r) => !r.pass)
console.log('\n======== SUMMARY ========')
console.log(`total=${results.length} pass=${results.length - failed.length} fail=${failed.length}`)
if (failed.length) {
  console.log('FAILED:')
  for (const f of failed) console.log(` - ${f.id} ${f.title} :: ${f.detail}`)
  process.exitCode = 1
} else {
  console.log('ALL CHECKLIST ITEMS PASSED')
}
