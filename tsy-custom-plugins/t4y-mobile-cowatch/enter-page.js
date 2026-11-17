/**
 * Unauthenticated mobile enter page (FRP public origin).
 * Login → pick a same-account PC → pair into that origin.
 * Soft-off serves {@link enterpriseOfflinePage}.
 * @returns {string}
 */
export function enterpriseEnterPage() {
  return `<!doctype html>
<html lang="zh">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>登录进入电脑</title>
<style>
  body{font-family:system-ui,-apple-system,sans-serif;margin:0;min-height:100vh;display:grid;place-items:center;background:#f3f4f6;color:#111827}
  main{width:min(22rem,92vw);padding:1.5rem;background:#fff;border-radius:12px;box-shadow:0 1px 2px rgba(0,0,0,.06)}
  h1{font-size:1.15rem;margin:0 0 .35rem}
  .sub{margin:0 0 1rem;color:#6b7280;font-size:.9rem;line-height:1.45}
  label{display:block;margin:0 0 .35rem;font-size:.85rem;color:#374151}
  input{width:100%;box-sizing:border-box;margin:0 0 .85rem;padding:.65rem .75rem;border:1px solid #d1d5db;border-radius:8px;font-size:1rem}
  button{width:100%;padding:.7rem 1rem;border:0;border-radius:8px;background:#0f1115;color:#fff;font-size:1rem;font-weight:600}
  button:disabled{opacity:.55}
  button.secondary{background:#fff;color:#111827;border:1px solid #d1d5db;margin-top:.5rem}
  #status{margin:.85rem 0 0;min-height:1.35em;color:#b91c1c;font-size:.9rem;line-height:1.4}
  #status[data-kind="info"]{color:#4b5563}
  #hosts{display:block;margin:0;padding:0;list-style:none}
  #hosts button.host{text-align:left;background:#fff;color:#111827;border:1px solid #e5e7eb;margin:0 0 .5rem;font-weight:500}
  #hosts button.host.is-ready{border-color:#86efac;background:#f0fdf4}
  #hosts button.host.is-current{border-color:#93c5fd;background:#eff6ff;box-shadow:inset 0 0 0 1px #93c5fd}
  #hosts button.host.is-off{border-color:#fcd34d;background:#fffbeb}
  #hosts button.host.is-offline{border-color:#e5e7eb;background:#f9fafb;opacity:.85}
  #hosts button.host:disabled{cursor:not-allowed}
  #hosts .meta{display:block;margin-top:.25rem;color:#6b7280;font-size:.8rem;font-weight:400}
  #hosts .badge{display:inline-block;margin-left:.35rem;padding:.1rem .4rem;border-radius:999px;font-size:.7rem;font-weight:600;vertical-align:middle}
  #hosts .badge.ready{background:#dcfce7;color:#166534}
  #hosts .badge.current{background:#dbeafe;color:#1d4ed8}
  #hosts .badge.off{background:#fef3c7;color:#b45309}
  #hosts .badge.offline{background:#f3f4f6;color:#6b7280}
  .pick-hint{margin:0 0 .75rem;padding:.65rem .75rem;border-radius:8px;background:#eff6ff;color:#1e3a8a;font-size:.85rem;line-height:1.4}
</style>
<main>
  <section id="loginSection">
    <h1>登录进入电脑</h1>
    <p class="sub">使用与电脑端相同的企业账号。登录后请先选择要进入的电脑。</p>
    <form id="form" autocomplete="on">
      <label for="enterpriseName">企业名</label>
      <input id="enterpriseName" name="enterpriseName" autocomplete="organization" required>
      <label for="userName">账号</label>
      <input id="userName" name="userName" autocomplete="username" required>
      <label for="password">密码</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required>
      <button id="submit" type="submit">登录</button>
    </form>
  </section>
  <section id="selectSection" hidden>
    <h1>选择电脑</h1>
    <p class="pick-hint">请点选一台电脑后再进入。列表仅含本账号已登录、且开启了移动访问的电脑。</p>
    <p class="sub">可同时有多台手机连接；进入后也可在账号菜单中切换电脑。</p>
    <ul id="hosts" aria-label="可选电脑"></ul>
    <button id="refreshHosts" class="secondary" type="button">刷新列表</button>
    <button id="backLogin" class="secondary" type="button">返回登录</button>
  </section>
  <p id="status" role="status" aria-live="polite"></p>
</main>
<script>
(() => {
  const form = document.getElementById('form')
  const status = document.getElementById('status')
  const submit = document.getElementById('submit')
  const loginSection = document.getElementById('loginSection')
  const selectSection = document.getElementById('selectSection')
  const hostsEl = document.getElementById('hosts')
  const refreshHosts = document.getElementById('refreshHosts')
  const backLogin = document.getElementById('backLogin')
  const HOST_READY_KEY = 't4y.mobile.hostReady.v1'
  const ENTERED_KEY = 't4y.mobile.cowatch.entered.v1'
  const REMEMBER_KEY = 't4y.mobile.hosts.v1'
  const RESUME_KEY = 't4y.mobile.enter.resume.v1'
  const SWITCH_AUTH_KEY = 't4y.mobile.switchAuth.v1'
  const CURRENT_HOST_KEY = 't4y.mobile.currentHost.v1'
  const IDENTITY_SESSION_KEY = 't4y.identity.session.v1'
  const IDENTITY_FRESH_KEY = 't4y.identity.fresh-auth.v1'
  const COWATCH_FLAG = 't4y.mobile.cowatch'

  /** @type {null | { accessToken: string, expiresAt: number, accountKey: string, enterpriseName: string, userName: string, hosts: any[] }} */
  let auth = null

  function setStatus(message, kind) {
    status.textContent = message || ''
    if (kind) status.dataset.kind = kind
    else status.removeAttribute('data-kind')
  }

  function readRemembered() {
    try {
      const raw = localStorage.getItem(REMEMBER_KEY)
      const parsed = raw ? JSON.parse(raw) : []
      return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.origin === 'string') : []
    } catch { return [] }
  }

  function writeRemembered(hosts) {
    try {
      const map = new Map()
      for (const host of hosts) {
        if (!host || typeof host.origin !== 'string' || typeof host.id !== 'string') continue
        map.set(host.id, {
          id: host.id,
          label: host.label || host.origin,
          origin: host.origin.replace(/\\/$/u, ''),
          accountKey: host.accountKey || '',
          lastSeenAt: Date.now(),
        })
      }
      const merged = [...map.values()].sort((a, b) => (b.lastSeenAt || 0) - (a.lastSeenAt || 0)).slice(0, 24)
      localStorage.setItem(REMEMBER_KEY, JSON.stringify(merged))
    } catch { /* ignore */ }
  }

  function showSelect() {
    loginSection.hidden = true
    selectSection.hidden = false
    hostsEl.style.display = 'block'
  }

  function showLogin() {
    selectSection.hidden = true
    loginSection.hidden = false
    auth = null
  }

  async function probeHost(origin, accountKey) {
    try {
      const response = await fetch(origin.replace(/\\/$/u, '') + '/api/t4y-mobile-enter/host-card', {
        credentials: 'omit',
        cache: 'no-store',
        mode: 'cors',
        signal: AbortSignal.timeout(4_000),
      })
      if (!response.ok) return null
      const card = await response.json()
      if (!card || card.accountKey !== accountKey) return null
      return {
        id: card.id,
        label: card.label || origin,
        origin: (card.origin || origin).replace(/\\/$/u, ''),
        accountKey: card.accountKey,
        accepting: card.accepting === true,
        online: true,
      }
    } catch {
      return null
    }
  }

  async function collectHosts() {
    if (!auth) return []
    const byId = new Map()
    for (const host of auth.hosts || []) {
      if (host?.id) byId.set(host.id, { ...host, online: true })
    }
    const remembered = readRemembered().filter((item) => !item.accountKey || item.accountKey === auth.accountKey)
    await Promise.all(remembered.map(async (item) => {
      if ([...byId.values()].some((host) => host.origin === item.origin)) return
      const probed = await probeHost(item.origin, auth.accountKey)
      if (probed) byId.set(probed.id, probed)
      else byId.set(item.id || item.origin, {
        id: item.id || item.origin,
        label: item.label || item.origin,
        origin: item.origin,
        accountKey: auth.accountKey,
        accepting: false,
        online: false,
      })
    }))
    return [...byId.values()]
  }

  function renderHosts(hosts) {
    hostsEl.innerHTML = ''
    const usable = hosts.filter((host) => host.online && host.accepting)
    if (usable.length === 0) {
      setStatus('暂无可用电脑。请在目标电脑登录同一账号并开启「移动访问」。', 'info')
    } else {
      setStatus('请点选一台电脑进入（共 ' + usable.length + ' 台可用）', 'info')
    }
    let currentOrigin = ''
    try {
      const raw = localStorage.getItem(CURRENT_HOST_KEY)
      const parsed = raw ? JSON.parse(raw) : null
      currentOrigin = parsed && typeof parsed.origin === 'string' ? parsed.origin.replace(/\\/$/u, '') : ''
    } catch { currentOrigin = '' }
    for (const host of hosts) {
      const li = document.createElement('li')
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'host'
      const origin = String(host.origin || '').replace(/\\/$/u, '')
      const isCurrent = currentOrigin && origin === currentOrigin
      const canEnter = host.online === true && host.accepting === true
      button.disabled = !canEnter
      let badge
      if (isCurrent) {
        button.classList.add('is-current')
        badge = '<span class="badge current">当前</span>'
      } else if (canEnter) {
        button.classList.add('is-ready')
        badge = '<span class="badge ready">可进入</span>'
      } else if (host.online) {
        button.classList.add('is-off')
        badge = '<span class="badge off">未开启移动访问</span>'
      } else {
        button.classList.add('is-offline')
        badge = '<span class="badge offline">不在线</span>'
      }
      button.innerHTML = '<span>' + escapeHtml(host.label || host.origin) + badge
        + '</span><span class="meta">' + escapeHtml(host.origin) + '</span>'
      button.addEventListener('click', () => { void enterHost(host) })
      li.appendChild(button)
      hostsEl.appendChild(li)
    }
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  async function refreshHostList() {
    setStatus('正在查找电脑…', 'info')
    const hosts = await collectHosts()
    renderHosts(hosts)
  }

  async function pairWithResult(data) {
    const token = typeof data.pairToken === 'string' ? data.pairToken.trim() : ''
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
      setStatus('进入失败，请稍后重试')
      return
    }
    setStatus('正在进入…', 'info')
    const pair = await fetch('/mobile-access/auth/pair', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, label: '手机' }),
    })
    if (!pair.ok) {
      setStatus(pair.status === 409 ? '设备数量已满，请在电脑端清理后再试' : '进入失败，请重新登录')
      return
    }
    try {
      const readySession = data.hostReady && typeof data.hostReady === 'object'
        ? data.hostReady.session
        : null
      const modelKeyPresent = data.hostReady && data.hostReady.modelKeyPresent === true
      if (data.hostReady && typeof data.hostReady === 'object') {
        sessionStorage.setItem(HOST_READY_KEY, JSON.stringify({
          at: Date.now(),
          session: readySession ?? null,
          modelKeyPresent,
        }))
      }
      sessionStorage.setItem(ENTERED_KEY, '1')
      sessionStorage.setItem(COWATCH_FLAG, '1')
      // Seed identity before / loads so the second login gate never paints.
      if (readySession && typeof readySession === 'object') {
        const seeded = { ...readySession, accessToken: 'mobile-cowatch', needsModulePick: false }
        if (typeof seeded.tenantId !== 'string' || seeded.tenantId === '') seeded.tenantId = 'mobile'
        if (typeof seeded.expiresAt !== 'number' || seeded.expiresAt <= Date.now()) {
          seeded.expiresAt = Date.now() + 8 * 3600_000
        }
        if (modelKeyPresent && (typeof seeded.llmApiKeyExpiresAt !== 'number' || seeded.llmApiKeyExpiresAt <= Date.now())) {
          seeded.llmApiKeyExpiresAt = Date.now() + 8 * 3600_000
        }
        if (!modelKeyPresent) delete seeded.llmApiKeyExpiresAt
        localStorage.setItem(IDENTITY_SESSION_KEY, JSON.stringify(seeded))
        localStorage.setItem(IDENTITY_FRESH_KEY, String(Date.now() + 120_000))
      }
      if (auth) {
        const switchAuth = {
          accessToken: auth.accessToken,
          enterpriseName: auth.enterpriseName,
          userName: auth.userName,
          accountKey: auth.accountKey,
          expiresAt: auth.expiresAt,
          at: Date.now(),
        }
        sessionStorage.setItem(SWITCH_AUTH_KEY, JSON.stringify(switchAuth))
        localStorage.setItem(SWITCH_AUTH_KEY, JSON.stringify(switchAuth))
      }
      if (data._selectedHost) {
        localStorage.setItem(CURRENT_HOST_KEY, JSON.stringify(data._selectedHost))
      }
    } catch { /* ignore */ }
    location.replace(typeof data.redirect === 'string' && data.redirect.startsWith('/') ? data.redirect : '/')
  }

  async function enterHost(host) {
    if (!auth || !host) return
    const origin = String(host.origin || '').replace(/\\/$/u, '')
    const here = location.origin.replace(/\\/$/u, '')
    writeRemembered([...(auth.hosts || []), host, ...readRemembered()])
    if (origin && origin !== here) {
      try {
        sessionStorage.setItem(RESUME_KEY, JSON.stringify({
          accessToken: auth.accessToken,
          enterpriseName: auth.enterpriseName,
          userName: auth.userName,
          accountKey: auth.accountKey,
          expiresAt: auth.expiresAt,
          at: Date.now(),
        }))
      } catch { /* ignore */ }
      // Cross-origin: hand off via fragment (not sent to server logs as path).
      const payload = btoa(unescape(encodeURIComponent(JSON.stringify({
        accessToken: auth.accessToken,
        enterpriseName: auth.enterpriseName,
        userName: auth.userName,
        accountKey: auth.accountKey,
        expiresAt: auth.expiresAt,
      }))))
      location.assign(origin + '/t4y-mobile-enter#resume=' + encodeURIComponent(payload))
      return
    }
    setStatus('正在连接电脑…', 'info')
    try {
      const response = await fetch('/api/t4y-mobile-enter/select', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          accessToken: auth.accessToken,
          enterpriseName: auth.enterpriseName,
          userName: auth.userName,
        }),
      })
      let data = null
      try { data = await response.json() } catch { data = null }
      if (!response.ok || !data || data.ok !== true) {
        const code = data && data.error
        setStatus(
          code === 'remote_off' ? '该电脑未开启移动访问'
            : code === 'host_not_ready' ? '请先在该电脑用同一账号登录'
              : code === 'auth_failed' ? '登录已失效，请重新登录'
                : code === 'rate_limited' ? '尝试过多，请稍后再试'
                  : '进入失败，请重试',
        )
        if (code === 'remote_off') location.replace('/t4y-mobile-enter')
        return
      }
      data._selectedHost = {
        id: host.id,
        label: host.label,
        origin: origin || here,
        accountKey: auth.accountKey,
      }
      await pairWithResult(data)
    } catch {
      setStatus('网络异常，请重试')
    }
  }

  async function resumeFromHandoff() {
    let payload = null
    let forceSelect = false
    try {
      const hash = location.hash || ''
      if (/(?:^|[&#])switch=1(?:&|$)/.test(hash)) forceSelect = true
      const match = hash.match(/resume=([^&]+)/)
      if (match) {
        payload = JSON.parse(decodeURIComponent(escape(atob(decodeURIComponent(match[1])))))
      }
      if (hash) history.replaceState(null, '', location.pathname + location.search)
    } catch { payload = null }
    if (!payload) {
      try {
        const raw = sessionStorage.getItem(RESUME_KEY)
        if (raw) {
          payload = JSON.parse(raw)
          sessionStorage.removeItem(RESUME_KEY)
        }
      } catch { payload = null }
    }
    if (!payload) {
      try {
        const raw = sessionStorage.getItem(SWITCH_AUTH_KEY) || localStorage.getItem(SWITCH_AUTH_KEY)
        if (raw && forceSelect) payload = JSON.parse(raw)
      } catch { payload = null }
    }
    if (!payload || typeof payload.accessToken !== 'string') return false
    if (typeof payload.expiresAt === 'number' && payload.expiresAt <= Date.now()) {
      setStatus('登录已过期，请重新登录')
      return true
    }
    auth = {
      accessToken: payload.accessToken,
      expiresAt: payload.expiresAt || (Date.now() + 3600_000),
      accountKey: payload.accountKey || '',
      enterpriseName: payload.enterpriseName || '',
      userName: payload.userName || '',
      hosts: [],
    }
    showSelect()
    // Switching devices or explicit preferSelect: always show the picker.
    if (forceSelect || payload.preferSelect === true) {
      await refreshHostList()
      return true
    }
    // Cross-origin handoff after user already chose that machine: connect directly.
    setStatus('正在连接电脑…', 'info')
    await enterHost({
      id: 'current',
      label: '当前电脑',
      origin: location.origin,
      accountKey: auth.accountKey,
      accepting: true,
      online: true,
    })
    return true
  }

  async function postEnterLogin(enterpriseName, userName, password) {
    let lastFail = null
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await fetch('/api/t4y-mobile-enter/login', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ enterpriseName, userName, password }),
        })
        let data = null
        try { data = await response.json() } catch { data = null }
        if (response.ok && data && data.ok === true) return { ok: true, data }
        const code = data && data.error
        // 业务错误不重试
        if (code === 'auth_failed' || code === 'rate_limited' || code === 'remote_off' || code === 'invalid_request') {
          return { ok: false, response, data }
        }
        lastFail = { ok: false, response, data }
      } catch (error) {
        lastFail = { ok: false, error }
      }
      if (attempt < 2) {
        setStatus('网络不稳定，正在重试（' + (attempt + 2) + '/3）…', 'info')
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)))
      }
    }
    return lastFail || { ok: false }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (submit.disabled) return
    submit.disabled = true
    setStatus('正在登录…', 'info')
    const enterpriseName = document.getElementById('enterpriseName').value.trim()
    const userName = document.getElementById('userName').value.trim()
    const password = document.getElementById('password').value
    try {
      const result = await postEnterLogin(enterpriseName, userName, password)
      if (!result.ok || !result.data) {
        const data = result.data
        const code = data && data.error
        if (code === 'remote_off') {
          location.replace('/t4y-mobile-enter')
          return
        }
        if (result.error && !data) {
          setStatus('网络异常，请重试')
          return
        }
        setStatus(
          code === 'auth_failed' ? '账号或密码错误'
            : code === 'rate_limited' ? '尝试过多，请稍后再试'
              : code === 'pair_failed' ? '登录失败，请稍后重试'
                : (data && data.message) || '登录失败，请重试',
        )
        return
      }
      const data = result.data
      auth = {
        accessToken: data.accessToken,
        expiresAt: data.expiresAt,
        accountKey: data.accountKey,
        enterpriseName: data.enterpriseName || enterpriseName,
        userName: data.userName || userName,
        hosts: Array.isArray(data.hosts) ? data.hosts : [],
      }
      writeRemembered([...(auth.hosts || []), ...readRemembered()])
      showSelect()
      await refreshHostList()
    } catch {
      setStatus('网络异常，请重试')
    } finally {
      submit.disabled = false
    }
  })

  refreshHosts.addEventListener('click', () => { void refreshHostList() })
  backLogin.addEventListener('click', () => {
    showLogin()
    setStatus('')
  })

  void resumeFromHandoff()
})()
</script>
</html>`
}

/**
 * Soft-off public status page: tunnel stays up, entry is refused until PC switch is on.
 * @returns {string}
 */
export function enterpriseOfflinePage() {
  return `<!doctype html>
<html lang="zh">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>电脑不在线</title>
<style>
  body{font-family:system-ui,-apple-system,sans-serif;margin:0;min-height:100vh;display:grid;place-items:center;background:#f3f4f6;color:#111827}
  main{width:min(22rem,92vw);padding:1.5rem;background:#fff;border-radius:12px;box-shadow:0 1px 2px rgba(0,0,0,.06);text-align:center}
  h1{font-size:1.15rem;margin:0 0 .5rem}
  .sub{margin:0 0 1.25rem;color:#6b7280;font-size:.9rem;line-height:1.5}
  button{width:100%;padding:.7rem 1rem;border:0;border-radius:8px;background:#0f1115;color:#fff;font-size:1rem;font-weight:600}
  button:disabled{opacity:.55}
  #hint{margin:0.85rem 0 0;min-height:1.25em;color:#6b7280;font-size:.85rem}
</style>
<main>
  <h1>电脑不在线</h1>
  <p class="sub">当前没有可连接的电脑，或电脑端未开启「移动访问」。请在电脑登录后打开账号菜单中的移动访问开关，再重试。</p>
  <button id="retry" type="button">重新检测</button>
  <p id="hint" role="status" aria-live="polite"></p>
</main>
<script>
(() => {
  const retry = document.getElementById('retry')
  const hint = document.getElementById('hint')
  let busy = false

  async function checkOnce(manual) {
    if (busy) return
    busy = true
    if (manual) hint.textContent = '正在检测…'
    retry.disabled = true
    try {
      const response = await fetch('/api/t4y-mobile-enter/status', {
        credentials: 'same-origin',
        cache: 'no-store',
      })
      let data = null
      try { data = await response.json() } catch { data = null }
      if (data && data.accepting === true) {
        hint.textContent = '电脑已上线，正在进入登录…'
        location.replace('/t4y-mobile-enter')
        return
      }
      hint.textContent = manual ? '仍未上线，请确认电脑已开启移动访问' : ''
    } catch {
      hint.textContent = manual ? '网络异常，请稍后重试' : ''
    } finally {
      busy = false
      retry.disabled = false
    }
  }

  retry.addEventListener('click', () => { void checkOnce(true) })
  window.setInterval(() => { void checkOnce(false) }, 5_000)
})()
</script>
</html>`
}
