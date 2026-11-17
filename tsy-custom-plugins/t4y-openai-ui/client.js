/** API-specific presentation over generic read-only Session and Slot capabilities. */
window.__ModuleLoader__.load({
  id: 't4y-openai-ui',
  factory: (require) => {
    const React = require('react')
    const { Button } = require('@deepseek-ai/dsh-client-ui-primitives')
    const namespace = 't4y.openaiUi'
    const dictionaries = {
      zh: { api: 'API', refresh: '刷新记录', refreshFailed: '无法刷新记录，请重试' },
      en: { api: 'API', refresh: 'Refresh records', refreshFailed: 'Could not refresh records. Try again.' },
      ja: { api: 'API', refresh: '履歴を更新', refreshFailed: '履歴を更新できませんでした。再試行してください。' },
      es: { api: 'API', refresh: 'Actualizar registros', refreshFailed: 'No se pudieron actualizar los registros. Inténtalo de nuevo.' },
      fr: { api: 'API', refresh: 'Actualiser les enregistrements', refreshFailed: 'Impossible d’actualiser les enregistrements. Réessayez.' },
      de: { api: 'API', refresh: 'Verlauf aktualisieren', refreshFailed: 'Der Verlauf konnte nicht aktualisiert werden. Versuche es erneut.' },
      ru: { api: 'API', refresh: 'Обновить записи', refreshFailed: 'Не удалось обновить записи. Повторите попытку.' },
      pt: { api: 'API', refresh: 'Atualizar registros', refreshFailed: 'Não foi possível atualizar os registros. Tente novamente.' },
    }
    // The namespace is assigned by the OpenAI service's Session addressing protocol.
    const apiSession = id => id.startsWith('openai-')

    function Badge({ label }) {
      return React.createElement('span', { className: 't4y-openai-api-badge' }, label)
    }

    function RowBadge({ sessionId, readOnly, t }) {
      return readOnly === true && apiSession(sessionId)
        ? React.createElement(Badge, { label: t('api') })
        : null
    }

    function HeaderBadge({ sessionId, useSession, useSessions, t }) {
      const summaryReadOnly = useSessions(list => list.byId[sessionId]?.readOnly === true)
      const readOnly = useSession(session => session.readOnly === true)
      return apiSession(sessionId) && (readOnly || summaryReadOnly)
        ? React.createElement(Badge, { label: t('api') })
        : null
    }

    function RefreshRecords({ sessionId, useSession, useSessions, refreshHistory, t }) {
      const summaryReadOnly = useSessions(list => list.byId[sessionId]?.readOnly === true)
      const readOnly = useSession(session => session.readOnly === true)
      const loading = useSession(session => session.openState === 'loading')
      const [failed, setFailed] = React.useState(false)
      if (!apiSession(sessionId) || (!readOnly && !summaryReadOnly)) return null
      const refresh = () => {
        setFailed(false)
        void refreshHistory().then(ok => { setFailed(!ok) }, () => { setFailed(true) })
      }
      return React.createElement(React.Fragment, null,
        React.createElement(Button, { size: 'sm', disabled: loading, onClick: refresh }, t('refresh')),
        failed ? React.createElement('span', { role: 'alert' }, t('refreshFailed')) : null,
      )
    }

    return {
      inject: ['slots', 'sessions', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(namespace, dictionaries), 't4y-openai-ui: dictionaries')
        ctx.effect(() => {
          const style = document.createElement('style')
          style.textContent = '.t4y-openai-api-badge{display:inline-flex;align-items:center;flex-shrink:0;border-radius:999px;corner-shape:round;padding:1px 8px;font-size:11px;line-height:17px;font-weight:500;white-space:nowrap;background:var(--dsw-static-blue-600);color:var(--dsw-static-neutral-00)}'
          document.head.appendChild(style)
          return () => { style.remove() }
        }, 't4y-openai-ui: badge styling')
        ctx.slots.inject('sidebar.session.row.badges', () => ctx.slots.register({
          name: 'sidebar.session.row.badges', id: 't4y-openai-api', order: 0, locale: namespace,
        }, RowBadge))
        ctx.slots.inject('conversation.session.header.readonly.actions', () => ctx.slots.register({
          name: 'conversation.session.header.readonly.actions', id: 't4y-openai-api', order: 0, locale: namespace,
        }, HeaderBadge))
        ctx.slots.inject('conversation.session.header.readonly.utilities', () => ctx.slots.register({
          name: 'conversation.session.header.readonly.utilities', id: 't4y-openai-refresh', order: 0, locale: namespace,
          inject: sessionId => ({
            refreshHistory: async () => {
              const binding = ctx.sessions.binding(sessionId)
              if (binding === undefined) return false
              await binding.session.refreshHistory()
              return true
            },
          }),
        }, RefreshRecords))
      },
    }
  },
})
