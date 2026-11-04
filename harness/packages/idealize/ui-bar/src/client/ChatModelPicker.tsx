/**
 * The model browser for a chat, opened from the composer's brain chip (Paper
 * "Brains rethink", board 09). The browser itself is unchanged: this reads the
 * catalogue the Brains sheet reads and hands it over. It lists only routes the
 * person has connected, because a choice here takes effect on the next reply
 * and a model with no account behind it would fail that reply.
 * @module @idealize/ui-bar/client/ChatModelPicker
 */

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { providerDisplayName } from './format.ts'
import type { ChatModelDetail, BrowserModel, RatingMap, Translate } from './model-browser.ts'
import { chatModel } from './model-browser.ts'
import { ModelBrowser } from './ModelBrowser.tsx'

/** What the chip asks for (restated; `@idealize/activity-pills` owns the type). */
export interface ChatModelRequest {
  brainName: string
  current: { provider: string; model: string } | null
  onApply: (model: { provider: string; model: string }) => void
  onClose: () => void
}

const HEADERS = { 'x-idealize-auth': '1', 'content-type': 'application/json' }

/**
 * Read a route's JSON, or null when it fails.
 * @param url - the route.
 * @returns the body, or null.
 */
async function read<T>(url: string): Promise<T | null> {
  const response = await fetch(url).catch(() => undefined)
  return response?.ok === true ? await response.json() as T : null
}

/**
 * The chip's model browser.
 * @param props.request - the chip's request.
 * @param props.t - the bar's translator.
 * @returns the browser, portalled over the window.
 */
export function ChatModelPicker({ request, t }: { request: ChatModelRequest; t: Translate }): ReactNode {
  const [models, setModels] = useState<readonly BrowserModel[] | null>(null)
  const [ratings, setRatings] = useState<RatingMap | undefined>(undefined)

  useEffect(() => {
    let live = true
    void Promise.all([
      read<{ providers: { provider: string; displayName: string; auth: string; connected: boolean; models: string[] }[] }>('/idealize/models/state'),
      read<{ providers: { provider: string; models: ChatModelDetail[] }[] }>('/idealize/models/details'),
      read<{ models: RatingMap }>('/idealize/router/ratings'),
    ]).then(([state, details, rated]) => {
      if (!live) return
      if (rated !== null) setRatings(rated.models)
      setModels((state?.providers ?? [])
        .filter(row => row.models.length > 0 && (row.connected || row.auth === 'free'))
        .flatMap((row) => {
          const label = providerDisplayName(row.provider, row.displayName)
          const described = details?.providers.find(entry => entry.provider === row.provider)?.models
          return row.models.map(id =>
            chatModel(row.provider, label, described?.find(entry => entry.id === id) ?? { id, name: id }, t, label))
        }))
    })
    return () => { live = false }
  }, [t])

  const rate = async (model: BrowserModel, tag: string, stars: number | null): Promise<void> => {
    const response = await fetch('/idealize/router/ratings', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ kind: model.makes, provider: model.provider, model: model.id, tag, stars, label: model.name }),
    }).catch(() => undefined)
    if (response?.ok === true) setRatings((await response.json() as { models: RatingMap }).models)
  }

  return (
    <ModelBrowser
      kind="chat"
      spaceLabel={request.brainName}
      models={models}
      current={request.current === null ? '' : `${request.current.provider} ${request.current.model}`}
      allowDefault={false}
      t={t}
      ratings={ratings}
      onRate={(model, tag, stars) => { void rate(model, tag, stars) }}
      onClose={request.onClose}
      onApply={(value) => {
        const split = value.indexOf(' ')
        if (split < 0) {
          request.onClose()
          return
        }
        request.onApply({ provider: value.slice(0, split), model: value.slice(split + 1) })
      }}
    />
  )
}
