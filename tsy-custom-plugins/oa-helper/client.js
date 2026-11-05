window.__ModuleLoader__.load({
  // The module system normalizes a package's client entry by removing `/client`.
  // Using the canonical specifier prevents one bundle from being registered twice.
  id: 'oa-helper/client',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const OFFICE_NS = 't4y.office-workflows'
    const COMMAND_KINDS = { leave: 'leave', travel: 'travel', office: 'office' }
    const OA_HELPER_ACTIONS = {
      leave: 'leave', 请假: 'leave',
      travel: 'travel', 出差: 'travel',
      office: 'office', 办公: 'office',
    }
    function parseOaHelperCommandArgs(args) {
      const text = typeof args === 'string' ? args.trim() : ''
      if (text === '') return { kind: 'leave', rest: '' }
      const matched = text.match(/^(\S+)(?:\s+([\s\S]*))?$/)
      const head = matched?.[1] ?? ''
      const rest = (matched?.[2] ?? '').trim()
      const kind = OA_HELPER_ACTIONS[head] || OA_HELPER_ACTIONS[head.toLowerCase()]
      if (kind) return { kind, rest }
      return { kind: 'leave', rest: text }
    }
    const STORAGE_PREFIX = 't4y.office-workflow.v2.'
    const copy = {
      zh: {
        leave: '请假申请', travel: '出差申请', office: '办公事务', select: '请选择',
        leaveType: '假别', annual: '年假', personal: '事假', sick: '病假',
        startDate: '开始日期', endDate: '结束日期', destination: '出差地点', itinerary: '行程安排', budget: '预算（元）', companions: '同行人',
        officeType: '事务类型', meeting: '会议预约', supplies: '办公用品申领', ledger: '流程台账查询', subject: '主题 / 名称', reason: '事由', detail: '说明',
        required: '请补全必填信息后再提交。',
        submit: '确认并提交到办公平台', submitting: '正在提交到办公平台…',
        submitted: '已提交到办公平台，当前状态：审批中。',
        submitFailed: '提交失败：{message}',
        leaveOnly: '目前仅请假支持提交到办公平台；出差与办公事务仍为本地确认。',
        draft: '请核对并补全申请信息。', status: '待确认'
      },
      en: {
        leave: 'Leave request', travel: 'Business trip', office: 'Office request', select: 'Select',
        leaveType: 'Leave type', annual: 'Annual leave', personal: 'Personal leave', sick: 'Sick leave',
        startDate: 'Start date', endDate: 'End date', destination: 'Destination', itinerary: 'Itinerary', budget: 'Budget (CNY)', companions: 'Travellers',
        officeType: 'Request type', meeting: 'Meeting reservation', supplies: 'Office supplies', ledger: 'Workflow ledger query', subject: 'Subject / name', reason: 'Reason', detail: 'Details',
        required: 'Complete the required fields before submitting.',
        submit: 'Confirm and submit to ZhiJianYun', submitting: 'Submitting to ZhiJianYun…',
        submitted: 'Submitted to ZhiJianYun. Status: approval pending.',
        submitFailed: 'Submit failed: {message}',
        leaveOnly: 'Only leave requests submit to ZhiJianYun for now; travel and office stay local.',
        draft: 'Review and complete your request.', status: 'Needs confirmation'
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
      return {
        kind: ['leave', 'travel', 'office'].includes(kind) ? kind : 'office',
        leaveType: input.leave_type || input.leaveType || '',
        startDate: input.start_date || input.startDate || '',
        endDate: input.end_date || input.endDate || '',
        destination: input.destination || '',
        itinerary: input.itinerary || '',
        budget: input.budget === undefined || input.budget === null ? '' : String(input.budget),
        companions: input.companions || '',
        officeType: input.office_type || input.officeType || '',
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
    function OfficeCard({ node, t, sessionId, submitLeave }) {
      const initial = React.useMemo(() => normalize(node.data), [node.data])
      const [values, setValues] = React.useState(() => readState(node.id, initial))
      const [submitted, setSubmitted] = React.useState(() => readState(node.id, initial).submitted === true)
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState('')
      React.useEffect(() => {
        setValues((current) => mergeForm(initial, current))
      }, [initial])
      const update = name => event => setValues(current => ({ ...current, [name]: event.target.value }))
      const needs = values.kind === 'leave'
        ? ['leaveType', 'startDate', 'endDate', 'reason']
        : values.kind === 'travel'
          ? ['destination', 'startDate', 'endDate', 'itinerary', 'reason']
          : ['subject', 'detail']
      const submit = event => {
        event.preventDefault()
        if (busy) return
        if (needs.some(name => !String(values[name] || '').trim())) { setError(t('required')); return }
        if (values.kind !== 'leave') {
          setError(t('leaveOnly'))
          return
        }
        setBusy(true)
        setError('')
        void submitLeave({
          sessionId,
          leave_type: values.leaveType || 'annual',
          start_date: values.startDate,
          end_date: values.endDate,
          reason: values.reason,
        }).then((outcome) => {
          if (!outcome.ok) {
            setError(t('submitFailed', { message: outcome.message }))
            return
          }
          const next = { ...values, submitted: true, submittedAt: new Date().toISOString(), remoteText: outcome.message }
          setValues(next)
          setSubmitted(true)
          writeState(node.id, next)
        }).catch((err) => {
          setError(t('submitFailed', { message: err instanceof Error ? err.message : String(err) }))
        }).finally(() => { setBusy(false) })
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
            React.createElement('span', { className: 't4y-office-card-badge' }, busy ? t('submitting') : t('status'))),
          React.createElement('p', { className: 't4y-office-note' }, t('draft')),
          React.createElement('form', { onSubmit: submit },
            values.kind === 'leave' && React.createElement(React.Fragment, null,
              React.createElement(Field, { label: t('leaveType'), wide: true }, React.createElement('select', { value: values.leaveType, onChange: update('leaveType'), disabled: busy },
                React.createElement('option', { value: '' }, t('select')),
                React.createElement('option', { value: 'annual' }, t('annual')), React.createElement('option', { value: 'personal' }, t('personal')), React.createElement('option', { value: 'sick' }, t('sick')))),
              React.createElement(Field, { label: t('startDate') }, React.createElement('input', { type: 'date', value: values.startDate, onChange: update('startDate'), disabled: busy })),
              React.createElement(Field, { label: t('endDate') }, React.createElement('input', { type: 'date', value: values.endDate, onChange: update('endDate'), disabled: busy }))
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
                React.createElement('option', { value: '' }, t('select')),
                React.createElement('option', { value: 'meeting' }, t('meeting')), React.createElement('option', { value: 'supplies' }, t('supplies')), React.createElement('option', { value: 'ledger' }, t('ledger')))),
              React.createElement(Field, { label: t('subject') }, React.createElement('input', { value: values.subject, onChange: update('subject') }))
            ),
            React.createElement(Field, { label: t(values.kind === 'office' ? 'detail' : 'reason') }, React.createElement('textarea', {
              value: values.kind === 'office' ? values.detail : values.reason,
              onChange: update(values.kind === 'office' ? 'detail' : 'reason'),
              disabled: busy && values.kind === 'leave',
            })),
            error && React.createElement('p', { className: 't4y-office-error', role: 'alert' }, error),
            React.createElement('button', { type: 'submit', className: 't4y-office-submit', disabled: busy },
              busy ? t('submitting') : t('submit'))
          )))
    }
    function OfficeTurnTail({ turn, sessionId, t, submitLeave }) {
      const source = turn.data.source('t4y-office-workflow')
      const workflow = React.useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot)
      if (!workflow) return null
      const id = `${sessionId}:${workflow.id}`
      return React.createElement(OfficeCard, {
        key: id,
        node: { id, data: workflow.data },
        t,
        sessionId,
        submitLeave,
      })
    }
    /**
     * Slash `/oa-helper` has no turn (Host command lifecycle is log-only), so the
     * turnTail projection never mounts. Specialize the command row instead.
     */
    function OfficeCommandView({ node, sessionId, t, submitLeave }) {
      const args = typeof node.args === 'string' ? node.args : ''
      if (/^\s*submit\b/i.test(args)) {
        const text = node.outcome?.text
        return React.createElement('section', {
          className: 't4y-office-card',
          role: node.outcome?.kind === 'error' ? 'alert' : 'status',
        }, React.createElement('div', { className: 't4y-office-card-frame' },
          React.createElement('p', { className: 't4y-office-note', style: { margin: 0 } },
            text || (node.outcome?.kind === 'error' ? t('submitFailed', { message: 'unknown' }) : t('submitted')))))
      }
      if (node.outcome === null) {
        return React.createElement('section', { className: 't4y-office-card', role: 'status' },
          React.createElement('div', { className: 't4y-office-card-frame' },
            React.createElement('p', { className: 't4y-office-note', style: { margin: 0 } }, t('status'))))
      }
      if (node.outcome?.text !== '已创建办公申请，请在会话卡片中补全并确认。') {
        return React.createElement('section', {
          className: 't4y-office-card',
          role: node.outcome?.kind === 'error' ? 'alert' : 'status',
        }, React.createElement('div', { className: 't4y-office-card-frame' },
          React.createElement('p', { className: 't4y-office-note', style: { margin: 0 } }, node.outcome?.text || t('status'))))
      }
      const parsed = parseOaHelperCommandArgs(args)
      const form = { kind: parsed.kind, ...parseCommand(parsed.kind, parsed.rest) }
      const id = `${sessionId}:${node.commandId}`
      return React.createElement(OfficeCard, {
        key: id,
        node: { id, data: form },
        t,
        sessionId,
        submitLeave,
      })
    }
    function officeFormState(event) {
      if (event.type === 'command/run') {
        if (event.data.name === 'oa-helper') {
          const parsed = parseOaHelperCommandArgs(event.data.args)
          return { seq: event.seq, kind: parsed.kind, ...parseCommand(parsed.kind, parsed.rest) }
        }
        const kind = COMMAND_KINDS[event.data.name]
        return { seq: event.seq, kind, ...parseCommand(kind, event.data.args) }
      }
      return { seq: event.seq, ...parseArgs(event.data.arguments) }
    }
    function isOfficeKind(kind) {
      return kind === 'leave' || kind === 'travel' || kind === 'office'
    }
    const commandActivity = {
      kind: 't4y-office-command-activity',
      target: 't4y-office-command-activity',
      match: event => event.type === 'command/run' && event.data.name === 'oa-helper'
        ? { id: String(event.data.commandId), role: 'start' } : null,
      start: () => ({}),
      update: context => context.state,
      buildViewNode: context => ({
        key: context.key, kind: context.kind, id: context.id,
        target: 't4y-office-command-activity', data: null,
      }),
    }
    const commandActivityView = {
      target: 't4y-office-command-activity',
      create: () => {
        let active = false
        return {
          empty: false,
          replace: ({ nodes }) => (active = nodes.length > 0),
          apply: ({ upserts }) => (active = active || upserts.length > 0),
        }
      },
      isActive: snapshot => snapshot,
    }
    // Turn-scoped projection (same seat as schedule_create): survives process-group
    // collapse and stays under the closing assistant text after the turn ends.
    const definition = {
      kind: 't4y-office-workflow',
      match: event => {
        if (event.type === 'turn/start') return { id: String(event.data.turn), role: 'start' }
        if (event.type === 'tool/call' && event.data.name === 'office_workflow_prepare' && typeof event.data.turn === 'number') {
          return { id: String(event.data.turn), role: 'update' }
        }
        if (event.type === 'tool/result' && typeof event.data.turn === 'number') {
          return { id: String(event.data.turn), role: 'update' }
        }
        if (event.type === 'command/run' && typeof event.data.turn === 'number') {
          if (event.data.name === 'oa-helper') {
            const parsed = parseOaHelperCommandArgs(event.data.args)
            if (COMMAND_KINDS[parsed.kind]) return { id: String(event.data.turn), role: 'update' }
          } else if (COMMAND_KINDS[event.data.name]) {
            return { id: String(event.data.turn), role: 'update' }
          }
        }
        return null
      },
      start: (_context, match) => {
        if (match.event.type !== 'turn/start') throw new Error('t4y-office-workflow start requires turn/start')
        return { turn: match.event.data.turn, form: null, pending: null }
      },
      update: (context, match) => {
        if (match.event.type === 'tool/call') {
          return { ...context.state, pending: { id: match.event.data.callId, form: officeFormState(match.event) } }
        }
        if (match.event.type === 'tool/result') {
          const pending = context.state.pending
          if (!pending || match.event.data.message?.source?.callId !== pending.id) return context.state
          return { ...context.state, pending: null, form: match.event.data.message.isError ? null : pending.form }
        }
        if (match.event.type === 'command/run') {
          return { ...context.state, form: officeFormState(match.event) }
        }
        return context.state
      },
      buildLocationData: (context, scope, previous) => {
        const form = context.state?.form
        if (scope !== 'turn' || form === null || form === undefined || !isOfficeKind(form.kind)) return null
        const value = { id: `office:${context.state.turn}`, data: form }
        if (previous?.kind === 'turn'
          && previous.turn === context.state.turn
          && previous.key === 't4y-office-workflow'
          && previous.value?.id === value.id
          && previous.value?.data === value.data) {
          return previous
        }
        return {
          kind: 'turn',
          turn: context.state.turn,
          key: 't4y-office-workflow',
          value,
        }
      },
    }
    exports.inject = ['slots', 'locale', 'uiConversation', 'remote', 'remote.commands']
    exports.apply = (ctx) => {
      ctx.effect(() => ctx.locale.register(OFFICE_NS, copy), 't4y review: office workflow locale')
      const submitLeave = async ({ sessionId, leave_type, start_date, end_date, reason }) => {
        const line = `/oa-helper submit ${JSON.stringify({ leave_type, start_date, end_date, reason })}`
        const result = await ctx.remote.commands.execute(sessionId, line, [])
        if (!result.ok) {
          return { ok: false, message: `${result.error.code}: ${result.error.message}` }
        }
        if (result.value === undefined) {
          return { ok: false, message: 'unknown command: /oa-helper submit' }
        }
        const commandResult = result.value.result
        if (commandResult?.kind === 'error') {
          return { ok: false, message: commandResult.text || 'oa-helper submit failed' }
        }
        return { ok: true, message: commandResult?.text || 'ok' }
      }
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
            .t4y-office-submit { width: 100%; justify-self: stretch; }
            .t4y-office-card-submitted .t4y-office-card-heading { align-items: flex-start; flex-direction: column; }
          }
          /* Viewport fallback when the chat column is crushed (e.g. drawer open
             beside content) and container queries do not fire as expected. */
          @media (max-width: 720px) {
            .t4y-office-card-frame { padding: 16px; }
            .t4y-office-card form { grid-template-columns: 1fr; }
            .t4y-office-submit {
              width: 100%;
              justify-self: stretch;
              white-space: normal;
            }
            .t4y-office-card-heading {
              align-items: flex-start;
              flex-direction: column;
            }
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
      ctx.uiConversation.events.register(commandActivity)
      ctx.uiConversation.views.register(commandActivityView)
      ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
        name: 'conversation.input.dock', id: 't4y-office-command-activity',
        inject: sessionId => ({ activate: () => ctx.uiConversation.binding(sessionId).activate('t4y-office-command-activity') }),
      }, ({ activate }) => {
        React.useEffect(() => { activate() }, [activate])
        return null
      }))
      // Tool-created cards sit on the turn (office_workflow_prepare).
      ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register(
        { name: 'conversation.chat.turnTail', id: 't4y-office-workflow', locale: OFFICE_NS },
        props => React.createElement(OfficeTurnTail, {
          ...props,
          t: ctx.locale.bind(OFFICE_NS),
          submitLeave,
        })
      ))
      // Slash `/oa-helper` is command-scoped (no turn); render the form on the command row.
      ctx.slots.inject('conversation.chat.commandview', () => ctx.slots.register(
        { name: 'conversation.chat.commandview', key: 'oa-helper', locale: OFFICE_NS },
        props => React.createElement(OfficeCommandView, {
          node: props.node,
          sessionId: props.sessionId,
          t: ctx.locale.bind(OFFICE_NS),
          submitLeave,
        })
      ))
    }
    return module.exports
  }
})
