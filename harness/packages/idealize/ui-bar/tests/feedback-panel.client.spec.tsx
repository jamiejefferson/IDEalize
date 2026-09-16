// @vitest-environment jsdom
// The Feedback pane over a stubbed submit route: the happy path clears the
// form, an upstream failure says the report is kept locally, and a refused
// submit shows its reason — the iframe page's silent 502 path made visible.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { FeedbackPanel } from '../src/client/FeedbackPanel.tsx'
import { en } from '../src/client/locales.ts'

const t = makeTranslate(en, commonEn)

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

interface RecordedCall {
  url: string
  init?: { method?: string; headers?: Record<string, string>; body?: string }
}

function stubSubmit(status: number, body: unknown) {
  const calls: RecordedCall[] = []
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RecordedCall['init']) => {
    calls.push({ url, ...init === undefined ? {} : { init } })
    return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }))
  }))
  return calls
}

describe('FeedbackPanel', () => {
  it('posts the trimmed text and type with the auth marker, clears the form, and raises the done notification', async () => {
    const calls = stubSubmit(200, { ok: true })
    const notifyDone = vi.fn()
    const view = render(<FeedbackPanel t={t} notifyDone={notifyDone} />)
    fireEvent.change(view.getByLabelText('Feedback type'), { target: { value: 'bug' } })
    fireEvent.change(view.getByLabelText('Feedback text'), { target: { value: '  The owl blinked twice.  ' } })
    fireEvent.click(view.getByRole('button', { name: 'Send' }))
    await waitFor(() => { expect(view.getByText('Sent. Thank you.')).toBeTruthy() })
    expect(notifyDone).toHaveBeenCalledWith('Feedback sent', 'Your report is with JJ. Thank you.')
    const call = calls[0]
    expect(call?.url).toBe('/idealize/feedback/submit')
    expect(call?.init?.headers).toMatchObject({ 'x-idealize-auth': '1' })
    expect(JSON.parse(call?.init?.body ?? '{}')).toEqual({ text: 'The owl blinked twice.', feedbackType: 'bug' })
    expect((view.getByLabelText('Feedback text') as HTMLTextAreaElement).value).toBe('')
  })

  it('refuses an empty submit without a request', () => {
    const calls = stubSubmit(200, { ok: true })
    const view = render(<FeedbackPanel t={t} notifyDone={vi.fn()} />)
    fireEvent.click(view.getByRole('button', { name: 'Send' }))
    expect(view.getByText('Write something first.')).toBeTruthy()
    expect(calls.length).toBe(0)
  })

  it('surfaces an upstream failure, says the report is kept locally, and raises no notification', async () => {
    stubSubmit(502, { error: 'supabase returned HTTP 500', backedUpLocally: true })
    const notifyDone = vi.fn()
    const view = render(<FeedbackPanel t={t} notifyDone={notifyDone} />)
    fireEvent.change(view.getByLabelText('Feedback text'), { target: { value: 'Lost in the post.' } })
    fireEvent.click(view.getByRole('button', { name: 'Send' }))
    await waitFor(() => {
      expect(view.getByText(/kept on this Mac/)).toBeTruthy()
    })
    expect(notifyDone).not.toHaveBeenCalled()
    expect(view.getByText(/supabase returned HTTP 500/)).toBeTruthy()
    // The text stays for a retry.
    expect((view.getByLabelText('Feedback text') as HTMLTextAreaElement).value).toBe('Lost in the post.')
  })

  it('shows the reason for a refused submit', async () => {
    stubSubmit(400, { error: 'text is required' })
    const view = render(<FeedbackPanel t={t} notifyDone={vi.fn()} />)
    fireEvent.change(view.getByLabelText('Feedback text'), { target: { value: 'x' } })
    fireEvent.click(view.getByRole('button', { name: 'Send' }))
    await waitFor(() => { expect(view.getByText(/Couldn’t send: text is required/)).toBeTruthy() })
  })
})
