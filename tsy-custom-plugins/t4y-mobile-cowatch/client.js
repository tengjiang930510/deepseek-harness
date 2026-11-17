/**
 * GENERATED FILE — edit client-src/*.js then run:
 *   node scripts/bundle-client.mjs
 *
 * Mobile co-watch client: treat the phone as a remote control of the PC Host.
 * Desktop browsers must stay inert — no wait gate, no fetch hooks, no layout rewrite.
 */
window.__ModuleLoader__.load({
  id: 't4y-mobile-cowatch/client',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')

    // --- client-src/shared.js ---
    const SESSION_KEY = 't4y.identity.session.v1'
    const SESSION_EVENT = 't4y-identity:session'
    const STYLE_ID = 't4y-mobile-cowatch-style'
    const FLAG = 't4y.mobile.cowatch'
    const HOST_READY_KEY = 't4y.mobile.hostReady.v1'
    /** Sticky: phone already entered the app once this tab — do not re-open WaitGate on FRP blips. */
    const ENTERED_KEY = 't4y.mobile.cowatch.entered.v1'
    /** Success / warm cache lifetime. */
    const HOST_READY_TTL_MS = 60_000
    /** Negative / 401 cache — stop retry storms while PC is offline or unpaired. */
    const HOST_READY_MISS_TTL_MS = 8_000
    const POLL_MS_BASE = 2_500
    const POLL_MS_MAX = 20_000
    const FETCH_TIMEOUT_MS = 5_000
    /** No tap/input for this long → drop live sockets; device cookie kept for 免登续连. */
    const IDLE_DISCONNECT_MS = 15 * 60 * 1000
    const IDLE_GATE_ID = 't4y-mobile-cowatch-idle'

    /**
     * Older mobile WebViews may lack AbortSignal.timeout.
     * @param {number} ms
     * @returns {AbortSignal}
     */
    function timeoutSignal(ms) {
      if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
        return AbortSignal.timeout(ms)
      }
      const controller = new AbortController()
      window.setTimeout(() => controller.abort(), ms)
      return controller.signal
    }

    const copy = {
      zh: {
        titleChecking: '正在连接',
        titleLogin: '请先在电脑完成登录',
        titleKey: '电脑尚未就绪',
        titleEntering: '正在进入',
        body: '请在电脑端登录并选择项目，完成后将自动进入。',
        checking: '正在连接…',
        waitingLogin: '等待电脑端登录…',
        waitingKey: '等待电脑端就绪…',
        entering: '正在进入…',
        idleTitle: '已闲置断开',
        idleBody: '超过 15 分钟无点按或输入，已断开实时连接以释放通道。点按下方继续，无需重新登录。',
        idleContinue: '继续使用',
        switchDevice: '切换电脑',
        switchTitle: '切换电脑',
        switchBody: '选择要进入的电脑。仅显示本账号已登录且开启移动访问的电脑。',
        switchRefresh: '刷新',
        switchClose: '取消',
        switchEmpty: '暂无其它可用电脑',
        switchCurrent: '当前',
        switchEnter: '进入',
        switchOffline: '不在线',
        switchOff: '未开启',
        switchNeedLogin: '登录已失效，请重新登录后再切换',
      },
      en: {
        titleChecking: 'Connecting',
        titleLogin: 'Sign in on the computer first',
        titleKey: 'Computer not ready',
        titleEntering: 'Entering',
        body: 'Sign in on the computer and choose a project. This page continues automatically.',
        checking: 'Connecting…',
        waitingLogin: 'Waiting for computer sign-in…',
        waitingKey: 'Waiting for the computer…',
        entering: 'Entering…',
        idleTitle: 'Disconnected after idle',
        idleBody: 'No tap or typing for 15 minutes. The live link was closed to free the channel. Continue without signing in again.',
        idleContinue: 'Continue',
        switchDevice: 'Switch computer',
        switchTitle: 'Switch computer',
        switchBody: 'Pick a computer signed in with this account and with mobile access on.',
        switchRefresh: 'Refresh',
        switchClose: 'Cancel',
        switchEmpty: 'No other computers available',
        switchCurrent: 'Current',
        switchEnter: 'Enter',
        switchOffline: 'Offline',
        switchOff: 'Access off',
        switchNeedLogin: 'Session expired. Sign in again to switch.',
      },
    }

    /** @returns {boolean} */
    function isMobileUa() {
      try {
        if (navigator.userAgentData && navigator.userAgentData.mobile === true) return true
      } catch { /* ignore */ }
      const ua = typeof navigator !== 'undefined' ? (navigator.userAgent || '') : ''
      if (/Android|iPhone|iPad|iPod|Mobile|HarmonyOS|MicroMessenger|OpenHarmony/i.test(ua)) return true
      try {
        if (typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 1
          && window.matchMedia('(pointer: coarse)').matches) return true
      } catch { /* ignore */ }
      return false
    }

    /**
     * Enter / pair markers survive「请求桌面网站」等桌面 UA；不得仅因 UA 清掉。
     * @returns {boolean}
     */
    function hasMobileEnterSession() {
      try {
        if (sessionStorage.getItem(ENTERED_KEY) === '1') return true
        if (sessionStorage.getItem(FLAG) === '1') return true
        if (sessionStorage.getItem(HOST_READY_KEY)) return true
        if (localStorage.getItem('t4y.mobile.switchAuth.v1')) return true
        const raw = localStorage.getItem(SESSION_KEY)
        if (raw) {
          const session = JSON.parse(raw)
          if (session && session.accessToken === 'mobile-cowatch') return true
        }
      } catch { /* ignore */ }
      return false
    }

    /**
     * Phone / enter-flow only. PC Web shell (「移动访问」) stays inert unless this
     * tab actually came through mobile enter / pair.
     * @returns {boolean}
     */
    function detectMobileCowatch() {
      try {
        const params = new URLSearchParams(window.location.search)
        if (params.get('t4yMobile') === '0') {
          sessionStorage.removeItem(FLAG)
          sessionStorage.removeItem(ENTERED_KEY)
          return false
        }
        if (params.get('t4yMobile') === '1') {
          sessionStorage.setItem(FLAG, '1')
          return true
        }
        // Enter/pair first: 部分手机浏览器用桌面 UA，不能清掉会话标记。
        if (hasMobileEnterSession()) {
          sessionStorage.setItem(FLAG, '1')
          return true
        }
        if (isMobileUa()) {
          sessionStorage.setItem(FLAG, '1')
          return true
        }
        // True desktop: drop leftover lab flag only when no enter session.
        sessionStorage.removeItem(FLAG)
      } catch { /* ignore */ }
      return false
    }

    const active = detectMobileCowatch()
    /** Bound before any wrap so phone guards never recurse. */
    const rawFetch = window.fetch.bind(window)

    /**
     * 企业移动访问固定中文，避免浏览器/系统语言为 en 时 FAB、切换弹层出现英文。
     * @returns {'zh' | 'en'}
     */
    function lang() {
      return 'zh'
    }

    /** @param {keyof typeof copy.zh} key */
    function t(key) {
      return copy[lang()][key] || copy.zh[key] || key
    }

    /** @returns {object | null} */
    function readSession() {
      try {
        const raw = localStorage.getItem(SESSION_KEY)
        if (!raw) return null
        const session = JSON.parse(raw)
        if (!session || typeof session !== 'object') return null
        if (typeof session.expiresAt === 'number' && session.expiresAt <= Date.now()) return null
        return session
      } catch {
        return null
      }
    }

    /**
     * @param {object | null} session
     */
    function writeLocalSession(session) {
      if (session === null) localStorage.removeItem(SESSION_KEY)
      else localStorage.setItem(SESSION_KEY, JSON.stringify(session))
      window.dispatchEvent(new CustomEvent(SESSION_EVENT, { detail: { session } }))
    }

    /**
     * @param {RequestInfo | URL} input
     * @returns {string}
     */
    function requestUrl(input) {
      if (typeof input === 'string') return input
      if (input instanceof URL) return input.href
      if (input && typeof input === 'object' && 'url' in input) return String(input.url)
      return ''
    }

    /** @type {{ session: object | null, modelKeyPresent: boolean, at: number } | null} */
    let hostReadyMemory = null
    /** @type {Promise<{ session: object | null, modelKeyPresent: boolean }> | null} */
    let hostReadyInflight = null

    /**
     * @param {unknown} session
     * @returns {object | null}
     */
    function usableHostSession(session) {
      if (!session || typeof session !== 'object') return null
      const value = /** @type {Record<string, unknown>} */ (session)
      if (typeof value.accessToken !== 'string' || value.accessToken === '') return null
      if (typeof value.expiresAt !== 'number' || value.expiresAt <= Date.now()) return null
      if (value.needsModulePick === true) return null
      if (typeof value.moduleId !== 'string' || value.moduleId === '') return null
      return value
    }

    /**
     * @param {object | null} session
     * @param {boolean} modelKeyPresent
     * @returns {{ session: object | null, modelKeyPresent: boolean }}
     */
    function normalizeHostReady(session, modelKeyPresent) {
      const usable = usableHostSession(session)
      const publicSession = usable
        ? { ...usable, accessToken: 'mobile-cowatch', needsModulePick: false }
        : null
      const keyPresent = modelKeyPresent === true
        || (typeof publicSession?.llmApiKeyExpiresAt === 'number' && publicSession.llmApiKeyExpiresAt > Date.now())
      return { session: publicSession, modelKeyPresent: Boolean(publicSession) && keyPresent }
    }

    /**
     * Prefer pair-page prefetch / recent memory to avoid FRP round-trips on cold boot.
     * @param {{ allowMiss?: boolean }} [options]
     */
    function readStashedHostReady(options = {}) {
      const allowMiss = options.allowMiss === true
      if (hostReadyMemory) {
        const ready = normalizeHostReady(hostReadyMemory.session, hostReadyMemory.modelKeyPresent)
        const ttl = (ready.session && ready.modelKeyPresent) ? HOST_READY_TTL_MS : HOST_READY_MISS_TTL_MS
        if (Date.now() - hostReadyMemory.at < ttl) {
          if (ready.session && ready.modelKeyPresent) return ready
          if (allowMiss) return ready
        }
      }
      try {
        const raw = sessionStorage.getItem(HOST_READY_KEY)
        if (!raw) return null
        const parsed = JSON.parse(raw)
        if (!parsed || typeof parsed.at !== 'number') {
          sessionStorage.removeItem(HOST_READY_KEY)
          return null
        }
        const ready = normalizeHostReady(parsed.session, parsed.modelKeyPresent === true)
        const ttl = (ready.session && ready.modelKeyPresent) ? HOST_READY_TTL_MS : HOST_READY_MISS_TTL_MS
        if (Date.now() - parsed.at > ttl) {
          sessionStorage.removeItem(HOST_READY_KEY)
          hostReadyMemory = null
          return null
        }
        hostReadyMemory = { ...ready, at: parsed.at }
        if (ready.session && ready.modelKeyPresent) return ready
        if (allowMiss) return ready
        return null
      } catch {
        return null
      }
    }

    /**
     * @param {{ session: object | null, modelKeyPresent: boolean }} ready
     */
    function writeStashedHostReady(ready) {
      hostReadyMemory = { ...ready, at: Date.now() }
      try {
        sessionStorage.setItem(HOST_READY_KEY, JSON.stringify({
          at: hostReadyMemory.at,
          session: ready.session,
          modelKeyPresent: ready.modelKeyPresent,
        }))
      } catch { /* ignore quota */ }
    }

    /** @returns {boolean} */
    function readEntered() {
      try {
        return sessionStorage.getItem(ENTERED_KEY) === '1'
      } catch {
        return false
      }
    }

    /** @param {boolean} value */
    function writeEntered(value) {
      try {
        if (value) sessionStorage.setItem(ENTERED_KEY, '1')
        else sessionStorage.removeItem(ENTERED_KEY)
      } catch { /* ignore */ }
    }

    /**
     * Last known good PC-ready snapshot (success only). Used when FRP blips.
     * @returns {{ session: object | null, modelKeyPresent: boolean } | null}
     */
    function readLastGoodHostReady() {
      const warm = readStashedHostReady()
      if (warm?.session && warm.modelKeyPresent) return warm
      return null
    }

    /**
     * Pull Desktop-shared session + whether Host already holds T4Y_NEW_API_KEY.
     * Single-flight + miss cache. Transport / non-OK answers must not wipe a good stash
     * (that caused false「电脑尚未就绪」over FRP jitter).
     * @param {{ force?: boolean }} [options]
     * @returns {Promise<{ session: object | null, modelKeyPresent: boolean, reached: boolean }>}
     */
    async function pullHostReady(options = {}) {
      if (!options.force) {
        const warm = readStashedHostReady()
        if (warm?.session && warm.modelKeyPresent) {
          return { ...warm, reached: true }
        }
        const miss = readStashedHostReady({ allowMiss: true })
        if (miss && !miss.session) {
          return { ...miss, reached: true }
        }
      }
      if (hostReadyInflight) return hostReadyInflight
      hostReadyInflight = (async () => {
        try {
          const response = await rawFetch('/api/t4y-identity/host-session', {
            method: 'GET',
            credentials: 'same-origin',
            signal: timeoutSignal(FETCH_TIMEOUT_MS),
          })
          if (!response.ok) {
            const lastGood = readLastGoodHostReady()
            if (lastGood) return { ...lastGood, reached: false }
            const empty = { session: null, modelKeyPresent: false, reached: false }
            // Do not persist soft failures as a definitive miss.
            return empty
          }
          const data = await response.json()
          const ready = normalizeHostReady(
            data?.session,
            data?.modelKeyPresent === true,
          )
          writeStashedHostReady(ready)
          return { ...ready, reached: true }
        } catch {
          const lastGood = readLastGoodHostReady()
          if (lastGood) return { ...lastGood, reached: false }
          return { session: null, modelKeyPresent: false, reached: false }
        } finally {
          hostReadyInflight = null
        }
      })()
      return hostReadyInflight
    }

    /**
     * Phone-only fetch guards (installed at module load so they beat identity boot).
     * Desktop never enables them.
     */
    function installFetchGuards() {
      if (window.__t4yMobileCowatchFetchGuarded) return
      window.__t4yMobileCowatchFetchGuarded = true
      window.fetch = async (input, init) => {
        const url = requestUrl(input)
        const method = (init?.method || (typeof input === 'object' && input && 'method' in input ? input.method : 'GET') || 'GET')
          .toUpperCase()

        if (url.includes('/api/t4y-identity/issue-model-key') && method === 'POST') {
          const ready = await pullHostReady()
          if (!ready.modelKeyPresent) {
            return new Response(JSON.stringify({
              error: 'desktop_key_required',
              message: t('waitingKey'),
            }), { status: 409, headers: { 'content-type': 'application/json; charset=utf-8' } })
          }
          if (ready.session) {
            try { writeLocalSession(ready.session) } catch { /* ignore */ }
          }
          let expiresIn = 3600
          try {
            const rawBody = init?.body
            if (typeof rawBody === 'string') {
              const parsed = JSON.parse(rawBody)
              const n = Number(parsed?.expiresIn)
              if (Number.isSafeInteger(n) && n > 0) expiresIn = n
            }
          } catch { /* use default */ }
          const local = readSession()
          const expiresAt = typeof local?.llmApiKeyExpiresAt === 'number' && local.llmApiKeyExpiresAt > Date.now()
            ? local.llmApiKeyExpiresAt
            : Date.now() + expiresIn * 1000
          const homeModuleId = typeof local?.keyHomeModuleId === 'string' && local.keyHomeModuleId !== ''
            ? local.keyHomeModuleId
            : (typeof local?.moduleId === 'string' ? local.moduleId : '')
          return new Response(JSON.stringify({
            expiresAt,
            homeModuleId,
            models: [],
            reusedHostCredential: true,
          }), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } })
        }

        if (url.includes('/api/t4y-identity/revoke-model-key') && method === 'POST') {
          return new Response(JSON.stringify({ revoked: false, skipped: 'mobile-cowatch' }), {
            status: 200,
            headers: { 'content-type': 'application/json; charset=utf-8' },
          })
        }

        if (url.includes('/api/t4y-identity/host-session') && method === 'DELETE') {
          return new Response(JSON.stringify({ cleared: false, skipped: 'mobile-cowatch' }), {
            status: 200,
            headers: { 'content-type': 'application/json; charset=utf-8' },
          })
        }

        return rawFetch(input, init)
      }
    }

    /**
     * Undo any leftover layout experiments (grid / dock / width) from prior
     * builds. Safe on every desktop boot.
     */
    function scrubLeakedChrome() {
      try { sessionStorage.removeItem(FLAG) } catch { /* ignore */ }
      try { delete document.documentElement.dataset.t4yMobileCowatch } catch { /* ignore */ }
      try { document.getElementById(STYLE_ID)?.remove() } catch { /* ignore */ }
      try { document.getElementById('t4y-mobile-cowatch-backdrop')?.remove() } catch { /* ignore */ }
      try {
        for (const el of document.querySelectorAll('[data-t4y-cowatch-frame]')) {
          if (!(el instanceof HTMLElement)) continue
          el.style.removeProperty('grid-template-columns')
          el.removeAttribute('data-t4y-cowatch-frame')
        }
        for (const el of document.querySelectorAll('[data-t4y-cowatch-sidebar]')) {
          if (!(el instanceof HTMLElement)) continue
          el.style.removeProperty('position')
          el.style.removeProperty('inset')
          el.style.removeProperty('left')
          el.style.removeProperty('top')
          el.style.removeProperty('bottom')
          el.style.removeProperty('width')
          el.style.removeProperty('height')
          el.style.removeProperty('z-index')
          el.style.removeProperty('overflow')
          el.style.removeProperty('visibility')
          el.style.removeProperty('pointer-events')
          el.removeAttribute('data-t4y-cowatch-sidebar')
        }
        for (const el of document.querySelectorAll('[class*="centerCol"]')) {
          if (el instanceof HTMLElement) el.style.removeProperty('grid-column')
        }
        for (const el of document.querySelectorAll('[class*="rightbarCol"]')) {
          if (!(el instanceof HTMLElement)) continue
          el.style.removeProperty('grid-column')
          el.style.removeProperty('width')
          el.style.removeProperty('max-width')
          el.style.removeProperty('overflow')
          el.style.removeProperty('padding')
        }
        for (const el of document.querySelectorAll('[class*="handle"]')) {
          if (el instanceof HTMLElement) el.style.removeProperty('display')
        }
        for (const scroll of document.querySelectorAll('[data-conversation-scroll]')) {
          const body = scroll.parentElement
          if (!(body instanceof HTMLElement)) continue
          body.style.removeProperty('--dsh-chat-user-width')
          body.style.removeProperty('--dsh-composer-card-max-width')
          body.style.removeProperty('--dsh-composer-side-clearance')
          body.style.removeProperty('--dsh-composer-dock-inset')
        }
        for (const bar of document.querySelectorAll('[data-t4y-mobile-hub-hidden]')) {
          if (!(bar instanceof HTMLElement)) continue
          bar.style.removeProperty('display')
          bar.removeAttribute('data-t4y-mobile-hub-hidden')
        }
      } catch { /* ignore */ }
    }

    // 仅真实电脑端清残留；enter 会话（含桌面 UA 手机）必须保留标记。
    if (!active) scrubLeakedChrome()

    /** Paint before React slots so phone never sits on blank boot white. */
    function ensureBootPlaceholder() {
      if (document.getElementById('t4y-mobile-cowatch-boot')) return
      const el = document.createElement('div')
      el.id = 't4y-mobile-cowatch-boot'
      el.setAttribute('role', 'status')
      el.style.cssText = [
        'position:fixed',
        'inset:0',
        'z-index:10040',
        'display:flex',
        'align-items:center',
        'justify-content:center',
        'background:#f8fafc',
        'color:#0f172a',
        'font:600 16px/24px system-ui,sans-serif',
        'padding:24px',
        'text-align:center',
      ].join(';')
      el.textContent = '正在连接…'
      const mount = () => {
        if (document.body) document.body.appendChild(el)
        else document.addEventListener('DOMContentLoaded', mount, { once: true })
      }
      mount()
    }

    function clearBootPlaceholder() {
      try {
        document.getElementById('t4y-mobile-cowatch-boot')?.remove()
      } catch { /* ignore */ }
    }

    if (active) {
      document.documentElement.dataset.t4yMobileCowatch = '1'
      installFetchGuards()
      ensureBootPlaceholder()
    }

    window.__t4yMobileCowatch = {
      active,
      detect: detectMobileCowatch,
      rev: '2026-11-13-idle-15m',
    }

    // --- client-src/phone-styles.js ---
    function installStyles() {
      if (document.getElementById(STYLE_ID)) return
      const style = document.createElement('style')
      style.id = STYLE_ID
      // Phone-only light cosmetics. No AppFrame grid rewrite, no chat width
      // overrides, no shortcut dock — those broke desktop / failed to ship.
      style.textContent = `
        /* Do NOT display:none identity restoring/login here.
           WaitGate mounts via slots and can lag behind identity boot; hiding those
           gates left a blank white/black shell on phone browsers. WaitGate already
           covers the viewport (z-index 10050) when it needs to. */
        .t4y-mobile-cowatch-root {
          position: fixed;
          inset: 0;
          z-index: 10050;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          /* Prefer explicit light fallback — phone theme tokens may resolve dark/empty. */
          background: #f8fafc;
          color: #0f172a;
          font-family: var(--dsw-font-sans, system-ui, sans-serif);
        }
        .t4y-mobile-cowatch-card {
          width: min(420px, 100%);
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .t4y-mobile-cowatch-title {
          margin: 0;
          font-size: 20px;
          line-height: 28px;
          font-weight: 600;
        }
        .t4y-mobile-cowatch-body {
          margin: 0;
          font-size: 14px;
          line-height: 22px;
          color: var(--dsw-alias-label-secondary, #475569);
        }
        .t4y-mobile-cowatch-status {
          margin: 0;
          font-size: 13px;
          line-height: 20px;
          color: var(--dsw-alias-label-tertiary, #64748b);
        }
        .t4y-mobile-cowatch-idle-root {
          position: fixed;
          inset: 0;
          z-index: 10060;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          background: rgba(15, 23, 42, 0.55);
          color: #0f172a;
          font-family: var(--dsw-font-sans, system-ui, sans-serif);
        }
        .t4y-mobile-cowatch-idle-card {
          width: min(420px, 100%);
          padding: 24px;
          border-radius: 12px;
          background: #fff;
          box-shadow: 0 8px 30px rgba(15, 23, 42, 0.18);
        }
        .t4y-mobile-cowatch-idle-card h2 {
          margin: 0 0 8px;
          font-size: 18px;
          line-height: 26px;
        }
        .t4y-mobile-cowatch-idle-card p {
          margin: 0 0 16px;
          font-size: 14px;
          line-height: 22px;
          color: #475569;
        }
        .t4y-mobile-cowatch-idle-card button {
          width: 100%;
          padding: 12px 16px;
          border: 0;
          border-radius: 8px;
          background: #0f1115;
          color: #fff;
          font-size: 16px;
          font-weight: 600;
        }
        .t4y-mobile-switch-root {
          position: fixed;
          inset: 0;
          z-index: 10060;
          display: flex;
          align-items: flex-end;
          justify-content: center;
          background: rgba(15, 17, 21, 0.45);
          padding: 1rem;
        }
        .t4y-mobile-switch-card {
          width: min(22rem, 100%);
          max-height: min(70vh, 32rem);
          overflow: auto;
          background: #fff;
          color: #111827;
          border-radius: 14px;
          padding: 1.1rem 1.1rem 1rem;
          box-shadow: 0 10px 30px rgba(0,0,0,.18);
        }
        .t4y-mobile-switch-card h2 { margin: 0 0 0.35rem; font-size: 1.05rem; }
        .t4y-mobile-switch-card .t4y-mobile-switch-body {
          margin: 0 0 0.85rem;
          color: #6b7280;
          font-size: 0.88rem;
          line-height: 1.45;
        }
        .t4y-mobile-switch-list { list-style: none; margin: 0; padding: 0; }
        .t4y-mobile-switch-list button {
          width: 100%;
          text-align: left;
          margin: 0 0 0.5rem;
          padding: 0.75rem 0.85rem;
          border: 1px solid #e5e7eb;
          border-radius: 10px;
          background: #fff;
          color: #111827;
          font-size: 0.95rem;
        }
        .t4y-mobile-switch-list button.is-ready {
          border-color: #86efac;
          background: #f0fdf4;
        }
        .t4y-mobile-switch-list button.is-current {
          border-color: #93c5fd;
          background: #eff6ff;
          box-shadow: inset 0 0 0 1px #93c5fd;
        }
        .t4y-mobile-switch-list button.is-off {
          border-color: #fcd34d;
          background: #fffbeb;
        }
        .t4y-mobile-switch-list button.is-offline {
          border-color: #e5e7eb;
          background: #f9fafb;
          opacity: 0.88;
        }
        .t4y-mobile-switch-list button[disabled] { cursor: not-allowed; }
        .t4y-mobile-switch-list .meta {
          display: block;
          margin-top: 0.25rem;
          color: #6b7280;
          font-size: 0.78rem;
        }
        .t4y-mobile-switch-list .badge {
          display: inline-block;
          margin-left: 0.35rem;
          padding: 0.1rem 0.4rem;
          border-radius: 999px;
          font-size: 0.7rem;
          font-weight: 600;
          vertical-align: middle;
        }
        .t4y-mobile-switch-list .badge.ready { background: #dcfce7; color: #166534; }
        .t4y-mobile-switch-list .badge.current { background: #dbeafe; color: #1d4ed8; }
        .t4y-mobile-switch-list .badge.off { background: #fef3c7; color: #b45309; }
        .t4y-mobile-switch-list .badge.offline { background: #f3f4f6; color: #6b7280; }
        .t4y-mobile-switch-actions {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 0.5rem;
          margin-top: 0.35rem;
        }
        .t4y-mobile-switch-actions button {
          padding: 0.65rem 0.75rem;
          border-radius: 8px;
          border: 1px solid #d1d5db;
          background: #fff;
          font-weight: 600;
        }
        .t4y-mobile-switch-actions button.primary {
          background: #0f1115;
          color: #fff;
          border-color: #0f1115;
        }
        html[data-t4y-mobile-cowatch="1"] [role="menu"] {
          z-index: 4000 !important;
        }
        /* 手机进入会话：隐藏电脑端「移动访问」开关，避免误操作本机 FRP */
        html[data-t4y-mobile-cowatch="1"] [data-t4y-mobile-access-item="1"],
        html[data-t4y-mobile-cowatch="1"] .dsh-mobile-control__trigger {
          display: none !important;
        }
        html[data-t4y-mobile-cowatch="1"] [aria-label="账号菜单"] span[class*="label"],
        html[data-t4y-mobile-cowatch="1"] [aria-label="Account menu"] span[class*="label"] {
          max-width: 9em;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        html[data-t4y-mobile-cowatch="1"] [data-shortcut-modal="settings"] {
          flex-direction: column !important;
          width: min(100vw - 24px, 800px) !important;
          max-width: calc(100vw - 24px) !important;
          height: min(100dvh - 24px, 800px) !important;
        }
        html[data-t4y-mobile-cowatch="1"] [data-shortcut-modal="settings"] > nav {
          width: 100% !important;
          gap: 10px !important;
          padding: 14px 12px 0 !important;
        }
        html[data-t4y-mobile-cowatch="1"] [data-shortcut-modal="settings"] > nav > div:last-child {
          display: flex !important;
          flex-direction: row !important;
          flex-wrap: nowrap !important;
          overflow-x: auto !important;
          overflow-y: hidden !important;
          gap: 4px !important;
          scroll-padding-inline: 8px;
          -webkit-overflow-scrolling: touch;
          scrollbar-width: none;
        }
        html[data-t4y-mobile-cowatch="1"] [data-shortcut-modal="settings"] > nav > div:last-child::-webkit-scrollbar {
          display: none;
        }
        html[data-t4y-mobile-cowatch="1"] [data-shortcut-modal="settings"] > nav button {
          flex: none !important;
          height: 36px !important;
        }
        html[data-t4y-mobile-cowatch="1"] [role="menu"] kbd,
        html[data-t4y-mobile-cowatch="1"] [role="menuitem"] [class*="Shortcut"],
        html[data-t4y-mobile-cowatch="1"] [role="menuitem"] [class*="shortcut"] {
          display: none !important;
        }
        html[data-t4y-mobile-cowatch="1"] [data-shell-bottom] {
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
        }
        html[data-t4y-mobile-cowatch="1"] [data-shell-bottom] button span {
          max-width: 28vw;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      `
      document.head.appendChild(style)
    }

    /**
     * Best-effort: rename dsh-mobile device label to enterprise displayName (Codex-style user binding).
     * @param {object} session

    // --- client-src/phone-waitgate.js ---
    function bindDeviceLabel(session) {
      const displayName = typeof session?.displayName === 'string' ? session.displayName.trim() : ''
      if (displayName === '') return
      void rawFetch('/api/t4y-mobile-cowatch/bind-device-label', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ displayName }),
        signal: timeoutSignal(FETCH_TIMEOUT_MS),
      }).catch(() => { /* non-blocking */ })
    }

    function WaitGate() {
      const stashed = readStashedHostReady()
      const alreadyEntered = readEntered() && Boolean(readSession()?.moduleId)
      const [phase, setPhase] = React.useState(
        (stashed?.session && stashed.modelKeyPresent) || alreadyEntered ? 'entering' : 'checking',
      )
      const [visible, setVisible] = React.useState(
        !((stashed?.session && stashed.modelKeyPresent) || alreadyEntered),
      )
      const adopting = React.useRef(alreadyEntered)
      const adoptLock = React.useRef(false)

      React.useEffect(() => {
        let cancelled = false
        /** @type {ReturnType<typeof window.setTimeout> | undefined} */
        let timer
        let delayMs = POLL_MS_BASE
        const finish = (session) => {
          writeLocalSession(session)
          bindDeviceLabel(session)
          writeEntered(true)
          setVisible(false)
          clearBootPlaceholder()
          document.documentElement.dataset.t4yIdentityAuthed = '1'
          adopting.current = true
          if (timer !== undefined) window.clearTimeout(timer)
        }
        const adopt = async (force = false) => {
          if (adopting.current || adoptLock.current) return true
          adoptLock.current = true
          try {
            const existing = readSession()
            const ready = await pullHostReady({ force })
            if (cancelled) return false
            // Already in-app (sticky): soft refresh only — never reopen WaitGate on FRP blips.
            if (readEntered() && existing?.moduleId && existing.needsModulePick !== true) {
              if (ready.modelKeyPresent) finish(existing)
              return true
            }
            if (existing && existing.needsModulePick !== true && existing.moduleId) {
              if (ready.modelKeyPresent) {
                finish(existing)
                return true
              }
              // Soft failure / timeout: keep checking, do not claim「电脑尚未就绪」.
              if (!ready.reached) {
                setPhase('checking')
                setVisible(true)
                return false
              }
              setPhase('waiting_key')
              setVisible(true)
              return false
            }
            if (!ready.session) {
              if (!ready.reached) {
                setPhase('checking')
                setVisible(true)
                return false
              }
              setPhase('waiting_login')
              setVisible(true)
              return false
            }
            if (!ready.modelKeyPresent) {
              if (!ready.reached) {
                setPhase('checking')
                setVisible(true)
                return false
              }
              setPhase('waiting_key')
              setVisible(true)
              return false
            }
            setPhase('entering')
            finish(ready.session)
            return true
          } finally {
            adoptLock.current = false
          }
        }
        const schedule = (forceNext = false) => {
          if (cancelled || adopting.current) return
          timer = window.setTimeout(() => {
            void (async () => {
              // Prefer cache; only force when the miss TTL has elapsed.
              const missFresh = readStashedHostReady({ allowMiss: true })
              const shouldForce = forceNext || (missFresh === null)
              const done = await adopt(shouldForce)
              if (cancelled || done || adopting.current) return
              delayMs = Math.min(POLL_MS_MAX, Math.round(delayMs * 1.7))
              schedule(false)
            })()
          }, delayMs)
        }
        // Prefer stashed PC state from the pair page (no network on first paint).
        const warm = readStashedHostReady()
        if (warm?.session && warm.modelKeyPresent) {
          finish(warm.session)
        } else if (alreadyEntered) {
          const existing = readSession()
          if (existing?.moduleId) finish(existing)
          else writeEntered(false)
        } else {
          void adopt(false).then((done) => {
            if (!cancelled && !done) schedule(false)
          })
        }
        const onSession = () => {
          if (adopting.current || readEntered()) return
          const session = readSession()
          if (session && session.needsModulePick !== true && session.moduleId) {
            delayMs = POLL_MS_BASE
            void pullHostReady().then((ready) => {
              if (cancelled || adopting.current) return
              if (ready.modelKeyPresent) finish(session)
              else if (ready.reached) {
                setVisible(true)
                setPhase('waiting_key')
              }
              // Soft failure: leave current UI alone; scheduler will retry.
            })
          }
        }
        window.addEventListener(SESSION_EVENT, onSession)
        return () => {
          cancelled = true
          if (timer !== undefined) window.clearTimeout(timer)
          window.removeEventListener(SESSION_EVENT, onSession)
        }
      }, [])

      if (!visible) {
        clearBootPlaceholder()
        return null
      }
      clearBootPlaceholder()
      const titleKey = phase === 'waiting_key' ? 'titleKey'
        : phase === 'entering' ? 'titleEntering'
        : phase === 'waiting_login' ? 'titleLogin'
          : 'titleChecking'
      const statusKey = phase === 'waiting_key' ? 'waitingKey'
        : phase === 'entering' ? 'entering'
        : phase === 'waiting_login' ? 'waitingLogin'
          : 'checking'
      return React.createElement('div', {
        className: 't4y-mobile-cowatch-root',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': 't4y-mobile-cowatch-title',
        'data-phase': phase,
      }, React.createElement('div', { className: 't4y-mobile-cowatch-card' },
        React.createElement('h2', { id: 't4y-mobile-cowatch-title', className: 't4y-mobile-cowatch-title' }, t(titleKey)),
        React.createElement('p', { className: 't4y-mobile-cowatch-body' }, t('body')),
        React.createElement('p', { className: 't4y-mobile-cowatch-status' }, t(statusKey))))
    }

    /**
     * After enter: 15 min with no tap/typing → close live WebSockets (free channel).
     * Device pairing cookies stay;「继续使用」reload 免登续连.
     * Page merely open in foreground does not count as activity.

    // --- client-src/phone-idle.js ---
    function installIdleWatchdog() {
      if (typeof window === 'undefined' || typeof document === 'undefined') return
      /** @type {Set<WebSocket>} */
      const sockets = new Set()
      const NativeWS = window.WebSocket
      if (typeof NativeWS !== 'function' || /** @type {{ __t4yIdleWrapped?: boolean }} */ (NativeWS).__t4yIdleWrapped === true) {
        // still schedule activity even if WS already wrapped
      } else {
        /**
         * @param {string | URL} url
         * @param {string | string[]} [protocols]
         */
        function WrappedWebSocket(url, protocols) {
          const ws = protocols === undefined ? new NativeWS(url) : new NativeWS(url, protocols)
          sockets.add(ws)
          const forget = () => { sockets.delete(ws) }
          ws.addEventListener('close', forget)
          ws.addEventListener('error', forget)
          return ws
        }
        WrappedWebSocket.prototype = NativeWS.prototype
        WrappedWebSocket.CONNECTING = NativeWS.CONNECTING
        WrappedWebSocket.OPEN = NativeWS.OPEN
        WrappedWebSocket.CLOSING = NativeWS.CLOSING
        WrappedWebSocket.CLOSED = NativeWS.CLOSED
        WrappedWebSocket.__t4yIdleWrapped = true
        window.WebSocket = /** @type {typeof WebSocket} */ (WrappedWebSocket)
      }

      let idle = false
      /** @type {ReturnType<typeof window.setTimeout> | undefined} */
      let timer

      function hideIdleGate() {
        try { document.getElementById(IDLE_GATE_ID)?.remove() } catch { /* ignore */ }
      }

      function showIdleGate() {
        if (document.getElementById(IDLE_GATE_ID)) return
        const root = document.createElement('div')
        root.id = IDLE_GATE_ID
        root.className = 't4y-mobile-cowatch-idle-root'
        root.setAttribute('role', 'dialog')
        root.setAttribute('aria-modal', 'true')
        root.innerHTML = `<div class="t4y-mobile-cowatch-idle-card">
          <h2>${t('idleTitle')}</h2>
          <p>${t('idleBody')}</p>
          <button type="button">${t('idleContinue')}</button>
        </div>`
        const button = root.querySelector('button')
        if (button) {
          button.addEventListener('click', () => {
            hideIdleGate()
            // Keep ENTERED_KEY so WaitGate stays sticky; device cookies renew the mux.
            try { sessionStorage.setItem(ENTERED_KEY, '1') } catch { /* ignore */ }
            window.location.reload()
          })
        }
        document.body.appendChild(root)
      }

      function disconnectLive() {
        for (const ws of [...sockets]) {
          try {
            if (ws.readyState === NativeWS.OPEN || ws.readyState === NativeWS.CONNECTING) {
              ws.close(1000, 'idle')
            }
          } catch { /* ignore */ }
          sockets.delete(ws)
        }
      }

      function arm() {
        if (idle) return
        if (timer !== undefined) window.clearTimeout(timer)
        timer = window.setTimeout(() => {
          // Only after the phone has entered the app once this tab.
          if (!readEntered()) {
            arm()
            return
          }
          idle = true
          disconnectLive()
          showIdleGate()
        }, IDLE_DISCONNECT_MS)
      }

      /** Tap / key / input only — not mousemove, not visibility alone. */
      const onActivity = () => {
        if (idle) return
        arm()
      }
      for (const type of ['pointerdown', 'touchstart', 'keydown', 'input']) {
        document.addEventListener(type, onActivity, { capture: true, passive: true })
      }
      arm()
    }

    /**
     * Desktop「移动访问」：
     * - 侧栏入口隐藏，改放到账号菜单「移动访问」
     * - 面板内只留一行勾选开关
     * - 启动后默认拉起 FRP；失败静默重试 2 次后再 toast

    // --- client-src/desktop-access.js ---
    function installEnterpriseMobileAccessSimplify() {
      if (typeof document === 'undefined') return
      // Phone / enter 会话只遥控 PC，不得注入「移动访问」开关。
      if (active || isMobileUa() || hasMobileEnterSession()) return
      const SWITCH_ID = 't4y-mobile-access-switch'
      const TOAST_ID = 't4y-mobile-remote-toast'
      const MENU_ITEM_ATTR = 'data-t4y-mobile-access-item'
      const styleId = 't4y-mobile-cowatch-access-simplify'
      if (!document.getElementById(styleId)) {
        const style = document.createElement('style')
        style.id = styleId
        style.textContent = `
          /* 侧栏「移动访问」入口隐藏；改从账号菜单进入 */
          .dsh-mobile-control__trigger {
            display: none !important;
          }
          .dsh-mobile-control__switcher,
          .dsh-mobile-control__view:not(.is-remote):not(.is-diagnostics):not(.is-devices),
          .dsh-mobile-control__lan-setup,
          .dsh-mobile-control__provider-section,
          .dsh-mobile-control__view.is-remote > .dsh-mobile-control__intro,
          .dsh-mobile-control__http-frame-warning,
          .dsh-mobile-control__channel-pane,
          .dsh-mobile-control__remote-columns > .dsh-mobile-control__view:not(.is-remote),
          .dsh-mobile-control__frp-setup,
          .dsh-mobile-control__frp-overview,
          .dsh-mobile-control__cpolar-setup,
          .dsh-mobile-control__cloudflared-setup,
          .dsh-mobile-control__iroh-setup,
          .dsh-mobile-control__origin-setup,
          .dsh-mobile-control__app-downloads,
          .dsh-mobile-control__update-plugin,
          .dsh-mobile-control__update-card,
          .dsh-mobile-control__release-notice,
          .dsh-mobile-control__diagnostic-entry:not(.t4y-keep-devices),
          .dsh-mobile-control__access,
          .dsh-mobile-control__qr,
          .dsh-mobile-control__guide,
          .dsh-mobile-control__setup-details,
          .dsh-mobile-control__provider-install,
          .dsh-mobile-control__component-status,
          .dsh-mobile-control__ws-paths,
          .dsh-mobile-control__devices:not(.is-open),
          .dsh-mobile-control__actions,
          .dsh-mobile-control__manage-row,
          .dsh-mobile-control__status,
          .dsh-mobile-control__primary,
          .dsh-mobile-control button.dsh-mobile-control__primary,
          .t4y-mobile-access-tip {
            display: none !important;
          }
          /* 远程访问设置页不再提供开关；统一走账号菜单「移动访问」 */
          #${SWITCH_ID},
          .dsh-mobile-control__view.is-remote .dsh-mobile-control__actions,
          .dsh-mobile-control__view.is-remote button {
            display: none !important;
          }
          #t4y-mobile-access-panel-note {
            display: block !important;
            margin: 8px 0 0;
            padding: 12px 14px;
            border-radius: 10px;
            border: 1px solid var(--dsw-alias-border-l2, #e5e7eb);
            background: var(--dsw-alias-bg-layer-2, #f8fafc);
            color: var(--dsw-alias-label-secondary, #475569);
            font-size: 13px;
            line-height: 1.5;
          }
          #${TOAST_ID} {
            position: fixed;
            z-index: 12000;
            left: 50%;
            bottom: 28px;
            transform: translateX(-50%);
            max-width: min(420px, calc(100vw - 32px));
            padding: 10px 14px;
            border-radius: 10px;
            background: #111827;
            color: #fff;
            font-size: 13px;
            line-height: 1.45;
            box-shadow: 0 8px 24px rgba(15, 23, 42, 0.28);
          }
          button[${MENU_ITEM_ATTR}="1"] {
            display: flex !important;
            align-items: center;
            width: 100%;
            gap: 8px;
          }
          button[${MENU_ITEM_ATTR}="1"] .t4y-ma-label {
            flex: 1;
            text-align: left;
            min-width: 0;
          }
          button[${MENU_ITEM_ATTR}="1"] .t4y-ma-qr-hint {
            flex: none;
            font-size: 12px;
            font-weight: 500;
            color: #1d4ed8;
            padding: 0.1rem 0.45rem;
            border-radius: 999px;
            background: #eff6ff;
          }
          button[${MENU_ITEM_ATTR}="1"] .t4y-ma-qr-hint[hidden] {
            display: none !important;
          }
          #t4y-mobile-access-qr-root {
            position: fixed;
            inset: 0;
            z-index: 13000;
            display: flex;
            align-items: center;
            justify-content: center;
            background: rgba(15, 23, 42, 0.42);
            backdrop-filter: blur(6px);
            -webkit-backdrop-filter: blur(6px);
            padding: 1.25rem;
            animation: t4y-ma-qr-fade .16s ease-out;
          }
          @keyframes t4y-ma-qr-fade {
            from { opacity: 0; }
            to { opacity: 1; }
          }
          @keyframes t4y-ma-qr-rise {
            from { opacity: 0; transform: translateY(8px) scale(0.98); }
            to { opacity: 1; transform: translateY(0) scale(1); }
          }
          @keyframes t4y-ma-qr-spin {
            to { transform: rotate(360deg); }
          }
          #t4y-mobile-access-qr-root .t4y-ma-qr-card {
            width: min(22rem, 100%);
            background: #fff;
            color: #0f172a;
            border: 1px solid #e2e8f0;
            border-radius: 16px;
            padding: 1.25rem 1.25rem 1.1rem;
            box-shadow: 0 18px 48px rgba(15, 23, 42, 0.16);
            text-align: center;
            animation: t4y-ma-qr-rise .18s ease-out;
          }
          #t4y-mobile-access-qr-root .t4y-ma-qr-head {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 0.75rem;
            margin-bottom: 0.35rem;
            text-align: left;
          }
          #t4y-mobile-access-qr-root .t4y-ma-qr-head h2 {
            margin: 0;
            font-size: 1.05rem;
            font-weight: 500;
            letter-spacing: -0.01em;
            color: #0f172a;
          }
          #t4y-mobile-access-qr-root .t4y-ma-qr-close {
            flex: none;
            width: 28px;
            height: 28px;
            margin: -4px -4px 0 0;
            border: 0;
            border-radius: 8px;
            background: transparent;
            color: #64748b;
            font-size: 1.15rem;
            line-height: 1;
            cursor: pointer;
          }
          #t4y-mobile-access-qr-root .t4y-ma-qr-close:hover {
            background: #f1f5f9;
            color: #0f172a;
          }
          #t4y-mobile-access-qr-root .t4y-ma-qr-desc {
            margin: 0 0 1rem;
            color: #64748b;
            font-size: 0.84rem;
            line-height: 1.5;
            text-align: left;
          }
          #t4y-mobile-access-qr-root .t4y-ma-qr-frame {
            display: flex;
            justify-content: center;
            align-items: center;
            margin: 0 auto 0.85rem;
            padding: 1rem;
            width: fit-content;
            max-width: 100%;
            box-sizing: border-box;
            border-radius: 14px;
            border: 1px solid #e2e8f0;
            background:
              linear-gradient(#fff, #fff) padding-box,
              linear-gradient(145deg, #e2e8f0, #f8fafc 45%, #e2e8f0) border-box;
            box-shadow: inset 0 1px 0 rgba(255,255,255,0.9);
          }
          #t4y-mobile-access-qr-root .t4y-ma-qr-svg {
            display: flex;
            justify-content: center;
            align-items: center;
            width: 196px;
            height: 196px;
            color: #64748b;
            font-size: 0.84rem;
          }
          #t4y-mobile-access-qr-root .t4y-ma-qr-svg[data-state="loading"]::before {
            content: "";
            width: 22px;
            height: 22px;
            border: 2px solid #cbd5e1;
            border-top-color: #334155;
            border-radius: 50%;
            animation: t4y-ma-qr-spin .7s linear infinite;
          }
          #t4y-mobile-access-qr-root .t4y-ma-qr-svg[data-state="loading"] {
            font-size: 0;
          }
          #t4y-mobile-access-qr-root .t4y-ma-qr-svg[data-state="error"] {
            color: #b91c1c;
            padding: 0.75rem;
            text-align: center;
            line-height: 1.45;
          }
          #t4y-mobile-access-qr-root .t4y-ma-qr-svg svg {
            width: 196px;
            height: 196px;
            display: block;
          }
          #t4y-mobile-access-qr-root .t4y-ma-qr-meta {
            display: inline-flex;
            align-items: center;
            gap: 0.35rem;
            margin: 0 0 1rem;
            padding: 0.28rem 0.65rem;
            border-radius: 999px;
            background: #f1f5f9;
            color: #475569;
            font-size: 0.78rem;
            font-weight: 500;
          }
          #t4y-mobile-access-qr-root .t4y-ma-qr-meta[hidden] {
            display: none !important;
          }
          #t4y-mobile-access-qr-root .t4y-ma-qr-meta::before {
            content: "";
            width: 6px;
            height: 6px;
            border-radius: 50%;
            background: #22c55e;
          }
          #t4y-mobile-access-qr-root .t4y-ma-qr-actions {
            display: grid;
            grid-template-columns: 1fr 1.2fr;
            gap: 0.55rem;
          }
          #t4y-mobile-access-qr-root .t4y-ma-qr-actions button {
            padding: 0.62rem 0.75rem;
            border-radius: 10px;
            border: 1px solid #e2e8f0;
            background: #fff;
            color: #334155;
            font-size: 0.9rem;
            font-weight: 500;
            cursor: pointer;
          }
          #t4y-mobile-access-qr-root .t4y-ma-qr-actions button:hover {
            background: #f8fafc;
          }
          #t4y-mobile-access-qr-root .t4y-ma-qr-actions button.primary {
            background: #0f172a;
            color: #fff;
            border-color: #0f172a;
          }
          #t4y-mobile-access-qr-root .t4y-ma-qr-actions button.primary:hover {
            background: #1e293b;
          }
          button[${MENU_ITEM_ATTR}="1"] .t4y-ma-switch {
            flex: none;
            position: relative;
            width: 40px;
            height: 22px;
            border-radius: 999px;
            background: #d1d5db;
            transition: background .15s ease;
            cursor: pointer;
          }
          button[${MENU_ITEM_ATTR}="1"] .t4y-ma-switch[data-on="1"] {
            background: #2563eb;
          }
          button[${MENU_ITEM_ATTR}="1"] .t4y-ma-switch[data-busy="1"] {
            opacity: 0.55;
            pointer-events: none;
          }
          button[${MENU_ITEM_ATTR}="1"] .t4y-ma-switch::after {
            content: "";
            position: absolute;
            top: 2px;
            left: 2px;
            width: 18px;
            height: 18px;
            border-radius: 50%;
            background: #fff;
            box-shadow: 0 1px 2px rgba(15, 23, 42, 0.25);
            transition: transform .15s ease;
          }
          button[${MENU_ITEM_ATTR}="1"] .t4y-ma-switch[data-on="1"]::after {
            transform: translateX(18px);
          }
          /* 不再使用大面板开关 */
          #${SWITCH_ID} { display: none !important; }
        `
        document.head.appendChild(style)
      }

      /** @param {HTMLElement} root */
      function ensurePanelNote(root) {
        let note = document.getElementById('t4y-mobile-access-panel-note')
        if (!(note instanceof HTMLElement)) {
          note = document.createElement('p')
          note.id = 't4y-mobile-access-panel-note'
          note.textContent = '手机访问开关已移至右上角账号菜单中的「移动访问」。请在那里开启或关闭。'
        }
        const host = root.querySelector('.dsh-mobile-control__view.is-remote')
          || root.querySelector('.dsh-mobile-control__panel')
          || root
        if (note.parentElement !== host) host.prepend(note)
        try { document.getElementById(SWITCH_ID)?.remove() } catch { /* ignore */ }
      }

      const simplifyPanel = () => {
        try {
          const root = document.getElementById('dsh-mobile-control-panel')
            || document.querySelector('.dsh-mobile-control')
          if (!(root instanceof HTMLElement)) return false

          for (const tab of root.querySelectorAll('.dsh-mobile-control__switcher .dsh-mobile-control__tab, .dsh-mobile-control__tab')) {
            if (!(tab instanceof HTMLElement)) continue
            const label = (tab.textContent || '').trim()
            if (/^远程$|^Remote$/i.test(label) && !tab.classList.contains('is-active')) {
              tab.click()
              break
            }
          }

          const frp = root.querySelector('.dsh-mobile-control__provider.is-frp')
          if (frp instanceof HTMLElement && !frp.classList.contains('is-selected')) frp.click()

          for (const view of root.querySelectorAll('.dsh-mobile-control__view')) {
            if (!(view instanceof HTMLElement)) continue
            if (view.classList.contains('is-remote') || view.classList.contains('is-diagnostics') || view.classList.contains('is-devices')) continue
            view.style.setProperty('display', 'none', 'important')
          }

          for (const btn of root.querySelectorAll('.dsh-mobile-control__diagnostic-entry, .dsh-mobile-control__header-actions button')) {
            if (!(btn instanceof HTMLElement)) continue
            const label = (btn.textContent || '').trim()
            if (/^设备$|Devices|device|配对/i.test(label) || /管理.*设备|Paired/i.test(label)) {
              btn.classList.add('t4y-keep-devices')
              btn.style.removeProperty('display')
            }
          }

          try { root.querySelector('.t4y-mobile-access-tip')?.remove() } catch { /* ignore */ }
          ensurePanelNote(root)
          return true
        } catch {
          return false
        }
      }

      const observer = new MutationObserver(() => { simplifyPanel() })
      try {
        simplifyPanel()
        observer.observe(document.documentElement, { childList: true, subtree: true })
        window.setTimeout(() => { try { observer.disconnect() } catch { /* ignore */ } }, 300_000)
      } catch { /* ignore */ }

      /**
       * @param {string} path
       * @param {RequestInit} [init]
       */
      async function adminJson(path, init = {}) {
        const method = String(init.method || 'GET').toUpperCase()
        const headers = new Headers(init.headers || {})
        if (!headers.has('content-type')) headers.set('content-type', 'application/json')
        if (method === 'POST') headers.set('x-dsh-mobile-web-admin', 'same-origin-json')
        const response = await rawFetch(path, {
          ...init,
          method,
          headers,
          credentials: 'same-origin',
          signal: timeoutSignal(20_000),
        })
        const text = await response.text()
        let body = {}
        try { body = text.trim() ? JSON.parse(text) : {} } catch { body = {} }
        if (!response.ok) {
          throw new Error(typeof body?.error === 'string' ? body.error : `HTTP ${response.status}`)
        }
        return body
      }

      const PHONE_ICON_SVG = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect x="4.25" y="1.75" width="7.5" height="12.5" rx="1.5" stroke="currentColor" stroke-width="1.3"/><path d="M7 12.25h2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>'

      /**
       * @param {HTMLElement} switchEl
       * @param {boolean} on
       * @param {boolean} [busy]
       */
      function paintMenuSwitch(switchEl, on, busy = false) {
        switchEl.dataset.on = on ? '1' : '0'
        switchEl.dataset.busy = busy ? '1' : '0'
        switchEl.setAttribute('aria-checked', on ? 'true' : 'false')
      }

      /**
       * @param {HTMLElement} switchEl
       */
      async function refreshMenuSwitch(switchEl) {
        try {
          const status = await adminJson('/api/t4y-mobile-cowatch/accepting')
          const on = status?.accepting === true
          writeUserOff(!on)
          paintMenuSwitch(switchEl, on, false)
        } catch {
          paintMenuSwitch(switchEl, !readUserOff(), false)
        }
      }

      /**
       * @param {HTMLElement} switchEl
       * @param {boolean} wantOn
       */
      // Soft-off flag (cross-tab). FRP stays up so phones still reach the offline page.
      const USER_OFF_KEY = 't4y.mobile.remote.userOff'

      function readUserOff() {
        try {
          if (localStorage.getItem(USER_OFF_KEY) === '1') return true
          if (sessionStorage.getItem(USER_OFF_KEY) === '1') {
            localStorage.setItem(USER_OFF_KEY, '1')
            sessionStorage.removeItem(USER_OFF_KEY)
            return true
          }
          return false
        } catch {
          return false
        }
      }

      /** @param {boolean} off */
      function writeUserOff(off) {
        try {
          if (off) {
            localStorage.setItem(USER_OFF_KEY, '1')
            sessionStorage.setItem(USER_OFF_KEY, '1')
          } else {
            localStorage.removeItem(USER_OFF_KEY)
            sessionStorage.removeItem(USER_OFF_KEY)
          }
        } catch { /* ignore */ }
      }

      const QR_ROOT_ID = 't4y-mobile-access-qr-root'
      /** @type {null | (() => void)} */
      let qrPanelCleanup = null

      function closeQrPanel() {
        try { qrPanelCleanup?.() } catch { /* ignore */ }
        qrPanelCleanup = null
        try { document.getElementById(QR_ROOT_ID)?.remove() } catch { /* ignore */ }
      }

      /**
       * Soft-on only: show FRP pair QR. Soft-off hides entry (caller must not open).
       * @returns {Promise<void>}
       */
      async function openQrPanel() {
        closeQrPanel()
        const root = document.createElement('div')
        root.id = QR_ROOT_ID
        root.setAttribute('role', 'dialog')
        root.setAttribute('aria-modal', 'true')
        root.setAttribute('aria-labelledby', 't4y-ma-qr-title')
        root.innerHTML = `<div class="t4y-ma-qr-card">
          <div class="t4y-ma-qr-head">
            <h2 id="t4y-ma-qr-title">扫码连接本机</h2>
            <button type="button" class="t4y-ma-qr-close" data-action="close" aria-label="关闭">×</button>
          </div>
          <p class="t4y-ma-qr-desc">用手机摄像头扫码，免登录进入当前电脑。二维码约 2 分钟有效，过期可刷新。</p>
          <div class="t4y-ma-qr-frame">
            <div class="t4y-ma-qr-svg" data-qr data-state="loading" aria-live="polite">正在生成</div>
          </div>
          <p class="t4y-ma-qr-meta" data-meta hidden></p>
          <div class="t4y-ma-qr-actions">
            <button type="button" data-action="close">关闭</button>
            <button type="button" class="primary" data-action="refresh">刷新二维码</button>
          </div>
        </div>`
        document.body.appendChild(root)
        const onKey = (event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            closeQrPanel()
          }
        }
        window.addEventListener('keydown', onKey)
        qrPanelCleanup = () => { window.removeEventListener('keydown', onKey) }
        root.addEventListener('click', (event) => {
          if (event.target === root) closeQrPanel()
        })
        for (const btn of root.querySelectorAll('[data-action="close"]')) {
          btn.addEventListener('click', () => closeQrPanel())
        }
        const paint = async () => {
          const box = root.querySelector('[data-qr]')
          const meta = root.querySelector('[data-meta]')
          if (!(box instanceof HTMLElement) || !(meta instanceof HTMLElement)) return
          box.dataset.state = 'loading'
          box.textContent = '正在生成'
          meta.hidden = true
          meta.textContent = ''
          try {
            // Ensure tunnel is up before minting a public pair URL.
            try {
              await adminJson('/api/mobile-access/remote/control', {
                method: 'POST',
                body: JSON.stringify({ running: true, provider: 'frp' }),
              })
            } catch { /* pairing open will fail loud if remote is down */ }
            const data = await adminJson('/api/mobile-access/remote/pairing/open', {
              method: 'POST',
              body: '{}',
            })
            const pairUrl = typeof data?.pairUrl === 'string' ? data.pairUrl : ''
            const qrSvg = typeof data?.qrSvg === 'string' ? data.qrSvg : ''
            const expiresAt = typeof data?.expiresAt === 'number' ? data.expiresAt : 0
            if (!pairUrl) throw new Error('empty_pair_url')
            if (qrSvg.includes('<svg')) {
              box.dataset.state = 'ready'
              box.innerHTML = qrSvg
            } else {
              box.dataset.state = 'error'
              box.textContent = '二维码生成失败，请刷新重试'
            }
            if (expiresAt > Date.now()) {
              meta.hidden = false
              meta.textContent = `有效至 ${new Date(expiresAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
            } else {
              meta.hidden = true
            }
          } catch {
            box.dataset.state = 'error'
            box.textContent = '生成失败，请确认移动访问已开启且网络正常'
            meta.hidden = true
          }
        }
        root.querySelector('[data-action="refresh"]')?.addEventListener('click', () => { void paint() })
        await paint()
      }

      function syncQrHint(item, on) {
        const hint = item.querySelector('.t4y-ma-qr-hint')
        if (!(hint instanceof HTMLElement)) return
        if (on) hint.removeAttribute('hidden')
        else hint.setAttribute('hidden', '')
      }

      /** Soft close/open: toggle accepting; keep FRP so the public status page stays reachable. */
      async function setRemoteEnabled(switchEl, wantOn, options = {}) {
        paintMenuSwitch(switchEl, wantOn, true)
        writeUserOff(!wantOn)
        const item = switchEl.closest(`button[${MENU_ITEM_ATTR}="1"]`)
        try {
          const status = await adminJson('/api/t4y-mobile-cowatch/accepting', {
            method: 'POST',
            body: JSON.stringify({ accepting: wantOn }),
          })
          const on = status?.accepting === true
          writeUserOff(!on)
          paintMenuSwitch(switchEl, on, false)
          if (item instanceof HTMLElement) syncQrHint(item, on)
          // Always keep the tunnel up (soft-off only refuses enter).
          try {
            await adminJson('/api/mobile-access/remote/control', {
              method: 'POST',
              body: JSON.stringify({ running: true, provider: 'frp' }),
            })
          } catch { /* ensure path reports via auto-ensure toast */ }
          if (!on) closeQrPanel()
          else if (options.openQr === true) void openQrPanel()
        } catch {
          writeUserOff(wantOn)
          paintMenuSwitch(switchEl, !wantOn, false)
          if (item instanceof HTMLElement) syncQrHint(item, !wantOn)
          showRemoteToast(wantOn ? '移动访问开启失败' : '移动访问关闭失败')
        }
      }

      /** Account menu row: phone icon + label + 扫码 hint + slide switch. */
      function syncAccountMenuItem() {
        try {
          const account = document.querySelector('[aria-label="账号菜单"][aria-expanded="true"], [aria-label="Account menu"][aria-expanded="true"]')
          if (!(account instanceof HTMLElement)) return
          const menu = document.querySelector('[role="menu"]')
          if (!(menu instanceof HTMLElement)) return
          const existing = menu.querySelector(`button[${MENU_ITEM_ATTR}="1"]`)
          if (existing instanceof HTMLElement) {
            const sw = existing.querySelector('.t4y-ma-switch')
            if (sw instanceof HTMLElement) {
              void refreshMenuSwitch(sw).then(() => {
                syncQrHint(existing, sw.dataset.on === '1')
              })
            }
            return
          }
          const sample = menu.querySelector('[role="menuitem"]')
          const item = document.createElement('button')
          item.type = 'button'
          item.setAttribute('role', 'menuitem')
          item.setAttribute(MENU_ITEM_ATTR, '1')
          if (sample instanceof HTMLElement && sample.className) item.className = sample.className
          const iconClass = sample?.querySelector('[class*="itemIcon"], [class*="ItemIcon"]')?.className || ''
          item.innerHTML = `${iconClass ? `<span class="${iconClass}">${PHONE_ICON_SVG}</span>` : `<span>${PHONE_ICON_SVG}</span>`}<span class="t4y-ma-label">移动访问</span><span class="t4y-ma-qr-hint" hidden>扫码</span><span class="t4y-ma-switch" role="switch" aria-checked="false"></span>`
          const switchEl = item.querySelector('.t4y-ma-switch')
          item.addEventListener('click', (event) => {
            event.preventDefault()
            event.stopPropagation()
            if (!(switchEl instanceof HTMLElement) || switchEl.dataset.busy === '1') return
            const target = event.target instanceof Element ? event.target : null
            const hitSwitch = target?.closest?.('.t4y-ma-switch')
            if (hitSwitch) {
              const next = switchEl.dataset.on !== '1'
              void setRemoteEnabled(switchEl, next, { openQr: next })
              return
            }
            // 开启时点「移动访问 / 扫码」展开二维码；关闭时隐藏入口，点击仅打开开关。
            if (switchEl.dataset.on === '1') {
              void openQrPanel()
              return
            }
            void setRemoteEnabled(switchEl, true, { openQr: true })
          })
          const settings = [...menu.querySelectorAll('[role="menuitem"]')].find((el) => /设置|Settings/i.test(el.textContent || ''))
          if (settings?.nextSibling) menu.insertBefore(item, settings.nextSibling)
          else if (settings) settings.after(item)
          else menu.insertBefore(item, menu.firstChild)
          if (switchEl instanceof HTMLElement) {
            void refreshMenuSwitch(switchEl).then(() => {
              syncQrHint(item, switchEl.dataset.on === '1')
            })
          }
        } catch { /* ignore */ }
      }

      const menuObserver = new MutationObserver(() => { syncAccountMenuItem() })
      try {
        menuObserver.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-expanded'] })
        syncAccountMenuItem()
      } catch { /* ignore */ }

      function showRemoteToast(message) {
        try {
          document.getElementById(TOAST_ID)?.remove()
          const el = document.createElement('div')
          el.id = TOAST_ID
          el.setAttribute('role', 'status')
          el.textContent = message
          document.body.appendChild(el)
          window.setTimeout(() => { try { el.remove() } catch { /* ignore */ } }, 8_000)
        } catch { /* ignore */ }
      }

      /**
       * Soft-off keeps FRP up for the public offline page; always ensure the tunnel.
       * Switch off only flips accepting via /api/t4y-mobile-cowatch/accepting.
       */
      function installRemoteAutoEnsure() {
        let silentFails = 0
        let toastShown = false
        let inFlight = false
        /** @type {ReturnType<typeof window.setInterval> | undefined} */
        let timer
        let acceptingSynced = false

        const healthy = (snap) => snap
          && snap.provider === 'frp'
          && snap.running === true
          && snap.state === 'ready'

        const syncAcceptingFromLocal = async () => {
          if (acceptingSynced) return
          acceptingSynced = true
          // Prior hard-off left localStorage userOff; map it onto soft-off once.
          if (!readUserOff()) return
          try {
            await adminJson('/api/t4y-mobile-cowatch/accepting', {
              method: 'POST',
              body: JSON.stringify({ accepting: false }),
            })
          } catch { /* ignore — next menu refresh will retry */ }
        }

        const tick = async () => {
          if (inFlight || document.hidden) return
          inFlight = true
          try {
            await syncAcceptingFromLocal()
            let snap = await adminJson('/api/mobile-access/remote/control')
            if (healthy(snap)) {
              silentFails = 0
              toastShown = false
              return
            }
            const frpConfigured = snap?.providers?.frp?.configuration?.configured === true
              || snap?.providers?.frp?.state === 'ready'
              || snap?.provider === 'frp'
            try {
              if (!snap.running || snap.provider !== 'frp') {
                snap = await adminJson('/api/mobile-access/remote/control', {
                  method: 'POST',
                  body: JSON.stringify(frpConfigured
                    ? { running: true, provider: 'frp' }
                    : { running: true }),
                })
              } else if (snap.state === 'error' || snap.state === 'unavailable' || snap.state === 'connecting') {
                snap = await adminJson('/api/mobile-access/remote/reconnect', {
                  method: 'POST',
                  body: '{}',
                })
              }
            } catch {
              // count as failed attempt below
            }
            await new Promise((resolve) => window.setTimeout(resolve, 2_500))
            try { snap = await adminJson('/api/mobile-access/remote/control') } catch { /* keep previous */ }
            if (healthy(snap)) {
              silentFails = 0
              toastShown = false
              return
            }
            silentFails += 1
            if (silentFails > 2 && !toastShown) {
              toastShown = true
              showRemoteToast('远程访问连接失败，请稍后在账号菜单中重试')
            }
          } catch {
            silentFails += 1
            if (silentFails > 2 && !toastShown) {
              toastShown = true
              showRemoteToast('远程访问连接失败，请稍后在账号菜单中重试')
            }
          } finally {
            inFlight = false
          }
        }

        void tick()
        timer = window.setInterval(() => { void tick() }, 20_000)
        window.setTimeout(() => { void tick() }, 4_000)
        window.setTimeout(() => { void tick() }, 12_000)
        void timer
      }

      installRemoteAutoEnsure()
    }

    // --- client-src/phone-switcher.js ---
    function installDeviceSwitcher() {
      if (typeof document === 'undefined') return
      const SWITCH_MENU_ATTR = 'data-t4y-mobile-switch-item'
      const SWITCH_ROOT_ID = 't4y-mobile-switch-root'
      const SWITCH_AUTH_KEY = 't4y.mobile.switchAuth.v1'
      const CURRENT_HOST_KEY = 't4y.mobile.currentHost.v1'
      const ENTERED_KEY = 't4y.mobile.cowatch.entered.v1'

      function readJson(storage, key) {
        try {
          const raw = storage.getItem(key)
          return raw ? JSON.parse(raw) : null
        } catch {
          return null
        }
      }

      function readSwitchAuth() {
        const fromSession = readJson(sessionStorage, SWITCH_AUTH_KEY)
        const fromLocal = readJson(localStorage, SWITCH_AUTH_KEY)
        // Prefer sessionStorage; migrate/clear durable localStorage copies.
        if (fromLocal && !fromSession) {
          try {
            sessionStorage.setItem(SWITCH_AUTH_KEY, JSON.stringify(fromLocal))
            localStorage.removeItem(SWITCH_AUTH_KEY)
          } catch { /* ignore */ }
        } else if (fromLocal) {
          try { localStorage.removeItem(SWITCH_AUTH_KEY) } catch { /* ignore */ }
        }
        const auth = fromSession || fromLocal
        if (auth && typeof auth.accessToken === 'string') {
          if (typeof auth.expiresAt === 'number' && auth.expiresAt <= Date.now()) {
            // fall through to reseed / scan fallback
          } else {
            return auth
          }
        }
        // QR / sticky enter：无 switchAuth 时仍可列当前电脑；跨机再走入口登录。
        try {
          if (sessionStorage.getItem(ENTERED_KEY) !== '1' && sessionStorage.getItem(FLAG) !== '1') return null
        } catch {
          return null
        }
        const identity = readJson(localStorage, SESSION_KEY)
        const expiresAt = typeof identity?.expiresAt === 'number' && identity.expiresAt > Date.now()
          ? identity.expiresAt
          : Date.now() + 8 * 3600_000
        return {
          accessToken: 'scan-local',
          enterpriseName: typeof identity?.enterpriseName === 'string' ? identity.enterpriseName : '',
          userName: typeof identity?.username === 'string' ? identity.username : '',
          accountKey: typeof identity?.accountKey === 'string' ? identity.accountKey : '',
          expiresAt,
          at: Date.now(),
          via: 'scan-fallback',
        }
      }

      /**
       * Paired phone can re-pull switchAuth from Host after tab kill / sessionStorage loss.
       * @returns {Promise<object | null>}
       */
      async function ensureSwitchAuth() {
        const existing = readSwitchAuth()
        if (canRedeemHost(existing)) return existing
        try {
          const response = await fetch('/api/t4y-mobile-cowatch/switch-auth-seed', {
            method: 'GET',
            credentials: 'same-origin',
            signal: AbortSignal.timeout(4_000),
          })
          if (!response.ok) return existing
          const body = await response.json()
          const seeded = body?.switchAuth
          if (!seeded || typeof seeded.accessToken !== 'string' || !canRedeemHost(seeded)) return existing
          const next = { ...seeded, at: Date.now(), via: seeded.via || 'qr-seed-refresh' }
          sessionStorage.setItem(SWITCH_AUTH_KEY, JSON.stringify(next))
          try { localStorage.removeItem(SWITCH_AUTH_KEY) } catch { /* ignore */ }
          return next
        } catch {
          return existing
        }
      }

      function canRedeemHost(auth) {
        return Boolean(auth
          && typeof auth.accessToken === 'string'
          && auth.accessToken !== ''
          && auth.accessToken !== 'scan-local'
          && auth.accessToken !== 'mobile-cowatch')
      }

      function readCurrentHost() {
        return readJson(localStorage, CURRENT_HOST_KEY)
      }

      async function probeHost(origin, accountKey) {
        try {
          const response = await fetch(`${String(origin).replace(/\/$/u, '')}/api/t4y-mobile-enter/host-card`, {
            credentials: 'omit',
            cache: 'no-store',
            mode: 'cors',
            signal: AbortSignal.timeout(4_000),
          })
          if (!response.ok) return null
          const card = await response.json()
          if (!card || (accountKey && card.accountKey !== accountKey)) return null
          return {
            id: card.id,
            label: card.label || origin,
            origin: String(card.origin || origin).replace(/\/$/u, ''),
            accountKey: card.accountKey,
            accepting: card.accepting === true,
            online: true,
          }
        } catch {
          return null
        }
      }

      async function collectHosts(auth) {
        // Product scope: current PC only — do not probe remembered multi-host history.
        const accountKey = auth?.accountKey || ''
        const byId = new Map()
        const current = readCurrentHost()
        if (current?.origin) {
          const probed = await probeHost(current.origin, accountKey)
          byId.set((probed || current).id || current.origin, probed || {
            ...current,
            online: false,
            accepting: false,
          })
        }
        const here = location.origin.replace(/\/$/u, '')
        if (![...byId.values()].some((host) => host.origin === here)) {
          const self = await probeHost(here, accountKey)
          if (self) byId.set(self.id, self)
          else if (!accountKey) {
            byId.set('current', {
              id: 'current',
              label: '当前电脑',
              origin: here,
              accountKey,
              accepting: true,
              online: true,
            })
          } else {
            byId.set('current', {
              id: 'current',
              label: '当前电脑',
              origin: here,
              accountKey,
              accepting: false,
              online: false,
            })
          }
        }
        return [...byId.values()]
      }

      function closeSwitcher() {
        try { document.getElementById(SWITCH_ROOT_ID)?.remove() } catch { /* ignore */ }
      }

      async function goToHost(host, auth) {
        const origin = String(host.origin || '').replace(/\/$/u, '')
        const here = location.origin.replace(/\/$/u, '')
        closeSwitcher()
        if (!canRedeemHost(auth)) {
          location.assign('/t4y-mobile-enter')
          return
        }
        try {
          sessionStorage.removeItem(ENTERED_KEY)
          sessionStorage.setItem(SWITCH_AUTH_KEY, JSON.stringify(auth))
          localStorage.removeItem(SWITCH_AUTH_KEY)
        } catch { /* ignore */ }
        if (origin === here) {
          // Re-select on this origin via enter page handoff (sessionStorage only).
          try {
            sessionStorage.setItem('t4y.mobile.enter.resume.v1', JSON.stringify({
              ...auth,
              at: Date.now(),
              preferSelect: true,
            }))
          } catch { /* ignore */ }
          location.assign('/t4y-mobile-enter#switch=1')
          return
        }
        try {
          const response = await fetch(`${origin}/api/t4y-mobile-cowatch/handoff-mint`, {
            method: 'POST',
            credentials: 'omit',
            mode: 'cors',
            cache: 'no-store',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              accessToken: auth.accessToken,
              enterpriseName: auth.enterpriseName,
              userName: auth.userName,
              accountKey: auth.accountKey,
              expiresAt: auth.expiresAt,
              preferSelect: true,
            }),
            signal: AbortSignal.timeout(6_000),
          })
          const data = await response.json().catch(() => null)
          if (!response.ok || typeof data?.code !== 'string' || data.code === '') {
            location.assign('/t4y-mobile-enter')
            return
          }
          location.assign(`${origin}/t4y-mobile-enter#handoff=${encodeURIComponent(data.code)}`)
        } catch {
          location.assign('/t4y-mobile-enter')
        }
      }

      async function openSwitcher() {
        closeSwitcher()
        const auth = await ensureSwitchAuth()
        const redeemable = canRedeemHost(auth)
        const root = document.createElement('div')
        root.id = SWITCH_ROOT_ID
        root.className = 't4y-mobile-switch-root'
        root.setAttribute('role', 'dialog')
        root.setAttribute('aria-modal', 'true')
        root.innerHTML = `<div class="t4y-mobile-switch-card">
          <h2>${t('switchTitle')}</h2>
          <p class="t4y-mobile-switch-body">${t('switchBody')}</p>
          <ul class="t4y-mobile-switch-list" id="t4y-mobile-switch-list"></ul>
          <div class="t4y-mobile-switch-actions">
            <button type="button" data-action="close">${t('switchClose')}</button>
            <button type="button" data-action="select-page">选机列表</button>
            <button type="button" class="primary" data-action="refresh">${t('switchRefresh')}</button>
          </div>
        </div>`
        document.body.appendChild(root)
        root.addEventListener('click', (event) => {
          if (event.target === root) closeSwitcher()
        })
        root.querySelector('[data-action="select-page"]')?.addEventListener('click', () => {
          closeSwitcher()
          void goToHost({ origin: location.origin, id: 'list', label: '选机列表' }, auth)
        })
        const list = root.querySelector('#t4y-mobile-switch-list')
        const paint = async () => {
          if (!(list instanceof HTMLElement)) return
          list.innerHTML = `<li style="color:#6b7280;font-size:.9rem;padding:.35rem 0">${t('checking')}</li>`
          const hosts = await collectHosts(auth || { accessToken: 'scan-local', accountKey: '' })
          const currentOrigin = String(readCurrentHost()?.origin || location.origin).replace(/\/$/u, '')
          list.innerHTML = ''
          if (hosts.length === 0) {
            list.innerHTML = `<li style="color:#6b7280;font-size:.9rem">${t('switchEmpty')}</li>`
            return
          }
          for (const host of hosts) {
            const li = document.createElement('li')
            const button = document.createElement('button')
            button.type = 'button'
            const origin = String(host.origin || '').replace(/\/$/u, '')
            const isCurrent = origin === currentOrigin
            const canEnter = host.online === true && host.accepting === true
            // 扫码免登会话没有企业 token 时，只允许查看当前机；换机走入口登录。
            const canSwitchTo = !isCurrent && canEnter && redeemable
            button.disabled = !isCurrent && !canSwitchTo
            let badgeClass = 'offline'
            let badgeText = t('switchOffline')
            if (isCurrent) {
              button.classList.add('is-current')
              badgeClass = 'current'
              badgeText = t('switchCurrent')
            } else if (canSwitchTo) {
              button.classList.add('is-ready')
              badgeClass = 'ready'
              badgeText = t('switchEnter')
            } else if (canEnter && !redeemable) {
              button.classList.add('is-off')
              badgeClass = 'off'
              badgeText = '需登录'
            } else if (host.online) {
              button.classList.add('is-off')
              badgeClass = 'off'
              badgeText = t('switchOff')
            } else {
              button.classList.add('is-offline')
            }
            button.innerHTML = `<span>${host.label || host.origin} <span class="badge ${badgeClass}">${badgeText}</span></span><span class="meta">${origin}</span>`
            if (canSwitchTo) {
              button.addEventListener('click', () => { void goToHost(host, auth) })
            } else if (isCurrent) {
              button.addEventListener('click', () => closeSwitcher())
            } else if (canEnter && !redeemable) {
              button.addEventListener('click', () => {
                closeSwitcher()
                location.assign('/t4y-mobile-enter')
              })
              button.disabled = false
            }
            li.appendChild(button)
            list.appendChild(li)
          }
        }
        root.querySelector('[data-action="close"]')?.addEventListener('click', () => closeSwitcher())
        root.querySelector('[data-action="refresh"]')?.addEventListener('click', () => { void paint() })
        void paint()
      }

      /** 电脑显示器图标，与账号菜单其它项左侧图标对齐。 */
      const SWITCH_HOST_ICON = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect x="2.25" y="2.5" width="11.5" height="8" rx="1.25" stroke="currentColor" stroke-width="1.3"/><path d="M5.5 13.5h5M8 10.5v3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>'

      function syncSwitchMenuItem() {
        try {
          const account = document.querySelector('[aria-label="账号菜单"][aria-expanded="true"], [aria-label="Account menu"][aria-expanded="true"]')
          if (!(account instanceof HTMLElement)) return
          const menu = document.querySelector('[role="menu"]')
          if (!(menu instanceof HTMLElement)) return
          // 去掉历史悬浮钮（旧会话残留）
          try { document.getElementById('t4y-mobile-switch-fab')?.remove() } catch { /* ignore */ }
          const existing = menu.querySelector(`button[${SWITCH_MENU_ATTR}="1"]`)
          if (existing instanceof HTMLElement) {
            if (!existing.querySelector('svg')) {
              const iconWrap = document.createElement('span')
              iconWrap.setAttribute('aria-hidden', 'true')
              iconWrap.style.cssText = 'display:inline-flex;width:16px;height:16px;flex:none;color:currentColor'
              iconWrap.innerHTML = SWITCH_HOST_ICON
              existing.insertBefore(iconWrap, existing.firstChild)
            }
            return
          }
          const sample = menu.querySelector('[role="menuitem"]')
          const item = document.createElement('button')
          item.type = 'button'
          item.setAttribute('role', 'menuitem')
          item.setAttribute(SWITCH_MENU_ATTR, '1')
          item.setAttribute('aria-label', t('switchDevice'))
          if (sample instanceof HTMLElement && sample.className) item.className = sample.className
          const iconWrap = document.createElement('span')
          iconWrap.setAttribute('aria-hidden', 'true')
          iconWrap.style.cssText = 'display:inline-flex;width:16px;height:16px;flex:none;color:currentColor'
          iconWrap.innerHTML = SWITCH_HOST_ICON
          const label = document.createElement('span')
          label.textContent = t('switchDevice')
          item.appendChild(iconWrap)
          item.appendChild(label)
          item.addEventListener('click', (event) => {
            event.preventDefault()
            event.stopPropagation()
            void openSwitcher()
          })
          const settings = [...menu.querySelectorAll('[role="menuitem"]')].find((el) => /设置|Settings/i.test(el.textContent || ''))
          if (settings?.nextSibling) menu.insertBefore(item, settings.nextSibling)
          else if (settings) settings.after(item)
          else menu.insertBefore(item, menu.firstChild)
        } catch { /* ignore */ }
      }

      const observer = new MutationObserver(() => { syncSwitchMenuItem() })
      try {
        observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-expanded'] })
        syncSwitchMenuItem()
        // 清掉旧版右下角悬浮「切换电脑」
        try { document.getElementById('t4y-mobile-switch-fab')?.remove() } catch { /* ignore */ }
      } catch { /* ignore */ }
    }

    // --- client-src/apply.js ---
    exports.inject = ['slots', 'locale']
    exports.apply = (ctx) => {
      // Desktop also needs the FRP-only simplify for「移动访问」.
      installEnterpriseMobileAccessSimplify()

      if (!active) return

      installStyles()
      installIdleWatchdog()
      installDeviceSwitcher()

      ctx.effect(() => () => {
        scrubLeakedChrome()
        try { document.getElementById(IDLE_GATE_ID)?.remove() } catch { /* ignore */ }
        try { document.getElementById('t4y-mobile-switch-root')?.remove() } catch { /* ignore */ }
        try { document.getElementById('t4y-mobile-switch-fab')?.remove() } catch { /* ignore */ }
      }, 't4y-mobile-cowatch: teardown')

      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 't4y-mobile-cowatch-wait',
        order: 0,
        locale: false,
      }, () => React.createElement(WaitGate)))
    }
    return module.exports
  },
})
