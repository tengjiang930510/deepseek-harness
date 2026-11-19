/**
 * Shared Desktop enterprise plugin list and pinned dsh-mobile version.
 * Used by sync-desktop-plugins and stage-desktop-trial-plugins.
 */

/** Tree-local t4y packages (link: for sync, copied for trial stage). */
export const T4Y_PLUGIN_NAMES = [
  't4y-tenant',
  't4y-identity',
  't4y-capability-hub',
  't4y-brand',
  't4y-release-manager',
  't4y-trial-runtime',
  't4y-mobile-cowatch',
]

/** Pinned npm version for the mobile channel; sync and trial stage must match. */
export const DSH_MOBILE_SPEC = '0.8.2'

/** Installer / profile bundle order: mobile channel first, then t4y platform. */
export const ENTERPRISE_BUNDLE_NAMES = ['dsh-mobile', ...T4Y_PLUGIN_NAMES]
