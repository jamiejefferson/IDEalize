import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { DesktopLayoutService } from './contracts.ts'

/**
 * Provide the desktop layout service for one plugin-fiber lifetime.
 * @param ctx - active browser Cordis context.
 * @param layout - desktop-owned layout implementation (the advanced layout state).
 * @returns disposer for the service registration.
 */
export function provideDesktopLayout(ctx: ClientContext, layout: DesktopLayoutService): () => void {
  const dispose = ctx.reflect.provide('layout', layout)
  return () => { void dispose() }
}
