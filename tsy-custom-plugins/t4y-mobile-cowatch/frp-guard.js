/**
 * Keep FRP free of orphan frpc that block dsh-mobile's FrpController.
 *
 * Official architecture: FrpController creates MobileAccessGateway, writes
 * frpc.toml localPort to that gateway port, then starts frpc. Pairing APIs
 * require remoteController().gateway().
 *
 * This guard must NEVER point frpc at setup.json upstream or spawn frpc itself —
 * that steals the proxy name, leaves gateway() undefined, and QR fails with
 * gateway_stopped. Soft-off / repair only kills owned orphans so reconnect can
 * own the slot again.
 */
import { access, readFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { homedir } from 'node:os'
import { join } from 'node:path'

const execFileAsync = promisify(execFile)

/**
 * @returns {string}
 */
export function dshHome() {
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv.trim()
  return join(homedir(), '.dsh')
}

/**
 * @returns {string}
 */
export function frpcTomlPath() {
  return join(dshHome(), 'mobile-access', 'remote', 'frp', 'config', 'frpc.toml')
}

/**
 * Shared across Web + Desktop Hosts on one machine.
 * @returns {string}
 */
export function acceptingStatePath() {
  return join(dshHome(), 'mobile-access', 't4y-accepting.json')
}

/** Match Host accepting heartbeat stale window. */
const ACCEPTING_HOLDER_STALE_MS = 45_000

/**
 * True when the shared accepting file says some Host still holds the FRP slot.
 * Soft-off on Desktop must not kill Web's frpc (same ~/.dsh/mobile-access tree).
 * @returns {Promise<boolean>}
 */
export async function sharedAcceptingAlive() {
  try {
    const parsed = JSON.parse(await readFile(acceptingStatePath(), 'utf8'))
    if (parsed?.accepting === false) return false
    const heartbeatAt = typeof parsed?.heartbeatAt === 'number' && Number.isFinite(parsed.heartbeatAt)
      ? parsed.heartbeatAt
      : (typeof parsed?.updatedAt === 'number' && Number.isFinite(parsed.updatedAt) ? parsed.updatedAt : 0)
    return Date.now() - heartbeatAt < ACCEPTING_HOLDER_STALE_MS
  } catch {
    return false
  }
}

/**
 * @param {string} text
 * @returns {number[]}
 */
function parsePids(text) {
  return String(text || '')
    .split(/\r?\n/u)
    .map((line) => Number(line.trim()))
    .filter((n) => Number.isInteger(n) && n > 0)
}

/**
 * @returns {Promise<number[]>}
 */
export async function listOwnedFrpcPids() {
  if (process.platform !== 'win32') {
    try {
      const { stdout } = await execFileAsync('pgrep', ['-f', 'mobile-access.*frpc|frpc.*mobile-access'], {
        timeout: 8_000,
        windowsHide: true,
      })
      return parsePids(stdout)
    } catch {
      return []
    }
  }
  const script = [
    "Get-CimInstance Win32_Process -Filter \"Name = 'frpc.exe'\"",
    "| Where-Object { $_.CommandLine -and ($_.CommandLine -match 'mobile-access') }",
    '| ForEach-Object { $_.ProcessId }',
  ].join(' ')
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { timeout: 15_000, windowsHide: true },
    )
    return parsePids(stdout)
  } catch {
    return []
  }
}

/**
 * @param {number[]} pids
 * @returns {Promise<void>}
 */
export async function killPids(pids) {
  const unique = [...new Set(pids)]
  for (const pid of unique) {
    try {
      if (process.platform === 'win32') {
        await execFileAsync('taskkill', ['/PID', String(pid), '/F', '/T'], {
          timeout: 10_000,
          windowsHide: true,
        })
      } else {
        process.kill(pid, 'SIGTERM')
      }
    } catch {
      // already gone
    }
  }
  if (unique.length === 0) return
  await new Promise((resolve) => setTimeout(resolve, 400))
  for (const pid of await listOwnedFrpcPids()) {
    try {
      if (process.platform === 'win32') {
        await execFileAsync('taskkill', ['/PID', String(pid), '/F', '/T'], {
          timeout: 10_000,
          windowsHide: true,
        })
      } else {
        process.kill(pid, 'SIGKILL')
      }
    } catch {
      // ignore
    }
  }
}

/**
 * @param {string} origin
 * @returns {number | null}
 */
export function localPortFromUpstreamOrigin(origin) {
  if (typeof origin !== 'string' || origin.trim() === '') return null
  try {
    const url = new URL(origin)
    if (url.port) return Number(url.port)
    if (url.protocol === 'https:') return 443
    if (url.protocol === 'http:') return 80
  } catch {
    return null
  }
  return null
}

/**
 * @param {{ accepting: boolean, clearForReconnect?: boolean }} options
 * @returns {Promise<{
 *   healthy: boolean,
 *   repaired: boolean,
 *   needReconnect: boolean,
 *   accepting: boolean,
 *   tomlPresent: boolean,
 *   frpcPids: number[],
 *   detail?: string,
 * }>}
 */
export async function ensureFrpRuntimeGuard(options) {
  const accepting = options.accepting === true
  const clearForReconnect = options.clearForReconnect === true
  let pids = await listOwnedFrpcPids()
  let repaired = false
  let tomlPresent = false
  try {
    await access(frpcTomlPath())
    tomlPresent = true
  } catch {
    tomlPresent = false
  }

  if (!accepting) {
    // Another Host (usually Web vs Desktop) still owns the shared slot — do not kill its frpc.
    if (await sharedAcceptingAlive()) {
      return {
        healthy: true,
        repaired: false,
        needReconnect: false,
        accepting: false,
        tomlPresent,
        frpcPids: pids,
        detail: 'deferred_kill_shared_holder_active',
      }
    }
    if (pids.length > 0) {
      await killPids(pids)
      repaired = true
      pids = []
    }
    return {
      healthy: true,
      repaired,
      needReconnect: false,
      accepting: false,
      tomlPresent,
      frpcPids: pids,
      detail: repaired ? 'stopped_orphans_while_soft_off' : undefined,
    }
  }

  // QR / ensure path: free the proxy name so FrpController can start gateway+frpc.
  if (clearForReconnect || pids.length > 1 || (pids.length >= 1 && !tomlPresent)) {
    if (pids.length > 0) {
      await killPids(pids)
      repaired = true
      pids = []
    }
    return {
      healthy: false,
      repaired,
      needReconnect: true,
      accepting: true,
      tomlPresent,
      frpcPids: pids,
      detail: clearForReconnect
        ? 'cleared_for_official_reconnect'
        : (!tomlPresent ? 'toml_missing_killed_orphans' : 'multiple_frpc_killed'),
    }
  }

  if (pids.length === 0 || !tomlPresent) {
    return {
      healthy: false,
      repaired: false,
      needReconnect: true,
      accepting: true,
      tomlPresent,
      frpcPids: pids,
      detail: pids.length === 0 ? 'frpc_missing' : 'toml_missing',
    }
  }

  // One frpc + toml: process looks occupied. Caller still must verify
  // dsh-mobile remote state === ready (gateway() present) before pairing.
  let tomlLocalPort = null
  try {
    const text = await readFile(frpcTomlPath(), 'utf8')
    const match = text.match(/localPort\s*=\s*(\d+)/u)
    if (match) tomlLocalPort = Number(match[1])
  } catch {
    // ignore
  }

  return {
    healthy: true,
    repaired: false,
    needReconnect: false,
    accepting: true,
    tomlPresent: true,
    frpcPids: pids,
    detail: tomlLocalPort === null ? 'frpc_running' : `frpc_running_localPort_${tomlLocalPort}`,
  }
}
