window.__ModuleLoader__.load({
  // The module system normalizes a package's client entry by removing `/client`.
  // Using the canonical specifier prevents one bundle from being registered twice.
  id: 't4y-review/client',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const OFFICE_NS = 't4y.office-workflows'
    const SETTINGS_NS = 't4y.settings.capability'
    const PACKAGE_NAME = 't4y-review'
    const PLUGIN_COMMANDS = ['/leave', '/travel', '/office', '/brand-review', '/brand-review-guidance']
    const COMMAND_KINDS = { leave: 'leave', travel: 'travel', office: 'office' }
    const STORAGE_PREFIX = 't4y.office-workflow.v2.'
    const copy = {
      zh: {
        leave: '请假申请', travel: '出差申请', office: '办公事务',
        leaveType: '假别', annual: '年假', personal: '事假', sick: '病假',
        startDate: '开始日期', endDate: '结束日期', destination: '出差地点', itinerary: '行程安排', budget: '预算（元）', companions: '同行人',
        officeType: '事务类型', meeting: '会议预约', supplies: '办公用品申领', ledger: '流程台账查询', subject: '主题 / 名称', reason: '事由', detail: '说明',
        required: '请补全必填信息后再提交。',
        submit: '确认并提交', submitted: '申请已提交，当前状态：审批中。', draft: '核对并补全申请信息，确认后提交。', status: '待确认'
      },
      en: {
        leave: 'Leave request', travel: 'Business trip', office: 'Office request',
        leaveType: 'Leave type', annual: 'Annual leave', personal: 'Personal leave', sick: 'Sick leave',
        startDate: 'Start date', endDate: 'End date', destination: 'Destination', itinerary: 'Itinerary', budget: 'Budget (CNY)', companions: 'Travellers',
        officeType: 'Request type', meeting: 'Meeting reservation', supplies: 'Office supplies', ledger: 'Workflow ledger query', subject: 'Subject / name', reason: 'Reason', detail: 'Details',
        required: 'Complete the required fields before submitting.',
        submit: 'Confirm and submit', submitted: 'Request submitted. Current status: approval pending.', draft: 'Review and complete your request before submitting.', status: 'Needs confirmation'
      }
    }
    const settingsCopy = {
      zh: {
        tab: '铁四院能力插件',
        intro: '开启或关闭铁四院智能助手能力插件。关闭后相关斜杠命令不再进入菜单。部分变更可能需要重启后生效。',
        pluginTitle: '办公事务表单',
        pluginDescription: '铁四院智能助手：办公申请卡片、审查任务与审查指导（/brand-review）。可在本页启用或禁用。',
        commands: '命令',
        enabled: '已开启',
        disabled: '已关闭',
        enableToggle: '启用 {name}',
        loading: '正在读取插件状态…',
        missing: '当前 profile 未安装 t4y-review。请在仓库根目录执行：pnpm dsh plugin --profile web add ./tsy-custom-plugins/t4y-review',
        error: '无法读取插件状态。',
        restart: '已记录变更，请重启 Web 后生效。',
        applied: '已更新启用状态。',
        toggleFailed: '切换失败：{message}',
        locked: '此包受保护，无法在此切换。'
      },
      en: {
        tab: 'T4Y capability plugins',
        intro: 'Turn T4Y Smart Assistant capability plugins on or off. Slash commands leave the menu when disabled. Some changes need a restart.',
        pluginTitle: 'Office forms',
        pluginDescription: 'T4Y Smart Assistant: office request cards, review tasks, and review guidance (/brand-review). Enable or disable on this page.',
        commands: 'Commands',
        enabled: 'On',
        disabled: 'Off',
        enableToggle: 'Enable {name}',
        loading: 'Loading plugin status…',
        missing: 't4y-review is not installed in this profile. From the repo root run: pnpm dsh plugin --profile web add ./tsy-custom-plugins/t4y-review',
        error: 'Could not read plugin status.',
        restart: 'Change recorded. Restart Web for it to take effect.',
        applied: 'Enablement updated.',
        toggleFailed: 'Toggle failed: {message}',
        locked: 'This package is protected and cannot be toggled here.'
      }
    }

    function isRecord(value) { return typeof value === 'object' && value !== null && !Array.isArray(value) }
    function parseArgs(value) {
      if (typeof value !== 'string') return isRecord(value) ? value : {}
      try { const parsed = JSON.parse(value); return isRecord(parsed) ? parsed : {} } catch { return {} }
    }
    function pad2(value) { return String(value).padStart(2, '0') }
    function formatDate(date) {
      return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
    }
    function todayInShanghai() {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
      }).formatToParts(new Date())
      const year = Number(parts.find((part) => part.type === 'year')?.value)
      const month = Number(parts.find((part) => part.type === 'month')?.value)
      const day = Number(parts.find((part) => part.type === 'day')?.value)
      return new Date(year, month - 1, day)
    }
    function shiftDays(date, days) {
      const next = new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
      return next
    }
    function parseChineseCount(token) {
      if (/^\d+$/.test(token)) return Number(token)
      const map = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }
      return map[token]
    }
    function parseRelativeDates(text) {
      const today = todayInShanghai()
      const result = {}
      const iso = [...text.matchAll(/(\d{4})-(\d{1,2})-(\d{1,2})/g)].map((match) => (
        `${match[1]}-${pad2(match[2])}-${pad2(match[3])}`
      ))
      const chinese = [...text.matchAll(/(\d{1,2})\s*月\s*(\d{1,2})\s*日/g)].map((match) => (
        `${today.getFullYear()}-${pad2(match[1])}-${pad2(match[2])}`
      ))
      const explicit = [...iso, ...chinese]
      if (explicit[0]) result.start_date = explicit[0]
      if (explicit[1]) result.end_date = explicit[1]

      const relatives = []
      if (/今天|今日/.test(text)) relatives.push(formatDate(today))
      if (/明天|明日/.test(text)) relatives.push(formatDate(shiftDays(today, 1)))
      if (/后天/.test(text)) relatives.push(formatDate(shiftDays(today, 2)))
      if (!result.start_date && relatives[0]) result.start_date = relatives[0]
      if (!result.end_date && relatives[1]) result.end_date = relatives[1]

      const after = text.match(/([一二两三四五六七八九十\d]+)\s*天\s*后/)
      if (after) {
        const days = parseChineseCount(after[1])
        if (Number.isFinite(days) && days >= 0) {
          const offsetDate = formatDate(shiftDays(today, days))
          if (/回|返/.test(text)) result.end_date = result.end_date || offsetDate
          else if (!result.start_date) result.start_date = offsetDate
          else result.end_date = result.end_date || offsetDate
        }
      }
      if (result.start_date && !result.end_date) result.end_date = result.start_date
      return result
    }
    function parseCommand(kind, args) {
      const text = typeof args === 'string' ? args.trim() : ''
      const dates = parseRelativeDates(text)
      const result = { kind, ...dates }
      if (kind === 'leave') {
        if (/病假/.test(text)) result.leave_type = 'sick'
        else if (/事假/.test(text)) result.leave_type = 'personal'
        else if (/年假/.test(text)) result.leave_type = 'annual'
        result.reason = text
      } else if (kind === 'travel') {
        const place = text.match(/(?:去|到|赴|前往)([\u4e00-\u9fa5A-Za-z]{2,20})/)
        if (place) result.destination = place[1]
        result.reason = text
        result.itinerary = text
      } else result.detail = text
      return result
    }
    function normalize(input) {
      const kind = COMMAND_KINDS[input.kind] || input.kind
      const text = [input.reason, input.itinerary, input.detail, input.destination].filter(Boolean).join(' ')
      const inferred = text ? parseRelativeDates(text) : {}
      return {
        kind: ['leave', 'travel', 'office'].includes(kind) ? kind : 'office',
        leaveType: input.leave_type || input.leaveType || 'annual',
        startDate: input.start_date || input.startDate || inferred.start_date || '',
        endDate: input.end_date || input.endDate || inferred.end_date || '',
        destination: input.destination || '',
        itinerary: input.itinerary || '',
        budget: input.budget === undefined || input.budget === null ? '' : String(input.budget),
        companions: input.companions || '',
        officeType: input.office_type || input.officeType || 'meeting',
        subject: input.subject || '',
        reason: input.reason || '',
        detail: input.detail || ''
      }
    }
    function mergeForm(initial, saved) {
      if (!isRecord(saved)) return initial
      const next = { ...initial, ...saved }
      for (const key of Object.keys(initial)) {
        if (!String(saved[key] ?? '').trim() && String(initial[key] ?? '').trim()) next[key] = initial[key]
      }
      return next
    }
    function readState(id, initial) {
      try {
        const saved = JSON.parse(window.localStorage.getItem(`${STORAGE_PREFIX}${id}`) || '{}')
        return mergeForm(initial, saved)
      } catch { return initial }
    }
    function writeState(id, state) {
      try { window.localStorage.setItem(`${STORAGE_PREFIX}${id}`, JSON.stringify(state)) } catch {}
    }
    function Field({ label, children, wide = false }) {
      return React.createElement('label', { className: `t4y-office-field${wide ? ' t4y-office-field-wide' : ''}` }, React.createElement('span', null, label), children)
    }
    function OfficeCard({ node, t }) {
      const initial = React.useMemo(() => normalize(node.data), [node.data])
      const [values, setValues] = React.useState(() => readState(node.id, initial))
      const [submitted, setSubmitted] = React.useState(() => readState(node.id, initial).submitted === true)
      const [error, setError] = React.useState('')
      React.useEffect(() => {
        setValues((current) => mergeForm(initial, current))
      }, [initial])
      const update = name => event => setValues(current => ({ ...current, [name]: event.target.value }))
      const needs = values.kind === 'leave'
        ? ['startDate', 'endDate', 'reason']
        : values.kind === 'travel'
          ? ['destination', 'startDate', 'endDate', 'itinerary', 'reason']
          : ['subject', 'detail']
      const submit = event => {
        event.preventDefault()
        if (needs.some(name => !String(values[name] || '').trim())) { setError(t('required')); return }
        const next = { ...values, submitted: true, submittedAt: new Date().toISOString() }
        setValues(next); setSubmitted(true); setError(''); writeState(node.id, next)
      }
      if (submitted) return React.createElement('section', { className: 't4y-office-card t4y-office-card-submitted', role: 'status' },
        React.createElement('div', { className: 't4y-office-card-frame' },
          React.createElement('div', { className: 't4y-office-card-heading' },
            React.createElement('div', { className: 't4y-office-card-title' },
              React.createElement('strong', null, t(values.kind))),
            React.createElement('span', { className: 't4y-office-card-badge t4y-office-card-badge-ok' }, t('submitted')))))
      return React.createElement('section', { className: 't4y-office-card', 'aria-label': t(values.kind) },
        React.createElement('div', { className: 't4y-office-card-frame' },
          React.createElement('div', { className: 't4y-office-card-heading' },
            React.createElement('div', { className: 't4y-office-card-title' },
              React.createElement('strong', null, t(values.kind))),
            React.createElement('span', { className: 't4y-office-card-badge' }, t('status'))),
          React.createElement('p', { className: 't4y-office-note' }, t('draft')),
          React.createElement('form', { onSubmit: submit },
            values.kind === 'leave' && React.createElement(React.Fragment, null,
              React.createElement(Field, { label: t('leaveType'), wide: true }, React.createElement('select', { value: values.leaveType, onChange: update('leaveType') },
                React.createElement('option', { value: 'annual' }, t('annual')), React.createElement('option', { value: 'personal' }, t('personal')), React.createElement('option', { value: 'sick' }, t('sick')))),
              React.createElement(Field, { label: t('startDate') }, React.createElement('input', { type: 'date', value: values.startDate, onChange: update('startDate') })),
              React.createElement(Field, { label: t('endDate') }, React.createElement('input', { type: 'date', value: values.endDate, onChange: update('endDate') }))
            ),
            values.kind === 'travel' && React.createElement(React.Fragment, null,
              React.createElement(Field, { label: t('destination') }, React.createElement('input', { value: values.destination, onChange: update('destination') })),
              React.createElement(Field, { label: t('startDate') }, React.createElement('input', { type: 'date', value: values.startDate, onChange: update('startDate') })),
              React.createElement(Field, { label: t('endDate') }, React.createElement('input', { type: 'date', value: values.endDate, onChange: update('endDate') })),
              React.createElement(Field, { label: t('itinerary') }, React.createElement('textarea', { value: values.itinerary, onChange: update('itinerary') })),
              React.createElement(Field, { label: t('budget') }, React.createElement('input', { type: 'number', min: '0', value: values.budget, onChange: update('budget') })),
              React.createElement(Field, { label: t('companions') }, React.createElement('input', { value: values.companions, onChange: update('companions') }))
            ),
            values.kind === 'office' && React.createElement(React.Fragment, null,
              React.createElement(Field, { label: t('officeType') }, React.createElement('select', { value: values.officeType, onChange: update('officeType') },
                React.createElement('option', { value: 'meeting' }, t('meeting')), React.createElement('option', { value: 'supplies' }, t('supplies')), React.createElement('option', { value: 'ledger' }, t('ledger')))),
              React.createElement(Field, { label: t('subject') }, React.createElement('input', { value: values.subject, onChange: update('subject') }))
            ),
            React.createElement(Field, { label: t(values.kind === 'office' ? 'detail' : 'reason') }, React.createElement('textarea', { value: values.kind === 'office' ? values.detail : values.reason, onChange: update(values.kind === 'office' ? 'detail' : 'reason') })),
            error && React.createElement('p', { className: 't4y-office-error', role: 'alert' }, error),
            React.createElement('button', { type: 'submit', className: 't4y-office-submit' },
              t('submit'))
          )))
    }
    function OfficeTurnTail({ turn, sessionId, t }) {
      const source = turn.data.source('t4y-office-workflow')
      const workflow = React.useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot)
      if (!workflow) return null
      const id = `${sessionId}:${workflow.id}`
      return React.createElement(OfficeCard, { key: id, node: { id, data: workflow.data }, t })
    }
    function officeFormState(event) {
      if (event.type === 'command/run') {
        const kind = COMMAND_KINDS[event.data.name]
        return { seq: event.seq, kind, ...parseCommand(kind, event.data.args) }
      }
      return { seq: event.seq, ...parseArgs(event.data.arguments) }
    }
    const definition = {
      kind: 't4y-office-workflow',
      match: event => {
        if (event.type === 'tool/call' && event.data.name === 'office_workflow_prepare' && typeof event.data.turn === 'number') {
          return { id: `office:${event.data.turn}`, role: 'start' }
        }
        if (event.type === 'command/run' && COMMAND_KINDS[event.data.name]) {
          if (typeof event.data.turn === 'number') return { id: `office:${event.data.turn}`, role: 'start' }
          return { id: `command:${event.data.commandId}`, role: 'start' }
        }
        // Refresh turn-owned data when the completed-turn tail becomes available.
        if (event.type === 'turn/end' && typeof event.data.turn === 'number') {
          return { id: `office:${event.data.turn}`, role: 'update' }
        }
        return null
      },
      start: (_context, match) => officeFormState(match.event),
      update: (context, match) => {
        if (match.event.type === 'turn/end') {
          return { ...context.state, turnEnded: true, endSeq: match.event.seq }
        }
        if (match.event.type === 'tool/call' || match.event.type === 'command/run') {
          return officeFormState(match.event)
        }
        return context.state
      },
      buildLocationData: (context, scope) => {
        if (scope !== 'turn' || !COMMAND_KINDS[context.state?.kind]) return null
        const location = context.start?.location ?? context.matches?.at(-1)?.location
        if (location?.kind !== 'turn' && location?.kind !== 'step') return null
        return {
          kind: 'turn',
          turn: location.turn.turn,
          key: 't4y-office-workflow',
          value: { id: context.id, data: context.state }
        }
      }
    }
    function CapabilityTab(props) {
      const t = props.t
      const listBundle = props.listBundle
      const setEnabled = props.setEnabled
      const resolveText = props.resolveText
      const [view, setView] = React.useState({ status: 'loading' })
      const [busy, setBusy] = React.useState(false)
      const [notice, setNotice] = React.useState(null)
      const reload = React.useCallback(async () => {
        try {
          const bundle = await listBundle()
          setView(bundle ? { status: 'ready', bundle } : { status: 'missing' })
        } catch (error) {
          setView({ status: 'error', message: error instanceof Error ? error.message : String(error) })
        }
      }, [listBundle])
      React.useEffect(() => { void reload() }, [reload])
      const title = view.status === 'ready'
        ? (view.bundle.meta?.title ? resolveText(view.bundle.meta.title) : t('pluginTitle'))
        : t('pluginTitle')
      const description = view.status === 'ready'
        ? (view.bundle.description || (view.bundle.meta?.description ? resolveText(view.bundle.meta.description) : t('pluginDescription')))
        : t('pluginDescription')
      const version = view.status === 'ready' && view.bundle.version ? `v${view.bundle.version}` : ''
      const enabled = view.status === 'ready' ? view.bundle.enabled : false
      const locked = view.status === 'ready' && view.bundle.readOnlyReason !== undefined
      return React.createElement('div', { className: 't4y-capability' },
        React.createElement('p', { className: 't4y-capability-intro' }, t('intro')),
        view.status === 'loading' && React.createElement('p', { className: 't4y-capability-note' }, t('loading')),
        view.status === 'error' && React.createElement('p', { className: 't4y-capability-error', role: 'alert' }, t('error'), ' ', view.message),
        view.status === 'missing' && React.createElement('p', { className: 't4y-capability-error', role: 'alert' }, t('missing')),
        view.status === 'ready' && React.createElement('article', { className: 't4y-capability-card' },
          React.createElement('div', { className: 't4y-capability-card-main' },
            React.createElement('div', { className: 't4y-capability-card-heading' },
              React.createElement('strong', null, title),
              version && React.createElement('span', { className: 't4y-capability-version' }, version)),
            React.createElement('p', { className: 't4y-capability-commands' },
              React.createElement('span', null, t('commands'), '：'),
              PLUGIN_COMMANDS.map((command) => React.createElement('code', { key: command }, command))),
            React.createElement('p', { className: 't4y-capability-description' }, description),
            notice && React.createElement('p', {
              className: notice.kind === 'error' ? 't4y-capability-error' : 't4y-capability-note',
              role: notice.kind === 'error' ? 'alert' : 'status'
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
                void setEnabled(next).then((change) => {
                  setView((previous) => previous.status === 'ready'
                    ? { status: 'ready', bundle: { ...previous.bundle, enabled: next } }
                    : previous)
                  if (change?.application === 'restart-required') setNotice({ kind: 'info', text: t('restart') })
                  else setNotice({ kind: 'info', text: t('applied') })
                }).catch((error) => {
                  setNotice({
                    kind: 'error',
                    text: t('toggleFailed', { message: error instanceof Error ? error.message : String(error) })
                  })
                  void reload()
                }).finally(() => { setBusy(false) })
              }
            }),
            React.createElement('span', null, enabled ? t('enabled') : t('disabled'))))
      )
    }

    exports.inject = ['slots', 'locale', 'uiConversation', 'remote', 'remote.pluginManager']
    exports.apply = (ctx) => {
      ctx.effect(() => ctx.locale.register(OFFICE_NS, copy), 't4y review: office workflow locale')
      ctx.effect(() => ctx.locale.register(SETTINGS_NS, settingsCopy), 't4y review: settings tab locale')
      const tSettings = ctx.locale.bind(SETTINGS_NS)
      ctx.effect(() => {
        const id = 't4y-office-workflow-style'
        const previousStyle = document.getElementById(id)
        const style = previousStyle instanceof HTMLStyleElement ? previousStyle : document.createElement('style')
        style.id = id
        // Harness can keep multiple scoped plugin instances alive across sessions.
        // Share ownership across module factories, regardless of disposal order.
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
          .t4y-office-card {
            width: min(640px, 100%);
            box-sizing: border-box;
            margin: 16px 0 8px;
            border: 1px solid var(--dsw-alias-border-l2);
            border-radius: 16px;
            background: var(--dsw-alias-bg-base);
            color: var(--dsw-alias-label-primary);
            container-type: inline-size;
          }
          .t4y-office-card-frame { padding: 24px; }
          .t4y-office-card-heading {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 16px;
          }
          .t4y-office-card-title { min-width: 0; }
          .t4y-office-card-heading strong { font-size: 18px; font-weight: 600; line-height: 1.5; }
          .t4y-office-card-badge {
            flex: none;
            padding: 4px 10px;
            border-radius: 6px;
            background: var(--dsw-alias-bg-module-platform);
            color: var(--dsw-alias-label-secondary);
            font-size: 12px;
            line-height: 1.5;
          }
          .t4y-office-card-badge-ok {
            background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, var(--dsw-alias-bg-base));
            color: var(--dsw-alias-state-success-primary);
            white-space: normal;
          }
          .t4y-office-note {
            margin: 6px 0 24px;
            color: var(--dsw-alias-label-secondary);
            font-size: 13px;
            line-height: 1.6;
          }
          .t4y-office-card form {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 18px 16px;
          }
          .t4y-office-field {
            display: flex;
            flex-direction: column;
            min-width: 0;
            gap: 8px;
            color: var(--dsw-alias-label-secondary);
            font-size: 13px;
            line-height: 1.5;
          }
          .t4y-office-field-wide,
          .t4y-office-field:has(textarea) { grid-column: 1 / -1; }
          .t4y-office-field input,
          .t4y-office-field textarea,
          .t4y-office-field select {
            width: 100%;
            min-width: 0;
            min-height: 42px;
            box-sizing: border-box;
            padding: 10px 12px;
            border: 1px solid var(--dsw-alias-border-l2);
            border-radius: 8px;
            background: var(--dsw-alias-bg-base);
            color: var(--dsw-alias-label-primary);
            font: inherit;
            font-size: 14px;
          }
          .t4y-office-field input:hover,
          .t4y-office-field textarea:hover,
          .t4y-office-field select:hover { border-color: var(--dsw-alias-label-tertiary); }
          .t4y-office-field input:focus,
          .t4y-office-field textarea:focus,
          .t4y-office-field select:focus {
            outline: 2px solid color-mix(in srgb, var(--dsw-alias-state-business-primary) 25%, transparent);
            outline-offset: 1px;
            border-color: var(--dsw-alias-state-business-primary);
          }
          .t4y-office-field textarea { min-height: 96px; resize: vertical; }
          .t4y-office-submit {
            grid-column: 1 / -1;
            justify-self: end;
            margin-top: 4px;
            padding: 10px 20px;
            min-height: 42px;
            border: 0;
            border-radius: 8px;
            background: var(--dsw-alias-brand-primary);
            color: var(--dsw-alias-label-primary-inverted);
            font: inherit;
            font-size: 14px;
            font-weight: 500;
            cursor: pointer;
          }
          .t4y-office-submit:hover { opacity: .88; }
          .t4y-office-submit:focus-visible {
            outline: 2px solid var(--dsw-alias-state-business-primary);
            outline-offset: 3px;
          }
          .t4y-office-error {
            grid-column: 1 / -1;
            margin: 0;
            color: var(--dsw-alias-state-error-primary);
            font-size: 13px;
          }
          @container (max-width: 420px) {
            .t4y-office-card-frame { padding: 18px; }
            .t4y-office-card form { grid-template-columns: 1fr; }
            .t4y-office-submit { width: 100%; }
            .t4y-office-card-submitted .t4y-office-card-heading { align-items: flex-start; flex-direction: column; }
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
      }, 't4y review: office workflow styles')
      ctx.uiConversation.events.register(definition)
      // A pending application is an actionable result, outside both process disclosures.
      ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register(
        { name: 'conversation.chat.turnTail', id: 't4y-office-workflow', locale: OFFICE_NS },
        props => React.createElement(OfficeTurnTail, { ...props, t: ctx.locale.bind(OFFICE_NS) })
      ))
      ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
        name: 'settings.plugins.tab',
        id: 't4y-capability',
        order: 20,
        label: () => tSettings('tab'),
        locale: SETTINGS_NS,
        inject: () => ({
          listBundle: async () => {
            const result = await ctx.remote.pluginManager.listBundles()
            if (!result.ok) {
              throw new Error(`${result.error.code}: ${result.error.message}`)
            }
            return result.value.find((bundle) => bundle.name === PACKAGE_NAME) ?? null
          },
          setEnabled: async (enabled) => {
            const result = await ctx.remote.pluginManager.setBundleEnabled(PACKAGE_NAME, enabled)
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
  }
})
