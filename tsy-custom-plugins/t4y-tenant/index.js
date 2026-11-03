/**
 * Host half: system tenant id, current enterprise (moduleId), and Hub catalog URL.
 *
 * Domain model:
 * - `tenantId` — id of the whole deployed system (temporarily only one).
 * - `moduleId` — id of an enterprise (billing / workspace / menu scope).
 * - `catalogProjectId` — Hub `projectName` slug (plugin coordinates), not tenant/module.
 */
export const name = 't4y-tenant'

/**
 * @typedef {{
 *   defaultTenantId?: string,
 *   catalogProjectId?: string,
 *   catalogTenantId?: string,
 *   catalogUrl?: string,
 *   capabilityPluginIds?: string[],
 * }} TenantConfig
 *
 * `catalogTenantId` remains accepted as a deprecated alias of `catalogProjectId`.
 */

const DEFAULT_TENANT_ID = ''
const DEFAULT_CATALOG_PROJECT_ID = 'wuhanmetro'
const DEFAULT_CATALOG_URL = 'https://gitee.com/eureka96/tsy-dsh-plugins-hub/raw/master/wuhanmetro/catalog.json'

/** Owns the active system tenant + enterprise module for Host consumers. */
export class T4yTenant {
  /** @param {TenantConfig} config */
  constructor(config) {
    this.defaultTenantId = typeof config.defaultTenantId === 'string'
      ? config.defaultTenantId
      : DEFAULT_TENANT_ID
    this.catalogProjectId = typeof config.catalogProjectId === 'string' && config.catalogProjectId !== ''
      ? config.catalogProjectId
      : (typeof config.catalogTenantId === 'string' && config.catalogTenantId !== ''
        ? config.catalogTenantId
        : DEFAULT_CATALOG_PROJECT_ID)
    this.catalog = typeof config.catalogUrl === 'string' && config.catalogUrl !== '' ? config.catalogUrl : DEFAULT_CATALOG_URL
    this.capabilityPluginIds = Array.isArray(config.capabilityPluginIds)
      ? config.capabilityPluginIds.filter((id) => typeof id === 'string' && id !== '')
      : ['oa-helper']
    /** @type {string} */
    this.tenantId = this.defaultTenantId
    /** @type {string | null} */
    this.moduleId = null
    /** @type {Set<(tenantId: string, reason: string, moduleId: string | null) => void>} */
    this.listeners = new Set()
  }

  /** @returns {string} */
  getDefaultTenantId() {
    return this.defaultTenantId
  }

  /** System-wide tenant id (login `enterprise.id`); temporarily a singleton. */
  /** @returns {string} */
  getTenantId() {
    return this.tenantId
  }

  /** Hub catalog / projectName slug used by release-manager validation. */
  /** @returns {string} */
  getCatalogProjectId() {
    return this.catalogProjectId
  }

  /** @deprecated Prefer getCatalogProjectId. */
  getCatalogTenantId() {
    return this.getCatalogProjectId()
  }

  /** Current enterprise id (`moduleId`). */
  /** @returns {string | null} */
  getModuleId() {
    return this.moduleId
  }

  /** @returns {string} */
  catalogUrl() {
    return this.catalog
  }

  /** @returns {string[]} */
  getCapabilityPluginIds() {
    return [...this.capabilityPluginIds]
  }

  /**
   * @param {string | null} tenantId system tenant id
   * @param {string} reason
   * @param {string | null} [moduleId] enterprise id
   */
  setTenantId(tenantId, reason, moduleId) {
    const next = typeof tenantId === 'string' && tenantId !== '' ? tenantId : this.defaultTenantId
    if (next.includes('/') || next.includes('..')) throw new Error('Invalid tenantId')
    const nextModule = typeof moduleId === 'string' && moduleId !== '' ? moduleId : null
    if (next === this.tenantId && nextModule === this.moduleId) return
    this.tenantId = next
    this.moduleId = nextModule
    for (const listener of this.listeners) listener(next, reason, nextModule)
  }

  /**
   * @param {string | null} moduleId enterprise id
   * @param {string} reason
   */
  setModuleId(moduleId, reason) {
    this.setTenantId(this.tenantId, reason, moduleId)
  }

  /**
   * @param {(tenantId: string, reason: string, moduleId: string | null) => void} listener
   * @returns {() => void}
   */
  onChange(listener) {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
}

/**
 * @param {*} ctx
 * @param {TenantConfig} [config]
 */
export function apply(ctx, config = {}) {
  const tenant = new T4yTenant(config ?? {})
  ctx.provide('t4yTenant', tenant)
}
