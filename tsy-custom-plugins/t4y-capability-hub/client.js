window.__ModuleLoader__.load({
  id: 't4y-capability-hub/client',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const { PluginArtworkDefault } = require('@deepseek-ai/dsh-client-ui-primitives')
    const SETTINGS_NS = 't4y.settings.capability'
    const hubCopy = {
      zh: {
        tab: '授权插件',
        intro: '只显示当前项目菜单中有权限的插件。开启/关闭与系统「插件」页相同：即时生效，无需刷新页面。',
        commands: '命令',
        categoryOther: '其他',
        shortcut: '在输入框显示快捷按钮',
        shortcutDraft: '请先处理当前输入内容',
        shortcutFailed: '无法打开插件命令，请确认插件已启用后重试',
        enableToggle: '启用 {name}',
        loading: '正在读取插件状态…',
        loginRequired: '请先通过账户菜单登录，再查看或安装当前项目的插件。',
        missing: '尚未安装',
        installing: '正在安装…',
        installedApplied: '已安装并启用',
        restartRequired: '已安装；请重启应用后使用',
        error: '无法读取插件状态。',
        catalogError: '无法读取当前项目的插件配置：{message}',
        noPlugins: '当前项目没有可用插件',
        toggleFailed: '切换失败：{message}',
      },
      en: {
        tab: 'Authorized plugins',
        intro: 'Only plugins authorized by the current project menu appear here. Enable and disable work like the system Plugins page: they apply immediately without refreshing.',
        commands: 'Commands',
        categoryOther: 'Other',
        shortcut: 'Show shortcut in composer',
        shortcutDraft: 'Finish the current draft first',
        shortcutFailed: 'Could not open the plugin command. Check that the plugin is enabled and try again.',
        enableToggle: 'Enable {name}',
        loading: 'Loading plugin status…',
        loginRequired: 'Sign in from the account menu before viewing or installing this project’s plugins.',
        missing: 'Not installed',
        installing: 'Installing…',
        installedApplied: 'Installed and enabled',
        restartRequired: 'Installed. Restart the app before use.',
        error: 'Could not read plugin status.',
        catalogError: 'Could not read this project’s plugin configuration: {message}',
        noPlugins: 'This project has no available plugins.',
        toggleFailed: 'Toggle failed: {message}',
      },
    }

    function resolveText(locale, text) {
      if (text == null) return ''
      if (typeof text === 'string') return text
      if (typeof text === 'object') return text.zh || text.en || ''
      return String(text)
    }

    function format(template, vars) {
      return String(template).replace(/\{(\w+)\}/g, (_, key) => (
        vars?.[key] == null ? '' : String(vars[key])
      ))
    }

    function moduleId() {
      return window.__t4yTenant?.getModuleId?.() || null
    }

    async function releaseRequest(path, body) {
      const url = new URL(path, window.location.origin).toString()
      // Never put the enterprise token in Authorization — that header is reserved
      // for the DSH web session; overwriting it yields plain-text 401/404 bodies.
      const headers = {}
      const accessToken = window.__t4yIdentity?.getAccessToken?.()
      const needsEnterpriseAuth = body !== undefined
      if (needsEnterpriseAuth && typeof accessToken === 'string' && accessToken !== '') {
        headers['X-T4Y-Access-Token'] = accessToken
      }
      const init = body === undefined
        ? { headers }
        : {
          method: 'POST',
          headers: { ...headers, 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }
      const response = await fetch(url, init)
      const raw = await response.text()
      let result
      try {
        result = raw ? JSON.parse(raw) : null
      } catch {
        throw new Error(raw.trim() || `HTTP ${response.status}`)
      }
      if (!response.ok || result?.ok !== true) throw new Error(result?.error || raw.trim() || `HTTP ${response.status}`)
      const value = result.value
      if (value?.application === 'failed' || value?.application === 'cancelled') {
        throw new Error(value.error?.diagnostic || value.error?.code || value.packageResult?.output || 'Installation did not complete')
      }
      return value
    }

    const SHORTCUT_EVENT = 't4y-capability:shortcuts-changed'

    function shortcutStorageKey() {
      const session = window.__t4yIdentity?.getSession?.()
      if (!session?.tenantId || !session?.username || !moduleId()) return null
      return `t4y-shortcuts:${JSON.stringify([session.tenantId, session.username, moduleId()])}`
    }

    function readShortcuts() {
      const key = shortcutStorageKey()
      if (key === null) return []
      try {
        const value = JSON.parse(localStorage.getItem(key) || '[]')
        return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : []
      } catch { return [] }
    }

    function updateShortcut(pluginKey, selected) {
      const key = shortcutStorageKey()
      if (key === null) return
      const values = new Set(readShortcuts())
      if (selected) values.add(pluginKey)
      else values.delete(pluginKey)
      localStorage.setItem(key, JSON.stringify([...values]))
      window.dispatchEvent(new Event(SHORTCUT_EVENT))
    }

    const METADATA_CACHE_KEY = 't4y-plugin-metadata-v1'

    function readPluginMetadata() {
      try {
        const value = JSON.parse(localStorage.getItem(METADATA_CACHE_KEY) || '{}')
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
      } catch { return {} }
    }

    function writePluginMetadata(plugins) {
      const cache = readPluginMetadata()
      for (const plugin of plugins) {
        if (typeof plugin.key !== 'string' || typeof plugin.name !== 'string' || typeof plugin.package !== 'string'
          || typeof plugin.version !== 'string' || !Array.isArray(plugin.commands)) continue
        cache[plugin.key] = { name: plugin.name, iconUrl: typeof plugin.iconUrl === 'string' ? plugin.iconUrl : undefined,
          version: plugin.version, package: plugin.package, commands: plugin.commands.filter(command => typeof command === 'string'),
          description: plugin.description, commit: plugin.latest?.git?.commit }
      }
      try { localStorage.setItem(METADATA_CACHE_KEY, JSON.stringify(cache)) } catch { /* Cache storage is optional. */ }
    }

    function metadataForCoordinates(coordinates, state) {
      const cache = readPluginMetadata()
      const plugins = []
      for (const coordinate of coordinates) {
        const metadata = cache[coordinate.key]
        const active = state.plugins?.[coordinate.key]?.active?.commit
        if (!metadata || typeof metadata.package !== 'string' || typeof metadata.version !== 'string' || !Array.isArray(metadata.commands)
          || !metadata.commands.every(command => typeof command === 'string')
          || (active && metadata.commit !== active)) return null
        plugins.push({ ...coordinate, package: metadata.package, version: metadata.version, commands: metadata.commands, description: metadata.description })
      }
      return plugins
    }

    let pluginPending = null
    let pluginSnapshot = null
    let pluginRevision = 0

    function currentPluginIdentity() {
      const key = shortcutStorageKey()
      const token = window.__t4yIdentity?.getAccessToken?.()
      return key && token ? { key, token } : null
    }

    function samePluginIdentity(a, b) {
      return a !== null && b !== null && a.key === b.key && a.token === b.token
    }

    function createRequestGate() {
      let generation = 0
      return {
        start: () => {
          const request = ++generation
          const identity = currentPluginIdentity()
          return () => request === generation && samePluginIdentity(identity, currentPluginIdentity())
        },
        invalidate: () => { generation += 1 },
      }
    }

    function invalidatePluginSnapshot() {
      pluginRevision += 1
      pluginPending = null
      pluginSnapshot = null
    }

    function loadPluginSnapshot() {
      const identity = currentPluginIdentity()
      if (!identity) { invalidatePluginSnapshot(); return Promise.resolve(null) }
      if (pluginSnapshot && samePluginIdentity(pluginSnapshot.identity, identity)) return Promise.resolve(pluginSnapshot.value)
      pluginSnapshot = null
      if (pluginPending && samePluginIdentity(pluginPending.identity, identity)) return pluginPending.promise
      const revision = pluginRevision
      const pending = { identity, promise: null }
      pending.promise = Promise.all([
        releaseRequest('/api/t4y-release/authorized-coordinates', { moduleId: moduleId() }),
        releaseRequest('/api/t4y-release/state'),
      ]).then(async ([coordinates, state]) => {
        if (revision !== pluginRevision || !samePluginIdentity(identity, currentPluginIdentity())) return null
        let plugins = metadataForCoordinates(coordinates, state)
        if (plugins === null) {
          plugins = await releaseRequest('/api/t4y-release/authorized-plugins', { moduleId: moduleId() })
          if (revision !== pluginRevision || !samePluginIdentity(identity, currentPluginIdentity())) return null
          writePluginMetadata(plugins)
        }
        const value = { plugins, state }
        pluginSnapshot = { identity, value }
        return value
      }).finally(() => { if (pluginPending === pending) pluginPending = null })
      pluginPending = pending
      return pending.promise
    }

    function visibleShortcuts(snapshot) {
      if (!snapshot) return []
      const enabled = new Set((snapshot.state.bundles || []).filter(bundle => bundle.enabled === true).map(bundle => bundle.name))
      const selected = new Set(readShortcuts())
      return snapshot.plugins.filter(plugin => selected.has(plugin.key) && enabled.has(plugin.package) && plugin.commands?.length)
    }

    function PluginIcon({ url, size }) {
      const [failedUrl, setFailedUrl] = React.useState(null)
      if (!url || failedUrl === url) return React.createElement(PluginArtworkDefault, { size })
      return React.createElement('img', {
        src: url, alt: '', width: size, height: size,
        className: 't4y-plugin-icon', referrerPolicy: 'no-referrer',
        onError: () => setFailedUrl(url),
      })
    }

    function createMenuProjection(controller) {
      let original = null
      let projected = null
      let indexes = new Map()
      const project = () => {
        const state = controller.menu.getSnapshot()
        if (state === original) return projected
        original = state
        indexes = new Map()
        const plugins = state.groups.find(group => group.source === 't4y-plugins')
        const names = new Set(plugins?.status === 'ready' ? plugins.items.map(item => item.name) : [])
        for (const metadata of Object.values(readPluginMetadata())) {
          if (!metadata || !Array.isArray(metadata.commands)) continue
          for (const command of metadata.commands) {
            if (typeof command === 'string' && command.startsWith('/')) names.add(command.slice(1))
          }
        }
        let hasDuplicates = false
        const groups = state.groups.map(group => {
          const mapping = []
          const items = group.items.filter((item, index) => {
            if (group.source === 'command' && names.has(item.name)) { hasDuplicates = true; return false }
            mapping.push(index)
            return true
          })
          indexes.set(group.source, mapping)
          return { ...group, items }
        })
        let highlight = state.highlight
        if (highlight) {
          const mapped = indexes.get(highlight.source)?.indexOf(highlight.index) ?? -1
          if (mapped >= 0) highlight = { source: highlight.source, index: mapped }
          else {
            const hidden = state.groups.find(group => group.source === highlight.source)?.items[highlight.index]
            const replacement = plugins?.items.findIndex(item => item.name === hidden?.name) ?? -1
            highlight = replacement < 0 ? null : { source: 't4y-plugins', index: replacement }
          }
        }
        projected = { ...state, groups, highlight, hasDuplicates }
        return projected
      }
      return {
        menu: { getSnapshot: project, subscribe: fn => controller.menu.subscribe(fn) },
        originalIndex: (source, index) => { project(); return indexes.get(source)?.[index] },
      }
    }

    function PluginMenu({ controller, t, slots }) {
      const menuRegistry = React.useMemo(() => ({
        subscribe: fn => slots.subscribe('conversation.input.overlay', fn),
        getSnapshot: () => slots.entries('conversation.input.overlay').find(entry =>
          entry.options.id === 'slash-menu' && (entry.options.priority || 0) === 0)?.component || null,
      }), [slots])
      const MenuView = React.useSyncExternalStore(menuRegistry.subscribe, menuRegistry.getSnapshot)
      const projection = React.useMemo(() => createMenuProjection(controller), [controller])
      React.useEffect(() => {
        const onKey = (event) => {
          if (event.isComposing || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return
          if (!(event.target instanceof HTMLElement) || !event.target.closest('[contenteditable="true"]')) return
          const state = projection.menu.getSnapshot()
          if (!state.open || state.hit?.trigger !== '/' || !state.hasDuplicates) return
          if ((event.key === 'Enter' || event.key === 'Tab') && state.highlight === null) {
            event.preventDefault()
            event.stopImmediatePropagation()
            return
          }
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
          const rows = state.groups.flatMap(group => group.status === 'ready'
            ? group.items.map((_, index) => ({ source: group.source, index })) : [])
          if (!rows.length) return
          const current = rows.findIndex(row => row.source === state.highlight?.source && row.index === state.highlight?.index)
          const direction = event.key === 'ArrowDown' ? 1 : -1
          const nextIndex = current < 0 ? (direction === 1 ? 0 : rows.length - 1) : (current + direction + rows.length) % rows.length
          const next = rows[nextIndex]
          const index = projection.originalIndex(next.source, next.index)
          if (index === undefined) return
          event.preventDefault()
          event.stopImmediatePropagation()
          controller.hover(next.source, index)
        }
        document.addEventListener('keydown', onKey, true)
        return () => document.removeEventListener('keydown', onKey, true)
      }, [controller, projection])
      const onPick = (source, index, action) => {
        const actual = projection.originalIndex(source, index)
        if (actual !== undefined) controller.pick(source, actual, action)
      }
      const onHover = (source, index) => {
        const actual = projection.originalIndex(source, index)
        if (actual !== undefined) controller.hover(source, actual)
      }
      if (!MenuView) return null
      return React.createElement(MenuView, {
        menu: projection.menu, headers: controller.headers, onPick, onHover,
        onCrumb: (source, index) => controller.pickCrumb(source, index),
        onDismiss: () => controller.dismiss(), t,
      })
    }

    function ShortcutBar({ inputActions, useInput, t, resolveCommand }) {
      const input = useInput((state) => state)
      const [plugins, setPlugins] = React.useState([])
      const [error, setError] = React.useState(false)
      React.useEffect(() => {
        let generation = 0
        let disposed = false
        let identity = currentPluginIdentity()
        const refresh = async () => {
          const request = ++generation
          setPlugins([])
          try {
            const snapshot = await loadPluginSnapshot()
            if (!disposed && request === generation) setPlugins(visibleShortcuts(snapshot))
          } catch {
            if (!disposed && request === generation) setPlugins([])
          }
        }
        const onChange = () => {
          void refresh()
        }
        const onIdentityChange = (_tenant, reason) => {
          const next = currentPluginIdentity()
          if (reason === 'module-plugins-applied' && samePluginIdentity(identity, next)) {
            void refresh()
            return
          }
          if ((!identity && !next) || samePluginIdentity(identity, next)) return
          identity = next
          void refresh()
        }
        void refresh()
        window.addEventListener(SHORTCUT_EVENT, onChange)
        const removeTenant = window.__t4yTenant?.onChange?.(onIdentityChange)
        const removeIdentity = window.__t4yIdentity?.onSession?.(onIdentityChange)
        return () => {
          disposed = true
          window.removeEventListener(SHORTCUT_EVENT, onChange)
          removeTenant?.()
          removeIdentity?.()
        }
      }, [])
      if (!plugins.length) return null
      return React.createElement('div', { className: 't4y-shortcut-bar' }, error && React.createElement('span', { role: 'alert' }, t('shortcutFailed')), plugins.flatMap((plugin) =>
        plugin.commands.map((command) => React.createElement('button', {
          type: 'button', key: `${plugin.key}:${command}`,
          disabled: input.phase !== 'plain' || input.draft !== '' || input.attachmentIds.length > 0,
          title: input.draft !== '' ? t('shortcutDraft') : command,
          onClick: () => {
            setError(false)
            const span = inputActions.captureInsertion()
            const currentKey = shortcutStorageKey()
            void (async () => {
              const snapshot = await loadPluginSnapshot()
              if (currentKey !== shortcutStorageKey() || !visibleShortcuts(snapshot).some(item => item.key === plugin.key)) return false
              return resolveCommand(command, span)
            })().then((ok) => { if (!ok) setError(true) }, () => { setError(true) })
          },
        }, React.createElement(PluginIcon, { url: plugin.iconUrl, size: 18 }), plugin.commands.length === 1 ? (plugin.menuTitle || plugin.name) : command))))
    }

    /** Same role="switch" control the system Plugins page uses. */
    function CapabilitySwitch(props) {
      const { checked, disabled, label, onChange } = props
      return React.createElement('button', {
        type: 'button',
        role: 'switch',
        'aria-checked': checked,
        'aria-label': label,
        disabled,
        className: 't4y-capability-switch',
        onClick: () => { onChange(!checked) },
      }, React.createElement('span', { className: 't4y-capability-switch-thumb' }))
    }

    function CapabilityCard(props) {
      const {
        t, plugin, installed, enabled, busy, onToggle, selected, onShortcut,
      } = props
      const [notice, setNotice] = React.useState(null)
      const title = plugin.menuTitle || plugin.name
      const description = resolveText(null, plugin.description)
      const commands = Array.isArray(plugin.commands) ? plugin.commands : []

      React.useEffect(() => {
        setNotice(null)
      }, [installed, enabled])

      const runToggle = (next) => {
        setNotice(null)
        void onToggle(plugin, next).then((result) => {
          if (result?.kind === 'restart') {
            setNotice({ kind: 'info', text: t('restartRequired') })
          } else if (result?.kind === 'installed') {
            setNotice({ kind: 'info', text: t('installedApplied') })
          }
        }).catch((error) => setNotice({
          kind: 'error',
          text: format(t('toggleFailed'), {
            message: error instanceof Error ? error.message : String(error),
          }),
        }))
      }

      return React.createElement('article', { className: 't4y-capability-card' },
        React.createElement('div', { className: 't4y-capability-card-main' },
          React.createElement('div', { className: 't4y-capability-card-heading' },
            React.createElement(PluginIcon, { url: plugin.iconUrl, size: 24 }),
            React.createElement('strong', null, title),
            React.createElement('span', { className: 't4y-capability-version' }, `v${plugin.version}`)),
          description && React.createElement('p', { className: 't4y-capability-description' }, description),
          commands.length > 0 && React.createElement('p', { className: 't4y-capability-commands' },
            React.createElement('span', null, t('commands'), '：'),
            commands.map((command) => React.createElement('code', { key: command }, command))),
          commands.length > 0 && React.createElement('label', { className: 't4y-shortcut-setting' },
            React.createElement('input', { type: 'checkbox', checked: selected, onChange: (event) => onShortcut(plugin.key, event.target.checked) }),
            t('shortcut')),
          !installed && React.createElement('p', {
            className: 't4y-capability-note',
            role: 'status',
          }, busy ? t('installing') : t('missing')),
          notice && React.createElement('p', {
            className: notice.kind === 'error' ? 't4y-capability-error' : 't4y-capability-note',
            role: notice.kind === 'error' ? 'alert' : 'status',
          }, notice.text)),
        React.createElement(CapabilitySwitch, {
          checked: enabled,
          disabled: busy,
          // Match system Plugins: missing packages accept an "on" toggle to install.
          label: format(t('enableToggle'), { name: title }),
          onChange: runToggle,
        }))
    }

    function CapabilityTab(props) {
      const t = props.t
      const authorizedPlugins = props.authorizedPlugins
      const installPlugin = props.installPlugin
      const setEnabled = props.setEnabled
      const [view, setView] = React.useState({ status: 'loading' })
      const gate = React.useRef(null)
      const identityEpoch = React.useRef(0)
      if (gate.current === null) gate.current = createRequestGate()
      React.useEffect(() => () => { gate.current.invalidate(); identityEpoch.current += 1 }, [])
      const [shortcuts, setShortcuts] = React.useState(readShortcuts)
      React.useEffect(() => {
        const refresh = () => setShortcuts(readShortcuts())
        window.addEventListener(SHORTCUT_EVENT, refresh)
        const removeTenant = window.__t4yTenant?.onChange?.(refresh)
        const removeIdentity = window.__t4yIdentity?.onSession?.(refresh)
        return () => { window.removeEventListener(SHORTCUT_EVENT, refresh); removeTenant?.(); removeIdentity?.() }
      }, [])
      const [busyKeys, setBusyKeys] = React.useState(() => new Set())
      const [authenticated, setAuthenticated] = React.useState(() => window.__t4yIdentity?.getSession?.() !== null)
      const viewRef = React.useRef(view)
      viewRef.current = view

      const markBusy = React.useCallback((key, busy) => {
        setBusyKeys((previous) => {
          const next = new Set(previous)
          if (busy) next.add(key)
          else next.delete(key)
          return next
        })
      }, [])

      const reload = React.useCallback(async (background = false) => {
        const isCurrent = gate.current.start()
        if (!currentPluginIdentity()) {
          setView({ status: 'signed-out' })
          return
        }
        if (!background) setView({ status: 'loading' })
        try {
          const [plugins, state] = await Promise.all([
            authorizedPlugins(),
            releaseRequest('/api/t4y-release/state'),
          ])
          if (!isCurrent()) return
          const bundles = Array.isArray(state.bundles) ? state.bundles : []
          const byPackage = new Map(bundles.map((bundle) => [bundle.name, bundle.enabled === true]))
          const installed = new Set()
          const enabled = new Set()
          for (const plugin of plugins) {
            const entry = state.plugins?.[plugin.key]
            const present = entry?.active?.commit !== undefined
              || byPackage.has(plugin.package)
            if (present) installed.add(plugin.key)
            if (byPackage.get(plugin.package) === true) enabled.add(plugin.key)
          }
          setView({ status: 'ready', plugins, installed, enabled })
        } catch (error) {
          if (isCurrent()) setView({ status: 'error', message: error instanceof Error ? error.message : String(error) })
        }
      }, [authorizedPlugins])

      const patchLocal = React.useCallback((pluginKey, patch) => {
        setView((previous) => {
          if (previous.status !== 'ready') return previous
          const installed = new Set(previous.installed)
          const enabled = new Set(previous.enabled)
          if (patch.installed === true) installed.add(pluginKey)
          if (patch.installed === false) installed.delete(pluginKey)
          if (patch.enabled === true) enabled.add(pluginKey)
          if (patch.enabled === false) enabled.delete(pluginKey)
          return { ...previous, installed, enabled }
        })
      }, [])

      const onShortcut = (key, selected) => updateShortcut(key, selected)
      const onToggle = React.useCallback(async (plugin, nextEnabled) => {
        const identity = currentPluginIdentity()
        const epoch = identityEpoch.current
        const isCurrent = () => epoch === identityEpoch.current && samePluginIdentity(identity, currentPluginIdentity())
        markBusy(plugin.key, true)
        const current = viewRef.current
        const wasInstalled = current.status === 'ready' && current.installed.has(plugin.key)
        // Optimistic: mirror the system Plugins switch immediately.
        patchLocal(plugin.key, wasInstalled
          ? { enabled: nextEnabled }
          : (nextEnabled ? { installed: true, enabled: true } : { enabled: false }))
        try {
          if (!wasInstalled) {
            if (!nextEnabled) return null
            const result = await installPlugin(plugin)
            if (!isCurrent()) return null
            patchLocal(plugin.key, { installed: true, enabled: true })
            // Refresh in the background so version/commit state stays accurate.
            void reload(true)
            try { localStorage.removeItem(METADATA_CACHE_KEY) } catch { /* Cache storage is optional. */ }
            invalidatePluginSnapshot()
            window.dispatchEvent(new Event(SHORTCUT_EVENT))
            if (result?.application === 'restart-required') return { kind: 'restart' }
            return { kind: 'installed' }
          }
          const result = await setEnabled(plugin, nextEnabled)
          if (!isCurrent()) return null
          patchLocal(plugin.key, { enabled: nextEnabled })
          void reload(true)
          try { localStorage.removeItem(METADATA_CACHE_KEY) } catch { /* Cache storage is optional. */ }
          invalidatePluginSnapshot()
          window.dispatchEvent(new Event(SHORTCUT_EVENT))
          if (result?.application === 'restart-required') return { kind: 'restart' }
          return null
        } catch (error) {
          if (!isCurrent()) return null
          // Roll the optimistic switch back, then re-read Host truth.
          patchLocal(plugin.key, wasInstalled
            ? { enabled: !nextEnabled }
            : { installed: false, enabled: false })
          void reload(true)
          throw error
        } finally {
          if (isCurrent()) markBusy(plugin.key, false)
        }
      }, [installPlugin, markBusy, patchLocal, reload, setEnabled])

      React.useEffect(() => { void reload() }, [reload])
      React.useEffect(() => {
        let identity = currentPluginIdentity()
        const onIdentityChange = (_tenant, reason) => {
          const next = currentPluginIdentity()
          setAuthenticated(next !== null)
          if (reason === 'module-plugins-applied' && samePluginIdentity(identity, next)) {
            void reload(true)
            return
          }
          if ((!identity && !next) || samePluginIdentity(identity, next)) return
          identity = next
          identityEpoch.current += 1
          setBusyKeys(new Set())
          void reload()
        }
        const removeTenant = window.__t4yTenant?.onChange?.(onIdentityChange)
        const removeIdentity = window.__t4yIdentity?.onSession?.(onIdentityChange)
        return () => {
          removeTenant?.()
          removeIdentity?.()
        }
      }, [reload])

      return React.createElement('div', { className: 't4y-capability' },
        !authenticated && React.createElement('p', {
          className: 't4y-capability-note',
          role: 'status',
        }, t('loginRequired')),
        authenticated && React.createElement(React.Fragment, null,
          React.createElement('p', { className: 't4y-capability-intro' }, t('intro')),
          view.status === 'loading' && React.createElement('p', { className: 't4y-capability-note' }, t('loading')),
          view.status === 'error' && React.createElement('p', {
            className: 't4y-capability-error',
            role: 'alert',
          }, format(t('catalogError'), { message: view.message })),
          view.status === 'ready' && view.plugins.length === 0 && React.createElement('p', {
            className: 't4y-capability-note',
            role: 'status',
          }, t('noPlugins')),
          view.status === 'ready' && [...new Set(view.plugins.map((plugin) => plugin.category || t('categoryOther')))].map((category) =>
            React.createElement('section', { key: category, className: 't4y-capability-category' },
              React.createElement('h3', null, category),
              view.plugins.filter((plugin) => (plugin.category || t('categoryOther')) === category).map((plugin) => React.createElement(CapabilityCard, {
                key: plugin.key, t, plugin,
                installed: view.installed.has(plugin.key),
                enabled: view.enabled.has(plugin.key),
                busy: busyKeys.has(plugin.key),
                selected: shortcuts.includes(plugin.key), onShortcut, onToggle,
              }))))))
    }

    exports.inject = ['slots', 'locale', 'sessions', 'inputTriggers']
    exports.apply = (ctx) => {
      if (window.__t4yCapabilityHubApplied === true) return
      window.__t4yCapabilityHubApplied = true
      ctx.effect(() => () => { delete window.__t4yCapabilityHubApplied }, 't4y capability hub: application marker')
      ctx.effect(() => ctx.locale.register(SETTINGS_NS, hubCopy), 't4y capability hub: settings locale')
      ctx.effect(() => {
        let identity = currentPluginIdentity()
        const onIdentityChange = (event) => {
          const next = currentPluginIdentity()
          if (event.detail?.reason === 'module-plugins-applied' && samePluginIdentity(identity, next)) {
            invalidatePluginSnapshot()
            return
          }
          if ((!identity && !next) || samePluginIdentity(identity, next)) return
          identity = next
          invalidatePluginSnapshot()
        }
        window.addEventListener('t4y-identity:session', onIdentityChange)
        window.addEventListener('t4y-tenant:changed', onIdentityChange)
        return () => {
          window.removeEventListener('t4y-identity:session', onIdentityChange)
          window.removeEventListener('t4y-tenant:changed', onIdentityChange)
          invalidatePluginSnapshot()
        }
      }, 't4y capability hub: identity cache')
      const tSettings = ctx.locale.bind(SETTINGS_NS)
      ctx.effect(() => {
        const id = 't4y-capability-hub-style'
        const previousStyle = document.getElementById(id)
        const style = previousStyle instanceof HTMLStyleElement ? previousStyle : document.createElement('style')
        style.id = id
        style.dataset.owners = String(Number(style.dataset.owners || 0) + 1)
        if (!style.isConnected) document.head.appendChild(style)
        style.textContent = `
          .t4y-capability {
            display: flex;
            flex-direction: column;
            gap: 16px;
            max-width: 720px;
          }
          .t4y-plugin-icon { flex: none; object-fit: contain; border-radius: 4px; }
          .t4y-capability-category { display: flex; flex-direction: column; gap: 12px; }
          .t4y-capability-category h3 { margin: 0; font-size: 14px; font-weight: 500; color: var(--dsw-alias-label-primary); }
          .t4y-shortcut-setting { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--dsw-alias-label-secondary); }
          .t4y-shortcut-bar { display: flex; gap: 4px; max-width: min(40vw, 400px); overflow-x: auto; }
          .t4y-shortcut-bar button { display: inline-flex; align-items: center; gap: 4px; flex: none; border: 0; border-radius: 6px; padding: 5px 8px; background: transparent; color: var(--dsw-alias-label-primary); cursor: pointer; }
          .t4y-shortcut-bar button:disabled { opacity: .5; cursor: default; }
          .t4y-shortcut-bar button:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); }
          .t4y-capability-intro,
          .t4y-capability-note,
          .t4y-capability-description,
          .t4y-capability-commands {
            margin: 0;
            color: var(--dsw-alias-label-secondary);
            font-size: 13px;
            line-height: 1.6;
          }
          .t4y-capability-card {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 20px;
            padding: 20px 22px;
            border: 1px solid var(--dsw-alias-border-l2);
            border-radius: 12px;
            background: var(--dsw-alias-bg-base);
          }
          .t4y-capability-card-main { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 8px; }
          .t4y-capability-card-heading {
            display: flex;
            align-items: baseline;
            gap: 10px;
            color: var(--dsw-alias-label-primary);
          }
          .t4y-capability-card-heading strong { font-size: 16px; font-weight: 500; }
          .t4y-capability-version {
            color: var(--dsw-alias-label-tertiary);
            font-size: 12px;
          }
          .t4y-capability-commands code {
            display: inline-block;
            margin: 0 6px 0 0;
            padding: 1px 6px;
            border-radius: 4px;
            background: var(--dsw-alias-bg-module-platform);
            font-size: 12px;
          }
          /* Match @deepseek-ai/dsh-client-ui-primitives Switch appearance. */
          .t4y-capability-switch {
            box-sizing: border-box;
            position: relative;
            flex: 0 0 auto;
            width: 36px;
            height: 20px;
            padding: 2px;
            border: 0;
            border-radius: 999px;
            background: var(--dsw-alias-border-l3, #d4d4d8);
            cursor: pointer;
          }
          .t4y-capability-switch[aria-checked='true'] {
            background: var(--dsw-alias-brand-primary, #0f766e);
          }
          .t4y-capability-switch:disabled {
            cursor: default;
            opacity: 0.5;
          }
          .t4y-capability-switch:focus-visible {
            outline: 2px solid var(--dsw-alias-state-business-primary, #0f766e);
            outline-offset: 2px;
          }
          .t4y-capability-switch-thumb {
            display: block;
            width: 16px;
            height: 16px;
            border-radius: 50%;
            background: var(--dsw-alias-label-primary-foreground, #fff);
            transition: transform 120ms ease;
          }
          .t4y-capability-switch[aria-checked='false'] .t4y-capability-switch-thumb {
            background: var(--dsw-alias-switch-thumb, #fff);
          }
          .t4y-capability-switch[aria-checked='true'] .t4y-capability-switch-thumb {
            transform: translateX(16px);
          }
          .t4y-capability-error {
            margin: 0;
            color: var(--dsw-alias-state-error-primary);
            font-size: 13px;
            line-height: 1.6;
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
      }, 't4y capability hub: styles')

      ctx.effect(() => {
        const claims = new Map()
        return ctx.inputTriggers.registerSource({
          trigger: '/', name: 't4y-plugins', order: 10, showGroupTitle: false,
          candidates: async (session, request) => {
            const actx = ctx.sessions.scope(session.sessionId)
            const identity = currentPluginIdentity()
            if (!actx || !moduleId() || !identity) return []
            const snapshot = await loadPluginSnapshot()
            if (!snapshot || request.signal.aborted || !samePluginIdentity(identity, currentPluginIdentity())) return []
            const plugins = snapshot.plugins
            const enabled = new Set((snapshot.state.bundles || []).filter(bundle => bundle.enabled).map(bundle => bundle.name))
            const controller = ctx.inputTriggers.sessionOf(actx)
            const candidates = []
            const query = request.query.toLocaleLowerCase()
            for (const plugin of plugins) {
              if (!enabled.has(plugin.package)) continue
              for (const command of plugin.commands || []) {
                const name = command.replace(/^\//, '')
                const label = plugin.menuTitle || plugin.name
                if (!name.toLocaleLowerCase().includes(query) && !label.toLocaleLowerCase().includes(query)) continue
                candidates.push({ command, name, label, plugin })
              }
            }
            const resolved = await Promise.all(candidates.map(async candidate => ({
              ...candidate, claim: await controller.resolveClaim(candidate.command, request.signal),
            })))
            if (request.signal.aborted || !samePluginIdentity(identity, currentPluginIdentity())) return []
            const rows = []
            for (const { name, label, plugin, claim } of resolved) {
              if (!claim) continue
              claims.set(`${session.sessionId}:${name}`, { claim, identity })
              rows.push({ name, label, description: resolveText(null, plugin.description), category: plugin.category || tSettings('categoryOther'), key: plugin.key, iconUrl: plugin.iconUrl })
            }
            const categories = [...new Set(rows.map(row => row.category))]
            return categories.flatMap(category => {
              const group = rows.filter(row => row.category === category)
              const count = new Set(group.map(row => row.key)).size
              return group.map(row => ({ name: row.name, label: row.label, description: row.description, section: `${category} (${count})`,
                icon: ({ size }) => React.createElement(PluginIcon, { url: row.iconUrl, size }) }))
            })
          },
          onPick: ({ session, candidate }) => {
            const entry = claims.get(`${session.sessionId}:${candidate.name}`)
            return entry && samePluginIdentity(entry.identity, currentPluginIdentity()) ? { claim: entry.claim } : undefined
          },
        })
      }, 't4y capability hub: plugin command source')

      ctx.slots.inject('conversation.input.overlay', () => {
        let removeMenu = null
        const sync = () => {
          const original = ctx.slots.entries('conversation.input.overlay').some(entry =>
            entry.options.id === 'slash-menu' && (entry.options.priority || 0) === 0)
          if (original && removeMenu === null) {
            removeMenu = ctx.slots.register({
              name: 'conversation.input.overlay', id: 'slash-menu', priority: -1, order: 0, locale: 'slash.menu',
              inject: (sessionId) => {
                const actx = ctx.sessions.scope(sessionId)
                if (!actx) throw new Error('Plugin menu requires an active session')
                return { controller: ctx.inputTriggers.sessionOf(actx), slots: ctx.slots }
              },
            }, PluginMenu)
          } else if (!original && removeMenu !== null) {
            const dispose = removeMenu
            removeMenu = null
            dispose()
          }
        }
        const unsubscribe = ctx.slots.subscribe('conversation.input.overlay', sync)
        sync()
        return () => { unsubscribe(); removeMenu?.(); removeMenu = null }
      })

      ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
        name: 'conversation.input.left', id: 't4y-plugin-shortcuts', order: 30, locale: SETTINGS_NS,
        inject: (sessionId) => ({
          resolveCommand: async (command, span) => {
            const actx = ctx.sessions.scope(sessionId)
            if (!actx) return false
            try {
              const claim = await ctx.inputTriggers.sessionOf(actx).resolveClaim(command, new AbortController().signal)
              return claim !== undefined && actx.bail(actx, 'slash/input-begin-command', { claim, span }) === true
            } catch { return false }
          },
        }),
      }, ShortcutBar))

      // Keep a unique order: general=0, models=10, plugins=15, this=16,
      // agent-presets=20. Sharing 20 with agent-presets made the tab jump
      // above/below that entry whenever registration order changed.
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 't4y-authorized-plugins',
        order: 16,
        label: () => tSettings('tab'),
        locale: SETTINGS_NS,
        inject: () => ({
          authorizedPlugins: async () => releaseRequest('/api/t4y-release/authorized-plugins', { moduleId: moduleId() }),
          installPlugin: async (plugin) => releaseRequest('/api/t4y-release/install-authorized', {
            moduleId: moduleId(),
            name: plugin.name,
            projectName: plugin.projectName,
          }),
          setEnabled: async (plugin, enabled) => releaseRequest('/api/t4y-release/set-authorized-enabled', {
            moduleId: moduleId(),
            name: plugin.name,
            projectName: plugin.projectName,
            enabled,
          }),
        }),
      }, CapabilityTab))
    }
    return module.exports
  },
})
