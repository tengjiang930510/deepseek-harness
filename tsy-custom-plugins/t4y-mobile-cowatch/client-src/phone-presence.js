    /**
     * Pseudo-live「已连接」: enter beat + leave on hide; re-enter when the tab returns.
     * No periodic heartbeat — scales to many phones without Host chatter.
     */
    function installPhonePresence() {
      if (typeof window === 'undefined' || typeof document === 'undefined') return
      const PATH = '/api/t4y-mobile-cowatch/presence'

      /**
       * @param {boolean} online
       * @param {{ keepalive?: boolean }} [options]
       */
      function beat(online, options = {}) {
        const body = JSON.stringify({ online })
        const keepalive = options.keepalive === true
        try {
          if (keepalive && typeof navigator.sendBeacon === 'function') {
            const blob = new Blob([body], { type: 'application/json' })
            if (navigator.sendBeacon(PATH, blob)) return
          }
        } catch { /* fall through to fetch */ }
        void rawFetch(PATH, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          credentials: 'include',
          keepalive,
        }).catch(() => { /* ignore transient FRP blips */ })
      }

      function leave() {
        beat(false, { keepalive: true })
      }

      function enter() {
        beat(true)
      }

      // Expose for idle gate — socket drop should clear PC「已连接」without a heartbeat loop.
      window.__t4yCowatchPresence = { enter, leave }

      enter()
      window.addEventListener('pagehide', leave)
      window.addEventListener('beforeunload', leave)
      window.addEventListener('pageshow', enter)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') enter()
        else leave()
      })
    }
