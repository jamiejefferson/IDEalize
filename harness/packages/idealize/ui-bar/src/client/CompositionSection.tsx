/**
 * The Composition tab of the Service hatch drawer pane: the @idealize/hatch
 * host page (what the app is made of, edits with snapshots and rollback)
 * hosted in an iframe beside the Service chat.
 */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import css from './CompositionSection.module.css'

export type CompositionSectionProps = PropsLocale<'idealize-bar'>

/**
 * Render the hatch page in a pane-filling frame.
 * @param props - composed slot props.
 * @returns the iframe wrapper.
 */
export function CompositionSection({ t }: CompositionSectionProps) {
  return (
    <div className={css.root}>
      <iframe className={css.frame} src="/idealize/hatch" title={t('composition.nav')} />
    </div>
  )
}
