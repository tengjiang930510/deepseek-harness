window.__ModuleLoader__.load({
  id: 't4y-identity/client',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const ReactDOM = require('react-dom')
    const capabilityHub = require('t4y-capability-hub/client')
    const SESSION_KEY = 't4y.identity.session.v1'
    /** Survives logout: last enterprise/username and last chosen project. */
    const PREFS_KEY = 't4y.identity.prefs.v1'
    /**
     * Set on interactive login so a Desktop window remount (or a same-tab
     * remount) can skip the restore-login gate — profile + model key were
     * just fetched in submitLogin.
     */
    const FRESH_AUTH_KEY = 't4y.identity.fresh-auth.v1'
    const FRESH_AUTH_MS = 30_000
    const EVENT_NAME = 't4y-identity:session'
    const MENU_ACTION_EVENT = 't4y-identity:menu-action'
    const OVERLAY_UI_EVENT = 't4y-identity:overlay-ui'
    const BRAND_EVENT = 't4y-brand:changed'
    /**
     * Dialog open flags live on window. The host remounts shell.overlay when
     * the account menu closes; React useState would reset, and a module-local
     * object can diverge across duplicate plugin evaluations.
     * Callers must set flags before closing the menu so remount init sees them.
     */
    function getOverlayUi() {
      const existing = window.__t4yIdentityOverlayUi
      if (existing && typeof existing === 'object') return existing
      const next = { moduleOpen: false, logoutOpen: false }
      window.__t4yIdentityOverlayUi = next
      return next
    }

    function setOverlayUi(patch) {
      const overlayUi = Object.assign(getOverlayUi(), patch)
      window.dispatchEvent(new CustomEvent(OVERLAY_UI_EVENT, { detail: { ...overlayUi } }))
    }
    const LOCALE_NS = 't4y.identity'
    const API_BASE_URL = 'https://jgyw.crfsdi.com.cn:51111/backendapi'
    /** File host used when module logo/favicon come back as relative paths. */
    const ASSET_BASE_URL = 'https://eims.crfsdi.com.cn:59111'
    /**
     * Broker `expiresIn` is seconds; cap matches t4y-key-broker `BROKER_MAX_SESSION_SECONDS`.
     * Enterprise login `data.expires_in` is minutes (43200 = 30 days).
     */
    const MODEL_KEY_MAX_SECONDS = 30 * 24 * 60 * 60

    /**
     * Convert enterprise login `expires_in` (minutes) to Broker seconds.
     * @param {unknown} expiresInMinutes
     * @returns {number}
     */
    function enterpriseExpiresInToSeconds(expiresInMinutes) {
      const minutes = Number(expiresInMinutes)
      if (!Number.isFinite(minutes) || minutes <= 0) return MODEL_KEY_MAX_SECONDS
      return Math.min(Math.floor(minutes * 60), MODEL_KEY_MAX_SECONDS)
    }


    /** System tenant id (login enterprise.id). moduleId is the enterprise. */
    function sessionTenantId(session) {
      if (typeof session?.tenantId === 'string' && session.tenantId !== '') return session.tenantId
      // Brief rename window wrote enterpriseId for the same system id.
      if (typeof session?.enterpriseId === 'string' && session.enterpriseId !== '') return session.enterpriseId
      return ''
    }


    const copy = {
      zh: {
        loginTitle: '开始使用',
        loginDescription: '登录企业账号后即可使用。你的项目和文件保存在本地。',
        enterpriseName: '企业名',
        username: '账号',
        password: '密码',
        accountLogin: '账户登录',
        signIn: '登录',
        logout: '退出登录',
        cancel: '取消',
        close: '关闭',
        signOutDescription: '退出登录不会丢失任何数据，你仍可以登录此账号。',
        badCredentials: '账号或密码错误，请重试。',
        networkError: '网络异常，请稍后重试。',
        encryptError: '密码加密失败，请重试。',
        infoError: '登录成功但获取用户信息失败，请重试。',
        keyError: '登录成功但创建模型访问凭据失败，请重试。',
        waiting: '正在登录…',
        restoring: '正在恢复登录…',
        pickModuleTitle: '选择项目',
        pickModuleDescription: '请选择要进入的项目。之后可在账号菜单中切换。',
        confirmModule: '进入项目',
        switchModule: '切换项目',
        currentModule: '当前项目',
        noModule: '暂无可用项目',
        noModuleDescription: '当前账号未分配任何项目，请联系管理员开通后再登录。',
        currentAccount: '当前账号',
      },
      en: {
        loginTitle: 'Get started',
        loginDescription: 'Sign in with your enterprise account to continue. Your projects and files are stored locally.',
        enterpriseName: 'Enterprise',
        username: 'Username',
        password: 'Password',
        accountLogin: 'Account sign in',
        signIn: 'Sign in',
        logout: 'Sign out',
        cancel: 'Cancel',
        close: 'Close',
        signOutDescription: 'Signing out will not delete any data. You can sign in to this account again.',
        badCredentials: 'Invalid username or password. Try again.',
        networkError: 'Network error. Please try again.',
        encryptError: 'Failed to encrypt password. Please try again.',
        infoError: 'Signed in, but failed to load profile. Please try again.',
        keyError: 'Signed in, but failed to create model access credentials. Please try again.',
        waiting: 'Signing in…',
        restoring: 'Restoring session…',
        pickModuleTitle: 'Choose a project',
        pickModuleDescription: 'Select a project to enter. You can switch later from the account menu.',
        confirmModule: 'Enter project',
        switchModule: 'Switch project',
        currentModule: 'Current project',
        noModule: 'No projects available',
        noModuleDescription: 'This account has no assigned projects. Ask an administrator to grant access, then sign in again.',
        currentAccount: 'Signed in as',
      },
    }

    // --- RSA PKCS#1 v1.5 (bejson / JSEncrypt compatible) ---

    function bytesToBigInt(bytes) {
      let hex = ''
      for (const byte of bytes) hex += byte.toString(16).padStart(2, '0')
      return BigInt(`0x${hex || '0'}`)
    }

    function bigIntToBytes(value, length) {
      let hex = value.toString(16)
      if (hex.length % 2) hex = `0${hex}`
      const raw = new Uint8Array(hex.length / 2)
      for (let i = 0; i < raw.length; i += 1) {
        raw[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
      }
      if (raw.length === length) return raw
      if (raw.length > length) return raw.slice(raw.length - length)
      const out = new Uint8Array(length)
      out.set(raw, length - raw.length)
      return out
    }

    function modPow(base, exp, mod) {
      let result = 1n
      let b = base % mod
      let e = exp
      while (e > 0n) {
        if (e & 1n) result = (result * b) % mod
        b = (b * b) % mod
        e >>= 1n
      }
      return result
    }

    function readDerLength(bytes, offset) {
      const first = bytes[offset]
      if (first < 0x80) return { length: first, offset: offset + 1 }
      const size = first & 0x7f
      let length = 0
      for (let i = 0; i < size; i += 1) length = (length << 8) | bytes[offset + 1 + i]
      return { length, offset: offset + 1 + size }
    }

    function readDerInteger(bytes, offset) {
      if (bytes[offset] !== 0x02) throw new Error('Expected INTEGER')
      const len = readDerLength(bytes, offset + 1)
      const start = len.offset
      const end = start + len.length
      let cursor = start
      while (cursor < end - 1 && bytes[cursor] === 0x00) cursor += 1
      return { value: bytesToBigInt(bytes.subarray(cursor, end)), offset: end }
    }

    function parseSpkiRsaPublicKey(spkiB64) {
      const der = Uint8Array.from(atob(spkiB64.replace(/\s+/g, '')), (c) => c.charCodeAt(0))
      if (der[0] !== 0x30) throw new Error('Invalid SPKI')
      const seq = readDerLength(der, 1)
      let offset = seq.offset
      if (der[offset] !== 0x30) throw new Error('Invalid AlgorithmIdentifier')
      const alg = readDerLength(der, offset + 1)
      offset = alg.offset + alg.length
      if (der[offset] !== 0x03) throw new Error('Invalid BIT STRING')
      const bit = readDerLength(der, offset + 1)
      offset = bit.offset
      if (der[offset] === 0x00) offset += 1
      if (der[offset] !== 0x30) throw new Error('Invalid RSAPublicKey')
      const keySeq = readDerLength(der, offset + 1)
      offset = keySeq.offset
      const modulus = readDerInteger(der, offset)
      const exponent = readDerInteger(der, modulus.offset)
      return { n: modulus.value, e: exponent.value }
    }

    function rsaEncryptPkcs1(spkiB64, text) {
      const { n, e } = parseSpkiRsaPublicKey(spkiB64)
      const k = Math.ceil(n.toString(16).length / 2)
      const message = new TextEncoder().encode(text)
      if (message.length > k - 11) throw new Error('Message too long for RSA key')
      const padded = new Uint8Array(k)
      padded[0] = 0x00
      padded[1] = 0x02
      const psLen = k - message.length - 3
      for (let i = 0; i < psLen; i += 1) {
        let byte = 0
        while (byte === 0) byte = crypto.getRandomValues(new Uint8Array(1))[0]
        padded[2 + i] = byte
      }
      padded[2 + psLen] = 0x00
      padded.set(message, 3 + psLen)
      const cipher = modPow(bytesToBigInt(padded), e, n)
      const bytes = bigIntToBytes(cipher, k)
      let binary = ''
      for (const byte of bytes) binary += String.fromCharCode(byte)
      return btoa(binary)
    }

    // --- API ---

    async function apiJson(path, options = {}) {
      const headers = {
        Accept: 'application/json, text/plain, */*',
        browser: 'Safari',
        'operating-system': 'Mac/iOS',
        'operator-type': 'PC',
        ...(options.headers || {}),
      }
      if (options.body !== undefined && headers['Content-Type'] === undefined) {
        headers['Content-Type'] = 'application/json'
      }
      let response
      try {
        response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers })
      } catch {
        return { ok: false, messageKey: 'networkError' }
      }
      let json
      try {
        json = await response.json()
      } catch {
        return { ok: false, messageKey: 'networkError' }
      }
      if (json?.code !== 200) {
        const msg = typeof json?.msg === 'string' && json.msg !== '' ? json.msg : null
        return { ok: false, messageKey: 'badCredentials', message: msg }
      }
      return { ok: true, data: json.data }
    }

    async function fetchPublicKey() {
      const result = await apiJson('/auth/publicKey')
      if (!result.ok) return result
      const publicKey = result.data?.publicKey
      if (typeof publicKey !== 'string' || publicKey === '') {
        return { ok: false, messageKey: 'networkError' }
      }
      return { ok: true, publicKey }
    }

    async function loginRequest(enterpriseName, userName, password) {
      const keyResult = await fetchPublicKey()
      if (!keyResult.ok) return keyResult
      let encrypted
      try {
        encrypted = rsaEncryptPkcs1(keyResult.publicKey, password)
      } catch {
        return { ok: false, messageKey: 'encryptError' }
      }
      const result = await apiJson('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ enterpriseName, userName, password: encrypted }),
      })
      if (!result.ok) return result
      const accessToken = result.data?.access_token
      if (typeof accessToken !== 'string' || accessToken === '') {
        return { ok: false, messageKey: 'networkError' }
      }
      return {
        ok: true,
        accessToken,
        // Seconds for Broker / local expiresAt; enterprise field is minutes.
        expiresIn: enterpriseExpiresInToSeconds(result.data?.expires_in),
      }
    }

    async function authorizedGet(path, accessToken) {
      return apiJson(path, { headers: { Authorization: accessToken } })
    }

    async function issueModelKey(accessToken, expiresIn, context) {
      const moduleId = typeof context?.moduleId === 'string' ? context.moduleId.trim() : ''
      if (moduleId === '') return { ok: false, message: 'moduleId is required' }
      try {
        const response = await fetch('/api/t4y-identity/issue-model-key', {
          method: 'POST',
          headers: { Authorization: accessToken, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            expiresIn,
            moduleId,
            ...(typeof context?.moduleName === 'string' && context.moduleName !== ''
              ? { moduleName: context.moduleName }
              : {}),
            ...(typeof context?.tenantId === 'string' && context.tenantId !== ''
              ? {
                tenantId: context.tenantId,
                reason: context.reason || 'issue-model-key',
              }
              : {}),
          }),
        })
        const data = await response.json()
        if (!response.ok || typeof data?.expiresAt !== 'number') {
          return {
            ok: false,
            message: typeof data?.message === 'string' && data.message !== '' ? data.message : undefined,
          }
        }
        return {
          ok: true,
          expiresAt: data.expiresAt,
          homeModuleId: typeof data.homeModuleId === 'string' ? data.homeModuleId : moduleId,
          models: Array.isArray(data.models) ? data.models : [],
          defaultModel: typeof data.defaultModel === 'string' ? data.defaultModel : undefined,
        }
      } catch { return { ok: false } }
    }

    async function revokeModelKey(accessToken) {
      if (typeof accessToken !== 'string' || accessToken === '') return
      try {
        await fetch('/api/t4y-identity/revoke-model-key', {
          method: 'POST',
          headers: { Authorization: accessToken },
        })
      } catch { /* logout continues even if revoke fails */ }
    }

    /** Push enterprise/project ids into Host t4yTenant (browser events alone do not). */
    async function syncHostContext(session, reason) {
      if (!session?.accessToken || sessionTenantId(session) === '') return
      try {
        await fetch('/api/t4y-identity/set-context', {
          method: 'POST',
          headers: {
            Authorization: session.accessToken,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            tenantId: sessionTenantId(session),
            moduleId: session.moduleId || null,
            reason: reason || 'client-context',
          }),
        })
      } catch { /* Host context is best-effort; UI still follows localStorage */ }
    }

    /**
     * Reconcile managed package enablement with the new project menu.
     */
    async function applyModulePlugins(session) {
      if (!session?.accessToken || typeof session.moduleId !== 'string' || session.moduleId === '') return
      try {
        await fetch('/api/t4y-release/apply-module', {
          method: 'POST',
          headers: {
            'X-T4Y-Access-Token': session.accessToken,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ moduleId: session.moduleId }),
        })
      } catch { /* capability tab still shows the new menu; enablement may lag */ }
    }

    /** Sync the current project without changing the selected conversation. */
    async function afterProjectContext(session, { reason }) {
      if (!session) return
      await syncHostContext(session, reason)
      // Plugin disable talks to the enterprise menu API — do not block the UI switch.
      if (session.moduleId && !session.needsModulePick) {
        void applyModulePlugins(session).then(() => {
          emitTenant(session, 'module-plugins-applied')
        })
      }
    }

    async function checkSessionStatus(accessToken, moduleId) {
      try {
        const response = await fetch('/api/t4y-identity/session-status', {
          method: 'POST',
          headers: { Authorization: accessToken, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...(typeof moduleId === 'string' && moduleId !== '' ? { moduleId } : {}),
          }),
        })
        if (response.status === 401) return { ok: true, active: false, reason: 'identity_invalid' }
        const data = await response.json()
        if (!response.ok) return { ok: false }
        return { ok: true, active: data?.active === true, reason: data?.reason, expiresAt: data?.expiresAt }
      } catch { return { ok: false } }
    }

    function remainingExpiresIn(session) {
      if (typeof session?.expiresAt !== 'number') return MODEL_KEY_MAX_SECONDS
      return Math.max(1, Math.floor((session.expiresAt - Date.now()) / 1000))
    }

    function resolveAssetUrl(url) {
      if (typeof url !== 'string' || url === '') return ''
      if (/^(https?:|data:)/i.test(url)) return url
      if (url.startsWith('/')) {
        // Encode path segments so Chinese filenames (e.g. 图片1.png) load in <img>.
        const encoded = url.split('/').map((part, index) => {
          if (index === 0 || part === '') return part
          try {
            return encodeURIComponent(decodeURIComponent(part))
          } catch {
            return encodeURIComponent(part)
          }
        }).join('/')
        return `${ASSET_BASE_URL}${encoded}`
      }
      return url
    }

    function mapModuleItem(item) {
      if (typeof item?.id !== 'string' || item.id === '') return null
      if (item.hideModule === '1') return null
      const logo = resolveAssetUrl(typeof item.logo === 'string' ? item.logo : '')
        || resolveAssetUrl(typeof item.favicon === 'string' ? item.favicon : '')
      return {
        id: item.id,
        name: typeof item.name === 'string' && item.name !== '' ? item.name : item.id,
        logo,
        favicon: resolveAssetUrl(typeof item.favicon === 'string' ? item.favicon : ''),
      }
    }

    /**
     * Accepts getRouters groups `[{ items }]` or module/list payload `{ items }`.
     * @param {*} payload
     */
    function normalizeModules(payload) {
      if (Array.isArray(payload)) {
        const modules = []
        for (const group of payload) {
          const items = Array.isArray(group?.items) ? group.items : []
          for (const item of items) {
            const mapped = mapModuleItem(item)
            if (mapped) modules.push(mapped)
          }
        }
        return modules
      }
      if (payload && Array.isArray(payload.items)) {
        return payload.items.map(mapModuleItem).filter(Boolean)
      }
      return []
    }

    /**
     * Prefer getRouters (projects assigned to this account). module/list returns
     * enterprise-wide modules and must not be used as the primary source — an
     * account with no projects would otherwise see every common module.
     */
    async function loadModules(accessToken) {
      const routers = await apiJson('/system/module/getRouters?clientType=0', {
        method: 'POST',
        headers: {
          Authorization: accessToken,
          'Content-Type': 'application/json',
        },
        body: '',
      })
      if (routers.ok) return normalizeModules(routers.data)
      return []
    }

    async function loadProfile(accessToken, expiresAt, previous) {
      const info = await authorizedGet('/system/user/getInfo', accessToken)
      if (!info.ok) return { ok: false, messageKey: 'infoError', message: info.message }
      const enterprise = info.data?.enterprise || {}
      const user = info.data?.user || {}
      // Login payload field is enterprise.id; in this product it is the system tenant id.
      const tenantId = String(enterprise.id || '')
      if (tenantId === '') return { ok: false, messageKey: 'infoError' }

      const modules = await loadModules(accessToken)
      const username = typeof user.userName === 'string' ? user.userName : ''

      let moduleId = typeof previous?.moduleId === 'string' ? previous.moduleId : null
      // Remembered project is per account; never reuse another user's last moduleId.
      if (!moduleId) {
        const prefs = readPrefs()
        if (prefs.moduleId && prefs.username === username) moduleId = prefs.moduleId
      }
      if (moduleId && !modules.some((item) => item.id === moduleId)) moduleId = null
      if (moduleId === null && modules.length === 1) moduleId = modules[0].id
      const selected = modules.find((item) => item.id === moduleId) || null

      const session = {
        accessToken,
        expiresAt,
        username,
        displayName: typeof user.nickName === 'string' && user.nickName !== ''
          ? user.nickName
          : (username !== '' ? username : '用户'),
        tenantId,
        enterpriseName: typeof enterprise.name === 'string' ? enterprise.name : '',
        systemName: typeof enterprise.systemName === 'string' && enterprise.systemName !== ''
          ? enterprise.systemName
          : (typeof enterprise.nick === 'string' ? enterprise.nick : ''),
        logo: resolveAssetUrl(typeof enterprise.logo === 'string' ? enterprise.logo : ''),
        roles: Array.isArray(info.data?.roles) ? info.data.roles.filter((role) => typeof role === 'string') : [],
        moduleId,
        moduleName: selected?.name || null,
        moduleLogo: selected?.logo || selected?.favicon || null,
        modules,
        loggedInAt: previous?.loggedInAt || new Date().toISOString(),
        // No assigned projects, or multiple with none chosen yet → keep the gate up.
        needsModulePick: modules.length === 0 || (modules.length > 1 && moduleId === null),
      }
      return { ok: true, session }
    }

    // --- Session / prefs persistence ---

    function readPrefs() {
      try {
        const raw = localStorage.getItem(PREFS_KEY)
        if (!raw) return { enterpriseName: '', username: '', moduleId: null }
        const parsed = JSON.parse(raw)
        return {
          enterpriseName: typeof parsed?.enterpriseName === 'string' ? parsed.enterpriseName : '',
          username: typeof parsed?.username === 'string' ? parsed.username : '',
          moduleId: typeof parsed?.moduleId === 'string' && parsed.moduleId !== '' ? parsed.moduleId : null,
        }
      } catch {
        return { enterpriseName: '', username: '', moduleId: null }
      }
    }

    function writePrefs(patch) {
      const next = { ...readPrefs(), ...patch }
      localStorage.setItem(PREFS_KEY, JSON.stringify(next))
      return next
    }

    function rememberLoginPrefs(session) {
      if (!session) return
      const prefs = readPrefs()
      // Keep the typed enterprise login name; API may return a display name.
      writePrefs({
        enterpriseName: prefs.enterpriseName,
        username: typeof session.username === 'string' && session.username !== ''
          ? session.username
          : prefs.username,
        moduleId: typeof session.moduleId === 'string' && session.moduleId !== ''
          ? session.moduleId
          : prefs.moduleId,
      })
    }

    function readSession() {
      try {
        const raw = localStorage.getItem(SESSION_KEY)
        if (!raw) return null
        const parsed = JSON.parse(raw)
        if (!parsed || typeof parsed.accessToken !== 'string' || sessionTenantId(parsed) === '') return null
        parsed.tenantId = sessionTenantId(parsed)
        if (typeof parsed.expiresAt === 'number' && Date.now() >= parsed.expiresAt) {
          localStorage.removeItem(SESSION_KEY)
          return null
        }
        if (typeof parsed.llmApiKeyExpiresAt === 'number' && Date.now() >= parsed.llmApiKeyExpiresAt) {
          localStorage.removeItem(SESSION_KEY)
          return null
        }
        return parsed
      } catch {
        return null
      }
    }

    function markFreshAuth() {
      try {
        localStorage.setItem(FRESH_AUTH_KEY, String(Date.now() + FRESH_AUTH_MS))
      } catch {
        // Private mode / quota — restore gate may flash once; login still works.
      }
    }

    /** @returns {boolean} whether a fresh interactive login is still within the skip window. */
    function peekFreshAuth() {
      try {
        const raw = localStorage.getItem(FRESH_AUTH_KEY)
        if (!raw) return false
        const until = Number(raw)
        return Number.isFinite(until) && Date.now() < until
      } catch {
        return false
      }
    }

    /** Consume the skip-restore marker so cold starts still run the restore gate. */
    function consumeFreshAuth() {
      const fresh = peekFreshAuth()
      try {
        localStorage.removeItem(FRESH_AUTH_KEY)
      } catch {
        // ignore
      }
      return fresh
    }

    function emitBrand(session) {
      // Prefer selected project name; fall back to enterprise systemName.
      const name = session?.moduleName || session?.systemName || ''
      const enterpriseLogo = session?.logo || ''
      const logo = session?.moduleLogo || enterpriseLogo || ''
      window.dispatchEvent(new CustomEvent(BRAND_EVENT, {
        detail: { name, logo, enterpriseLogo, session },
      }))
    }

    function emitTenant(session, reason) {
      window.dispatchEvent(new CustomEvent('t4y-tenant:changed', {
        detail: {
          tenantId: sessionTenantId(session),
          moduleId: session?.moduleId || null,
          reason,
        },
      }))
    }

    function writeSession(session, reason = 'update') {
      if (session === null) localStorage.removeItem(SESSION_KEY)
      else localStorage.setItem(SESSION_KEY, JSON.stringify(session))
      window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { session } }))
      emitBrand(session)
      emitTenant(session, reason)
      // Keep Host t4yTenant aligned whenever the browser session changes.
      // Logout clears Host via revoke-model-key → identity.logout().
      if (session) void syncHostContext(session, reason)
    }

    async function doLogout() {
      const current = readSession()
      if (current) rememberLoginPrefs(current)
      if (current?.accessToken) await revokeModelKey(current.accessToken)
      try { localStorage.removeItem(FRESH_AUTH_KEY) } catch { /* ignore */ }
      writeSession(null, 'logout')
    }

    function selectModule(session, moduleId) {
      const selected = (session.modules || []).find((item) => item.id === moduleId)
      if (!selected) return session
      const next = {
        ...session,
        moduleId: selected.id,
        moduleName: selected.name,
        moduleLogo: selected.logo || selected.favicon || '',
        needsModulePick: false,
      }
      return next
    }

    /**
     * Select a project and switch Workspace / plugins / brand.
     *
     * module ≈ 企业（分账单元）。普通人只有一个；管理员可切换多个。
     * 模型 Key 按用户一把：有可用 Key 时切项目绝不重签（分账仍记在 keyHomeModuleId）。
     * 管理员若要把推理费用改记到另一企业：退出登录（revoke）后再选目标项目签发。
     */
    async function commitModule(session, moduleId) {
      const next = selectModule(session, moduleId)
      if (next === session) return session
      const hasUsableKey = typeof session.llmApiKeyExpiresAt === 'number'
        && session.llmApiKeyExpiresAt > Date.now()
      if (!hasUsableKey) {
        // First project pick after login (or Key already expired): mint once for this user.
        const key = await issueModelKey(next.accessToken, remainingExpiresIn(next), {
          tenantId: sessionTenantId(next),
          moduleId: next.moduleId,
          moduleName: next.moduleName,
          reason: 'module-switch',
        })
        if (!key.ok) {
          throw new Error(key.message || 'issue-model-key failed')
        }
        next.llmApiKeyExpiresAt = key.expiresAt
        next.keyHomeModuleId = key.homeModuleId || next.moduleId
      } else {
        next.llmApiKeyExpiresAt = session.llmApiKeyExpiresAt
        next.keyHomeModuleId = session.keyHomeModuleId || session.moduleId || null
      }
      writePrefs({ moduleId: next.moduleId })
      rememberLoginPrefs(next)
      writeSession(next, 'module-switch')
      await afterProjectContext(next, {
        reason: 'module-switch',
      })
      return next
    }

    function menuItemText(item) {
      return item.textContent?.replace(/\s+/g, ' ').trim() || ''
    }

    /**
     * Host Menu rows append shortcut glyphs to textContent (e.g. 「设置 ⌘,」).
     * Prefer the middle label span; fall back to stripping a trailing shortcut.
     */
    function menuItemPrimaryLabel(item) {
      const spans = [...item.querySelectorAll(':scope > span')]
      if (spans.length >= 2) {
        const labeled = spans.find((span) => !span.querySelector('svg') && span.getAttribute('aria-hidden') !== 'true')
          || spans[1]
        const text = labeled?.textContent?.replace(/\s+/g, ' ').trim() || ''
        if (text !== '') return text
      }
      return menuItemText(item)
        .replace(/\s*(⌘|⌃|⌥|⇧|Ctrl|Alt|Shift|Meta|Command).*$/i, '')
        .trim()
    }

    function menuItemMatches(item, labels) {
      const primary = menuItemPrimaryLabel(item)
      const full = menuItemText(item)
      return labels.some((label) => primary === label || full === label || full.startsWith(`${label} `))
    }

    function replaceMenuItemLabel(item, labels, label) {
      const spans = [...item.querySelectorAll(':scope > span')]
      const labelSpan = spans.find((span) => !span.querySelector('svg') && span.getAttribute('aria-hidden') !== 'true')
      if (labelSpan) {
        if (labelSpan.textContent !== label) labelSpan.textContent = label
      } else {
        const walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT)
        let node = walker.nextNode()
        while (node !== null) {
          const text = node.textContent?.trim() || ''
          if (labels.includes(text) || labels.some((known) => text === known || text.startsWith(`${known} `))) {
            if (node.textContent !== label) node.textContent = label
            break
          }
          node = walker.nextNode()
        }
      }
      item.setAttribute('aria-label', label)
    }

    /** Keep the shell's account trigger labeled with the signed-in person's name. */
    function replaceAccountTriggerLabel(trigger, label) {
      const labels = ['更多', 'More']
      const walker = document.createTreeWalker(trigger, NodeFilter.SHOW_TEXT)
      let node = walker.nextNode()
      while (node !== null) {
        const text = node.textContent?.trim() || ''
        if (labels.includes(text) || text === label) {
          if (node.textContent !== label) node.textContent = label
          return
        }
        // Host may already show a truncated nickname; always force the current display name.
        if (node.parentElement?.className && String(node.parentElement.className).includes('label')) {
          if (node.textContent !== label) node.textContent = label
          return
        }
        node = walker.nextNode()
      }
    }

    // Inline glyphs for the DOM account-menu adapter (cannot import ui-primitives icons).
    const ICON_USER = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" stroke-width="1.3"><path d="M8 8.25C9.51878 8.25 10.75 7.01878 10.75 5.5C10.75 3.98122 9.51878 2.75 8 2.75C6.48122 2.75 5.25 3.98122 5.25 5.5C5.25 7.01878 6.48122 8.25 8 8.25Z" stroke="currentColor"/><path d="M2.5 14.5C2.5 11.5 5.25 10.25 8 10.25C10.75 10.25 13.5 11.5 13.5 14.5" stroke="currentColor"/></svg>'
    const ICON_FOLDER = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" stroke-width="1.3"><path d="M12.3994 13.5986H2.04956C1.49728 13.5986 1.04956 13.1509 1.04956 12.5986V3.40137C1.04956 2.84908 1.49728 2.40137 2.04956 2.40137H4.76632C5.01016 2.40137 5.24561 2.49046 5.42836 2.6519L6.94088 3.98799C7.12364 4.14943 7.35908 4.23852 7.60293 4.23852H12.3994C12.9517 4.23852 13.3994 4.68624 13.3994 5.23852V7.16991" stroke="currentColor"/><path d="M2.55911 7.93683C2.67584 7.49906 3.07229 7.19446 3.52536 7.19446H13.6491C14.3061 7.19446 14.7846 7.81725 14.6153 8.45209L13.4411 12.856C13.3244 13.2938 12.9279 13.5984 12.4748 13.5984H2.35113C1.69411 13.5984 1.21562 12.9756 1.38489 12.3407L2.55911 7.93683Z" stroke="currentColor"/></svg>'
    const ICON_LOGOUT = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M6.5 2.5H4.25C3.55964 2.5 3 3.05964 3 3.75V12.25C3 12.9404 3.55964 13.5 4.25 13.5H6.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M7 8H13.5M13.5 8L11 5.5M13.5 8L11 10.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>'

    /** Replace the leading icon of a menu row or the account trigger. */
    function setLeadingIcon(host, svgHtml, iconId) {
      if (!(host instanceof HTMLElement)) return
      if (iconId && host.dataset.t4yIcon === iconId && host.querySelector('svg')) return
      const holder = document.createElement('span')
      holder.innerHTML = svgHtml
      const next = holder.firstElementChild
      if (!(next instanceof SVGElement)) return
      next.setAttribute('aria-hidden', 'true')
      const existing = host.querySelector('svg')
      if (existing) {
        existing.replaceWith(next)
      } else {
        const span = document.createElement('span')
        span.setAttribute('aria-hidden', 'true')
        span.style.cssText = 'display:inline-flex;width:16px;height:16px;flex:none;color:currentColor'
        span.appendChild(next)
        host.insertBefore(span, host.firstChild)
      }
      if (iconId) host.dataset.t4yIcon = iconId
    }

    function findAccountMenuList() {
      const menus = [...document.querySelectorAll('[role="menu"]')]
      return menus.find((menu) => {
        if (!(menu instanceof HTMLElement)) return false
        return [...menu.querySelectorAll('[role="menuitem"]')]
          .some((item) => menuItemMatches(item, ['设置', 'Settings']))
      }) || null
    }

    function installAccountMenuAdapter(t) {
      /** Reused across opens so insert does not rebind listeners every time. */
      let switchItem = null
      let trigger = null
      let activeMenu = null
      let frame = null
      let revealFrame = 0
      let readyTimer = 0
      let attempts = 0
      let disposed = false
      /** True after the open cycle finished patching; skips body-observer re-entry. */
      let patchedOpen = false

      const clearMenuReady = () => {
        patchedOpen = false
        trigger?.removeAttribute('data-t4y-menu-ready')
        if (activeMenu instanceof HTMLElement) {
          activeMenu.removeAttribute('data-t4y-menu-pending')
          activeMenu = null
        }
        // Any leftover account menus from a remount stay hidden until re-patched.
        for (const menu of document.querySelectorAll('[role="menu"][data-t4y-menu-pending]')) {
          menu.removeAttribute('data-t4y-menu-pending')
        }
        if (revealFrame !== 0) {
          window.cancelAnimationFrame(revealFrame)
          revealFrame = 0
        }
        if (readyTimer !== 0) {
          window.clearTimeout(readyTimer)
          readyTimer = 0
        }
      }

      /** Hide before paint. MutationObserver runs before the next frame. */
      const concealMenu = (menu) => {
        if (!(menu instanceof HTMLElement)) return
        activeMenu = menu
        menu.setAttribute('data-t4y-account-menu', 'true')
        // Always pending until revealMenu — do not key off trigger ready (stale across opens).
        menu.setAttribute('data-t4y-menu-pending', 'true')
        trigger?.removeAttribute('data-t4y-menu-ready')
      }

      const collectAddedMenus = (records) => {
        const menus = []
        for (const record of records) {
          if (record.type !== 'childList') continue
          for (const node of record.addedNodes) {
            if (!(node instanceof HTMLElement)) continue
            if (node.getAttribute('role') === 'menu') menus.push(node)
            else menus.push(...node.querySelectorAll('[role="menu"]'))
          }
        }
        return menus
      }

      const finishReveal = (menu) => {
        if (trigger?.getAttribute('aria-expanded') !== 'true') return
        // Host Menu uses `transition: all`; revealing mid-remeasure animates a
        // top jump (e.g. 674→634). Freeze transitions for one frame.
        if (menu instanceof HTMLElement) {
          menu.style.transition = 'none'
          menu.removeAttribute('data-t4y-menu-pending')
        }
        trigger.setAttribute('data-t4y-menu-ready', 'true')
        patchedOpen = true
        if (menu instanceof HTMLElement) {
          revealFrame = window.requestAnimationFrame(() => {
            revealFrame = 0
            if (menu.style.transition === 'none') menu.style.transition = ''
          })
        }
      }

      const revealMenu = () => {
        // Wait until portal top/height stop moving after we inject「切换项目」.
        if (revealFrame !== 0) window.cancelAnimationFrame(revealFrame)
        const menu = activeMenu
        if (!(menu instanceof HTMLElement)) {
          finishReveal(null)
          return
        }
        let lastTop = menu.style.top
        let lastHeight = Math.round(menu.getBoundingClientRect().height)
        let stable = 0
        let frames = 0
        const tick = () => {
          revealFrame = 0
          if (disposed || trigger?.getAttribute('aria-expanded') !== 'true') return
          frames += 1
          const top = menu.style.top
          const height = Math.round(menu.getBoundingClientRect().height)
          if (top === lastTop && height === lastHeight) stable += 1
          else {
            stable = 0
            lastTop = top
            lastHeight = height
          }
          if ((stable >= 2 && frames >= 2) || frames >= 10) {
            finishReveal(menu)
            return
          }
          revealFrame = window.requestAnimationFrame(tick)
        }
        revealFrame = window.requestAnimationFrame(tick)
      }

      const armReadyFailsafe = () => {
        if (readyTimer !== 0) return
        readyTimer = window.setTimeout(() => {
          readyTimer = 0
          if (trigger?.getAttribute('aria-expanded') === 'true') {
            if (revealFrame !== 0) {
              window.cancelAnimationFrame(revealFrame)
              revealFrame = 0
            }
            finishReveal(activeMenu)
          }
        }, 160)
      }

      const syncTriggerChrome = () => {
        if (trigger === null) return
        const session = readSession()
        if (session !== null) {
          replaceAccountTriggerLabel(trigger, session.displayName)
          setLeadingIcon(trigger, ICON_USER, 'user')
          trigger.setAttribute('data-signed-out', 'false')
        }
      }

      const hideFeedbackRows = (items) => {
        for (const item of items) {
          if (!menuItemMatches(item, ['意见反馈', 'Feedback', 'Send feedback'])) continue
          const wrap = item.parentElement
          if (wrap instanceof HTMLElement && wrap.style.display !== 'none') {
            wrap.style.display = 'none'
          }
        }
      }

      const syncMenu = () => {
        if (disposed || trigger === null) return
        const expanded = trigger.getAttribute('aria-expanded') === 'true'
        if (!expanded) {
          clearMenuReady()
          return
        }
        armReadyFailsafe()
        const menu = findAccountMenuList()
        if (menu === null) return

        // Same open cycle already patched this menu node — ignore observer noise.
        if (
          patchedOpen
          && menu === activeMenu
          && menu.getAttribute('data-t4y-menu-pending') !== 'true'
          && (switchItem === null || switchItem.isConnected)
        ) {
          return
        }

        if (menu.getAttribute('data-t4y-menu-pending') !== 'true') concealMenu(menu)
        else {
          activeMenu = menu
          menu.setAttribute('data-t4y-account-menu', 'true')
        }

        const items = [...menu.querySelectorAll('[role="menuitem"]')]
          .filter((item) => item instanceof HTMLElement)
        hideFeedbackRows(items)
        const hostAuthLabels = ['登录', 'Sign in', '退出登录', 'Sign out']
        const session = readSession()

        const label = session === null ? t('accountLogin') : t('logout')
        const authLabels = [...hostAuthLabels, t('accountLogin'), t('logout')]
        const authItem = items.find((item) => (
          item.dataset.t4ySwitchModule !== 'true' && menuItemMatches(item, authLabels)
        ))
        // Always reveal even if the auth row cannot be patched — opacity gate must not stick.
        if (authItem === undefined) {
          revealMenu()
          return
        }

        replaceMenuItemLabel(authItem, authLabels, label)
        if (session !== null) setLeadingIcon(authItem, ICON_LOGOUT, 'logout')
        else setLeadingIcon(authItem, ICON_USER, 'user')

        const canSwitch = Boolean(session && (session.modules || []).length > 1)
        if (canSwitch) {
          if (switchItem === null || !switchItem.isConnected) {
            if (switchItem !== null && !switchItem.isConnected) switchItem = null
            switchItem = authItem.cloneNode(true)
            switchItem.dataset.t4ySwitchModule = 'true'
            switchItem.dataset.t4yIdentityBound = 'true'
            switchItem.addEventListener('click', (event) => {
              event.preventDefault()
              event.stopImmediatePropagation()
              setOverlayUi({ moduleOpen: true, logoutOpen: false })
              window.dispatchEvent(new CustomEvent(MENU_ACTION_EVENT, { detail: { action: 'switch-module' } }))
              trigger?.click()
            }, { capture: true })
          }
          replaceMenuItemLabel(switchItem, authLabels.concat([t('switchModule'), label]), t('switchModule'))
          setLeadingIcon(switchItem, ICON_FOLDER, 'folder')
          switchItem.style.display = ''
          if (switchItem.parentElement !== authItem.parentElement || switchItem.nextSibling !== authItem) {
            authItem.parentElement?.insertBefore(switchItem, authItem)
          }
        } else if (switchItem !== null) {
          switchItem.style.display = 'none'
        }

        if (authItem.dataset.t4yIdentityBound !== 'true') {
          authItem.dataset.t4yIdentityBound = 'true'
          authItem.addEventListener('click', (event) => {
            event.preventDefault()
            event.stopImmediatePropagation()
            const current = readSession()
            if (current !== null) setOverlayUi({ logoutOpen: true, moduleOpen: false })
            window.dispatchEvent(new CustomEvent(MENU_ACTION_EVENT, {
              detail: { action: current === null ? 'login' : 'logout' },
            }))
            trigger?.click()
          }, { capture: true })
        }

        if (trigger.getAttribute('data-t4y-menu-ready') !== 'true') revealMenu()
        else {
          menu.removeAttribute('data-t4y-menu-pending')
          patchedOpen = true
        }
      }

      /** Keep the opacity gate armed before React flips aria-expanded. */
      const onTriggerPointerDown = () => {
        if (trigger?.getAttribute('aria-expanded') === 'true') return
        clearMenuReady()
      }

      const onTriggerKeyDown = (event) => {
        if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
        if (trigger?.getAttribute('aria-expanded') === 'true') return
        clearMenuReady()
      }

      const observer = new MutationObserver((records) => {
        if (disposed || trigger === null) return

        // Conceal as soon as the account menu portal mounts — even before aria-expanded flips.
        for (const menu of collectAddedMenus(records)) {
          if (!(menu instanceof HTMLElement)) continue
          const looksAccount = [...menu.querySelectorAll('[role="menuitem"]')]
            .some((item) => menuItemMatches(item, ['设置', 'Settings']))
          if (looksAccount) concealMenu(menu)
        }

        const expandedChanged = records.some((record) => (
          record.type === 'attributes' && record.target === trigger
        ))
        if (trigger.getAttribute('aria-expanded') !== 'true') {
          // Keep a just-mounted pending menu hidden until expanded flips; drop detached nodes.
          if (!activeMenu?.isConnected) clearMenuReady()
          return
        }
        if (expandedChanged) {
          trigger.removeAttribute('data-t4y-menu-ready')
          patchedOpen = false
        }
        const menu = findAccountMenuList()
        if (menu === null) return
        if (menu.getAttribute('data-t4y-menu-pending') !== 'true') concealMenu(menu)
        if (!patchedOpen || !switchItem?.isConnected || menu !== activeMenu) syncMenu()
      })

      const bindTrigger = () => {
        if (disposed) return
        const candidate = document.querySelector('[aria-label="账号菜单"], [aria-label="Account menu"]')
        if (candidate instanceof HTMLElement) {
          trigger = candidate
          trigger.addEventListener('pointerdown', onTriggerPointerDown, true)
          trigger.addEventListener('keydown', onTriggerKeyDown, true)
          observer.observe(document.body, { childList: true, subtree: true })
          observer.observe(trigger, { attributes: true, attributeFilter: ['aria-expanded'] })
          syncTriggerChrome()
          if (trigger.getAttribute('aria-expanded') === 'true') syncMenu()
          return
        }
        attempts += 1
        if (attempts < 30) frame = window.requestAnimationFrame(bindTrigger)
      }
      const onSession = () => {
        syncTriggerChrome()
        patchedOpen = false
        if (trigger?.getAttribute('aria-expanded') === 'true') syncMenu()
      }
      bindTrigger()
      window.addEventListener(EVENT_NAME, onSession)
      return () => {
        disposed = true
        clearMenuReady()
        observer.disconnect()
        if (frame !== null) window.cancelAnimationFrame(frame)
        trigger?.removeEventListener('pointerdown', onTriggerPointerDown, true)
        trigger?.removeEventListener('keydown', onTriggerKeyDown, true)
        window.removeEventListener(EVENT_NAME, onSession)
        switchItem?.remove()
        switchItem = null
      }
    }

    function DialogShell(props) {
      return React.createElement('div', {
        className: `t4y-identity-root ${props.gate ? 't4y-identity-root-gate' : 't4y-identity-root-mask'}`,
        role: 'presentation',
        'data-t4y-identity': props.kind,
        onMouseDown: (event) => {
          if (!props.dismissible) return
          if (event.target === event.currentTarget && !props.busy) props.onDismiss?.()
        },
      },
        React.createElement('div', { className: 't4y-identity-stage' },
          React.createElement('div', {
            className: 't4y-identity-dialog',
            role: 'dialog',
            'aria-modal': 'true',
            'aria-labelledby': props.titleId,
            onMouseDown: (event) => event.stopPropagation(),
          }, props.children)))
    }

    function Field(props) {
      return React.createElement('label', { className: 't4y-identity-field' },
        React.createElement('span', null, props.label),
        React.createElement('input', {
          ref: props.inputRef,
          name: props.name,
          type: props.type || 'text',
          autoComplete: props.autoComplete,
          value: props.value,
          disabled: props.disabled,
          onChange: (event) => props.onChange(event.target.value),
        }))
    }

    function IdentityOverlay(props) {
      const t = props.t
      // Consume once per mount; Strict Mode remounts still skip only when the
      // marker remains (interactive login writes a fresh TTL).
      const bootGate = React.useRef(null)
      if (bootGate.current === null) {
        const existing = readSession()
        const fresh = Boolean(existing) && consumeFreshAuth()
        bootGate.current = { fresh, restore: Boolean(existing) && !fresh }
      }
      const startedFresh = bootGate.current.fresh
      const [session, setSession] = React.useState(readSession)
      const [bootstrapping, setBootstrapping] = React.useState(() => bootGate.current.restore)
      const [logoutOpen, setLogoutOpen] = React.useState(() => getOverlayUi().logoutOpen)
      const [moduleOpen, setModuleOpen] = React.useState(() => getOverlayUi().moduleOpen)
      const initialPrefs = React.useMemo(() => readPrefs(), [])
      const [enterpriseName, setEnterpriseName] = React.useState(initialPrefs.enterpriseName)
      const [username, setUsername] = React.useState(initialPrefs.username)
      const [password, setPassword] = React.useState('')
      const [moduleId, setModuleId] = React.useState(initialPrefs.moduleId || '')
      const [error, setError] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const enterpriseRef = React.useRef(null)

      const closeModuleDialog = React.useCallback(() => setOverlayUi({ moduleOpen: false }), [])
      const closeLogoutDialog = React.useCallback(() => setOverlayUi({ logoutOpen: false }), [])

      React.useEffect(() => {
        const onSession = (event) => setSession(event.detail?.session ?? readSession())
        window.addEventListener(EVENT_NAME, onSession)
        return () => window.removeEventListener(EVENT_NAME, onSession)
      }, [])

      React.useEffect(() => {
        const syncFromStore = (event) => {
          const next = event?.detail || getOverlayUi()
          setModuleOpen(Boolean(next.moduleOpen))
          setLogoutOpen(Boolean(next.logoutOpen))
          if (next.moduleOpen) setModuleId(readSession()?.moduleId || readPrefs().moduleId || '')
        }
        // Remount after menu close may miss the click-time event; re-read store.
        syncFromStore()
        window.addEventListener(OVERLAY_UI_EVENT, syncFromStore)
        return () => window.removeEventListener(OVERLAY_UI_EVENT, syncFromStore)
      }, [])

      React.useEffect(() => {
        let cancelled = false
        const existing = readSession()
        if (!existing) {
          setBootstrapping(false)
          emitBrand(null)
          emitTenant(null, 'anonymous')
          return undefined
        }
        if (startedFresh) {
          emitBrand(existing)
          emitTenant(existing, 'login')
          setBootstrapping(false)
          return undefined
        }
        ;(async () => {
          const result = await loadProfile(existing.accessToken, existing.expiresAt, existing)
          if (cancelled) return
          if (!result.ok) {
            doLogout()
            setBootstrapping(false)
            return
          }
          if (!result.session.needsModulePick) {
            const key = await issueModelKey(existing.accessToken, remainingExpiresIn(existing), {
              tenantId: sessionTenantId(result.session),
              moduleId: result.session.moduleId,
              moduleName: result.session.moduleName,
              reason: 'restore',
            })
            if (cancelled) return
            if (!key.ok) {
              doLogout()
              setBootstrapping(false)
              return
            }
            result.session.llmApiKeyExpiresAt = key.expiresAt
            result.session.keyHomeModuleId = key.homeModuleId || result.session.moduleId
          }
          writeSession(result.session, 'restore')
          setSession(result.session)
          setModuleId(result.session.moduleId || '')
          if (!result.session.needsModulePick) {
            await afterProjectContext(result.session, {
              reason: 'restore',
            })
          }
          if (cancelled) return
          setBootstrapping(false)
        })()
        return () => { cancelled = true }
      }, [startedFresh, props.uiWorkspace, props.workspaces])

      React.useEffect(() => {
        const onMenuAction = (event) => {
          if (event.detail?.action === 'logout') {
            setOverlayUi({ logoutOpen: true, moduleOpen: false })
            return
          }
          if (event.detail?.action === 'switch-module') {
            setModuleId(readSession()?.moduleId || '')
            setOverlayUi({ moduleOpen: true, logoutOpen: false })
          }
        }
        window.addEventListener(MENU_ACTION_EVENT, onMenuAction)
        return () => window.removeEventListener(MENU_ACTION_EVENT, onMenuAction)
      }, [])

      React.useEffect(() => {
        // Keep the workspace shell hidden for the whole restore gate, not only
        // when localStorage has no session — otherwise cold start / remount
        // flashes the brand shell behind「正在恢复登录…」.
        document.documentElement.dataset.t4yIdentityAuthed =
          !bootstrapping && session && !session.needsModulePick ? '1' : '0'
        return () => { delete document.documentElement.dataset.t4yIdentityAuthed }
      }, [session, bootstrapping])

      React.useEffect(() => {
        const bridge = window.dshOnboarding
        if (!bridge || typeof bridge.setCompact !== 'function') return undefined
        bridge.setCompact(!session)
        return undefined
      }, [Boolean(session)])

      React.useEffect(() => {
        if (session) return undefined
        const prefs = readPrefs()
        setEnterpriseName(prefs.enterpriseName)
        setUsername(prefs.username)
        setModuleId(prefs.moduleId || '')
        return undefined
      }, [session])

      React.useEffect(() => {
        if (!session?.accessToken || session.needsModulePick) return undefined
        let cancelled = false
        const verify = async () => {
          if (typeof session.expiresAt === 'number' && Date.now() >= session.expiresAt) {
            doLogout()
            return
          }
          if (typeof session.llmApiKeyExpiresAt === 'number' && Date.now() >= session.llmApiKeyExpiresAt) {
            doLogout()
            return
          }
          const status = await checkSessionStatus(session.accessToken, session.moduleId)
          if (cancelled) return
          if (status.ok && status.active === false) doLogout()
        }
        verify()
        const timer = window.setInterval(verify, 60_000)
        const onVisible = () => {
          if (document.visibilityState === 'visible') verify()
        }
        document.addEventListener('visibilitychange', onVisible)
        // Host deletes T4Y_NEW_API_KEY on chat AUTH; re-check immediately instead of waiting a minute.
        const onCredential = (ref) => {
          const names = Array.isArray(ref) ? ref : [ref]
          if (!names.includes('T4Y_NEW_API_KEY')) return
          verify()
        }
        const remote = props.remote
        const offCredential = typeof remote?.$on === 'function'
          ? remote.$on('credentials/reference-updated', onCredential)
          : undefined
        return () => {
          cancelled = true
          window.clearInterval(timer)
          document.removeEventListener('visibilitychange', onVisible)
          if (typeof offCredential === 'function') offCredential()
          else if (offCredential && typeof offCredential.dispose === 'function') offCredential.dispose()
        }
      }, [session?.accessToken, session?.needsModulePick, session?.expiresAt, session?.llmApiKeyExpiresAt, props.remote])

      const locked = bootstrapping || !session || session.needsModulePick

      const submitLogin = async (event) => {
        event.preventDefault()
        if (busy) return
        setBusy(true)
        setError(null)
        const prefs = readPrefs()
        writePrefs({
          enterpriseName: enterpriseName.trim(),
          username: username.trim(),
          moduleId: prefs.moduleId,
        })
        const result = await loginRequest(enterpriseName.trim(), username.trim(), password)
        if (!result.ok) {
          setError(result.message || t(result.messageKey))
          setBusy(false)
          return
        }
        const expiresAt = Date.now() + result.expiresIn * 1000
        const profile = await loadProfile(result.accessToken, expiresAt, {
          moduleId: prefs.moduleId,
        })
        if (!profile.ok) {
          setError(profile.message || t(profile.messageKey))
          setBusy(false)
          return
        }
        if (!profile.session.needsModulePick) {
          const key = await issueModelKey(result.accessToken, result.expiresIn, {
            tenantId: sessionTenantId(profile.session),
            moduleId: profile.session.moduleId,
            moduleName: profile.session.moduleName,
            reason: 'login',
          })
          if (!key.ok) {
            setError(key.message ? `${t('keyError')}（${key.message}）` : t('keyError'))
            setBusy(false)
            return
          }
          profile.session.llmApiKeyExpiresAt = key.expiresAt
          profile.session.keyHomeModuleId = key.homeModuleId || profile.session.moduleId
        }
        rememberLoginPrefs(profile.session)
        markFreshAuth()
        writeSession(profile.session, 'login')
        setSession(profile.session)
        setModuleId(profile.session.moduleId || '')
        setPassword('')
        if (!profile.session.needsModulePick) {
          await afterProjectContext(profile.session, {
            reason: 'login',
          })
        }
        setBusy(false)
      }

      const confirmModule = () => {
        if (!session || !moduleId || busy) return
        setBusy(true)
        setError(null)
        void commitModule(session, moduleId).then((next) => {
          setSession(next)
          setOverlayUi({ moduleOpen: false })
        }).catch((error) => {
          const message = error instanceof Error ? error.message : ''
          setError(message && message !== 'issue-model-key failed'
            ? `${t('keyError')}（${message}）`
            : t('keyError'))
        }).finally(() => {
          setBusy(false)
        })
      }

      let gateLogin = null
      if (locked && !bootstrapping && !session) {
        gateLogin = React.createElement(DialogShell, {
          kind: 'login-gate',
          gate: true,
          busy,
          dismissible: false,
          titleId: 't4y-identity-title',
        }, React.createElement('form', { onSubmit: submitLogin },
          React.createElement('div', { className: 't4y-identity-content' },
            React.createElement('div', { className: 't4y-identity-header' },
              React.createElement('h2', { id: 't4y-identity-title', className: 't4y-identity-title' }, t('loginTitle'))),
            React.createElement('p', { className: 't4y-identity-description' }, t('loginDescription')),
            React.createElement('div', { className: 't4y-identity-body' },
              React.createElement(Field, {
                label: t('enterpriseName'),
                name: 'enterpriseName',
                autoComplete: 'organization',
                value: enterpriseName,
                disabled: busy,
                inputRef: enterpriseRef,
                onChange: setEnterpriseName,
              }),
              React.createElement(Field, {
                label: t('username'),
                name: 'username',
                autoComplete: 'username',
                value: username,
                disabled: busy,
                onChange: setUsername,
              }),
              React.createElement(Field, {
                label: t('password'),
                name: 'password',
                type: 'password',
                autoComplete: 'current-password',
                value: password,
                disabled: busy,
                onChange: setPassword,
              }),
              error ? React.createElement('p', { className: 't4y-identity-error', role: 'alert' }, error) : null)),
          React.createElement('div', { className: 't4y-identity-actions' },
            React.createElement('button', {
              type: 'submit',
              className: 't4y-identity-btn t4y-identity-btn-primary',
              disabled: busy || enterpriseName.trim() === '' || username.trim() === '' || password === '',
            }, busy ? t('waiting') : t('signIn')))))
      }

      let restoring = null
      if (bootstrapping) {
        restoring = React.createElement(DialogShell, {
          kind: 'restoring',
          gate: true,
          busy: true,
          dismissible: false,
          titleId: 't4y-identity-restoring',
        }, React.createElement('div', { className: 't4y-identity-content' },
          React.createElement('div', { className: 't4y-identity-header' },
            React.createElement('h2', { id: 't4y-identity-restoring', className: 't4y-identity-title' }, t('restoring')))))
      }

      const needsPick = Boolean(session?.needsModulePick || moduleOpen)
      let moduleDialog = null
      if (!bootstrapping && session && needsPick) {
        const hasModules = (session.modules || []).length > 0
        const moduleList = !hasModules
          ? React.createElement('p', { className: 't4y-identity-hint' }, t('noModule'))
          : React.createElement('div', { className: 't4y-identity-module-list', role: 'listbox' },
            session.modules.map((item) => React.createElement('button', {
              key: item.id,
              type: 'button',
              role: 'option',
              'aria-selected': moduleId === item.id,
              className: `t4y-identity-module-item${moduleId === item.id ? ' is-selected' : ''}`,
              onClick: () => setModuleId(item.id),
            },
            item.logo
              ? React.createElement('img', { src: item.logo, alt: '', className: 't4y-identity-module-logo', draggable: false })
              : React.createElement('span', { className: 't4y-identity-module-logo t4y-identity-module-logo-fallback' }),
            React.createElement('span', { className: 't4y-identity-module-name' }, item.name))))
        moduleDialog = React.createElement(DialogShell, {
          kind: 'module-pick',
          gate: Boolean(session.needsModulePick),
          busy,
          dismissible: !session.needsModulePick,
          onDismiss: closeModuleDialog,
          titleId: 't4y-identity-module-title',
        },
        React.createElement('div', { className: 't4y-identity-content' },
          React.createElement('div', { className: 't4y-identity-header' },
            React.createElement('h2', { id: 't4y-identity-module-title', className: 't4y-identity-title' },
              hasModules ? t('pickModuleTitle') : t('noModule')),
            !session.needsModulePick ? React.createElement('button', {
              type: 'button',
              className: 't4y-identity-close',
              'aria-label': t('close'),
              onClick: closeModuleDialog,
            }, '×') : null),
          React.createElement('p', { className: 't4y-identity-description' },
            hasModules ? t('pickModuleDescription') : t('noModuleDescription')),
          React.createElement('div', { className: 't4y-identity-body' }, moduleList)),
        React.createElement('div', { className: 't4y-identity-actions' },
          !session.needsModulePick ? React.createElement('button', {
            type: 'button',
            className: 't4y-identity-btn t4y-identity-btn-outline',
            onClick: closeModuleDialog,
          }, t('cancel')) : null,
          hasModules ? React.createElement('button', {
            type: 'button',
            className: 't4y-identity-btn t4y-identity-btn-primary',
            disabled: !moduleId,
            onClick: confirmModule,
          }, t('confirmModule')) : React.createElement('button', {
            type: 'button',
            className: 't4y-identity-btn t4y-identity-btn-primary',
            disabled: busy,
            onClick: async () => {
              if (busy) return
              setBusy(true)
              try {
                await doLogout()
                setOverlayUi({ logoutOpen: false, moduleOpen: false })
                setSession(null)
              } finally {
                setBusy(false)
              }
            },
          }, t('logout'))))
      }

      let accountDialog = null
      if (logoutOpen && session && !session.needsModulePick) {
        accountDialog = React.createElement(DialogShell, {
          kind: 'account',
          gate: false,
          busy,
          dismissible: true,
          onDismiss: closeLogoutDialog,
          titleId: 't4y-identity-account-title',
        },
        React.createElement('div', { className: 't4y-identity-content' },
          React.createElement('div', { className: 't4y-identity-header' },
            React.createElement('h2', { id: 't4y-identity-account-title', className: 't4y-identity-title' }, t('logout')),
            React.createElement('button', {
              type: 'button',
              className: 't4y-identity-close',
              'aria-label': t('close'),
              onClick: closeLogoutDialog,
            }, '×')),
          React.createElement('p', { className: 't4y-identity-description' },
            `${t('currentAccount')}：${session.displayName}${session.moduleName ? ` · ${t('currentModule')}：${session.moduleName}` : ''}`),
          React.createElement('p', { className: 't4y-identity-description' }, t('signOutDescription'))),
        React.createElement('div', { className: 't4y-identity-actions' },
          (session.modules || []).length > 1 ? React.createElement('button', {
            type: 'button',
            className: 't4y-identity-btn t4y-identity-btn-outline',
            onClick: () => {
              setModuleId(session.moduleId || '')
              setOverlayUi({ logoutOpen: false, moduleOpen: true })
            },
          }, t('switchModule')) : null,
          React.createElement('button', {
            type: 'button',
            className: 't4y-identity-btn t4y-identity-btn-outline',
            onClick: closeLogoutDialog,
          }, t('cancel')),
          React.createElement('button', {
            type: 'button',
            className: 't4y-identity-btn t4y-identity-btn-primary',
            disabled: busy,
            onClick: async () => {
              if (busy) return
              setBusy(true)
              try {
                await doLogout()
                setOverlayUi({ logoutOpen: false, moduleOpen: false })
                setSession(null)
              } finally {
                setBusy(false)
              }
            },
          }, t('logout'))))
      }

      // Portal to body so html[data-t4y-identity-authed="0"] can hide the app
      // shell while keeping .t4y-identity-root visible (body direct child).
      const overlay = React.createElement(React.Fragment, null, restoring, gateLogin, moduleDialog, accountDialog)
      if (typeof ReactDOM.createPortal === 'function') {
        return ReactDOM.createPortal(overlay, document.body)
      }
      return overlay
    }

    exports.inject = ['slots', 'locale', 'remote', 'uiWorkspace', 'workspaces']
    exports.apply = (ctx) => {
      // The identity client is the guaranteed Web bootstrap point. It starts
      // the authorization page after the enterprise session bridge exists.
      capabilityHub.apply(ctx)
      const existing = readSession()
      // Fresh interactive login may remount with a complete session; otherwise
      // keep the shell hidden until IdentityOverlay finishes restore.
      document.documentElement.dataset.t4yIdentityAuthed =
        existing && !existing.needsModulePick && peekFreshAuth() ? '1' : '0'

      ctx.effect(() => ctx.locale.register(LOCALE_NS, copy), 't4y identity: locale')
      const t = ctx.locale.bind(LOCALE_NS)

      ctx.effect(() => {
        const id = 't4y-identity-style'
        const previous = document.getElementById(id)
        const style = previous instanceof HTMLStyleElement ? previous : document.createElement('style')
        style.id = id
        style.dataset.owners = String(Number(style.dataset.owners || 0) + 1)
        if (!style.isConnected) document.head.appendChild(style)
        style.textContent = `
          /* The enterprise sign-in is its own first page. The application shell
             must not remain visible behind it as a disabled workspace. */
          html[data-t4y-identity-authed="0"] body > *:not(.t4y-identity-root):not(#t4y-identity-style) {
            display: none !important;
          }
          /* Nested under shell.overlay if createPortal is unavailable. */
          html[data-t4y-identity-authed="0"] .t4y-identity-root {
            visibility: visible !important;
            pointer-events: auto !important;
          }
          .t4y-identity-root {
            pointer-events: auto;
            position: fixed;
            inset: 0;
            z-index: 2147483000;
            display: flex;
            flex-direction: column;
            user-select: none;
          }
          .t4y-identity-root-gate {
            background: var(--dsw-alias-bg-base, #f8fafc);
          }
          .t4y-identity-root[data-t4y-identity="login-gate"] {
            /* Desktop keeps workspace chrome on the compact login size; an
               opaque page fill avoids vibrancy leaking around the card. */
            background: var(--dsw-alias-bg-base, #f8fafc);
          }
          .t4y-identity-root-mask {
            background: transparent;
          }
          .t4y-identity-root-mask::before {
            content: '';
            position: absolute;
            inset: var(--dsh-frame-chrome-top, 0px) 0 0;
            backdrop-filter: var(--dsw-mask-blur, blur(8px));
            background: var(--dsw-alias-bg-mask-1, rgba(15, 23, 42, 0.28));
          }
          /* Hide host「意见反馈」while the account menu is open. */
          body:has([aria-label="账号菜单"][aria-expanded="true"]) [role="menu"] > [role="presentation"] > div:nth-child(2),
          body:has([aria-label="Account menu"][aria-expanded="true"]) [role="menu"] > [role="presentation"] > div:nth-child(2) {
            display: none !important;
          }
          /* Pending mark is set synchronously when the menu mounts (before paint). */
          [role="menu"][data-t4y-menu-pending="true"] {
            opacity: 0 !important;
            pointer-events: none !important;
          }
          /* Fallback if the portal paints before our observer marks it. */
          body:has([aria-label="账号菜单"][aria-expanded="true"]:not([data-t4y-menu-ready="true"])) [role="menu"],
          body:has([aria-label="Account menu"][aria-expanded="true"]:not([data-t4y-menu-ready="true"])) [role="menu"] {
            opacity: 0 !important;
            pointer-events: none !important;
          }
          .t4y-identity-stage {
            position: relative;
            z-index: 1;
            display: flex;
            flex: 1;
            min-height: 0;
            align-items: center;
            justify-content: center;
            padding: max(24px, var(--dsh-frame-overlay-top, 24px)) 24px;
            overflow: auto;
          }
          .t4y-identity-root[data-t4y-identity="login-gate"] .t4y-identity-stage {
            padding: var(--dsh-frame-top-clearance, 0px) 0 0;
            overflow: hidden;
          }
          .t4y-identity-dialog {
            box-sizing: border-box;
            position: relative;
            z-index: 1;
            display: flex;
            flex-direction: column;
            gap: 20px;
            width: min(420px, 100%);
            margin: 0;
            padding: 0 0 24px;
            overflow: hidden;
            border: 0.5px solid var(--dsw-alias-border-inverted, transparent);
            border-radius: var(--dsw-radius-panel, 16px);
            background: var(--dsw-alias-bg-layer-2, #fff);
            box-shadow: var(--dsw-elevation-prominent, 0 16px 40px rgba(15, 23, 42, 0.18));
            animation: t4yIdentityEnter var(--ds-transition-duration, 180ms) var(--ds-ease-in-out, ease);
          }
          .t4y-identity-root[data-t4y-identity="login-gate"] .t4y-identity-dialog {
            width: 100%;
            height: 100%;
            padding: 0;
            border-radius: 16px;
            box-shadow: none;
          }
          .t4y-identity-root[data-t4y-identity="login-gate"] .t4y-identity-dialog > form {
            display: flex;
            flex-direction: column;
            height: 100%;
          }
          @keyframes t4yIdentityEnter {
            from { opacity: 0; }
            to { opacity: 1; }
          }
          @media (prefers-reduced-motion: reduce) {
            .t4y-identity-dialog { animation: none; }
          }
          .t4y-identity-content { display: flex; flex-direction: column; width: 100%; }
          .t4y-identity-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            padding: 22px 24px 12px;
          }
          .t4y-identity-title {
            margin: 0;
            font-size: 16px;
            line-height: 24px;
            font-weight: 500;
            color: var(--dsw-alias-label-primary, #0f172a);
          }
          .t4y-identity-close {
            box-sizing: border-box;
            display: inline-flex;
            flex: none;
            align-items: center;
            justify-content: center;
            width: 28px;
            height: 28px;
            padding: 0;
            border: 0;
            border-radius: var(--dsw-radius-sm, 6px);
            background: transparent;
            color: var(--dsw-alias-label-secondary, #64748b);
            font-size: 18px;
            line-height: 1;
            cursor: pointer;
          }
          .t4y-identity-close:hover:not(:disabled) {
            background: var(--dsw-alias-interactive-bg-hover, rgba(15, 23, 42, 0.06));
          }
          .t4y-identity-description {
            margin: 0;
            padding: 0 24px;
            font-size: 14px;
            line-height: 22px;
            font-weight: 400;
            color: var(--dsw-alias-label-primary, #0f172a);
          }
          .t4y-identity-body {
            display: flex;
            flex-direction: column;
            gap: 12px;
            margin-top: 20px;
            padding: 0 24px;
          }
          .t4y-identity-field {
            display: flex;
            flex-direction: column;
            gap: 6px;
            font-size: 13px;
            line-height: 20px;
            color: var(--dsw-alias-label-secondary, #64748b);
          }
          .t4y-identity-field input {
            box-sizing: border-box;
            width: 100%;
            height: 36px;
            padding: 0 12px;
            border: 0.5px solid var(--dsw-alias-border-l2, #cbd5e1);
            border-radius: var(--dsw-radius-md, 8px);
            background: var(--dsw-alias-bg-base, #fff);
            color: var(--dsw-alias-label-primary, #0f172a);
            font-size: 14px;
            line-height: 22px;
          }
          .t4y-identity-field input:focus {
            outline: none;
            border-color: var(--dsw-alias-brand-primary, #4d6bfe);
            box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-brand-primary, #4d6bfe) 25%, transparent);
          }
          .t4y-identity-field input:disabled { opacity: 0.4; }
          .t4y-identity-error {
            margin: 0;
            font-size: 13px;
            line-height: 20px;
            color: var(--dsw-alias-state-error-primary, #dc2626);
          }
          .t4y-identity-hint {
            margin: 0;
            font-size: 12px;
            line-height: 18px;
            color: var(--dsw-alias-label-tertiary, #94a3b8);
          }
          .t4y-identity-module-list {
            display: flex;
            flex-direction: column;
            gap: 8px;
            max-height: 280px;
            overflow: auto;
          }
          .t4y-identity-module-item {
            box-sizing: border-box;
            display: flex;
            align-items: center;
            gap: 12px;
            width: 100%;
            padding: 10px 12px;
            border: 0.5px solid var(--dsw-alias-border-l2, #cbd5e1);
            border-radius: var(--dsw-radius-md, 8px);
            background: transparent;
            color: var(--dsw-alias-label-primary, #0f172a);
            text-align: left;
            cursor: pointer;
          }
          .t4y-identity-module-item:hover {
            background: var(--dsw-alias-interactive-bg-hover, rgba(15, 23, 42, 0.06));
          }
          .t4y-identity-module-item.is-selected {
            border-color: var(--dsw-alias-brand-primary, #4d6bfe);
            box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-brand-primary, #4d6bfe) 20%, transparent);
          }
          .t4y-identity-module-logo {
            width: 28px;
            height: 28px;
            object-fit: contain;
            flex: none;
            border-radius: 6px;
            background: var(--dsw-alias-bg-base, #fff);
          }
          .t4y-identity-module-logo-fallback {
            display: inline-block;
            background: var(--dsw-alias-border-l2, #e2e8f0);
          }
          .t4y-identity-module-name {
            font-size: 14px;
            line-height: 22px;
          }
          .t4y-identity-actions {
            box-sizing: border-box;
            display: flex;
            justify-content: flex-end;
            align-items: center;
            flex-wrap: wrap;
            width: 100%;
            padding: 0 24px;
            gap: 8px;
          }
          .t4y-identity-root[data-t4y-identity="login-gate"] .t4y-identity-actions {
            margin-top: auto;
            padding: 0 24px 24px;
          }
          .t4y-identity-btn {
            box-sizing: border-box;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-width: 72px;
            height: 36px;
            padding: 0 14px;
            border: none;
            border-radius: var(--dsw-radius-md, 8px);
            font-size: 14px;
            line-height: 22px;
            cursor: pointer;
          }
          .t4y-identity-btn:disabled {
            cursor: not-allowed;
            opacity: 0.4;
          }
          .t4y-identity-btn-primary {
            padding: 0 16px;
            font-weight: 500;
            background: var(--dsw-alias-button-primary-fill, #0f1115);
            color: var(--dsw-alias-label-primary-foreground, #fff);
          }
          .t4y-identity-btn-primary:hover:not(:disabled) {
            background: var(--dsw-alias-button-primary-hover, #25282e);
          }
          .t4y-identity-btn-outline {
            border: 0.5px solid var(--dsw-alias-border-l2, #cbd5e1);
            background: transparent;
            color: var(--dsw-alias-label-primary, #0f172a);
          }
          .t4y-identity-btn-outline:hover:not(:disabled) {
            background: var(--dsw-alias-interactive-bg-hover, rgba(15, 23, 42, 0.06));
          }
        `
        let disposed = false
        return () => {
          if (disposed) return
          disposed = true
          const owners = Number(style.dataset.owners) - 1
          style.dataset.owners = String(owners)
          if (owners === 0) style.remove()
        }
      }, 't4y identity: styles')

      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 't4y-identity-gate',
        order: 1,
        locale: LOCALE_NS,
      }, () => React.createElement(IdentityOverlay, {
        t,
        remote: ctx.remote,
        uiWorkspace: ctx.uiWorkspace,
        workspaces: ctx.workspaces,
      })))

      ctx.effect(() => installAccountMenuAdapter(t), 't4y identity: account menu adapter')

      window.__t4yIdentity = {
        getSession: readSession,
        getAccessToken: () => readSession()?.accessToken || null,
        getModuleId: () => readSession()?.moduleId || null,
        isAdministrator: () => {
          const roles = readSession()?.roles || []
          return roles.includes('admin') || roles.includes('supManager')
        },
        logout: () => { doLogout() },
        selectModule: (moduleId) => {
          const session = readSession()
          if (!session) return null
          return commitModule(session, moduleId)
        },
        onSession: (listener) => {
          const handler = (event) => listener(event.detail?.session ?? readSession())
          window.addEventListener(EVENT_NAME, handler)
          return () => window.removeEventListener(EVENT_NAME, handler)
        },
        apiBaseUrl: API_BASE_URL,
        defaultTenantId: '',
      }

      ctx.effect(() => () => { delete window.__t4yIdentity }, 't4y identity: bridge')
    }
    return module.exports
  },
})
