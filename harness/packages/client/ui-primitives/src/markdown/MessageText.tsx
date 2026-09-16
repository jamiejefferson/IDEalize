// MessageText is the literal-text primitive for user and steering content; assistant output uses MarkdownText.

import css from './MessageText.module.css'

export function MessageText({ text }: { text: string }) {
  // data-message-text: stable hook for the appearance panel's line-spacing
  // rule (the hashed module class offers no external handle).
  return <div className={css.text} data-message-text="">{text}</div>
}
