// @vitest-environment jsdom
/**
 * Composition: apply provides `ctx.idealizeBar`, whose closures drive the
 * same pane state the rail's own entries write — the drawer pane and column,
 * the deck file and column, and the appearance service's open flag — and the
 * service leaves with its fiber.
 */
import { describe, expect, it, vi } from 'vitest'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject } from '../src/client/index.ts'
import { bench, declareRoot } from './apply-bench.client.ts'

usePinnedBrowserLanguages('en')

describe('ui-bar apply', () => {
  it('declares the services it uses', () => {
    expect(inject).toEqual([
      'slots', 'locale', 'layout', 'sessions', 'workspaces',
      'modelsSettingsSection', 'trajectorySection', 'scheduleSection', 'studioSection', 'appearance', 'conversation', 'connection',
      'remote', 'remote.commands',
    ])
  })

  it('provides ctx.idealizeBar and seats the rail, drawer and deck', async () => {
    const { ctx, slots } = await bench()
    declareRoot(slots)

    await ctx.plugin({ inject: [...inject], apply }).await()

    expect(ctx.idealizeBar).toBeDefined()
    expect(slots.entries('shell.rail')).toHaveLength(1)
    expect(slots.entries('shell.drawer')).toHaveLength(1)
    expect(slots.entries('shell.deck')).toHaveLength(1)
  })

  it('pins the locale to English and empties the Language row and the DeepSeek onboarding entry', async () => {
    const { ctx, slots } = await bench()
    declareRoot(slots)

    await ctx.plugin({ inject: [...inject], apply }).await()

    expect(ctx.locale.getLocale().active).toBe('en')
    ctx.locale.setLocale('zh')
    expect(ctx.locale.getLocale().active).toBe('en')
    expect(slots.entries('settings.general.item').map(entry => [entry.options.id, entry.options.priority])).toEqual([['language', -1]])
    expect(slots.entries('settings.onboarding').map(entry => [entry.options.id, entry.options.priority])).toEqual([['deepseek-official', -1]])
  })

  it('shows the Terminal entry once the terminal service reports an embedded shell, and drops it with the service', async () => {
    const { ctx, slots, layout } = await bench()
    declareRoot(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()
    const bar = ctx.idealizeBar
    expect(bar.state.getSnapshot().terminalAvailable).toBe(false)

    const terminal = await ctx.plugin({
      inject: [],
      apply: (scope: typeof ctx) => {
        scope.provide('terminalMode', {
          embedded: () => Promise.resolve(true),
          open: () => true,
          restart: () => Promise.resolve(),
          Pane: () => null,
        } as never)
      },
    }).await()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(bar.state.getSnapshot().terminalAvailable).toBe(true)

    bar.show('terminal')
    expect(layout.openDrawer).toHaveBeenCalledTimes(1)
    await terminal.dispose()
    expect(bar.state.getSnapshot().terminalAvailable).toBe(false)
    expect(bar.state.getSnapshot().panel).toBeNull()
    expect(layout.closeDrawer).toHaveBeenCalledTimes(1)
  })

  it('leaves the Terminal entry hidden where the host has no embedded shell', async () => {
    const { ctx, slots } = await bench()
    declareRoot(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()
    await ctx.plugin({
      inject: [],
      apply: (scope: typeof ctx) => {
        scope.provide('terminalMode', {
          embedded: () => Promise.resolve(false), open: () => false, restart: () => Promise.resolve(), Pane: () => null,
        } as never)
      },
    }).await()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(ctx.idealizeBar.state.getSnapshot().terminalAvailable).toBe(false)
  })

  it('drives the drawer pane and column through one closure set', async () => {
    const { ctx, slots, layout } = await bench()
    declareRoot(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()
    const bar = ctx.idealizeBar

    bar.show('files')
    expect(bar.state.getSnapshot().panel).toBe('files')
    expect(layout.openDrawer).toHaveBeenCalledTimes(1)

    // Re-showing the open pane moves nothing.
    bar.show('files')
    expect(layout.openDrawer).toHaveBeenCalledTimes(1)

    bar.close()
    expect(bar.state.getSnapshot().panel).toBeNull()
    expect(layout.closeDrawer).toHaveBeenCalledTimes(1)
    bar.close()
    expect(layout.closeDrawer).toHaveBeenCalledTimes(1)
  })

  it('keeps the appearance pane and the appearance service in step', async () => {
    const { ctx, slots, appearance, appearanceStore } = await bench()
    declareRoot(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()
    const bar = ctx.idealizeBar

    bar.show('appearance')
    expect(appearance.open).toHaveBeenCalledTimes(1)
    bar.close()
    expect(appearance.close).toHaveBeenCalledTimes(1)

    // The flag's own writers (⌘⌥A) land in the same pane state.
    appearanceStore.update((draft) => { draft.open = true })
    expect(bar.state.getSnapshot().panel).toBe('appearance')
  })

  it('drives the deck file and column', async () => {
    const { ctx, slots, layout } = await bench()
    declareRoot(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()
    const bar = ctx.idealizeBar

    bar.openFile('/tmp/notes.md')
    expect(bar.state.getSnapshot().file).toBe('/tmp/notes.md')
    expect(layout.openDeck).toHaveBeenCalledTimes(1)

    bar.closeFile()
    expect(bar.state.getSnapshot().file).toBeNull()
    expect(layout.closeDeck).toHaveBeenCalledTimes(1)
    // Closing an empty deck moves nothing.
    bar.closeFile()
    expect(layout.closeDeck).toHaveBeenCalledTimes(1)
  })

  it('marks the chat as configured before the brain write, and lifts the mark when that write fails', async () => {
    const { ctx, slots, order, lift, noteSessionConfigured } = await bench()
    declareRoot(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()

    const entry = slots.entries('conversation.hero.launcher')[0]
    expect(entry).toBeDefined()
    const injected = (entry as unknown as {
      inject: () => { spaces: { enter: (space: string, brain: string, sessionId?: string) => Promise<boolean> } }
    }).inject()

    // The bench's preset write refuses, standing in for a launch that fails
    // after the marker is set.
    await expect(injected.spaces.enter('chat', 'coding', 'session-1')).resolves.toBe(false)
    expect(noteSessionConfigured).toHaveBeenCalledWith('session-1')
    // The order is the fix: without it, New chat inside the window between the
    // write and the Host projection it produces hands this chat back.
    expect(order).toEqual(['note', 'select', 'lift'])
    expect(lift).toHaveBeenCalledTimes(1)
  })

  it('contributes Skills & Commands, Connectors and Plugins to the composer "+" menu; picks open what owns them', async () => {
    const { ctx, slots } = await bench()
    declareRoot(slots)
    interface Row { id: string; label: string; disabled?: boolean; heading?: boolean; keywords?: string }
    interface Entry {
      id: string
      order: number
      label: string
      commands?: boolean
      search?: boolean
      rows?: (session: { sessionId: string }) => readonly Row[] | Promise<readonly Row[]>
      onSelect: (session: { sessionId: string; insertText(text: string): void }, row: string | undefined) => void
    }
    const entries: Entry[] = []
    const disposed: string[] = []
    ctx.provide('composerMenu', {
      register: (entry: Entry) => { entries.push(entry); return () => { disposed.push(entry.id) } },
    } as never)
    const commands = ctx.get('remote.commands') as { execute: ReturnType<typeof vi.fn>; list?: unknown }
    commands.list = vi.fn(() => Promise.resolve({
      ok: true,
      value: [{ name: 'plan', description: 'plan' }, { name: 'goal', description: 'goal', input: { placeholder: 'the goal' } }],
    }))
    const skillsRoute = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ groups: [
      { folder: '', skills: [{ name: 'deploy', description: 'd', invocable: true }] },
      { folder: 'Codex', skills: [{ name: 'deploy', description: 'codex d', invocable: true }, { name: 'broken', description: '', invocable: false }] },
    ] }))))
    vi.stubGlobal('fetch', skillsRoute)
    try {
      const fiber = ctx.plugin({ inject: [...inject], apply })
      await fiber.await()
      expect(entries.map(entry => [entry.id, entry.order])).toEqual([['skills', 10], ['connectors', 20], ['plugins', 30]])
      const session = { sessionId: 's1', insertText: vi.fn() }
      const [skills, connectors, plugins] = entries as [Entry, Entry, Entry]

      // Skills & Commands: the folder's skills, then the session's host commands, under headings.
      expect(skills.commands).toBe(true)
      expect(skills.search).toBe(true)
      const rows = await skills.rows!(session)
      expect(skillsRoute).toHaveBeenCalledWith('/idealize/bar/skills')
      expect(commands.list).toHaveBeenCalledWith('s1')
      // The folder's skills under one heading per subfolder, then the commands; the wider catalogue stays with the typed "/" menu.
      expect(rows.map(row => [row.id, row.label, row.heading === true, row.keywords, row.disabled === true])).toEqual([
        ['heading:skills', 'Skills folder', true, undefined, false],
        ['skill:deploy#', 'deploy', false, 'd', false],
        ['heading:skills:Codex', 'Codex', true, undefined, false],
        ['skill:deploy#Codex', 'deploy', false, 'codex d', false],
        ['skill:broken#Codex', 'broken', false, '', true],
        ['heading:commands', 'Commands', true, undefined, false],
        ['command:plan', '/plan', false, 'plan', false],
        ['command:goal', '/goal', false, 'goal', false],
      ])
      skills.onSelect(session, 'skill:deploy#Codex')
      expect(session.insertText).toHaveBeenLastCalledWith('/deploy ')
      skills.onSelect(session, 'command:goal')
      expect(session.insertText).toHaveBeenLastCalledWith('/goal ')
      expect(commands.execute).not.toHaveBeenCalled()
      skills.onSelect(session, 'command:plan')
      expect(commands.execute).toHaveBeenCalledExactlyOnceWith('s1', '/plan')
      expect(session.insertText).toHaveBeenCalledTimes(2)
      // An empty folder shows one disabled row under the Skills heading.
      skillsRoute.mockResolvedValueOnce(new Response(JSON.stringify({ groups: [] })))
      const empty = await skills.rows!(session)
      expect(empty[1]).toEqual({ id: 'skill:', label: 'No skills in your folder yet', disabled: true })
      expect(empty.map(row => row.id)).toEqual(['heading:skills', 'skill:', 'heading:commands', 'command:plan', 'command:goal'])

      // Connectors and Plugins are plain picks: no submenu, no hatch wording.
      expect(connectors.rows).toBeUndefined()
      expect(plugins.rows).toBeUndefined()
      const bar = ctx.idealizeBar
      // No settings dialog is seated in this bench, so Connectors does nothing here.
      connectors.onSelect(session, undefined)
      expect(bar.state.getSnapshot().panel).toBeNull()
      // Plugins clicks the community market launcher when one is mounted, else opens the hatch pane.
      plugins.onSelect(session, undefined)
      expect(bar.state.getSnapshot().panel).toBe('hatch')
      bar.close()
      const launcher = document.createElement('button')
      launcher.className = 'dshMarketLauncher'
      const click = vi.fn()
      launcher.addEventListener('click', click)
      document.body.appendChild(launcher)
      try {
        plugins.onSelect(session, undefined)
        expect(click).toHaveBeenCalledTimes(1)
        expect(bar.state.getSnapshot().panel).toBeNull()
      } finally {
        launcher.remove()
      }
      await fiber.dispose()
      // Effects dispose in reverse registration order.
      expect(disposed).toEqual(['plugins', 'connectors', 'skills'])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('drops the service and its seats with the fiber', async () => {
    const { ctx, slots } = await bench()
    declareRoot(slots)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(ctx.get('idealizeBar')).toBeDefined()

    await fiber.dispose()

    await vi.waitFor(() => { expect(ctx.get('idealizeBar')).toBeUndefined() })
    expect(slots.entries('shell.rail')).toHaveLength(0)
    expect(slots.entries('shell.drawer')).toHaveLength(0)
    expect(slots.entries('shell.deck')).toHaveLength(0)
  })
})
