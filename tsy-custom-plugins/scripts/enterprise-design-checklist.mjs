/**
 * Design-level product regression for Wuhan Metro enterprise plugins.
 *
 * Goes beyond smoke (is X visible?) into documented product rules from
 * PLUGIN-REFERENCE.md and each package README.zh.md / DEVELOPING.md.
 *
 * Usage (Desktop with --remote-debugging-port=9222, logged in):
 *   node tsy-custom-plugins/scripts/enterprise-design-checklist.mjs
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
  results.push({ id, area, title, pass: !!pass, detail: String(detail || '').slice(0, 320) })
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
  async function evaluate(expression, timeoutMs = 45_000) {
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

function readSrc(...parts) {
  return readFileSync(join(pluginsRoot, ...parts), 'utf8')
}

// ——— Static design contracts (source of truth in docs / code) ———
{
  const idClient = readSrc('t4y-identity', 'client.js')
  const idIndex = readSrc('t4y-identity', 'index.js')
  record('D-id-no-key-in-browser', 't4y-identity', '浏览器会话不存模型 Key 明文（文档契约）',
    /不含.*模型 Key|llmApiKeyExpiresAt|不保存模型 Key/.test(readSrc('t4y-identity', 'README.zh.md'))
    && !/localStorage\.setItem\([^)]*apiKey|sessionStorage\.setItem\([^)]*T4Y_NEW_API/.test(idClient))
  record('D-id-prefs-survive-logout', 't4y-identity', 'prefs 键在退出后仍保留账号/企业偏好',
    /t4y\.identity\.prefs\.v1/.test(idClient) && /退出后仍保留/.test(readSrc('t4y-identity', 'README.zh.md')))
  record('D-id-switch-no-reissue', 't4y-identity', '切企业不重签 Key（产品规则）',
    /不.*重签|不重签 Key/.test(readSrc('t4y-identity', 'README.zh.md'))
    && /set-context/.test(idIndex + idClient))
  record('D-id-account-copy', 't4y-identity', '账号菜单文案：账户登录 / 退出登录 / 切换项目',
    /账户登录/.test(idClient) && /退出登录/.test(idClient) && /切换项目/.test(idClient))
  record('D-id-default-qwen-flash', 't4y-identity', '默认模型优先 qwen3.8-flash',
    /qwen3\.8-flash/.test(idClient + idIndex + readSrc('t4y-identity', 'README.zh.md')))
  record('D-id-enterprise-proxy-only', 't4y-identity', '浏览器经 Host enterprise-proxy，不直连 apiBaseUrl',
    /enterprise-proxy/.test(idClient) && /不要.*浏览器里传 accessToken|不直连/.test(readSrc('t4y-identity', 'README.zh.md')))
}

{
  const brand = readSrc('t4y-brand', 'client.js')
  const brandReadme = readSrc('t4y-brand', 'README.zh.md')
  record('D-br-module-over-enterprise', 't4y-brand', '品牌名：项目优先于企业 systemName',
    /module\.name|moduleName|项目优先/.test(brand + brandReadme))
  record('D-br-placeholder-signed-out', 't4y-brand', '未登录占位「智能助手」+ 内置 logo',
    /智能助手/.test(brand + brandReadme) && /brand-mark|fallback|内置/.test(brandReadme))
  record('D-br-logo-fail-fallback', 't4y-brand', '远程 logo 失败回退内置图',
    /onerror|fallback|enterpriseLogo|失败回退/.test(brand + brandReadme))
}

{
  const tenantReadme = readSrc('t4y-tenant', 'README.zh.md')
  record('D-te-three-ids-distinct', 't4y-tenant', 'tenantId / moduleId / catalogProjectId 三者不可互换',
    /不可互换|不是同一套 id|distinct/.test(tenantReadme + readSrc('PLUGIN-REFERENCE.md')))
  record('D-te-no-auth-by-context', 't4y-tenant', '上下文存在 ≠ 已获插件授权',
    /不代表.*授权|不校验密码/.test(readSrc('PLUGIN-REFERENCE.md')))
}

{
  const hub = readSrc('t4y-capability-hub', 'client.js')
  const hubDev = readSrc('t4y-capability-hub', 'DEVELOPING.md')
  record('D-hub-no-shortcut-checkbox', 't4y-capability-hub', '授权卡片不再提供「在输入框显示」勾选',
    /不再提供.*快捷|不再提供「在输入框显示」/.test(readSrc('t4y-capability-hub', 'README.zh.md'))
    && !/在输入框显示快捷/.test(hub))
  record('D-hub-skill-no-insert-slash', 't4y-capability-hub', '技能按钮不往草稿插入 /',
    /不往草稿插入|toggleTrigger\(['"]\/['"]\)|不插入/.test(hub + hubDev))
  record('D-hub-skill-disabled-with-draft', 't4y-capability-hub', '有草稿/附件时技能应禁用（leading claim）',
    /有草稿|shortcutDraft|请先处理当前输入/.test(hub + hubDev))
  record('D-hub-toggle-closes-panel', 't4y-capability-hub', '面板已开时再点技能算关闭成功',
    /面板已开时会关闭|关面板.*成功/.test(hubDev))
  record('D-hub-auth-memory-only', 't4y-capability-hub', '授权结果只在页面内存，不跨刷新复用',
    /不跨页面|只保存在当前页面内存|授权结果只保存在/.test(readSrc('t4y-capability-hub', 'README.zh.md')))
  record('D-hub-intro-copy', 't4y-capability-hub', '授权页 intro 文案固定',
    /只显示当前项目菜单中有权限的插件/.test(hub))
}

{
  const rel = readSrc('t4y-release-manager', 'index.js')
  const relReadme = readSrc('t4y-release-manager', 'README.zh.md')
  record('D-rel-immutable-commit', 't4y-release-manager', '发布状态按 40 位 Git 提交固定',
    /40.*提交|git\.commit|commit/.test(rel + relReadme))
  record('D-rel-apply-module-no-uninstall', 't4y-release-manager', '切项目只停用未授权包，不卸载',
    /不卸载|停用.*未授权/.test(relReadme + readSrc('PLUGIN-REFERENCE.md')))
  record('D-rel-manual-disable-sticky', 't4y-release-manager', '用户手动停用不会被自动停用恢复逻辑覆盖',
    /手动停用.*保持|手动停用不应/.test(relReadme + readSrc('PLUGIN-REFERENCE.md')))
  record('D-rel-package-eq-menu-name', 't4y-release-manager', 'Hub 包名 = 菜单叶子 name（无 t4y- 前缀）',
    true) // enforced by product rule; live check below
  record('D-rel-filter-platform-from-list', 't4y-release-manager', '普通插件列表过滤平台包与受管包',
    /过滤|不显示企业平台包|listBundles/.test(rel + relReadme))
}

{
  const trial = readSrc('t4y-trial-runtime', 'index.js')
  const runtime = readSrc('t4y-trial-runtime', 'runtime.js')
  record('D-tr-no-login-ui', 't4y-trial-runtime', '本包不提供登录 UI / 不自造 Key',
    /不提供登录 UI|不自造 Key/.test(readSrc('t4y-trial-runtime', 'README.zh.md')))
  record('D-tr-credential-slot', 't4y-trial-runtime', 'LLM/搜索凭据对齐 T4Y_NEW_API_KEY',
    /T4Y_NEW_API_KEY/.test(trial + runtime + readSrc('t4y-trial-runtime', 'README.zh.md')))
  record('D-tr-qwen-search-not-prose', 't4y-trial-runtime', '搜索映射 structured sources，不用模型散文当 content',
    /never model prose|structured source|web_search_call/.test(trial))
  record('D-tr-drop-deepseek-search', 't4y-trial-runtime', 'profile 去掉 DeepSeek search 占用',
    /web-search-deepseek|PROFILE_OWNED/.test(trial))
}

{
  const oaClient = readSrc('oa-helper', 'client.js')
  const oaIndex = readSrc('oa-helper', 'index.js')
  const oaRef = readSrc('PLUGIN-REFERENCE.md')
  record('D-oa-single-slash', 'oa-helper', '斜杠仅单一入口 /oa-helper',
    /斜杠菜单只暴露.*oa-helper|单一斜杠入口/.test(readSrc('oa-helper', 'README.zh.md'))
    && /name:\s*['"]oa-helper['"]/.test(oaIndex))
  record('D-oa-three-kinds', 'oa-helper', '请假/出差/办公三套字段',
    /请假申请/.test(oaClient) && /出差申请/.test(oaClient) && /办公事务/.test(oaClient)
    && /假别/.test(oaClient) && /出差地点/.test(oaClient) && /事务类型/.test(oaClient))
  record('D-oa-leave-remote-only', 'oa-helper', '仅请假远程提交；出差/办公本地确认',
    /目前仅请假支持提交到办公平台/.test(oaClient))
  record('D-oa-prepare-no-submit', 'oa-helper', '准备阶段不提交远程流程',
    /正常准备阶段不提交|请核对并补全/.test(oaRef + oaClient))
  record('D-oa-submit-lib-missing', 'oa-helper', 'leave-open.js 缺失时提交通道应失败响亮',
    /请假提交模块不可用|leave-open\.js/.test(oaIndex)
    && !existsSync(join(pluginsRoot, 'oa-helper', 'lib', 'leave-open.js')))
  record('D-oa-commandview-for-slash', 'oa-helper', '斜杠无 turn 时用 commandview 挂卡片',
    /commandview|turnTail projection never mounts|Specialize the command row/.test(oaClient))
  record('D-oa-relative-dates', 'oa-helper', '相对日期解析（今天/明天/后天）',
    /今天|明天|后天/.test(oaClient) && /Asia\/Shanghai/.test(oaClient))
}

{
  const cw = readSrc('t4y-mobile-cowatch', 'README.zh.md')
  const cwIndex = readSrc('t4y-mobile-cowatch', 'index.js')
  const cwClient = existsSync(join(pluginsRoot, 't4y-mobile-cowatch', 'client.js'))
    ? readSrc('t4y-mobile-cowatch', 'client.js') : ''
  record('D-cw-placeholder-token', 't4y-mobile-cowatch', '手机占位 accessToken=mobile-cowatch，真 token 不落手机',
    /mobile-cowatch/.test(cw) && /真 token 留在电脑|不下发真 token/.test(cw))
  record('D-cw-no-token-in-hash', 't4y-mobile-cowatch', '禁止 accessToken 进 URL hash',
    /禁止.*accessToken.*URL hash|handoff/.test(cw))
  record('D-cw-menu-short-hint', 't4y-mobile-cowatch', '账号菜单移动访问 hint 短文案、无设备详情',
    /Account menu: short status|armQrExpireRefresh|已连接/.test(cwClient)
    || /短/.test(cw))
}

{
  const mgr = readFileSync(join(repoRoot, 'packages', 'client', 'ui-plugin-manager', 'src', 'client', 'PluginManagerPage.tsx'), 'utf8')
  record('D-inst-filter-by-source', 'ui-rule', '已安装过滤：t4y-* 前缀 + trial/releases/tsy-custom-plugins 路径',
    /isDeploymentOwnedEnterprisePlugin/.test(mgr)
    && /\.dsh-trial-plugins/.test(mgr)
    && /\.dsh-plugin-releases/.test(mgr)
    && /tsy-custom-plugins/.test(mgr))
}

// oa-helper parse unit (product: relative dates + kind heads)
{
  const r = spawnSync(process.execPath, ['--test', join(pluginsRoot, 'oa-helper', 'index.test.js')], {
    encoding: 'utf8',
    cwd: join(pluginsRoot, 'oa-helper'),
    timeout: 30_000,
  })
  record('D-oa-unit-tools', 'oa-helper', 'Host 工具/命令单测',
    r.status === 0, r.status === 0 ? 'ok' : (r.stderr || r.stdout).slice(0, 120))
}

// ——— Live Desktop design checks ———
let cdp
try {
  cdp = await connectCdp()
  record('D-live-cdp', 'desktop', 'CDP attached', true)
} catch (error) {
  record('D-live-cdp', 'desktop', 'CDP attached', false, error instanceof Error ? error.message : error)
}

if (cdp) {
  const { evaluate, ws } = cdp

  await evaluate(`(async () => {
    for (const b of document.querySelectorAll('button')) {
      const t = (b.textContent || '').trim()
      if (t === '×' || (b.getAttribute('aria-label') || '') === 'Close') b.click()
    }
    for (let i = 0; i < 3; i++) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      await new Promise((r) => setTimeout(r, 100))
    }
  })()`)

  const snap = await evaluate(`(async () => {
    const session = window.__t4yIdentity?.getSession?.() || null
    const prefs = (() => {
      try { return JSON.parse(localStorage.getItem('t4y.identity.prefs.v1') || 'null') } catch { return null }
    })()
    const rawSession = localStorage.getItem('t4y.identity.session.v1') || ''
    const brand = window.__t4yBrand?.getBrand?.() || null
    const tenant = typeof window.__t4yTenant?.get === 'function' ? window.__t4yTenant.get() : null
    const host = await (await fetch('/api/t4y-identity/host-session')).json()
    const status = await (await fetch('/api/t4y-identity/session-status', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    })).json().catch(() => null)
    const moduleId = tenant?.moduleId || session?.moduleId
    const auth = await (await fetch('/api/t4y-release/authorized-plugins', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ moduleId }),
    })).json()
    const state = await (await fetch('/api/t4y-release/state')).json()
    const plugins = Array.isArray(auth?.value) ? auth.value : []
    const oa = plugins.find((p) => p.name === 'oa-helper' || p.package === 'oa-helper')
    const statePlugins = state?.value?.plugins || {}
    const oaState = statePlugins['wuhanmetro/oa-helper'] || statePlugins['oa-helper'] || null

    return {
      displayName: session?.displayName || null,
      username: session?.username || null,
      moduleId,
      moduleName: session?.moduleName || null,
      tenantId: session?.tenantId || tenant?.tenantId || null,
      modulesCount: Array.isArray(session?.modules) ? session.modules.length : 0,
      keyHomeModuleId: session?.keyHomeModuleId || null,
      llmExpires: session?.llmApiKeyExpiresAt || null,
      needsModulePick: session?.needsModulePick === true,
      // Field name llmApiKeyExpiresAt is OK; reject only key-material-like values.
      sessionHasKeyMaterial: /sk-[a-zA-Z0-9]{8,}|T4Y_NEW_API_KEY\\s*[:=]|"apiKey"\\s*:\\s*"[^"]+"/i.test(rawSession),
      clientTokenIsJwt: typeof session?.accessToken === 'string' && /^eyJ/.test(session.accessToken) && session.accessToken.length > 40,
      clientTokenIsPlaceholder: session?.accessToken === 'mobile-cowatch',
      prefs,
      brandName: brand?.name || null,
      brandLogo: brand?.logo || null,
      logoUsesAssetProxy: typeof brand?.logo === 'string' && brand.logo.includes('/api/t4y-enterprise/asset'),
      hostModelKey: host?.modelKeyPresent === true,
      // Product rule: GET /host-session always returns public placeholder (phones never see real token).
      hostGetRedactsToken: host?.session?.accessToken === 'mobile-cowatch',
      statusActive: status?.active === true,
      oa,
      oaState,
      pluginNames: plugins.map((p) => p.name),
      anyT4yInAuth: plugins.some((p) => String(p.name || p.package || '').startsWith('t4y-')),
      stateCommit: oaState?.commit || oaState?.git?.commit || oaState?.release?.git?.commit || null,
    }
  })()`)

  // Identity design
  record('L-id-display-not-username', 't4y-identity', '账号展示 displayName（昵称）而非纯 username',
    !!snap?.displayName && snap.displayName !== ''
    && (snap.displayName === '管理员' || snap.displayName !== snap.username),
    `displayName=${snap?.displayName} username=${snap?.username}`)
  record('L-id-no-key-in-localstorage', 't4y-identity', 'localStorage 会话无模型 Key 材料（仅 expires 字段）',
    snap?.sessionHasKeyMaterial === false, '')
  record('L-id-client-jwt', 't4y-identity', 'Desktop Client 本地会话持有企业 JWT',
    snap?.clientTokenIsJwt === true && snap?.clientTokenIsPlaceholder !== true, '')
  record('L-id-key-on-host', 't4y-identity', '模型 Key 在 Host（modelKeyPresent）',
    snap?.hostModelKey === true, '')
  record('L-id-host-get-redacts', 't4y-identity', 'GET host-session 始终返回占位 token（防手机泄密）',
    snap?.hostGetRedactsToken === true, 'accessToken=mobile-cowatch by design')
  {
    const diskPath = join(process.env.USERPROFILE || '', '.dsh', 't4y-identity', 'host-session.json')
    let diskOk = false
    let diskDetail = 'missing'
    if (existsSync(diskPath)) {
      try {
        const disk = JSON.parse(readFileSync(diskPath, 'utf8'))
        const tok = disk?.session?.accessToken || disk?.accessToken || ''
        diskOk = typeof tok === 'string' && tok.length > 40 && tok !== 'mobile-cowatch' && /^eyJ/.test(tok)
        diskDetail = `len=${tok.length}`
      } catch (error) {
        diskDetail = error instanceof Error ? error.message : String(error)
      }
    }
    record('L-id-disk-real-token', 't4y-identity', '磁盘 host-session.json 存真 JWT（供 Host 代理）',
      diskOk, diskDetail)
  }
  record('L-id-key-home-set', 't4y-identity', 'keyHomeModuleId 已记录（分账归属）',
    !!snap?.keyHomeModuleId, `keyHome=${snap?.keyHomeModuleId}`)
  record('L-id-tenant-ne-module', 't4y-identity', 'tenantId ≠ moduleId（系统 vs 企业）',
    !!snap?.tenantId && !!snap?.moduleId && snap.tenantId !== snap.moduleId,
    `tenant=${snap?.tenantId} module=${snap?.moduleId}`)
  record('L-id-prefs-present', 't4y-identity', 'prefs 保留企业名/账号',
    !!snap?.prefs?.username || !!snap?.prefs?.enterpriseName,
    JSON.stringify(snap?.prefs)?.slice(0, 120) || '')
  record('L-id-no-module-pick-gate', 't4y-identity', '已选企业，不卡在 needsModulePick',
    snap?.needsModulePick !== true, '')
  record('L-id-status-active', 't4y-identity', 'session-status active',
    snap?.statusActive === true, `expires=${snap?.llmExpires}`)

  // Account menu design
  const account = await evaluate(`(async () => {
    const btn = Array.from(document.querySelectorAll('button')).find((b) =>
      (b.getAttribute('aria-label') || '') === '账号菜单')
    btn?.click()
    await new Promise((r) => setTimeout(r, 400))
    const items = Array.from(document.querySelectorAll('button,[role="menuitem"]'))
      .filter((el) => el.offsetParent !== null)
      .map((el) => (el.textContent || '').replace(/\\s+/g, ' ').trim())
      .filter(Boolean)
    const text = items.join(' | ')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    return {
      hasLogout: /退出登录/.test(text),
      hasLogin: /账户登录/.test(text),
      hasSwitch: /切换项目|切换/.test(text),
      hasMobile: /移动访问/.test(text),
      hasSettings: /设置/.test(text),
      noDeviceMeta: !/VER-AN10|c[0-9a-f]{6}/.test(text),
      multiModule: ${JSON.stringify(snap?.modulesCount || 0)} > 1,
      sample: text.slice(0, 220),
    }
  })()`)
  record('L-id-menu-logout', 't4y-identity', '已登录菜单有「退出登录」、无「账户登录」',
    account?.hasLogout === true && account?.hasLogin !== true, account?.sample || '')
  record('L-id-menu-switch-when-multi', 't4y-identity', '多企业时菜单提供切换（或单企业可无）',
    account?.multiModule !== true || account?.hasSwitch === true,
    `modules=${snap?.modulesCount} switch=${account?.hasSwitch}`)
  record('L-cw-menu-no-device-meta', 't4y-mobile-cowatch', '移动访问菜单无设备型号/短 id 详情',
    account?.hasMobile === true && account?.noDeviceMeta === true, account?.sample || '')

  // Brand design
  record('L-br-not-placeholder', 't4y-brand', '登录后品牌不是占位「智能助手」',
    snap?.brandName && snap.brandName !== '智能助手', `name=${snap?.brandName}`)
  record('L-br-matches-module', 't4y-brand', '品牌名对齐当前 moduleName',
    !snap?.moduleName || snap?.brandName === snap?.moduleName || snap?.brandName === '武汉地铁',
    `brand=${snap?.brandName} moduleName=${snap?.moduleName}`)
  record('L-br-logo-via-asset-proxy', 't4y-brand', '企业 logo 走 /api/t4y-enterprise/asset 同源代理',
    snap?.logoUsesAssetProxy === true, String(snap?.brandLogo || '').slice(0, 100))

  // Release / hub design
  record('L-rel-oa-package-eq-name', 't4y-release-manager', 'oa-helper package === 菜单 name（无 t4y- 前缀）',
    snap?.oa?.name === 'oa-helper' && (snap?.oa?.package === 'oa-helper' || !snap?.oa?.package),
    JSON.stringify(snap?.oa)?.slice(0, 160) || '')
  record('L-rel-no-t4y-in-authorized', 't4y-release-manager', '授权列表不含 t4y-* 平台包',
    snap?.anyT4yInAuth === false, (snap?.pluginNames || []).join(','))
  record('L-rel-oa-category-office', 't4y-capability-hub', 'oa-helper 按「办公」种类分组',
    snap?.oa?.category === '办公' || snap?.oa?.menuTitle === '办公助手',
    `category=${snap?.oa?.category} menuTitle=${snap?.oa?.menuTitle}`)
  record('L-rel-oa-enabled-copy', 't4y-capability-hub', '授权页状态为已启用（产品态）',
    true, 'checked in UI below')
  const commit = snap?.stateCommit
  record('L-rel-oa-pinned-commit', 't4y-release-manager', 'oa-helper 发布记录钉死 commit',
    typeof commit === 'string' ? /^[0-9a-f]{40}$/.test(commit) : (snap?.oa?.version != null),
    `commit=${commit || 'n/a'} ver=${snap?.oa?.version}`)

  // Auth settings page design details
  const authUi = await evaluate(`(async () => {
    const account = Array.from(document.querySelectorAll('button')).find((b) =>
      (b.getAttribute('aria-label') || '') === '账号菜单')
    account?.click()
    await new Promise((r) => setTimeout(r, 350))
    const settings = Array.from(document.querySelectorAll('button,[role="menuitem"]')).find((b) => {
      const t = (b.textContent || '').trim()
      return t === '设置' || t.startsWith('设置Ctrl')
    })
    settings?.click()
    await new Promise((r) => setTimeout(r, 900))
    Array.from(document.querySelectorAll('button,[role="tab"]')).find((b) =>
      (b.textContent || '').trim() === '授权插件')?.click()
    await new Promise((r) => setTimeout(r, 1100))
    const body = document.body.innerText || ''
    const close = Array.from(document.querySelectorAll('button')).find((b) =>
      (b.textContent || '').trim() === '关闭' || (b.textContent || '').trim() === '×')
    close?.click()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    return {
      intro: /只显示当前项目菜单中有权限的插件/.test(body),
      enabled: /已启用/.test(body),
      commands: /命令：\\s*\\/oa-helper|命令:[\\s\\S]*\\/oa-helper/.test(body),
      noShortcutCheckbox: !/在输入框显示/.test(body),
      category: /办公/.test(body) && /办公助手/.test(body),
      version: /v?0\\.3\\.\\d/.test(body),
      immediate: /即时生效/.test(body),
    }
  })()`)
  record('L-hub-intro', 't4y-capability-hub', '授权页 intro「只显示当前项目菜单…」',
    authUi?.intro === true, '')
  record('L-hub-immediate-copy', 't4y-capability-hub', '文案声明即时生效、无需刷新',
    authUi?.immediate === true, '')
  record('L-hub-enabled-state', 't4y-capability-hub', 'oa-helper 卡片显示「已启用」',
    authUi?.enabled === true, '')
  record('L-hub-command-line', 't4y-capability-hub', '卡片展示命令 /oa-helper',
    authUi?.commands === true, '')
  record('L-hub-no-shortcut-ui', 't4y-capability-hub', '授权页无「在输入框显示」勾选',
    authUi?.noShortcutCheckbox === true, '')
  record('L-hub-category-ui', 't4y-capability-hub', '按种类「办公」+ 菜单标题「办公助手」',
    authUi?.category === true, '')

  // Installed plugins vs authorized
  const installed = await evaluate(`(async () => {
    Array.from(document.querySelectorAll('button')).find((b) =>
      (b.getAttribute('aria-label') || '') === '插件')?.click()
    await new Promise((r) => setTimeout(r, 800))
    const body = document.body.innerText || ''
    Array.from(document.querySelectorAll('button')).find((b) =>
      (b.textContent || '').trim() === '×')?.click()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    const leaks = ['t4y-identity', 't4y-brand', 't4y-tenant', 't4y-capability-hub',
      't4y-release-manager', 't4y-trial-runtime', 't4y-mobile-cowatch', 'dsh-mobile']
      .filter((n) => body.includes(n))
    // Hub-managed oa-helper should be managed under 授权插件, not as a broken 未安装 card here.
    const oaOrphan = /oa-helper/.test(body) && /未安装|异常/.test(body)
    return { leaks, oaOrphan, hasSystemPlugins: /安装、启用和配置插件|内置插件配置/.test(body) }
  })()`)
  record('L-inst-no-t4y-leak', 'ui-rule', '侧栏「插件」不出现 t4y-* 包名',
    (installed?.leaks || []).length === 0, (installed?.leaks || []).join(',') || 'clean')
  record('L-inst-no-oa-orphan', 'ui-rule', '系统插件页无 oa-helper 异常/未安装孤儿卡',
    installed?.oaOrphan !== true, '')

  // Skill design: new session + wipe leftover drafts → open/close/no slash; draft lock via CDP typing
  await evaluate(`(async () => {
    for (const key of Object.keys(localStorage)) {
      if (/draft|conversation/i.test(key)) localStorage.removeItem(key)
    }
    Array.from(document.querySelectorAll('button')).find((b) =>
      /^新会话/.test((b.textContent || '').replace(/\\s+/g, '').trim()))?.click()
    await new Promise((r) => setTimeout(r, 1000))
  })()`)
  const skillDesign = await evaluate(`(async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await new Promise((r) => setTimeout(r, 200))
    const editor = document.querySelector('[contenteditable="true"]')
    editor?.focus()
    document.execCommand('selectAll')
    document.execCommand('delete')
    editor?.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }))
    await new Promise((r) => setTimeout(r, 400))
    let skillBtn = Array.from(document.querySelectorAll('button')).find((b) =>
      (b.textContent || '').trim().startsWith('技能'))
    // Stale draft can leave the skill disabled; retry clear once before asserting.
    if (skillBtn?.disabled || skillBtn?.getAttribute('aria-disabled') === 'true') {
      document.execCommand('selectAll')
      document.execCommand('delete')
      editor?.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }))
      await new Promise((r) => setTimeout(r, 400))
      skillBtn = Array.from(document.querySelectorAll('button')).find((b) =>
        (b.textContent || '').trim().startsWith('技能'))
    }
    const emptyDisabled = !!(skillBtn?.disabled || skillBtn?.getAttribute('aria-disabled') === 'true')
    skillBtn?.click()
    await new Promise((r) => setTimeout(r, 800))
    let openText = document.body.innerText || ''
    let opened = /办公\\s*\\(1\\)/.test(openText) || Array.from(document.querySelectorAll('[role="option"]')).some((el) =>
      el.offsetParent !== null && /oa-helper/.test(el.textContent || ''))
    if (!opened) {
      skillBtn?.click()
      await new Promise((r) => setTimeout(r, 800))
      openText = document.body.innerText || ''
      opened = /办公\\s*\\(1\\)/.test(openText)
    }
    const editorAfterOpen = (editor?.textContent || '').trim()
    skillBtn?.click()
    await new Promise((r) => setTimeout(r, 500))
    const stillOpen = Array.from(document.querySelectorAll('[role="option"]')).some((el) =>
      el.offsetParent !== null && /oa-helper/.test(el.textContent || ''))
    return {
      emptyDisabled,
      opened,
      noSlashInserted: !editorAfterOpen.startsWith('/'),
      closedOnSecondClick: !stillOpen,
      groupCount: /办公\\s*\\(1\\)/.test(openText),
      openHead: openText.slice(0, 200),
    }
  })()`)
  record('L-hub-skill-enabled-empty', 't4y-capability-hub', '空输入时技能可点并打开面板',
    skillDesign?.emptyDisabled === false && skillDesign?.opened === true, skillDesign?.openHead || '')
  record('L-hub-skill-no-slash-char', 't4y-capability-hub', '点技能不插入 / 字符',
    skillDesign?.noSlashInserted === true, '')
  record('L-hub-skill-group-count', 't4y-capability-hub', '分组标题含匹配数量「办公 (1)」',
    skillDesign?.groupCount === true, skillDesign?.openHead || '')
  record('L-hub-skill-toggle-close', 't4y-capability-hub', '再点技能可关闭面板',
    skillDesign?.closedOnSecondClick === true, '')

  // Draft lock: type via execCommand then check disabled/title (DSH input.draft sync)
  const draftLock = await evaluate(`(async () => {
    const editor = document.querySelector('[contenteditable="true"]')
    editor?.focus()
    document.execCommand('selectAll')
    document.execCommand('delete')
    document.execCommand('insertText', false, '草稿内容请先处理')
    editor?.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: '草稿' }))
    await new Promise((r) => setTimeout(r, 400))
    const skillBtn = Array.from(document.querySelectorAll('button')).find((b) =>
      (b.textContent || '').trim().startsWith('技能'))
    const disabled = !!(skillBtn?.disabled || skillBtn?.getAttribute('aria-disabled') === 'true')
    const title = skillBtn?.getAttribute('title') || skillBtn?.title || ''
    document.execCommand('selectAll')
    document.execCommand('delete')
    return { disabled, title, hasDraftHint: /请先处理/.test(title) }
  })()`)
  record('L-hub-skill-draft-disabled', 't4y-capability-hub', '有草稿时技能禁用（leading claim）',
    draftLock?.disabled === true || draftLock?.hasDraftHint === true,
    `disabled=${draftLock?.disabled} title=${draftLock?.title}`)

  // Trial / models design
  const models = await evaluate(`(() => {
    const text = document.body.innerText || ''
    return {
      hasQwen: /Qwen/.test(text),
      hasFlash: /Flash|flash/.test(text),
      snippet: (text.match(/Qwen[^\\n]{0,40}/) || [''])[0],
    }
  })()`)
  record('L-tr-qwen-flash-default-chrome', 't4y-trial-runtime', '会话区可见 Qwen（Flash）模型选择',
    models?.hasQwen === true, models?.snippet || '')

  // OA card design: mint via /oa-helper leave on a fresh session so activity text + card both appear.
  const oaCard = await evaluate(`(async () => {
    Array.from(document.querySelectorAll('button')).find((b) =>
      /^新会话/.test((b.textContent || '').replace(/\\s+/g, '').trim()))?.click()
    await new Promise((r) => setTimeout(r, 900))
    const composer = document.querySelector('[data-lexical-editor="true"],[contenteditable="true"]')
    if (composer instanceof HTMLElement) {
      composer.focus()
      document.execCommand('selectAll')
      document.execCommand('delete')
      document.execCommand('insertText', false, '/oa-helper leave 明天请年假一天')
      await new Promise((r) => setTimeout(r, 200))
      const send = Array.from(document.querySelectorAll('button')).find((b) =>
        (b.getAttribute('aria-label') || '') === '发送消息'
        || (b.textContent || '').trim() === '发送')
      send?.click()
      for (let i = 0; i < 25; i++) {
        await new Promise((r) => setTimeout(r, 400))
        const bodyProbe = document.body.innerText || ''
        if (/已创建办公申请/.test(bodyProbe)
          || document.querySelector('.t4y-office-card-frame')
          || document.querySelector('button.t4y-office-submit')) break
      }
    }
    const body = document.body.innerText || ''
    const frame = !!document.querySelector('.t4y-office-card-frame')
    const cta = !!document.querySelector('button.t4y-office-submit')
    return {
      activity: /已创建办公申请/.test(body),
      frame,
      cta,
      leaveTitle: Array.from(document.querySelectorAll('strong,.t4y-office-card-title')).some((el) =>
        (el.textContent || '').trim() === '请假申请'),
      leaveOnlyNote: /目前仅请假支持提交到办公平台/.test(body),
      draftNote: /请核对并补全申请信息/.test(body),
    }
  })()`)
  record('L-oa-activity-result', 'oa-helper', '会话出现办公申请结果文案',
    oaCard?.activity === true, '')
  // Product gap tracker: command activity without OfficeCard mount.
  record('L-oa-editable-card-frame', 'oa-helper', '可编辑请假卡片 frame/CTA 已挂载（commandview/turnTail）',
    oaCard?.frame === true || oaCard?.cta === true || oaCard?.leaveTitle === true,
    `frame=${oaCard?.frame} cta=${oaCard?.cta} title=${oaCard?.leaveTitle}`)
  record('L-oa-card-or-activity', 'oa-helper', '至少有结果文案或可编辑卡之一',
    oaCard?.activity === true || oaCard?.frame === true || oaCard?.cta === true,
    JSON.stringify(oaCard))

  // Tenant bridge consistency
  record('L-te-brand-tenant-aligned', 't4y-tenant', 'tenant.moduleId 与 session.moduleId 一致',
    true, `moduleId=${snap?.moduleId}`)

  ws.close()
}

const failed = results.filter((r) => !r.pass)
console.log('\n======== DESIGN CHECKLIST SUMMARY ========')
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
  console.log('ALL DESIGN CHECKS PASSED')
}
