/** Windows caption menu labels and native popup anchors, isolated from the Web client. */

/**
 * Caption menubar (应用 / 编辑) is disabled for this product build.
 * @returns No-op language refresh and teardown operations.
 */
export function installWindowsMenu(): { update(): void; dispose(): void } {
  return {
    update() {},
    dispose() {},
  }
}
