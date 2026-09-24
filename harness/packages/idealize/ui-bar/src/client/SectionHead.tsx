/**
 * Section heading shared by the drawer panes: title, an optional one-line
 * detail, an optional trailing action. Styled from the Brains pane's sheet so
 * every pane's sections read the same.
 */
import type { ReactNode } from 'react'
import css from './BrainsPanel.module.css'

export function SectionHead({ title, detail, action }: { title: string; detail?: string; action?: ReactNode }) {
  return (
    <div className={css.sectionHead}>
      <div>
        <div className={css.sectionTitle}>{title}</div>
        {detail !== undefined && <div className={css.sectionDetail}>{detail}</div>}
      </div>
      {action}
    </div>
  )
}
