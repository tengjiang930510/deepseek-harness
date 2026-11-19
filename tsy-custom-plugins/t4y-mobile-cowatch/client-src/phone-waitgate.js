    /**
     * Best-effort: rename dsh-mobile device label to enterprise displayName (Codex-style user binding).
     * @param {object} session
     */
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
