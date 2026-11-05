import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  ENTERPRISE_ASSET_PATH,
  enterpriseAssetProxyPath,
  isAllowedEnterpriseGatewayHost,
  parseAllowedEnterpriseUrl,
  resolveEnterpriseAccessToken,
  resolveEnterpriseProxyTarget,
} from './enterprise-access.js'

describe('enterprise-access (方案 B)', () => {
  it('allowlists only enterprise gateway hosts', () => {
    assert.equal(isAllowedEnterpriseGatewayHost('eims.crfsdi.com.cn'), true)
    assert.equal(isAllowedEnterpriseGatewayHost('jgyw.crfsdi.com.cn'), true)
    assert.equal(isAllowedEnterpriseGatewayHost('evil.example'), false)
  })

  it('builds 方案 B asset proxy paths', () => {
    const absolute = 'https://eims.crfsdi.com.cn:59111/a/b.png'
    assert.equal(
      enterpriseAssetProxyPath(absolute),
      `${ENTERPRISE_ASSET_PATH}?url=${encodeURIComponent(absolute)}`,
    )
    assert.equal(enterpriseAssetProxyPath('https://evil.example/x'), null)
    assert.equal(parseAllowedEnterpriseUrl('ftp://eims.crfsdi.com.cn/x'), null)
  })

  it('resolves relative API paths against apiBaseUrl', () => {
    const base = 'https://jgyw.crfsdi.com.cn:51111/backendapi'
    const ok = resolveEnterpriseProxyTarget({ path: '/system/user/getInfo' }, base)
    assert.equal(ok.ok, true)
    assert.equal(ok.target.href, 'https://jgyw.crfsdi.com.cn:51111/backendapi/system/user/getInfo')
    assert.equal(resolveEnterpriseProxyTarget({ path: '../etc/passwd' }, base).ok, false)
    assert.equal(resolveEnterpriseProxyTarget({ url: 'https://evil.example/x' }, base).error, 'host_not_allowed')
  })

  it('prefers X-T4Y header over host-session when present', async () => {
    const request = {
      headers: {
        get(name) {
          return name === 'x-t4y-access-token' ? 'header-token' : null
        },
      },
    }
    assert.equal(await resolveEnterpriseAccessToken(request), 'header-token')
  })
})
