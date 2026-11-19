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
            <button type="button" class="primary" data-action="refresh">${t('switchRefresh')}</button>
          </div>
          <button type="button" class="t4y-mobile-switch-select-link" data-action="select-page">选机列表</button>
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
