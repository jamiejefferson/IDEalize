/**
 * An image in markdown that lives on someone else's server. Fetching it tells
 * that server the address, and an agent that has read hostile text can put
 * anything in that address, chat contents included. So it loads when the person
 * clicks, and the button says which server it would ask.
 */

import { useState } from 'react'
import css from './MarkdownText.module.css'

/** Images the person has already chosen to load on this page, so a re-render does not ask again. */
const chosen = new Set<string>()

/**
 * @param props.src - the absolute http(s) address.
 * @param props.alt - the image's description.
 * @param props.label - the button's words, with `{host}` for the server.
 * @returns the button, or the image once it has been asked for.
 */
export function RemoteImage({ src, alt, label }: { src: string; alt: string; label?: string | undefined }) {
  const [load, setLoad] = useState(() => chosen.has(src))
  if (load) {
    return (
      <img
        className={css.image}
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
      />
    )
  }
  const words = (label ?? 'Load image from {host}').replace('{host}', new URL(src).host)
  return (
    <button
      type="button"
      className={css.remoteImage}
      data-remote-image={src}
      title={src}
      onClick={() => {
        chosen.add(src)
        setLoad(true)
      }}
    >
      {alt === '' ? words : `${alt} · ${words}`}
    </button>
  )
}
