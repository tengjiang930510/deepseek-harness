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
