    /**
     * After enter: 15 min with no tap/typing → close live WebSockets (free channel).
     * Device pairing cookies stay;「继续使用」reload 免登续连.
     * Page merely open in foreground does not count as activity.
     */
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
          try { window.__t4yCowatchPresence?.leave() } catch { /* ignore */ }
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
