    /**
     * Desktop「移动访问」：
     * - 侧栏入口隐藏，改放到账号菜单「移动访问」
     * - 面板内只留一行勾选开关
     * - 启动后默认拉起 FRP；失败静默重试 2 次后再 toast
     */
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
            color: inherit;
            -webkit-text-fill-color: currentColor;
          }
          button[${MENU_ITEM_ATTR}="1"] .t4y-ma-qr-hint {
            flex: none;
            font-size: 12px;
            font-weight: 500;
            color: #1d4ed8 !important;
            padding: 0.1rem 0.45rem;
            border-radius: 999px;
            background: #eff6ff;
            -webkit-text-fill-color: currentColor;
          }
          button[${MENU_ITEM_ATTR}="1"] .t4y-ma-qr-hint[data-connected="1"] {
            color: #166534 !important;
            background: #dcfce7;
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
            margin: 0 0 0.85rem;
            color: #64748b;
            font-size: 0.84rem;
            line-height: 1.45;
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
          #t4y-mobile-access-qr-root .t4y-ma-qr-connected {
            margin: 0 0 0.75rem;
            padding: 0.4rem 0.65rem;
            border-radius: 8px;
            background: #f0fdf4;
            color: #166534 !important;
            font-size: 0.82rem;
            font-weight: 500;
            text-align: left;
            -webkit-text-fill-color: currentColor;
          }
          #t4y-mobile-access-qr-root .t4y-ma-qr-connected[data-empty="1"] {
            background: #f8fafc;
            color: #64748b !important;
          }
          #t4y-mobile-access-qr-root .t4y-ma-qr-actions button {
            padding: 0.62rem 0.75rem;
            border-radius: 10px;
            border: 1px solid #e2e8f0;
            background: #fff;
            color: #334155 !important;
            font-size: 0.9rem;
            font-weight: 500;
            cursor: pointer;
            -webkit-text-fill-color: currentColor;
          }
          #t4y-mobile-access-qr-root .t4y-ma-qr-actions button:hover {
            background: #f8fafc;
          }
          #t4y-mobile-access-qr-root .t4y-ma-qr-actions button.primary {
            background: #0f172a;
            color: #fff !important;
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
          const err = new Error(
            typeof body?.message === 'string' && body.message !== ''
              ? body.message
              : (typeof body?.error === 'string' ? body.error : `HTTP ${response.status}`),
          )
          err.status = response.status
          err.code = typeof body?.error === 'string' ? body.error : undefined
          throw err
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
          writeAcceptingCache(on)
          paintMenuSwitch(switchEl, on, false)
        } catch {
          paintMenuSwitch(switchEl, readCachedAccepting(), false)
        }
      }

      // Soft-off flag (cross-tab). FRP stays up so phones still reach the offline page.
      const USER_OFF_KEY = 't4y.mobile.remote.userOff'
      /** Last known Host accepting — paints the menu switch before the next fetch returns. */
      const ACCEPTING_CACHE_KEY = 't4y.mobile.remote.acceptingCached'

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

      /**
       * Optimistic switch state before /accepting returns.
       * Prefer explicit cache, then invert userOff (missing keys → on, matching Host default).
       * @returns {boolean}
       */
      function readCachedAccepting() {
        try {
          const cached = localStorage.getItem(ACCEPTING_CACHE_KEY)
          if (cached === '1') return true
          if (cached === '0') return false
        } catch { /* fall through */ }
        return !readUserOff()
      }

      /** @param {boolean} on */
      function writeAcceptingCache(on) {
        try {
          localStorage.setItem(ACCEPTING_CACHE_KEY, on ? '1' : '0')
        } catch { /* ignore */ }
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
          writeAcceptingCache(!off)
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
          <p class="t4y-ma-qr-desc">用手机扫描下方二维码</p>
          <p class="t4y-ma-qr-connected" data-connected data-empty="1">暂无手机连接</p>
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
        const connectedEl = root.querySelector('[data-connected]')
        /** @type {string} */
        let lastConnectedKey = ''
        /** @type {boolean} */
        let paintBusy = false
        /** @type {ReturnType<typeof window.setTimeout> | undefined} */
        let qrExpireTimer
        /** @type {ReturnType<typeof window.setInterval> | undefined} */
        let channelWatchTimer
        const clearQrExpireTimer = () => {
          if (qrExpireTimer !== undefined) {
            window.clearTimeout(qrExpireTimer)
            qrExpireTimer = undefined
          }
        }
        const armQrExpireRefresh = (expiresAt) => {
          clearQrExpireTimer()
          if (!(typeof expiresAt === 'number') || !Number.isFinite(expiresAt)) return
          const wait = Math.max(0, expiresAt - Date.now() + 250)
          qrExpireTimer = window.setTimeout(() => {
            qrExpireTimer = undefined
            if (!document.getElementById(QR_ROOT_ID)) return
            void paint()
          }, wait)
        }
        const markChannelDown = () => {
          const box = root.querySelector('[data-qr]')
          const meta = root.querySelector('[data-meta]')
          if (!(box instanceof HTMLElement)) return
          // Stop advertising a stale QR that would hit nginx Not Found on the phone.
          clearQrExpireTimer()
          box.dataset.state = 'error'
          box.textContent = '远程通道断开，当前二维码已失效。恢复后会自动刷新…'
          if (meta instanceof HTMLElement) {
            meta.hidden = false
            meta.textContent = '也可手动点「刷新二维码」'
          }
        }
        const paint = async () => {
          if (paintBusy) return
          paintBusy = true
          clearQrExpireTimer()
          const box = root.querySelector('[data-qr]')
          const meta = root.querySelector('[data-meta]')
          if (!(box instanceof HTMLElement) || !(meta instanceof HTMLElement)) {
            paintBusy = false
            return
          }
          box.dataset.state = 'loading'
          box.textContent = '正在生成'
          meta.hidden = true
          meta.textContent = ''
          try {
            // Invalidate any previous open pairing so old codes fail closed (配对已过期), not half-alive.
            try {
              await adminJson('/api/mobile-access/remote/pairing/close', {
                method: 'POST',
                body: '{}',
              })
            } catch { /* none open */ }
            // FrpController must be ready (gateway()) before pairing/open.
            try {
              const originInfo = await syncPerHostOrigin()
              const snap = await ensureFrpTunnel({ reason: 'qr' })
              if (snap?.state === 'ready') {
                warmPublicOrigin(originInfo?.publicOrigin || snap?.origin)
              }
            } catch { /* pairing open retries below */ }
            let data
            try {
              data = await adminJson('/api/mobile-access/remote/pairing/open', {
                method: 'POST',
                body: '{}',
              })
            } catch (pairError) {
              const msg = pairError instanceof Error ? pairError.message : ''
              if (!/gateway_stopped/i.test(msg)) throw pairError
              await ensureFrpTunnel({ reason: 'qr' })
              data = await adminJson('/api/mobile-access/remote/pairing/open', {
                method: 'POST',
                body: '{}',
              })
            }
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
              const until = new Date(expiresAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
              meta.textContent = `有效至 ${until}`
              armQrExpireRefresh(expiresAt)
            } else {
              meta.hidden = true
            }
          } catch (error) {
            box.dataset.state = 'error'
            const detail = error instanceof Error ? error.message : ''
            box.textContent = detail && detail !== 'empty_pair_url'
              ? `生成失败：${detail}`
              : '生成失败，请确认移动访问已开启，并检查网络后重试'
            meta.hidden = true
          } finally {
            paintBusy = false
          }
        }
        const paintConnected = async () => {
          if (!(connectedEl instanceof HTMLElement)) return
          const snapshot = await fetchConnectedDevices()
          connectedEl.textContent = formatConnectedBanner(snapshot)
          connectedEl.dataset.empty = /暂无/.test(connectedEl.textContent) ? '1' : '0'
          const key = snapshot.devices.map((device) => String(device?.id || '')).filter(Boolean).sort().join(',')
          // After a successful scan the token is spent — mint a fresh QR so switching browsers works.
          if (lastConnectedKey !== '' && key !== lastConnectedKey) {
            lastConnectedKey = key
            void paint()
            return
          }
          lastConnectedKey = key
        }
        void paintConnected()
        const connectedTimer = window.setInterval(() => { void paintConnected() }, 3_000)
        // Drop stale QR when FRP dies (phone would otherwise see nginx Not Found); remint when healthy.
        channelWatchTimer = window.setInterval(() => {
          if (!document.getElementById(QR_ROOT_ID) || paintBusy) return
          void (async () => {
            const box = root.querySelector('[data-qr]')
            if (!(box instanceof HTMLElement)) return
            try {
              const st = await adminJson('/api/mobile-access/remote/control')
              const ok = st?.provider === 'frp' && st?.running === true && st?.state === 'ready'
              if (!ok) {
                if (box.dataset.state === 'ready') markChannelDown()
                const snap = await ensureFrpTunnel({ reason: 'qr-watch' }).catch(() => null)
                if (snap?.state === 'ready' && box.dataset.state === 'error') void paint()
                return
              }
              if (box.dataset.state === 'error' && /通道断开|已失效/.test(box.textContent || '')) {
                void paint()
              }
            } catch { /* next tick */ }
          })()
        }, 5_000)
        const onKey = (event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            closeQrPanel()
          }
        }
        window.addEventListener('keydown', onKey)
        qrPanelCleanup = () => {
          clearQrExpireTimer()
          window.clearInterval(connectedTimer)
          if (channelWatchTimer !== undefined) window.clearInterval(channelWatchTimer)
          window.removeEventListener('keydown', onKey)
        }
        root.addEventListener('click', (event) => {
          if (event.target === root) closeQrPanel()
        })
        for (const btn of root.querySelectorAll('[data-action="close"]')) {
          btn.addEventListener('click', () => closeQrPanel())
        }
        root.querySelector('[data-action="refresh"]')?.addEventListener('click', () => { void paint() })
        await paint()
      }

      /**
       * @returns {Promise<{ devices: { id: string, label: string, online: boolean }[], onlineCount: number }>}
       */
      async function fetchConnectedDevices() {
        try {
          const data = await adminJson('/api/t4y-mobile-cowatch/connected-devices')
          const devices = Array.isArray(data?.devices) ? data.devices : []
          const onlineCount = typeof data?.onlineCount === 'number'
            ? data.onlineCount
            : devices.filter((device) => device?.online === true).length
          return { devices, onlineCount }
        } catch {
          return { devices: [], onlineCount: 0 }
        }
      }

      /**
       * @param {{ devices: { label?: string, online?: boolean }[], onlineCount: number }} snapshot
       * @returns {string}
       */
      /**
       * Prefer Host-enriched label (`iPhone · a1b2c3d4（管理员）`); fall back to model/shortId.
       * @param {{ label?: string, model?: string, shortId?: string, account?: string, id?: string }} device
       * @returns {string}
       */
      function connectedDeviceLabel(device) {
        if (typeof device?.label === 'string' && device.label.trim() !== '') return device.label.trim()
        const model = typeof device?.model === 'string' && device.model.trim() !== ''
          ? device.model.trim()
          : '手机'
        const shortId = typeof device?.shortId === 'string' && device.shortId !== ''
          ? device.shortId
          : (typeof device?.id === 'string' && device.id.length >= 8 ? device.id.slice(0, 8) : '')
        const base = shortId ? `${model} · ${shortId}` : model
        const account = typeof device?.account === 'string' ? device.account.trim() : ''
        return account && account !== model ? `${base}（${account}）` : base
      }

      function formatConnectedHint(snapshot) {
        // Account menu: short status only. Model / shortId live in the QR panel.
        const online = snapshot.devices.filter((device) => device.online !== false)
        if (online.length === 0) return '扫码'
        if (online.length === 1) return '已连接'
        return `已连接 ${online.length} 台`
      }

      /**
       * @param {{ devices: { label?: string, online?: boolean }[], onlineCount: number }} snapshot
       * @returns {string}
       */
      function formatConnectedBanner(snapshot) {
        const online = snapshot.devices.filter((device) => device.online !== false)
        if (online.length === 0) return '暂无手机连接'
        if (online.length === 1) {
          return `当前已连接：${connectedDeviceLabel(online[0])}`
        }
        const names = online.slice(0, 3).map((device) => connectedDeviceLabel(device)).join('、')
        const more = online.length > 3 ? ` 等 ${online.length} 台` : ''
        return `当前已连接：${names}${more}`
      }

      /**
       * @param {HTMLElement} item
       * @param {boolean} on
       * @param {{ devices: { label?: string, online?: boolean }[], onlineCount: number } | null} [snapshot]
       */
      function syncQrHint(item, on, snapshot = null) {
        const hint = item.querySelector('.t4y-ma-qr-hint')
        if (!(hint instanceof HTMLElement)) return
        if (!on) {
          hint.setAttribute('hidden', '')
          hint.dataset.connected = '0'
          hint.textContent = '扫码'
          return
        }
        hint.removeAttribute('hidden')
        const text = snapshot ? formatConnectedHint(snapshot) : '扫码'
        hint.textContent = text
        hint.dataset.connected = text.startsWith('已连接') ? '1' : '0'
      }

      /** @type {ReturnType<typeof window.setInterval> | undefined} */
      let connectedPollTimer
      /** @type {Promise<{ devices: { id: string, label: string, online: boolean }[], onlineCount: number }> | null} */
      let connectedInflight = null

      function stopConnectedPolling() {
        if (connectedPollTimer !== undefined) {
          window.clearInterval(connectedPollTimer)
          connectedPollTimer = undefined
        }
      }

      async function refreshConnectedHints() {
        const item = document.querySelector(`button[${MENU_ITEM_ATTR}="1"]`)
        if (!(item instanceof HTMLElement)) return
        const switchEl = item.querySelector('.t4y-ma-switch')
        const on = switchEl instanceof HTMLElement && switchEl.dataset.on === '1'
        if (!on) {
          syncQrHint(item, false)
          return
        }
        if (!connectedInflight) {
          connectedInflight = fetchConnectedDevices().finally(() => { connectedInflight = null })
        }
        const snapshot = await connectedInflight
        syncQrHint(item, true, snapshot)
        const panel = document.getElementById(QR_ROOT_ID)
        const banner = panel?.querySelector('[data-connected]')
        if (banner instanceof HTMLElement) {
          banner.textContent = formatConnectedBanner(snapshot)
          banner.dataset.empty = /暂无/.test(banner.textContent) ? '1' : '0'
        }
      }

      function ensureConnectedPolling(on) {
        if (!on) {
          stopConnectedPolling()
          return
        }
        if (connectedPollTimer !== undefined) return
        void refreshConnectedHints()
        // Pseudo-real-time: leave beacon clears soon; poll only for crashed-tab TTL expiry.
        connectedPollTimer = window.setInterval(() => { void refreshConnectedHints() }, 15_000)
      }

      /** Soft close/open: accepting on ⇒ FRP up; soft-off ⇒ grace then release the shared frps slot. */
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
          ensureConnectedPolling(on)
          if (item instanceof HTMLElement) {
            if (on) void refreshConnectedHints()
            else syncQrHint(item, false)
          }
          if (on) {
            cancelFrpStop()
            try {
              const originInfo = await syncPerHostOrigin()
              const snap = await ensureFrpTunnel({ reason: 'soft-on' })
              warmPublicOrigin(originInfo?.publicOrigin || snap?.origin)
            } catch { /* ensure path reports via auto-ensure toast */ }
          } else {
            scheduleFrpStop()
          }
          if (!on) closeQrPanel()
          else if (options.openQr === true) void openQrPanel()
        } catch (error) {
          writeUserOff(wantOn)
          paintMenuSwitch(switchEl, !wantOn, false)
          if (item instanceof HTMLElement) syncQrHint(item, !wantOn)
          const busy = error && typeof error === 'object' && error.code === 'accepting_slot_busy'
          const detail = error instanceof Error && error.message ? error.message : ''
          showRemoteToast(
            busy && detail !== ''
              ? detail
              : (wantOn ? '移动访问开启失败' : '移动访问关闭失败'),
          )
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
              // Keep painted state; only reconcile with Host (avoid off→on flash).
              if (sw.dataset.on !== '1' && sw.dataset.on !== '0') {
                paintMenuSwitch(sw, readCachedAccepting(), false)
              }
              void refreshMenuSwitch(sw).then(() => {
                const on = sw.dataset.on === '1'
                ensureConnectedPolling(on)
                if (on) void refreshConnectedHints()
                else syncQrHint(existing, false)
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
          const cachedOn = readCachedAccepting()
          item.innerHTML = `${iconClass ? `<span class="${iconClass}">${PHONE_ICON_SVG}</span>` : `<span>${PHONE_ICON_SVG}</span>`}<span class="t4y-ma-label">移动访问</span><span class="t4y-ma-qr-hint"${cachedOn ? '' : ' hidden'}>扫码</span><span class="t4y-ma-switch" role="switch" aria-checked="${cachedOn ? 'true' : 'false'}"></span>`
          const switchEl = item.querySelector('.t4y-ma-switch')
          if (switchEl instanceof HTMLElement) paintMenuSwitch(switchEl, cachedOn, false)
          item.addEventListener('click', (event) => {
            event.preventDefault()
            event.stopPropagation()
            if (!(switchEl instanceof HTMLElement) || switchEl.dataset.busy === '1') return
            const target = event.target instanceof Element ? event.target : null
            const hitSwitch = target?.closest?.('.t4y-ma-switch')
            if (hitSwitch) {
              // Toggle only — never auto-open QR; user clicks the row /「扫码」when ready.
              const next = switchEl.dataset.on !== '1'
              void setRemoteEnabled(switchEl, next, { openQr: false })
              return
            }
            // Soft-on: click label /「扫码」opens QR. Soft-off: click only turns the switch on.
            if (switchEl.dataset.on === '1') {
              void openQrPanel()
              return
            }
            void setRemoteEnabled(switchEl, true, { openQr: false })
          })
          const settings = [...menu.querySelectorAll('[role="menuitem"]')].find((el) => /设置|Settings/i.test(el.textContent || ''))
          if (settings?.nextSibling) menu.insertBefore(item, settings.nextSibling)
          else if (settings) settings.after(item)
          else menu.insertBefore(item, menu.firstChild)
          if (switchEl instanceof HTMLElement) {
            ensureConnectedPolling(cachedOn)
            if (cachedOn) void refreshConnectedHints()
            void refreshMenuSwitch(switchEl).then(() => {
              const on = switchEl.dataset.on === '1'
              ensureConnectedPolling(on)
              if (on) void refreshConnectedHints()
              else syncQrHint(item, false)
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

      /** Soft-off: keep FRP briefly for「电脑不在线」, then release the shared frps slot. */
      const SOFT_OFF_FRP_GRACE_MS = 60_000
      /** @type {ReturnType<typeof window.setTimeout> | undefined} */
      let frpStopTimer

      function cancelFrpStop() {
        if (frpStopTimer !== undefined) {
          window.clearTimeout(frpStopTimer)
          frpStopTimer = undefined
        }
      }

      async function stopFrpTunnel() {
        try {
          await adminJson('/api/mobile-access/remote/control', {
            method: 'POST',
            body: JSON.stringify({ running: false, provider: 'frp' }),
          })
        } catch { /* offline / already stopped */ }
      }

      function scheduleFrpStop() {
        cancelFrpStop()
        frpStopTimer = window.setTimeout(() => {
          frpStopTimer = undefined
          void stopFrpTunnel()
        }, SOFT_OFF_FRP_GRACE_MS)
      }

      /** Apply per-Desktop publicOrigin; reload frpc when the Host rewrote settings. */
      let originSyncInflight = null
      async function syncPerHostOrigin() {
        if (originSyncInflight) return originSyncInflight
        originSyncInflight = (async () => {
          const result = await adminJson('/api/t4y-mobile-cowatch/per-host-origin', {
            method: 'POST',
            body: '{}',
          })
          if (result?.changed === true && result.configure && typeof result.configure === 'object') {
            await adminJson('/api/mobile-access/remote/frp/configure', {
              method: 'POST',
              body: JSON.stringify(result.configure),
            })
          }
          return result
        })().finally(() => { originSyncInflight = null })
        return originSyncInflight
      }

      /** @type {number} */
      let lastOriginWarmAt = 0
      /**
       * No corporate domain: sslip uses Let's Encrypt on-demand (~10s first hit).
       * Warm the public Origin from the PC as soon as FRP is up so the phone skips that wait.
       * @param {string | null | undefined} [hintOrigin]
       */
      function warmPublicOrigin(hintOrigin) {
        const now = Date.now()
        if (now - lastOriginWarmAt < 10 * 60_000) return
        lastOriginWarmAt = now
        void (async () => {
          try {
            let origin = typeof hintOrigin === 'string' ? hintOrigin.trim().replace(/\/$/u, '') : ''
            if (!origin.startsWith('https://')) {
              const synced = await syncPerHostOrigin()
              if (typeof synced?.publicOrigin === 'string') {
                origin = synced.publicOrigin.trim().replace(/\/$/u, '')
              }
            }
            if (!origin.startsWith('https://')) {
              const snap = await adminJson('/api/mobile-access/remote/control')
              if (typeof snap?.origin === 'string') origin = snap.origin.trim().replace(/\/$/u, '')
            }
            if (!origin.startsWith('https://')) return
            await fetch(`${origin}/mobile-access/discovery`, {
              method: 'GET',
              mode: 'cors',
              credentials: 'omit',
              cache: 'no-store',
              signal: AbortSignal.timeout(45_000),
            })
          } catch { /* warm is best-effort; phone still works after LE issues */ }
        })()
      }

      /**
       * Single-flight FRP repair for QR + auto-ensure (only while accepting).
       * Never tear down a ready tunnel (clear/reconnect drops phone mid-boot →
       * ECONNRESET → "Failed to load plugins"). Only repair when FrpController
       * is actually down/broken.
       * @param {{ reason?: string }} [options]
       * @returns {Promise<{ provider?: string, running?: boolean, state?: string, origin?: string } | null>}
       */
      let tunnelEnsureInflight = null
      async function ensureFrpTunnel(options = {}) {
        if (tunnelEnsureInflight) return tunnelEnsureInflight
        tunnelEnsureInflight = (async () => {
          void options
          let snap = null
          try {
            snap = await adminJson('/api/mobile-access/remote/control')
          } catch { /* start path below */ }

          const isReady = (s) => s
            && s.provider === 'frp'
            && s.running === true
            && s.state === 'ready'
          const isHandshaking = (s) => s
            && s.provider === 'frp'
            && s.running === true
            && (s.state === 'starting' || s.state === 'connecting')
          // frpc may still be listed as running while FrpController reports frp_exited.
          const isZombieError = (s) => s
            && s.provider === 'frp'
            && (s.state === 'error' || s.errorCode === 'frp_exited' || s.errorCode === 'gateway_stopped')

          if (isReady(snap)) return snap

          // Handshake in progress — wait, never stop+start under a live phone.
          if (isHandshaking(snap)) {
            for (let i = 0; i < 12; i += 1) {
              await new Promise((resolve) => window.setTimeout(resolve, 700))
              try {
                snap = await adminJson('/api/mobile-access/remote/control')
              } catch { /* keep */ }
              if (isReady(snap) || !isHandshaking(snap)) break
            }
            if (isReady(snap) || isHandshaking(snap)) return snap
          }

          // Zombie running+error: stop first so start/reconnect can rebuild gateway().
          if (isZombieError(snap) && snap?.running === true) {
            try {
              await adminJson('/api/mobile-access/remote/control', {
                method: 'POST',
                body: JSON.stringify({ running: false, provider: 'frp' }),
              })
            } catch { /* best-effort */ }
          }

          // Broken / off: free orphan frpc, then start (prefer start over reconnect).
          try {
            await adminJson('/api/t4y-mobile-cowatch/frp-guard', {
              method: 'POST',
              body: JSON.stringify({ clearForReconnect: true }),
            })
          } catch { /* best-effort */ }

          try {
            snap = await adminJson('/api/mobile-access/remote/control', {
              method: 'POST',
              body: JSON.stringify({ running: true, provider: 'frp' }),
            })
          } catch { /* reconnect below */ }

          if (!isReady(snap) && !isHandshaking(snap)) {
            try {
              snap = await adminJson('/api/mobile-access/remote/reconnect', {
                method: 'POST',
                body: JSON.stringify({ provider: 'frp' }),
              })
            } catch { /* caller surfaces */ }
          }

          for (let i = 0; i < 12; i += 1) {
            if (isReady(snap)) break
            if (!isHandshaking(snap)) break
            await new Promise((resolve) => window.setTimeout(resolve, 700))
            try {
              snap = await adminJson('/api/mobile-access/remote/control')
            } catch { /* keep */ }
          }
          return snap
        })().finally(() => { tunnelEnsureInflight = null })
        return tunnelEnsureInflight
      }

      /**
       * Keep FRP warm only while「移动访问」is accepting. Soft-off releases after grace.
       */
      function installRemoteAutoEnsure() {
        let silentFails = 0
        let toastShown = false
        let inFlight = false
        /** @type {ReturnType<typeof window.setInterval> | undefined} */
        let timer
        let acceptingSynced = false
        let originSynced = false

        const healthy = (snap) => snap
          && snap.provider === 'frp'
          && snap.running === true
          && snap.state === 'ready'

        const syncAcceptingFromLocal = async () => {
          if (acceptingSynced) return
          // Prior hard-off left localStorage userOff; map it onto soft-off once.
          if (!readUserOff()) {
            acceptingSynced = true
            return
          }
          try {
            await adminJson('/api/t4y-mobile-cowatch/accepting', {
              method: 'POST',
              body: JSON.stringify({ accepting: false }),
            })
            acceptingSynced = true
            scheduleFrpStop()
          } catch { /* retry on next tick */ }
        }

        const readAccepting = async () => {
          try {
            const data = await adminJson('/api/t4y-mobile-cowatch/accepting')
            return data?.accepting === true
          } catch {
            return readCachedAccepting()
          }
        }

        const tick = async () => {
          if (inFlight || document.hidden) return
          inFlight = true
          try {
            await syncAcceptingFromLocal()
            const accepting = await readAccepting()
            if (!accepting) {
              silentFails = 0
              // Soft-off / boot with switch off: release leftover tunnels after grace.
              if (frpStopTimer === undefined) scheduleFrpStop()
              return
            }
            cancelFrpStop()
            /** @type {string | null} */
            let publicOriginHint = null
            if (!originSynced) {
              try {
                const originInfo = await syncPerHostOrigin()
                publicOriginHint = typeof originInfo?.publicOrigin === 'string' ? originInfo.publicOrigin : null
                originSynced = true
              } catch { /* retry next tick */ }
            }
            let snap = await ensureFrpTunnel({ reason: 'auto-ensure' })
            if (healthy(snap)) {
              silentFails = 0
              toastShown = false
              warmPublicOrigin(publicOriginHint || snap?.origin)
              return
            }
            // Still handshaking — do not count as failure yet.
            if (
              snap
              && snap.provider === 'frp'
              && snap.running === true
              && (snap.state === 'starting' || snap.state === 'connecting')
            ) {
              return
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
