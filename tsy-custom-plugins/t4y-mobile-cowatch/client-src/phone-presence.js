    /**
     * Desktop「已连接」is driven by Host presence rows created at pair/register/enter,
     * refreshed by cookie traffic, and cleared by an explicit leave beacon.
     */
    function installPhonePresence() {
      if (typeof window === 'undefined') return

      /** @type {boolean | null} */
      let desiredOnline = null
      /** @type {Promise<void>} */
      let chain = Promise.resolve()

      const postPresence = (online, keepalive = false) => {
        const body = JSON.stringify({ online: online === true })
        try {
          if (online !== true && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
            const blob = new Blob([body], { type: 'application/json' })
            if (navigator.sendBeacon('/api/t4y-mobile-cowatch/presence', blob)) return Promise.resolve()
          }
        } catch { /* fall through to fetch */ }
        return fetch('/api/t4y-mobile-cowatch/presence', {
          method: 'POST',
          credentials: 'same-origin',
          keepalive: keepalive === true,
          headers: { 'content-type': 'application/json' },
          body,
        }).then(() => undefined, () => undefined)
      }

      const flush = () => {
        chain = chain.then(async () => {
          const target = desiredOnline
          if (target === null) return
          await postPresence(target === true, target !== true)
          // A newer leave/enter may have flipped desired while we were in flight.
          if (desiredOnline !== target && desiredOnline !== null) {
            await postPresence(desiredOnline === true, desiredOnline !== true)
          }
        })
        return chain
      }

      const leave = () => {
        desiredOnline = false
        void flush()
      }

      const enter = () => {
        desiredOnline = true
        void flush()
      }

      window.__t4yCowatchPresence = { enter, leave }

      try {
        if (document.readyState === 'complete') enter()
        else window.addEventListener('load', () => enter(), { once: true })
      } catch { /* ignore */ }

      try {
        window.addEventListener('pagehide', () => leave())
        window.addEventListener('beforeunload', () => leave())
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'hidden') leave()
          else if (document.visibilityState === 'visible') enter()
        })
      } catch { /* ignore */ }
    }
