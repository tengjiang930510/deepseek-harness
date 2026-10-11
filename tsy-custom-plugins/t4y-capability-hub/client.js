  /** Capability cards shown on this settings tab. Edit here when adding a package. */
  const CAPABILITY_PACKAGES = [
    {
      name: 't4y-review',
      commands: ['/leave', '/travel', '/office', '/brand-review', '/brand-review-guidance'],
      title: { zh: '办公事务表单', en: 'Office forms' },
      description: {
        zh: '铁四院智能助手：办公申请卡片、审查任务与审查指导（/brand-review）。可在本页启用或禁用。',
        en: 'T4Y Smart Assistant: office request cards, review tasks, and review guidance (/brand-review). Enable or disable on this page.',
      },
    },
    {
      name: 't4y-bilibili-search',
      commands: ['/bilibili', 'bilibili_video_search'],
      title: { zh: 'B站视频搜索', en: 'Bilibili video search' },
      description: {
        zh: '内置 Playwright，搜索 B站视频（工具 bilibili_video_search）。',
        en: 'Built-in Playwright Bilibili search (tool bilibili_video_search).',
      },
    },
  ]

window.__ModuleLoader__.load({
  id: 't4y-capability-hub/client',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const SETTINGS_NS = 't4y.settings.capability'

    /** Tab chrome only — not per-plugin product copy. */
    const hubCopy = {
      zh: {
        tab: '铁四院能力插件',
        intro: '开启或关闭铁四院智能助手能力插件。关闭后相关斜杠命令不再进入菜单。部分变更可能需要重启后生效。',
        commands: '命令',
        enabled: '已开启',
        disabled: '已关闭',
        enableToggle: '启用 {name}',
        loading: '正在读取插件状态…',
        missing: '未安装。请在仓库根目录执行：pnpm dsh plugin --profile web add ./tsy-custom-plugins/{name}',
        error: '无法读取插件状态。',
        restart: '已记录变更，请重启 Web 后生效。',
        applied: '已更新启用状态。',
        toggleFailed: '切换失败：{message}',
        locked: '此包受保护，无法在此切换。',
      },
      en: {
        tab: 'T4Y capability plugins',
        intro: 'Turn T4Y Smart Assistant capability plugins on or off. Slash commands leave the menu when disabled. Some changes need a restart.',
        commands: 'Commands',
        enabled: 'On',
        disabled: 'Off',
        enableToggle: 'Enable {name}',
        loading: 'Loading plugin status…',
        missing: 'Not installed. From the repo root run: pnpm dsh plugin --profile web add ./tsy-custom-plugins/{name}',
        error: 'Could not read plugin status.',
        restart: 'Change recorded. Restart Web for it to take effect.',
        applied: 'Enablement updated.',
        toggleFailed: 'Toggle failed: {message}',
        locked: 'This package is protected and cannot be toggled here.',
      },
    }

    function CapabilityCard(props) {
      const { t, spec, bundle, resolveText, setEnabled } = props
      const [busy, setBusy] = React.useState(false)
      const [notice, setNotice] = React.useState(null)
      const title = bundle?.meta?.title ? resolveText(bundle.meta.title) : resolveText(spec.title)
      const description = bundle?.description
        || (bundle?.meta?.description ? resolveText(bundle.meta.description) : resolveText(spec.description))
      const version = bundle?.version ? `v${bundle.version}` : ''
      const enabled = bundle ? bundle.enabled : false
      const locked = bundle?.readOnlyReason !== undefined
      if (!bundle) {
        return React.createElement('article', { className: 't4y-capability-card' },
          React.createElement('div', { className: 't4y-capability-card-main' },
            React.createElement('div', { className: 't4y-capability-card-heading' },
              React.createElement('strong', null, title)),
            React.createElement('p', { className: 't4y-capability-description' }, t('missing', { name: spec.name }))))
      }
      return React.createElement('article', { className: 't4y-capability-card' },
        React.createElement('div', { className: 't4y-capability-card-main' },
          React.createElement('div', { className: 't4y-capability-card-heading' },
            React.createElement('strong', null, title),
            version && React.createElement('span', { className: 't4y-capability-version' }, version)),
          React.createElement('p', { className: 't4y-capability-commands' },
            React.createElement('span', null, t('commands'), '：'),
            spec.commands.map((command) => React.createElement('code', { key: command }, command))),
          React.createElement('p', { className: 't4y-capability-description' }, description),
          notice && React.createElement('p', {
            className: notice.kind === 'error' ? 't4y-capability-error' : 't4y-capability-note',
            role: notice.kind === 'error' ? 'alert' : 'status',
          }, notice.text),
          locked && React.createElement('p', { className: 't4y-capability-note' }, t('locked'))),
        React.createElement('label', { className: 't4y-capability-toggle' },
          React.createElement('input', {
            type: 'checkbox',
            checked: enabled,
            disabled: busy || locked,
            'aria-label': t('enableToggle', { name: title }),
            onChange: (event) => {
              const next = event.target.checked
              setBusy(true)
              setNotice(null)
              void setEnabled(spec.name, next).then((change) => {
                props.onEnabled?.(spec.name, next)
                if (change?.application === 'restart-required') setNotice({ kind: 'info', text: t('restart') })
                else setNotice({ kind: 'info', text: t('applied') })
              }).catch((error) => {
                setNotice({
                  kind: 'error',
                  text: t('toggleFailed', { message: error instanceof Error ? error.message : String(error) }),
                })
                props.onReload?.()
              }).finally(() => { setBusy(false) })
            },
          }),
          React.createElement('span', null, enabled ? t('enabled') : t('disabled'))))
    }

    function CapabilityTab(props) {
      const t = props.t
      const listBundles = props.listBundles
      const setEnabled = props.setEnabled
      const resolveText = props.resolveText
      const [view, setView] = React.useState({ status: 'loading' })
      const reload = React.useCallback(async () => {
        try {
          const bundles = await listBundles()
          setView({ status: 'ready', bundles })
        } catch (error) {
          setView({ status: 'error', message: error instanceof Error ? error.message : String(error) })
        }
      }, [listBundles])
      React.useEffect(() => { void reload() }, [reload])
      return React.createElement('div', { className: 't4y-capability' },
        React.createElement('p', { className: 't4y-capability-intro' }, t('intro')),
        view.status === 'loading' && React.createElement('p', { className: 't4y-capability-note' }, t('loading')),
        view.status === 'error' && React.createElement('p', { className: 't4y-capability-error', role: 'alert' }, t('error'), ' ', view.message),
        view.status === 'ready' && CAPABILITY_PACKAGES.map((spec) => React.createElement(CapabilityCard, {
          key: spec.name,
          t,
          spec,
          bundle: view.bundles.find((bundle) => bundle.name === spec.name) ?? null,
          resolveText,
          setEnabled,
          onReload: reload,
          onEnabled: (name, enabled) => {
            setView((previous) => {
              if (previous.status !== 'ready') return previous
              return {
                status: 'ready',
                bundles: previous.bundles.map((bundle) => (
                  bundle.name === name ? { ...bundle, enabled } : bundle
                )),
              }
            })
          },
        })))
    }

    exports.inject = ['slots', 'locale', 'remote', 'remote.pluginManager']
    exports.apply = (ctx) => {
      ctx.effect(() => ctx.locale.register(SETTINGS_NS, hubCopy), 't4y capability hub: settings locale')
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
          .t4y-capability-card-heading strong { font-size: 16px; font-weight: 600; }
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
          .t4y-capability-toggle {
            flex: none;
            display: inline-flex;
            align-items: center;
            gap: 8px;
            color: var(--dsw-alias-label-secondary);
            font-size: 13px;
            cursor: pointer;
            user-select: none;
          }
          .t4y-capability-toggle input {
            width: 16px;
            height: 16px;
            accent-color: var(--dsw-alias-brand-primary);
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

      ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
        name: 'settings.plugins.tab',
        id: 't4y-capability',
        order: 20,
        label: () => tSettings('tab'),
        locale: SETTINGS_NS,
        inject: () => ({
          listBundles: async () => {
            const result = await ctx.remote.pluginManager.listBundles()
            if (!result.ok) {
              throw new Error(`${result.error.code}: ${result.error.message}`)
            }
            return result.value
          },
          setEnabled: async (packageName, enabled) => {
            const result = await ctx.remote.pluginManager.setBundleEnabled(packageName, enabled)
            if (!result.ok) {
              throw new Error(`${result.error.code}: ${result.error.message}`)
            }
            return result.value
          },
          resolveText: (text) => ctx.locale.resolveText(text),
        }),
      }, CapabilityTab))
    }
    return module.exports
  },
})
