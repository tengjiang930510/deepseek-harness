/** Running-status brand mark (Wuhan Metro) for the Chat status row. */
import css from './ChatView.module.css'
import { RUNNING_BRAND_MARK_SRC } from './running-brand-data.ts'

/**
 * Render the decorative running icon beside the processing label.
 * @returns Wuhan Metro mark sized to the status row.
 */
export function RunningWhaleTail() {
  return (
    <span className={css.runningIcon} aria-hidden="true">
      <img className={css.runningBrandMark} src={RUNNING_BRAND_MARK_SRC} alt="" draggable={false} />
    </span>
  )
}
