#!/usr/bin/env node
/**
 * Read the authenticated menu and an optional form's data without changing the enterprise system.
 *
 * Required environment: ENTERPRISE_NAME, ENTERPRISE_USER, ENTERPRISE_PASSWORD, T4Y_MODULE_ID.
 * Optional environment: T4Y_FORM_ID and T4Y_API_BASE.
 */
import { constants, publicEncrypt } from 'node:crypto'

const apiBase = (process.env.T4Y_API_BASE || 'https://jgyw.crfsdi.com.cn:51111/backendapi').replace(/\/$/, '')
const enterpriseName = process.env.ENTERPRISE_NAME || ''
const userName = process.env.ENTERPRISE_USER || ''
const password = process.env.ENTERPRISE_PASSWORD || ''
const moduleId = process.env.T4Y_MODULE_ID || ''
const formId = process.env.T4Y_FORM_ID || ''

function fail(message) {
  console.error(`ERROR ${message}`)
  process.exitCode = 1
}

function requireValue(value, name) {
  if (value !== '') return value
  throw new Error(`${name} is required`)
}

async function request(path, options = {}) {
  let response
  try {
    response = await fetch(`${apiBase}${path}`, {
      ...options,
      headers: {
        Accept: 'application/json, text/plain, */*',
        browser: 'Safari',
        'operating-system': 'Mac/iOS',
        'operator-type': 'PC',
        ...(options.headers || {}),
      },
      signal: AbortSignal.timeout(15_000),
    })
  } catch (error) {
    throw new Error(`Request to ${path} failed: ${error instanceof Error ? error.message : String(error)}`)
  }
  let payload
  try {
    payload = await response.json()
  } catch {
    throw new Error(`Request to ${path} returned non-JSON HTTP ${response.status}`)
  }
  if (!response.ok || payload?.code !== 200) {
    const message = typeof payload?.msg === 'string' ? payload.msg : `HTTP ${response.status}`
    throw new Error(`Request to ${path} was rejected: ${message}`)
  }
  return payload.data
}

function rsaEncryptPkcs1(publicKey, plaintext) {
  const pem = `-----BEGIN PUBLIC KEY-----\n${publicKey}\n-----END PUBLIC KEY-----\n`
  return publicEncrypt({ key: pem, padding: constants.RSA_PKCS1_PADDING }, Buffer.from(plaintext, 'utf8')).toString('base64')
}

async function login() {
  const publicKey = await request('/auth/publicKey')
  if (typeof publicKey?.publicKey !== 'string' || publicKey.publicKey === '') {
    throw new Error('Public-key response did not include publicKey')
  }
  const encryptedPassword = rsaEncryptPkcs1(publicKey.publicKey, password)
  const session = await request('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enterpriseName, userName, password: encryptedPassword }),
  })
  if (typeof session?.access_token !== 'string' || session.access_token === '') {
    throw new Error('Login response did not include access_token')
  }
  return session.access_token
}

function findFormMenu(value, targetId) {
  if (!value || typeof value !== 'object') return undefined
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findFormMenu(item, targetId)
      if (found !== undefined) return found
    }
    return undefined
  }
  if (value.formId === targetId || value.id === targetId) return value
  for (const item of Object.values(value)) {
    const found = findFormMenu(item, targetId)
    if (found !== undefined) return found
  }
  return undefined
}

function menuSummary(menu) {
  if (Array.isArray(menu)) return { topLevelCount: menu.length }
  return { topLevelType: typeof menu }
}

function pluginCoordinates(records) {
  if (!records || typeof records !== 'object' || !Array.isArray(records.fields) || !Array.isArray(records.items)) {
    throw new Error(`fieldQuery for form ${formId} returned an unexpected response`)
  }
  const fieldIdByTitle = new Map(
    records.fields
      .filter((field) => field && typeof field.title === 'string' && typeof field.id === 'string')
      .map((field) => [field.title, field.id]),
  )
  const nameFieldId = fieldIdByTitle.get('插件名')
  const projectNameFieldId = fieldIdByTitle.get('项目名')
  if (nameFieldId === undefined || projectNameFieldId === undefined) {
    throw new Error(`Form ${formId} must contain fields titled 插件名 and 项目名`)
  }
  return records.items.map((item) => ({ name: item[nameFieldId], projectName: item[projectNameFieldId] }))
}

async function main() {
  requireValue(enterpriseName, 'ENTERPRISE_NAME')
  requireValue(userName, 'ENTERPRISE_USER')
  requireValue(password, 'ENTERPRISE_PASSWORD')
  requireValue(moduleId, 'T4Y_MODULE_ID')

  const accessToken = await login()
  const authorization = { Authorization: accessToken, 'module-id': moduleId }
  const menu = await request(`/system/menu/getMultiRoutersNew/${encodeURIComponent(moduleId)}?clientType=0`, {
    headers: authorization,
  })
  console.log(JSON.stringify({ menu: menuSummary(menu), moduleId }, null, 2))

  if (formId === '') return
  const menuNode = findFormMenu(menu, formId)
  console.log(JSON.stringify({ formId, menuNodeFound: menuNode !== undefined, menuNode }, null, 2))
  if (menuNode === undefined) return

  const menuId = typeof menuNode.id === 'string' ? menuNode.id : ''
  if (menuId === '') throw new Error(`Menu node for form ${formId} did not include an id`)
  const records = await request(`/form/${encodeURIComponent(moduleId)}/data/fieldQuery`, {
    method: 'POST',
    headers: { ...authorization, 'menu-id': menuId, 'form-id': formId, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      formId,
      queryCondition: [],
    }),
  })
  console.log(JSON.stringify({ formId, menuId, total: records.total, plugins: pluginCoordinates(records) }, null, 2))
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)))
