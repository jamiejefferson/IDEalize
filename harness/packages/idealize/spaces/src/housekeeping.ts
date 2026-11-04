/**
 * Runs the blank-chat clean-up and the start-up tidy. Neither can stop the app
 * starting: a failure is logged and the files stay as they are.
 * @module @idealize/spaces/housekeeping
 */

import { realpath } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { setAsideBlankChats, type BlankChatStore } from './blank-chats.ts'
import { crashDumpFolder, tidyOnStart, type EveryFileReader } from './startup-tidy.ts'

/** How long after start-up the tidy waits, so reading every log never competes with opening the app. */
const TIDY_DELAY_MS = 120_000

/** The folder as the disk names it; an absent folder keeps its given name. */
async function canonical(path: string): Promise<string> {
  return await realpath(path).catch(() => resolve(path))
}

/**
 * Set blank chats aside once, then tidy old files well after start-up. Both act
 * only when the store's logs are this data folder's own. A store elsewhere, such
 * as a test's or a tool's, says nothing about what this data folder holds, and
 * its run must leave no record here.
 * @param ctx - the plugin context holding the session store.
 * @param home - the app's data folder.
 * @param tidyDelayMs - how long the tidy waits.
 */
export async function installHousekeeping(
  ctx: Context,
  home: string = resolveDshHome(),
  tidyDelayMs: number = TIDY_DELAY_MS,
): Promise<void> {
  const store = (ctx as unknown as { get(name: string): unknown }).get('sessionPersistence') as
    BlankChatStore & Partial<EveryFileReader> & { logsRoot?: string }
  if (store.logsRoot === undefined || await canonical(store.logsRoot) !== await canonical(join(home, 'sessions'))) return

  ctx.effect(() => {
    const timer = setTimeout(() => {
      tidyOnStart({
        home,
        store: typeof store.readEveryFile === 'function' ? store as EveryFileReader : undefined,
        crashDumps: crashDumpFolder(home),
        now: Date.now(),
      }).then((result) => {
        if (result?.uncertain !== undefined) ctx.logger.warn(`idealize-spaces: left old attachments alone: ${result.uncertain}`)
      }, (error: unknown) => { ctx.logger.warn(`idealize-spaces: the tidy did not finish: ${String(error)}`) })
    }, tidyDelayMs)
    timer.unref()
    return () => { clearTimeout(timer) }
  }, 'idealize-spaces: start-up tidy')

  await setAsideBlankChats({
    store,
    isLive: id => ctx.sessions.get(id) !== undefined,
    home,
    now: Date.now(),
    log: (message) => { ctx.logger.info(message) },
  }).catch((error: unknown) => { ctx.logger.warn(`idealize-spaces: blank chats stay for now: ${String(error)}`) })
}
