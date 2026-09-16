/** V0's announcement banner: a dismissible strip pinned above the columns. */
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { Announcement } from '../announcement.ts'
import css from './AnnouncementBanner.module.css'

/** Registration-side face. */
export interface AnnouncementBannerInjected {
  hooks: {
    /** The announcement to show right now, or undefined (nothing new / already seen). */
    announcement: SnapshotStore<Announcement | undefined>
  }
  /** Dismiss the current banner and remember its id so it never reappears. */
  dismiss: () => void
  /** Open the announcement's call-to-action link. */
  openLink: (url: string) => void
}

/** Full slot props. */
export type AnnouncementBannerProps =
  PropsRuntime<'shell.banner'>
  & PropsLocale<'idealize-notify'>
  & InjectFace<AnnouncementBannerInjected>

function Sparkles(props: { className: string | undefined }) {
  return (
    <svg className={props.className} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 1.5 9.6 6.4 14.5 8l-4.9 1.6L8 14.5 6.4 9.6 1.5 8l4.9-1.6Z" />
      <path d="M13 1.5l.6 1.4 1.4.6-1.4.6L13 5.5l-.6-1.4-1.4-.6 1.4-.6Z" opacity=".7" />
    </svg>
  )
}

/**
 * Render the banner when an announcement is current; nothing otherwise.
 * @param props - composed slot props.
 */
export function AnnouncementBanner({ useAnnouncement, dismiss, openLink, t }: AnnouncementBannerProps) {
  const announcement = useAnnouncement(value => value)
  if (announcement === undefined) return null
  return (
    <div className={css.banner} role="status" data-announcement-id={announcement.id}>
      <Sparkles className={css.spark} />
      <div className={css.text}>
        <div className={css.title}>{announcement.title}</div>
        <div className={css.body}>{announcement.body}</div>
      </div>
      {announcement.ctaLabel !== undefined && announcement.ctaUrl !== undefined && (
        <button type="button" className={css.cta} onClick={() => { openLink(announcement.ctaUrl as string) }}>
          {announcement.ctaLabel}
        </button>
      )}
      <button
        type="button"
        className={css.dismiss}
        onClick={dismiss}
        aria-label={t('banner.dismiss')}
        title={t('banner.dismiss.help')}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" />
        </svg>
      </button>
    </div>
  )
}
