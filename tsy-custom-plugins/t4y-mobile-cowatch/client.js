/**
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

    const SESSION_KEY = 't4y.identity.session.v1'
    const SESSION_EVENT = 't4y-identity:session'
    const STYLE_ID = 't4y-mobile-cowatch-style'
    const FLAG = 't4y.mobile.cowatch'
    const POLL_MS = 3000

    const copy = {
      zh: {
        title: '请先在电脑完成登录',
        body: '手机仅遥控本机助手，不单独登录。请在电脑端登录企业账号并选择项目；完成后本页会自动进入。',
        waitingKey: '电脑尚未就绪模型凭据，请在电脑端重新登录后再试。',
        polling: '正在等待电脑登录…',
      },
      en: {
        title: 'Sign in on the computer first',
        body: 'This phone only remote-controls the PC assistant. Sign in and pick a project on the computer; this page will join automatically.',
        waitingKey: 'The computer has no model credentials yet. Sign in again on the PC, then retry.',
        polling: 'Waiting for the computer to sign in…',
      },
    }

    /** @returns {boolean} */
    function isMobileUa() {
      const ua = typeof navigator !== 'undefined' ? (navigator.userAgent || '') : ''
      return /Android|iPhone|iPad|iPod|Mobile|HarmonyOS|MicroMessenger/i.test(ua)
    }

    /**
     * Phone / paired WebView only. Desktop Web (含「移动访问」面板所在页) 必须保持
     * 完全不激活：清掉实验室用的 session 标记，避免全屏等待层遮住侧栏。
     * @returns {boolean}
     */
    function detectMobileCowatch() {
      try {
        const params = new URLSearchParams(window.location.search)
        if (params.get('t4yMobile') === '0') {
          sessionStorage.removeItem(FLAG)
          return false
        }
        // Desktop UA: never activate. Stale ?t4yMobile=1 lab flags must not
        // cover the PC Web shell (sidebar / 移动访问).
        if (!isMobileUa()) {
          sessionStorage.removeItem(FLAG)
          return false
        }
        if (params.get('t4yMobile') === '1') {
          sessionStorage.setItem(FLAG, '1')
          return true
        }
        if (sessionStorage.getItem(FLAG) === '1') return true
      } catch { /* ignore */ }
      return isMobileUa()
    }

    const active = detectMobileCowatch()
    /** Bound before any wrap so phone guards never recurse. */
    const rawFetch = window.fetch.bind(window)

    /** @returns {'zh' | 'en'} */
    function lang() {
      const raw = (document.documentElement.lang || navigator.language || 'zh').toLowerCase()
      return raw.startsWith('zh') ? 'zh' : 'en'
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

    const FETCH_TIMEOUT_MS = 8_000

    /**
     * Pull Desktop-shared session + whether Host already holds T4Y_NEW_API_KEY.
     * @returns {Promise<{ session: object | null, modelKeyPresent: boolean }>}
     */
    async function pullHostReady() {
      try {
        const response = await rawFetch('/api/t4y-identity/host-session', {
          method: 'GET',
          credentials: 'same-origin',
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        })
        if (!response.ok) return { session: null, modelKeyPresent: false }
        const data = await response.json()
        const session = data?.session
        if (!session || typeof session.accessToken !== 'string' || session.accessToken === '') {
          return { session: null, modelKeyPresent: false }
        }
        if (typeof session.expiresAt !== 'number' || session.expiresAt <= Date.now()) {
          return { session: null, modelKeyPresent: false }
        }
        if (session.needsModulePick === true) return { session: null, modelKeyPresent: false }
        if (typeof session.moduleId !== 'string' || session.moduleId === '') {
          return { session: null, modelKeyPresent: false }
        }
        const modelKeyPresent = data?.modelKeyPresent === true
          || (typeof session.llmApiKeyExpiresAt === 'number' && session.llmApiKeyExpiresAt > Date.now())
        return { session, modelKeyPresent }
      } catch {
        return { session: null, modelKeyPresent: false }
      }
    }

    /** @returns {Promise<boolean>} */
    async function hostHasModelKey() {
      const ready = await pullHostReady()
      return ready.modelKeyPresent
    }

    /** @returns {Promise<object | null>} */
    async function pullHostSession() {
      const ready = await pullHostReady()
      return ready.session
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

    // Desktop Web must never stay in cowatch mode.
    if (!isMobileUa()) scrubLeakedChrome()

    if (active) {
      document.documentElement.dataset.t4yMobileCowatch = '1'
      installFetchGuards()
    }

    window.__t4yMobileCowatch = {
      active,
      detect: detectMobileCowatch,
      rev: '2026-11-05-rollback-safe',
    }

    function installStyles() {
      if (document.getElementById(STYLE_ID)) return
      const style = document.createElement('style')
      style.id = STYLE_ID
      // Phone-only light cosmetics. No AppFrame grid rewrite, no chat width
      // overrides, no shortcut dock — those broke desktop / failed to ship.
      style.textContent = `
        html[data-t4y-mobile-cowatch="1"] .t4y-identity-root[data-t4y-identity="login-gate"],
        html[data-t4y-mobile-cowatch="1"] .t4y-identity-root[data-t4y-identity="module-pick"].t4y-identity-root-gate,
        html[data-t4y-mobile-cowatch="1"] .t4y-identity-root[data-t4y-identity="restoring"] {
          display: none !important;
        }
        .t4y-mobile-cowatch-root {
          position: fixed;
          inset: 0;
          z-index: 10050;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          background: var(--dsw-alias-bg-primary, #f8fafc);
          color: var(--dsw-alias-label-primary, #0f172a);
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
        html[data-t4y-mobile-cowatch="1"] [role="menu"] {
          z-index: 4000 !important;
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

    function WaitGate() {
      const [status, setStatus] = React.useState(t('polling'))
      const [visible, setVisible] = React.useState(true)
      const adopting = React.useRef(false)

      React.useEffect(() => {
        let cancelled = false
        const adopt = async () => {
          if (adopting.current) return
          const existing = readSession()
          if (existing && existing.needsModulePick !== true && existing.moduleId) {
            const present = await hostHasModelKey()
            if (cancelled) return
            if (present) {
              setVisible(false)
              document.documentElement.dataset.t4yIdentityAuthed = '1'
              return
            }
            setStatus(t('waitingKey'))
            setVisible(true)
            return
          }
          const shared = await pullHostSession()
          if (cancelled) return
          if (!shared) {
            setStatus(t('polling'))
            setVisible(true)
            return
          }
          const present = await hostHasModelKey()
          if (cancelled) return
          if (!present) {
            setStatus(t('waitingKey'))
            setVisible(true)
            return
          }
          const stamp = typeof shared.accessToken === 'string' ? shared.accessToken.slice(-12) : ''
          const flagKey = 't4y.mobile.cowatch.adopted'
          try {
            if (sessionStorage.getItem(flagKey) === stamp) {
              writeLocalSession(shared)
              window.dispatchEvent(new CustomEvent(SESSION_EVENT, { detail: { session: shared } }))
              setVisible(false)
              document.documentElement.dataset.t4yIdentityAuthed = '1'
              return
            }
            sessionStorage.setItem(flagKey, stamp)
          } catch { /* ignore */ }
          adopting.current = true
          writeLocalSession(shared)
          setVisible(false)
          window.setTimeout(() => {
            try { window.location.reload() } catch { /* ignore */ }
          }, 50)
        }
        adopt()
        const timer = window.setInterval(adopt, POLL_MS)
        const onSession = () => {
          const session = readSession()
          if (session && session.needsModulePick !== true && session.moduleId) {
            void hostHasModelKey().then((present) => {
              if (cancelled) return
              if (present) {
                setVisible(false)
                document.documentElement.dataset.t4yIdentityAuthed = '1'
              } else {
                setVisible(true)
                setStatus(t('waitingKey'))
              }
            })
          }
        }
        window.addEventListener(SESSION_EVENT, onSession)
        return () => {
          cancelled = true
          window.clearInterval(timer)
          window.removeEventListener(SESSION_EVENT, onSession)
        }
      }, [])

      if (!visible) return null
      return React.createElement('div', {
        className: 't4y-mobile-cowatch-root',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': 't4y-mobile-cowatch-title',
      }, React.createElement('div', { className: 't4y-mobile-cowatch-card' },
        React.createElement('h2', { id: 't4y-mobile-cowatch-title', className: 't4y-mobile-cowatch-title' }, t('title')),
        React.createElement('p', { className: 't4y-mobile-cowatch-body' }, t('body')),
        React.createElement('p', { className: 't4y-mobile-cowatch-status' }, status)))
    }

    exports.inject = ['slots', 'locale']
    exports.apply = (ctx) => {
      if (!active) return

      installStyles()

      ctx.effect(() => () => {
        scrubLeakedChrome()
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
