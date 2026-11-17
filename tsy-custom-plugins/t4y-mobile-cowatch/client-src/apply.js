    exports.inject = ['slots', 'locale']
    exports.apply = (ctx) => {
      // Desktop also needs the FRP-only simplify for「移动访问」.
      installEnterpriseMobileAccessSimplify()

      if (!active) return

      installStyles()
      installIdleWatchdog()
      installDeviceSwitcher()

      ctx.effect(() => () => {
        scrubLeakedChrome()
        try { document.getElementById(IDLE_GATE_ID)?.remove() } catch { /* ignore */ }
        try { document.getElementById('t4y-mobile-switch-root')?.remove() } catch { /* ignore */ }
        try { document.getElementById('t4y-mobile-switch-fab')?.remove() } catch { /* ignore */ }
      }, 't4y-mobile-cowatch: teardown')

      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 't4y-mobile-cowatch-wait',
        order: 0,
        locale: false,
      }, () => React.createElement(WaitGate)))
    }
