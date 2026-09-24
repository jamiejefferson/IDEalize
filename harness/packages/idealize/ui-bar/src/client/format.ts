/**
 * Figures as the drawer panes print them: token counts, money, instants and
 * working time. One place, so the Brains pane and the Time & cost pane print
 * the same number the same way.
 */

/** A token count, compact: `1.5k`, `2.4M`, or the number under a thousand. */
export function tokens(value: number): string {
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}k`
  return String(value)
}

/** A cost in the viewer's locale; the currency code is host-validated ISO 4217 shaped, which Intl always formats. */
export function money(value: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value)
}

/** An instant as a short day-and-time in the viewer's locale ("8 Sept, 10:12"). */
export function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

/**
 * What a provider route is called, everywhere in the panes: the name its
 * directory gave it when that is a name, else its id with a capital. The
 * host already resolves catalogue routes through the services directory
 * (openai → OpenAI); this is the last resort for a route no table knows.
 * @param provider - the route id.
 * @param displayName - the name the state payload carries, when it does.
 * @returns the name to show.
 */
export function providerDisplayName(provider: string, displayName?: string): string {
  if (displayName !== undefined && displayName.trim() !== '' && displayName !== provider) return displayName
  return `${provider.charAt(0).toUpperCase()}${provider.slice(1)}`
}

/**
 * Working time in whole minutes: `0m`, `45m`, `3h 05m`. Seconds never show,
 * because a figure that ticks reads as a stopwatch rather than a total.
 * @param seconds - the duration.
 * @returns the text.
 */
export function duration(seconds: number): string {
  const minutes = Math.round(Math.max(0, seconds) / 60)
  const hours = Math.floor(minutes / 60)
  if (hours === 0) return `${String(minutes)}m`
  return `${String(hours)}h ${String(minutes % 60).padStart(2, '0')}m`
}
