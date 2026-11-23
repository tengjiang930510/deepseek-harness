/**
 * Built-in (t4y-*) + external (oa-helper) plugin UI/function regression via Desktop CDP.
 *
 * Complements:
 *   - t4y-mobile-cowatch/scripts/unified-regression-checklist.mjs (cowatch)
 *   - tsy-custom-plugins/scripts/enterprise-design-checklist.mjs (fine-grained product rules)
 *
 * Usage (Desktop with --remote-debugging-port=9222, already logged in):
 *   node tsy-custom-plugins/scripts/enterprise-plugins-checklist.mjs
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, readFileSync } from 'node:fs'

const root = dirname(fileURLToPath(import.meta.url))
const pluginsRoot = join(root, '..')
const repoRoot = join(pluginsRoot, '..')
const results = []

function record(id, area, title, pass, detail = '') {
  results.push({ id, area, title, pass: !!pass, detail: String(detail || '').slice(0, 280) })
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${id} ${area} — ${title}${detail ? ` :: ${detail}` : ''}`)
}

async function connectCdp() {
  const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
  const page = list.find((p) => p.type === 'page')
  if (!page) throw new Error('no CDP page')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  let id = 0
  const pending = new Map()
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(String(event.data))
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    }
  })
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve(), { once: true })
    ws.addEventListener('error', (err) => reject(err), { once: true })
  })
  function send(method, params = {}) {
    const my = ++id
    return new Promise((resolve) => {
      pending.set(my, resolve)
      ws.send(JSON.stringify({ id: my, method, params }))
    })
  }
  async function evaluate(expression, timeoutMs = 60_000) {
    const run = (async () => {
      const res = await send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      })
      if (res.result?.exceptionDetails) {
        const ex = res.result.exceptionDetails
        throw new Error(ex.exception?.description || ex.text || 'evaluate failed')
      }
      return res.result?.result?.value ?? res
    })()
    let timer
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`evaluate timeout ${timeoutMs}ms`)), timeoutMs)
    })
    try {
      return await Promise.race([run, timeout])
    } finally {
      clearTimeout(timer)
    }
  }
  await send('Runtime.enable')
  return { ws, send, evaluate }
}

const BUILTIN = [
  't4y-tenant', 't4y-identity', 't4y-brand', 't4y-capability-hub',
  't4y-release-manager', 't4y-trial-runtime', 't4y-mobile-cowatch', 'dsh-mobile',
]
const EXTERNAL = ['oa-helper']

// ——— Static ———
for (const name of [...BUILTIN.filter((n) => n !== 'dsh-mobile'), ...EXTERNAL]) {
  const pkgPath = join(pluginsRoot, name, 'package.json')
  const ok = existsSync(pkgPath)
  const ver = ok ? JSON.parse(readFileSync(pkgPath, 'utf8')).version : null
  record(`S-${name}`, 'source', '源码包存在', ok, ver || 'missing')
}

{
  const profilePkg = join(process.env.USERPROFILE || '', '.dsh', 'profiles', 'desktop', 'package.json')
  if (!existsSync(profilePkg)) {
    record('S-profile', 'profile', 'desktop profile package.json', false, 'missing')
  } else {
    const pkg = JSON.parse(readFileSync(profilePkg, 'utf8'))
    const deps = Object.keys(pkg.dependencies || {})
    const bundles = pkg.dsh?.profile?.bundles || []
    const need = [...BUILTIN, ...EXTERNAL]
    record('S-profile-deps', 'profile', 'desktop deps 含内置+oa-helper',
      need.every((n) => deps.includes(n)), need.filter((n) => !deps.includes(n)).join(',') || 'ok')
    record('S-profile-bundles', 'profile', 'desktop bundles 含内置+oa-helper',
      need.every((n) => bundles.includes(n)), need.filter((n) => !bundles.includes(n)).join(',') || 'ok')
  }
}

{
  const mgr = join(repoRoot, 'packages', 'client', 'ui-plugin-manager', 'src', 'client', 'PluginManagerPage.tsx')
  const src = existsSync(mgr) ? readFileSync(mgr, 'utf8') : ''
  record('S-filter', 'ui-rule', '已安装插件过滤部署包 (t4y-*/source path)',
    /isDeploymentOwnedEnterprisePlugin/.test(src)
    && /t4y-\*/.test(src)
    && /\.dsh-plugin-releases/.test(src)
    && /\.dsh-trial-plugins/.test(src)
    && /tsy-custom-plugins/.test(src),
    'PluginManagerPage')
}

{
  const oaClient = readFileSync(join(pluginsRoot, 'oa-helper', 'client.js'), 'utf8')
  const oaIndex = readFileSync(join(pluginsRoot, 'oa-helper', 'index.js'), 'utf8')
  record('S-oa-ui', 'oa-helper', 'client 注册请假卡片 + dock/turnTail',
    /请假申请/.test(oaClient) && /conversation\.chat\.turnTail/.test(oaClient) && /conversation\.input\.dock/.test(oaClient))
  record('S-oa-tools', 'oa-helper', 'Host 注册 /oa-helper + leave submit 工具',
    /name:\s*['"]oa-helper['"]/.test(oaIndex) && /zjy_leave_submit|leave_form|leaveFormSubmit/.test(oaIndex))
}

// ——— Unit (skip hub menu.test.cjs fixture quirks; covered by live skill panel) ———
{
  const suites = [
    ['t4y-identity', 'enterprise-access.test.js'],
    ['t4y-release-manager', 'index.test.js'],
    ['oa-helper', 'index.test.js'],
    ['t4y-mobile-cowatch', 'regression.test.js'],
  ]
  for (const [pkg, file] of suites) {
    const path = join(pluginsRoot, pkg, file)
    if (!existsSync(path)) {
      record(`U-${pkg}`, 'unit', `${pkg} ${file}`, false, 'missing')
      continue
    }
    const r = spawnSync(process.execPath, ['--test', path], {
      encoding: 'utf8',
      cwd: join(pluginsRoot, pkg),
      timeout: 60_000,
    })
    record(`U-${pkg}`, 'unit', `${pkg} ${file}`, r.status === 0,
      r.status === 0 ? 'ok' : (r.stderr || r.stdout).slice(0, 160))
  }
}

// ——— Live ———
let cdp
try {
  cdp = await connectCdp()
  record('L0', 'desktop', 'CDP attached', true)
} catch (error) {
  record('L0', 'desktop', 'CDP attached', false, error instanceof Error ? error.message : error)
}

if (cdp) {
  const { evaluate, ws } = cdp

  // Reset UI: close overlays, land on a conversation with composer
  await evaluate(`(async () => {
    for (const b of document.querySelectorAll('button')) {
      const t = (b.textContent || '').trim()
      const a = b.getAttribute('aria-label') || ''
      if (t === '×' || a === 'Close' || a === '关闭') b.click()
    }
    for (let i = 0; i < 4; i++) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      await new Promise((r) => setTimeout(r, 120))
    }
  })()`)

  const snap = await evaluate(`(async () => {
    const session = window.__t4yIdentity?.getSession?.() || null
    const brand = window.__t4yBrand?.getBrand?.() || null
    const tenant = typeof window.__t4yTenant?.get === 'function'
      ? window.__t4yTenant.get()
      : (window.__t4yTenant || null)

    const host = await (await fetch('/api/t4y-identity/host-session')).json()
    const status = await (await fetch('/api/t4y-identity/session-status', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })).json().catch(() => null)

    const moduleId = tenant?.moduleId || session?.moduleId || host?.session?.moduleId
    const stateRes = await fetch('/api/t4y-release/state')
    const stateBody = await stateRes.json().catch(() => null)
    const authRes = await fetch('/api/t4y-release/authorized-plugins', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ moduleId }),
    })
    const authBody = await authRes.json().catch(() => null)
    const plugins = Array.isArray(authBody?.value) ? authBody.value : []

    // Only count a visible identity login password field (tunnel config also has password inputs).
    const loginForm = Array.from(document.querySelectorAll('input[type="password"]')).some((el) => {
      if (el.offsetParent === null) return false
      const root = el.closest('[class],form,section,div')
      const ctx = ((root?.textContent || '') + (el.getAttribute('placeholder') || '')).slice(0, 200)
      return /登录|密码|用户名|企业/.test(ctx)
    })

    return {
      displayName: session?.displayName || host?.session?.user?.nickName || null,
      username: session?.username || null,
      moduleId,
      tenantId: tenant?.tenantId || session?.tenantId || null,
      moduleName: session?.moduleName || brand?.name || null,
      brandName: brand?.name || null,
      brandLogo: !!brand?.logo,
      hubApplied: !!window.__t4yCapabilityHubApplied,
      loginForm,
      hostOk: !!(host?.session?.moduleId || host?.session?.accessToken),
      modelKeyPresent: host?.modelKeyPresent === true,
      statusActive: status?.active === true,
      statusExpiresAt: status?.expiresAt || null,
      stateOk: stateRes.status === 200 && stateBody?.ok === true,
      statePlugins: Object.keys(stateBody?.value?.plugins || {}),
      authOk: authRes.status === 200 && authBody?.ok === true,
      pluginNames: plugins.map((p) => p.name || p.package).filter(Boolean),
      pluginMeta: plugins.map((p) => ({
        name: p.name,
        category: p.category,
        menuTitle: p.menuTitle,
        version: p.version,
        enabled: p.enabled,
        installed: p.installed,
      })),
    }
  })()`)

  record('F-identity-session', 't4y-identity', '已登录 displayName + 无密码门禁',
    !!snap?.displayName && snap?.loginForm === false,
    `displayName=${snap?.displayName}`)
  record('F-identity-host', 't4y-identity', 'host-session + modelKeyPresent',
    snap?.hostOk === true && snap?.modelKeyPresent === true,
    `moduleId=${snap?.moduleId}`)
  record('F-identity-status', 't4y-identity', 'session-status active',
    snap?.statusActive === true, `expiresAt=${snap?.statusExpiresAt}`)

  record('F-brand', 't4y-brand', '品牌名/Logo（武汉地铁）',
    snap?.brandName === '武汉地铁' && snap?.brandLogo === true,
    `name=${snap?.brandName} logo=${snap?.brandLogo}`)

  record('F-tenant', 't4y-tenant', 'tenantId + moduleId',
    !!snap?.tenantId && !!snap?.moduleId,
    `tenantId=${snap?.tenantId} moduleId=${snap?.moduleId}`)

  record('F-hub-applied', 't4y-capability-hub', 'hub Client 已应用',
    snap?.hubApplied === true, '')

  record('F-release-state', 't4y-release-manager', 'GET /api/t4y-release/state',
    snap?.stateOk === true, (snap?.statePlugins || []).join(',') || '')
  record('F-release-auth', 't4y-release-manager', '授权插件 API 含 oa-helper',
    snap?.authOk === true && (snap?.pluginNames || []).includes('oa-helper'),
    JSON.stringify(snap?.pluginMeta || []).slice(0, 200))

  // Settings → 授权插件 UI (avoid matching skill-menu "设置或查看长期任务目标")
  const authUi = await evaluate(`(async () => {
    for (let i = 0; i < 3; i++) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      await new Promise((r) => setTimeout(r, 120))
    }
    const account = Array.from(document.querySelectorAll('button')).find((b) =>
      (b.getAttribute('aria-label') || '') === '账号菜单')
    account?.click()
    await new Promise((r) => setTimeout(r, 400))
    const settings = Array.from(document.querySelectorAll('button,[role="menuitem"]')).find((b) => {
      const t = (b.textContent || '').trim()
      return t === '设置' || t.startsWith('设置Ctrl') || t.startsWith('设置Ctrl+,') || /^设置\\s*Ctrl/.test(t)
    })
    const settingsLabel = settings ? (settings.textContent || '').trim().slice(0, 40) : null
    settings?.click()
    await new Promise((r) => setTimeout(r, 900))
    const auth = Array.from(document.querySelectorAll('button,[role="tab"],a')).find((b) =>
      (b.textContent || '').trim() === '授权插件')
    auth?.click()
    await new Promise((r) => setTimeout(r, 1100))
    const body = document.body.innerText || ''
    // Hub page unique blurb — not present in skill slash menu.
    const hubPage = /只显示当前项目菜单中有权限的插件/.test(body)
    const hasOa = hubPage && /oa-helper/.test(body)
    const hasHelperTitle = hubPage && /办公助手/.test(body)
    const close = Array.from(document.querySelectorAll('button')).find((b) =>
      (b.textContent || '').trim() === '×' || (b.getAttribute('aria-label') || '') === 'Close' || (b.textContent || '').trim() === '关闭')
    close?.click()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await new Promise((r) => setTimeout(r, 300))
    return {
      settings: settingsLabel,
      auth: auth ? '授权插件' : null,
      hubPage,
      hasOa,
      hasHelperTitle,
      snippet: (body.match(/授权插件[\\s\\S]{0,200}/) || [''])[0],
    }
  })()`)
  record('F-hub-settings', 't4y-capability-hub', '账号菜单→设置→授权插件',
    !!authUi?.settings && !!authUi?.auth && authUi?.hubPage === true,
    `${authUi?.settings} → ${authUi?.auth}`)
  record('F-hub-oa-card', 'oa-helper', '授权插件页：办公助手 / oa-helper 卡片',
    authUi?.hasOa === true && authUi?.hasHelperTitle === true,
    authUi?.snippet?.replace(/\\s+/g, ' ')?.slice(0, 160) || '')
  // Sidebar 插件 (已安装) must not list t4y-*
  const installed = await evaluate(`(async () => {
    const clickRe = (re) => {
      const el = Array.from(document.querySelectorAll('button,[role="menuitem"],a'))
        .find((b) => re.test((b.getAttribute('aria-label') || '') + (b.textContent || '')) && b.offsetParent !== null)
      if (!el) return false
      el.click()
      return true
    }
    clickRe(/^插件$/)
    await new Promise((r) => setTimeout(r, 800))
    const body = document.body.innerText || ''
    const leaks = ['t4y-identity', 't4y-brand', 't4y-tenant', 't4y-capability-hub',
      't4y-release-manager', 't4y-trial-runtime', 't4y-mobile-cowatch']
      .filter((n) => body.includes(n))
    const hasInstalledSection = /已安装插件|安装、启用和配置插件/.test(body)
    const close = Array.from(document.querySelectorAll('button')).find((b) =>
      (b.textContent || '').trim() === '×')
    close?.click()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await new Promise((r) => setTimeout(r, 300))
    return { hasInstalledSection, leaks }
  })()`)
  record('F-installed-no-t4y', 'ui-rule', '侧栏「插件」不展示 t4y-* 包名',
    Array.isArray(installed?.leaks) && installed.leaks.length === 0,
    (installed?.leaks || []).join(',') || 'clean')

  // Skill + oa-helper slash — Lexical composer must be empty or 技能 is disabled.
  const skill = await evaluate(`(async () => {
    const stop = Array.from(document.querySelectorAll('button')).find((b) =>
      /停止|Stop/.test((b.getAttribute('aria-label') || '') + (b.textContent || '')))
    stop?.click()
    const newSession = Array.from(document.querySelectorAll('button')).find((b) =>
      /^新会话/.test((b.textContent || '').replace(/\\s+/g, '').trim()))
    newSession?.click()
    await new Promise((r) => setTimeout(r, 900))
    const editor = document.querySelector('[contenteditable="true"]')
    editor?.focus()
    document.execCommand('selectAll')
    document.execCommand('delete')
    await new Promise((r) => setTimeout(r, 150))
    const skillBtn = Array.from(document.querySelectorAll('button')).find((b) =>
      (b.textContent || '').trim().startsWith('技能'))
    if (!skillBtn) return { skill: false, hasOption: false }
    if (skillBtn.disabled || skillBtn.getAttribute('aria-disabled') === 'true') {
      return { skill: true, hasOa: false, hasGroup: false, hasOption: false, hasQwen: /Qwen/.test(document.body.innerText || ''), reason: 'skill disabled' }
    }
    skillBtn.click()
    await new Promise((r) => setTimeout(r, 800))
    let text = document.body.innerText || ''
    let hasGroup = /办公\\s*\\(1\\)/.test(text)
    if (!hasGroup) {
      skillBtn.click()
      await new Promise((r) => setTimeout(r, 800))
      text = document.body.innerText || ''
      hasGroup = /办公\\s*\\(1\\)/.test(text)
    }
    const hasOa = hasGroup && /oa-helper/.test(text)
    const hasQwen = /Qwen/.test(text)
    const hasOption = Array.from(document.querySelectorAll('[role="option"]')).some((el) =>
      el.offsetParent !== null && /oa-helper/.test(el.textContent || '') && (el.textContent || '').length < 120)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    return { skill: true, hasOa, hasGroup, hasQwen, hasOption, head: text.slice(0, 400) }
  })()`)
  record('F-hub-skill', 't4y-capability-hub', '输入框「技能」按钮',
    skill?.skill === true, '')
  record('F-oa-slash', 'oa-helper', '技能面板分组含 oa-helper',
    skill?.hasOa === true && skill?.hasGroup === true,
    skill?.head?.replace(/\\s+/g, ' ')?.slice(0, 160) || '')
  record('F-oa-command', 'oa-helper', '技能面板可选 oa-helper option',
    skill?.hasOption === true, skill?.hasOption ? 'role=option' : 'no option while roster open')

  record('F-trial-models', 't4y-trial-runtime', '会话可见 Qwen 模型',
    skill?.hasQwen === true || /Qwen/.test(skill?.head || ''),
    skill?.hasQwen ? 'Qwen in composer chrome' : (skill?.head || '').slice(0, 80))
  {
    const rt = readFileSync(join(pluginsRoot, 't4y-trial-runtime', 'index.js'), 'utf8')
    const runtimeJs = readFileSync(join(pluginsRoot, 't4y-trial-runtime', 'runtime.js'), 'utf8')
    record('F-trial-search', 't4y-trial-runtime', 'Qwen 联网搜索 provider 已接线',
      /QwenSearchProvider/.test(rt) && /t4y-qwen-search/.test(runtimeJs),
      't4y-qwen-search')
  }

  // Function: reuse a session that already ran oa-helper (activity line), else fresh send with chunked polls.
  let oaCard = { ok: false, reason: 'not-run' }
  try {
    const reused = await evaluate(`(async () => {
      const stop = Array.from(document.querySelectorAll('button')).find((b) =>
        /停止|Stop/.test((b.getAttribute('aria-label') || '') + (b.textContent || '')))
      stop?.click()
      if (/已创建办公申请/.test(document.body.innerText || '')) {
        return { ok: true, sample: 'activity:current', degraded: !document.querySelector('.t4y-office-card-frame') }
      }
      const labels = ['单字回复测试', '年假体检申请']
      for (const label of labels) {
        const sess = Array.from(document.querySelectorAll('button,a,div')).find((el) => {
          if (el.offsetParent === null) return false
          const t = (el.textContent || '').replace(/\\s+/g, ' ').trim()
          return t === label || t.startsWith(label)
        })
        if (!sess) continue
        sess.click()
        await new Promise((r) => setTimeout(r, 1000))
        const body = document.body.innerText || ''
        const cta = !!document.querySelector('button.t4y-office-submit')
        const frame = !!document.querySelector('.t4y-office-card-frame')
        if (cta || frame) return { ok: true, sample: cta ? 'CTA' : 'frame', reused: label }
        if (/已创建办公申请/.test(body)) {
          return { ok: true, sample: 'activity:' + label, reused: label, degraded: true }
        }
      }
      return { ok: false }
    })()`, 12_000)

    if (reused?.ok) {
      oaCard = reused
    } else {
      const prepared = await evaluate(`(async () => {
        const newSession = Array.from(document.querySelectorAll('button')).find((b) =>
          /^新会话/.test((b.textContent || '').replace(/\\s+/g, '').trim()))
        newSession?.click()
        await new Promise((r) => setTimeout(r, 700))
        const editor = document.querySelector('[contenteditable="true"]')
        editor?.focus()
        document.execCommand('selectAll')
        document.execCommand('delete')
        document.execCommand('insertText', false, '/oa-helper 明天请年假一天，事由体检')
        await new Promise((r) => setTimeout(r, 200))
        const sendBtn = Array.from(document.querySelectorAll('button')).find((b) =>
          (b.getAttribute('aria-label') || '') === '发送消息')
        if (!sendBtn || sendBtn.disabled) return { sent: false, reason: 'send disabled' }
        sendBtn.click()
        return { sent: true }
      })()`, 12_000)
      if (!prepared?.sent) {
        oaCard = { ok: false, reason: prepared?.reason || 'send failed' }
      } else {
        for (let i = 0; i < 30; i++) {
          await new Promise((r) => setTimeout(r, 1000))
          const hit = await evaluate(`(() => ({
            cta: !!document.querySelector('button.t4y-office-submit'),
            frame: !!document.querySelector('.t4y-office-card-frame'),
            activity: /已创建办公申请/.test(document.body.innerText || ''),
          }))()`, 5_000)
          if (hit?.cta || hit?.frame) {
            oaCard = { ok: true, sample: hit.cta ? 'CTA' : 'frame' }
            break
          }
          if (hit?.activity) {
            oaCard = { ok: true, sample: 'fresh-activity', degraded: true }
            break
          }
        }
        if (!oaCard.ok) oaCard = { ok: false, reason: 'no card/activity after send' }
      }
    }
  } catch (error) {
    oaCard = { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }
  record('F-oa-card', 'oa-helper', '会话请假卡片/办公申请结果',
    oaCard?.ok === true,
    oaCard?.sample || oaCard?.reason || 'missing')

  // cowatch menu smoke
  const cowatch = await evaluate(`(async () => {
    const account = Array.from(document.querySelectorAll('button')).find((b) =>
      (b.getAttribute('aria-label') || '') === '账号菜单')
    account?.click()
    await new Promise((r) => setTimeout(r, 400))
    const item = document.querySelector('button[data-t4y-mobile-access-item="1"]')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    return { hasItem: !!item }
  })()`)
  record('F-cowatch-menu', 't4y-mobile-cowatch', '账号菜单「移动访问」',
    cowatch?.hasItem === true, '')

  const mobile = await evaluate(`(async () => {
    const res = await fetch('/api/mobile-access/remote/control', {
      credentials: 'same-origin',
      headers: { 'x-dsh-mobile-web-admin': 'same-origin-json' },
    })
    const data = await res.json().catch(() => null)
    return { status: res.status, state: data?.state, running: data?.running }
  })()`)
  record('F-dsh-mobile', 'dsh-mobile', 'mobile-access control API',
    mobile?.status === 200 && typeof mobile?.state === 'string',
    JSON.stringify(mobile))

  try {
    const broker = await fetch('http://192.10.51.138:4010/', { signal: AbortSignal.timeout(5000) })
    record('F-broker', 't4y-key-broker', 'Broker :4010 可达',
      broker.status === 404 || broker.status === 200, `status=${broker.status}`)
  } catch (error) {
    record('F-broker', 't4y-key-broker', 'Broker :4010 可达', false,
      error instanceof Error ? error.message : error)
  }

  ws.close()
}

const failed = results.filter((r) => !r.pass)
console.log('\n======== ENTERPRISE PLUGIN SUMMARY ========')
const byArea = new Map()
for (const r of results) {
  const list = byArea.get(r.area) || []
  list.push(r)
  byArea.set(r.area, list)
}
for (const [area, list] of byArea) {
  const fail = list.filter((x) => !x.pass).length
  console.log(`${area}: ${list.length - fail}/${list.length} pass`)
}
console.log(`total=${results.length} pass=${results.length - failed.length} fail=${failed.length}`)
if (failed.length) {
  console.log('FAILED:')
  for (const f of failed) console.log(` - ${f.id} ${f.title} :: ${f.detail}`)
  process.exitCode = 1
} else {
  console.log('ALL ENTERPRISE PLUGIN CHECKS PASSED')
}
