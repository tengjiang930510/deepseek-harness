window.__ModuleLoader__.load({
  id: 't4y-tenant/client',
  factory: () => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const EVENT_NAME = 't4y-tenant:changed'

    /** System tenant id from session (`enterprise.id` on login). */
    function sessionTenantId(session) {
      if (typeof session?.tenantId === 'string' && session.tenantId !== '') return session.tenantId
      // Brief enterpriseId write during rename; treat as tenantId.
      if (typeof session?.enterpriseId === 'string' && session.enterpriseId !== '') return session.enterpriseId
      return ''
    }

    function currentTenantId() {
      const session = window.__t4yIdentity?.getSession?.()
      const fromSession = sessionTenantId(session)
      if (fromSession !== '') return fromSession
      return window.__t4yIdentity?.defaultTenantId || ''
    }

    /** Current enterprise id. */
    function currentModuleId() {
      const session = window.__t4yIdentity?.getSession?.()
      return session?.moduleId || null
    }

    exports.inject = []
    exports.apply = (ctx) => {
      window.__t4yTenant = {
        getTenantId: currentTenantId,
        getModuleId: currentModuleId,
        getDefaultTenantId: () => window.__t4yIdentity?.defaultTenantId || '',
        getCatalogProjectId: () => window.__t4yIdentity?.catalogProjectId || '',
        onChange: (listener) => {
          const handler = (event) => listener(
            event.detail?.tenantId || currentTenantId(),
            event.detail?.reason || 'changed',
            event.detail?.moduleId ?? currentModuleId(),
          )
          window.addEventListener(EVENT_NAME, handler)
          return () => window.removeEventListener(EVENT_NAME, handler)
        },
      }

      ctx.effect(() => {
        const onIdentity = () => {
          const session = window.__t4yIdentity?.getSession?.()
          window.dispatchEvent(new CustomEvent(EVENT_NAME, {
            detail: {
              tenantId: sessionTenantId(session),
              moduleId: session?.moduleId || null,
              reason: session ? 'login' : 'logout',
            },
          }))
        }
        const remove = window.__t4yIdentity?.onSession?.(onIdentity)
        return () => {
          remove?.()
          delete window.__t4yTenant
        }
      }, 't4y tenant: bridge')
    }
    return module.exports
  },
})
