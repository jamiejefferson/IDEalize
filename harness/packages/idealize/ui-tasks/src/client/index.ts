/**
 * The task column, browser half. Fills the frame's `shell.aside` seat — the
 * full-height column immediately left of the tool rail — with the current
 * chat's task list.
 *
 * JJ, 24 Aug 2026: a chat working through several tasks should show the
 * agent's list as a column beside the work. The list itself is the `todos`
 * projection the harness computes from `todo_write`, so nothing here is
 * fetched or stored. The column is the one place the list shows: the
 * composer's own plan strip (ui-conversation's `TodoPanel`, the dock entry
 * `todo`) is shadowed with an empty occupant, since the same list twice on
 * one screen reads as two lists (JJ, 8 Sep 2026: "we seem to have two of them").
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the ui-layout SlotMap merge (the shell.aside seat).
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: the ui-conversation SlotMap merge (the input dock the plan strip rides).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { TaskAside } from './TaskColumn.tsx'
import { en, NS, zh } from './locales.ts'
import type { TasksKey } from './locales.ts'

export { TaskColumn, TaskAside } from './TaskColumn.tsx'
export type { TaskColumnProps, TaskAsideProps } from './TaskColumn.tsx'
export type { TasksKey, Translate } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The task column's copy. */
    'idealize-tasks': TasksKey
  }
}

/** Required services: the slot registry and copy. */
export const inject = ['slots', 'locale']

/**
 * Mount the task column.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'idealize-tasks: dictionaries')
  ctx.slots.inject('shell.aside', () => ctx.slots.register({
    name: 'shell.aside',
    locale: NS,
  }, TaskAside))
  // Same cell as ui-conversation's plan strip (list id `todo`), lower priority
  // renders: the column carries the list, the composer carries nothing.
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'todo',
    order: 0,
    priority: -1,
  }, NoPlanStrip))
}

/** The empty occupant shadowing the composer's plan strip. */
function NoPlanStrip(): null {
  return null
}
