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
    /** First WaitGate retries should be snappy over FRP; back off only while waiting. */
    const POLL_MS_BASE = 700
    const POLL_MS_MAX = 12_000
    /** Phone over FRP: 5s aborted too often on cold RTT; keep well under Desktop's 20s. */
    const FETCH_TIMEOUT_MS = 12_000
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

    const COARSE_DEVICE_MODELS = new Set([
      'iPhone', 'iPad', 'Android', '手机', '浏览器', 'Mac', 'Windows', 'Windows Phone', '华为',
      'Mobile device', 'DeepSeek Harness Android', '1', 'test1',
    ])

    /**
     * @param {string} model
     * @returns {boolean}
     */
    function isConcretePhoneModel(model) {
      const m = String(model || '').trim()
      if (m.length < 3 || m.length > 32) return false
      return !COARSE_DEVICE_MODELS.has(m)
    }

    /**
     * Prefer Android Build model when present; otherwise a coarse class (iPhone / Android / …).
     * @param {string} [userAgent]
     * @returns {string}
     */
    function modelFromUserAgent(userAgent) {
      const ua = String(userAgent || (typeof navigator !== 'undefined' ? navigator.userAgent : '') || '')
      const fromBuild = ua.match(/;\s*([^;)]+?)\s+Build\//i)
      if (fromBuild?.[1]) {
        const name = fromBuild[1].trim().replace(/\s+/g, ' ')
        if (name && name.length <= 32 && !/^wv$/i.test(name)) return name.slice(0, 32)
      }
      const fromAndroid = ua.match(/Android\s+[\d.]+;\s*([^;)]+?)(?:\s+Build\/|[;)])/i)
      if (fromAndroid?.[1]) {
        const name = fromAndroid[1].trim().replace(/\s+/g, ' ')
        if (
          name
          && name.length <= 32
          && !/^wv$/i.test(name)
          && !/^(U|zh-cn|zh-tw|en-us)$/i.test(name)
        ) {
          return name.slice(0, 32)
        }
      }
      if (/iPhone/i.test(ua)) return 'iPhone'
      if (/iPad/i.test(ua)) return 'iPad'
      if (/Android/i.test(ua)) return 'Android'
      if (/HarmonyOS|HUAWEI/i.test(ua)) return '华为'
      if (/Mobile|phone/i.test(ua)) return '手机'
      if (/Macintosh|Mac OS/i.test(ua)) return 'Mac'
      if (/Windows/i.test(ua)) return 'Windows'
      return '浏览器'
    }

    /**
     * Cross-browser phone id. Concrete Android models (VER-AN10) use the model alone so
     * Chrome / 系统浏览器 / 微信内置浏览器 share one fingerprint.
     * @returns {Promise<string>}
     */
    async function crossBrowserDeviceFingerprint() {
      const ua = String((typeof navigator !== 'undefined' ? navigator.userAgent : '') || '')
      const model = modelFromUserAgent(ua)
      if (isConcretePhoneModel(model)) return `xbf2.model.${model}`
      const family = /iPhone|iPad|iPod/i.test(ua) ? 'ios' : (/Android/i.test(ua) ? 'android' : 'other')
      let tz = ''
      try {
        tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''
      } catch { /* ignore */ }
      const screenObj = typeof screen !== 'undefined' ? screen : { width: 0, height: 0 }
      const w = Number(screenObj.width) || 0
      const h = Number(screenObj.height) || 0
      const shortSide = Math.min(w, h)
      const longSide = Math.max(w, h)
      const dpr = Math.round((typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1) * 100) / 100
      const parts = [
        'v2',
        family,
        model,
        `${shortSide}x${longSide}`,
        String(dpr),
        String(typeof navigator !== 'undefined' ? (navigator.maxTouchPoints || 0) : 0),
        tz,
      ]
      const raw = parts.join('|')
      try {
        if (typeof crypto !== 'undefined' && crypto.subtle) {
          const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))
          const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
          return `xbf2.${hex}`
        }
      } catch { /* fall through */ }
      let hash = 2166136261
      for (let i = 0; i < raw.length; i += 1) {
        hash ^= raw.charCodeAt(i)
        hash = Math.imul(hash, 16777619)
      }
      return `xbf2.fb${(hash >>> 0).toString(16).padStart(8, '0')}`
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
