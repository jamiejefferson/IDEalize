/**
 * @idealize/powell — the host half of MiniMode's desk buddy (2.0.0).
 *
 * Powell is one workspace-level agent (JJ, 2 Oct 2026: a separate agent, not
 * the Studio coordinator). This plugin owns its session: it starts or resumes
 * it on the `powell` Activity Agent, holds the active project as explicit
 * state, turns the session's events into the owl's seven states and its
 * spoken sentences, answers permission prompts for Powell's own session in
 * the speech bubble, and serves the speech providers so no key reaches the
 * window.
 *
 * HTTP (loopback; mutating routes need `x-idealize-auth: 1`):
 * - `GET  /idealize/powell/events` — SSE of {@link PowellStreamEvent}.
 * - `POST /idealize/powell/say` `{text, modality}` — a message from the person.
 * - `POST /idealize/powell/stop` — cancel Powell and anything it started.
 * - `POST /idealize/powell/choose` `{choice}` — a bubble button.
 * - `POST /idealize/powell/hear` (WAV body) — speech to text.
 * - `GET  /idealize/powell/speak?text=` — text to streamed MP3.
 * - `GET  /idealize/powell/voice` — the acknowledgement manifest; `GET /idealize/powell/clip/<id>` one clip.
 * - `GET|POST /idealize/powell/project` — read or set the active project.
 * - `GET  /idealize/powell/owl.json` — the owl's run-cycle frames.
 * - `POST /idealize/powell/open-app` — show the full IDEalize window.
 * @module @idealize/powell
 */

import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import type { Agent, ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { writableRoot } from '@deepseek-ai/dsh-agent-presets'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-title'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-workspace'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { SPLASH_FRAMES } from '@idealize/skin'
import { POWELL_PERSONA, powellContext, powellGuide } from './guide.ts'
import { mergeProjects, readProjectSwitch, resolveProject, subfolders, type ProjectEntry } from './projects.ts'
import { FalElevenTts, FalScribe, SpeechError, VoiceCache, type SpeechToTextProvider, type TextToSpeechProvider } from './speech.ts'
import { clipFor, EXPLAIN_BUDGET, parseReply, SentenceStream, SPOKEN_BUDGET, wantsDetail } from './speech-text.ts'
import { appOfTool, statusOfTool } from './status.ts'
import type { PowellBubble, PowellChoice, PowellProject, PowellStreamEvent, PowellView } from './types.ts'

export * from './types.ts'
export { ACK_LIBRARY, clipFor, isActionable, parseReply, pickAck, SentenceStream, tidy, wantsDetail } from './speech-text.ts'
export { appOfTool, statusOfTool } from './status.ts'
export { mergeProjects, projectKey, readProjectSwitch, resolveProject } from './projects.ts'
export { powellContext, powellGuide } from './guide.ts'
export { wavOf } from './speech.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    idealizePowell: PowellService
  }
}

export const name = 'idealize-powell'

/** Powell's settings (`idealize-powell:` in settings.yaml). */
export interface Config {
  /** `provider/model` for Powell's brain; empty uses the app's default model. */
  model: string
  /** The ElevenLabs voice. */
  voice: string
  /** fal text-to-speech endpoints in preference order. */
  speechModels: string[]
  /** fal speech-to-text endpoint. */
  hearingModel: string
  /** How long a finished reply stays up before Powell settles, in ms. */
  doneMs: number
}

export const Config: z<Config> = z.object({
  // Timed 2 Oct 2026 through OpenRouter with Powell's tool shape: Claude
  // Haiku 4.5 answered first in 0.94–1.13 s over six runs and called the right
  // tool every time; Gemini 3.8 Flash took 2.0–2.7 s, GPT-5 mini 2.8 s.
  model: z.string().default('openrouter/anthropic/claude-haiku-4.5')
    .description('Powell\'s brain as provider/model; used when that provider is set up, else the app default.'),
  voice: z.string().default('George').description('ElevenLabs voice for Powell.'),
  speechModels: z.array(z.string()).default(['elevenlabs/tts/eleven-v4-turbo', 'fal-ai/elevenlabs/tts/turbo-v2.5']).description('Text-to-speech endpoints, first preferred.'),
  hearingModel: z.string().default('fal-ai/elevenlabs/speech-to-text/scribe-v2').description('Speech-to-text endpoint.'),
  doneMs: z.natural().default(6000).description('How long a reply stays up (ms).'),
})

/** The preset id Powell's chat runs on. */
export const POWELL_PRESET = 'powell'

/** What survives a restart. */
interface PowellState {
  sessionId?: string
  project?: PowellProject
  voiceConsent?: boolean
  muted?: boolean
}

/** One open permission prompt shown in the bubble. */
interface PendingApproval {
  id: string
  resolve: (outcome: 'allowed-once' | 'rejected') => void
}

/** Settings sections Powell reads, structurally. */
interface FolderSettings {
  projectsRoot?: string
  documentationFolder?: string
}

/** The desktop shell's actions Powell uses, structurally. */
interface DesktopLike {
  expandFromBar?(): Promise<void> | void
  collapseToBar?(): Promise<void> | void
  openPath?(path: string): Promise<string>
}

const IDLE_VIEW: PowellView = { mood: 'idle', status: '', project: null, bubble: null, busy: false, voiceConsent: false, muted: false }

/**
 * Write the `powell` preset from the deployment's default composition with
 * the persona row replaced, once; the user's later edits are theirs.
 * @param root - the writable preset root.
 * @param template - the default preset's composition text.
 * @returns true when it was created.
 */
async function seedPreset(root: string, template: string): Promise<boolean> {
  const dir = join(root, POWELL_PRESET)
  try {
    await access(join(dir, 'agent.cordis.yml'))
    return false
  } catch {
    // Absent: create it.
  }
  const persona = `- id: persona\n  name: '@deepseek-ai/dsh-persona'\n  config:\n    text: >-\n      ${POWELL_PERSONA}\n`
  const start = /^- id: persona\s*$/m.exec(template)
  let composition: string
  if (start === null) {
    composition = `${persona}\n${template}`
  } else {
    const after = template.slice(start.index + start[0].length)
    const next = /^(?:- |#|\S)/m.exec(after.replace(/^[^\n]*\n/, ''))
    const end = next === null ? template.length : start.index + start[0].length + after.indexOf('\n') + 1 + next.index
    composition = `${template.slice(0, start.index)}${persona}${template.slice(end)}`
  }
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'agent.cordis.yml'), `# Powell, the desk-buddy owl: the persona row is the personalisation prompt; edit it freely.\n${composition}`)
  await writeFile(join(dir, 'preset.yml'), 'name: Powell\ndescription: The desk-buddy owl. Acts across every project, the docs and connected apps, and speaks in one short line.\norder: 92\n')
  return true
}

/** The project tool's answer: the project, its working folder and its notes folder. */
function describeProject(project: PowellProject): string {
  const notes = project.notes !== undefined && project.notes !== project.path ? ` Notes (documentation): ${project.notes}.` : ''
  return `Active project: ${project.name}. Working folder: ${project.path}.${notes}`
}

/** The assistant text of one message's content. */
function textOf(content: readonly { type: string; text?: string }[]): string {
  return content.filter(block => block.type === 'text').map(block => block.text ?? '').join('')
}

/** Powell: the service behind the owl. */
export class PowellService extends Service {
  private view: PowellView = IDLE_VIEW
  private readonly listeners = new Set<(event: PowellStreamEvent) => void>()
  private state: PowellState = {}
  private agent: Agent | undefined
  private starting: Promise<Agent> | undefined
  private stream: SentenceStream | undefined
  private budget = SPOKEN_BUDGET
  /** Sentences already spoken this turn: the budget is per turn, not per step. */
  private spoken = 0
  /**
   * A step's first sentence, held until the step shows what it is: a second
   * sentence or the step's end means a reply (speak it), a tool call means
   * narration before work ("I'll list the projects…"), which is dropped.
   */
  private held: string | undefined
  /** This step called a tool, so its text is narration and stays silent. */
  private stepActs = false
  private stepSpoken = 0
  private lastStepText = ''
  private lastUserText = ''
  /**
   * The running turn answers something said to the owl. A turn woken by
   * Studio mail (Powell is the Studio manager) answers in the Studio, so the
   * owl shows it working but neither speaks nor raises a bubble.
   */
  private fromOwl = false
  private settle: ReturnType<typeof setTimeout> | undefined
  private readonly approvals = new Map<string, PendingApproval>()
  /** Chats Powell started this turn, cancelled by Stop with it. */
  private readonly delegates = new Set<string>()
  readonly hearing: SpeechToTextProvider
  readonly voice: TextToSpeechProvider
  readonly clips: VoiceCache
  private readonly stateFile: string

  constructor(ctx: Context, readonly config: Config) {
    super(ctx, 'idealizePowell')
    const key = async (): Promise<string | undefined> => {
      const credentials = this.ctx.get('credentials')
      return (await credentials?.resolve(credentialRef('FAL_KEY')).catch(() => undefined))?.value
    }
    this.hearing = new FalScribe(key, config.hearingModel)
    this.voice = new FalElevenTts(key, config.voice, config.speechModels)
    const home = join(resolveDshHome(), 'idealize', 'powell')
    this.clips = new VoiceCache(join(home, 'voice'), this.voice)
    this.stateFile = join(home, 'state.json')
  }

  async start(): Promise<void> {
    try {
      this.state = JSON.parse(await readFile(this.stateFile, 'utf8')) as PowellState
    } catch {
      this.state = {}
    }
    this.view = {
      ...IDLE_VIEW,
      project: this.state.project ?? null,
      voiceConsent: this.state.voiceConsent === true,
      muted: this.state.muted === true,
    }
    // The clip library generates in the background; a missing clip falls back to live speech.
    void this.clips.warm().catch(() => undefined)
  }

  private async save(): Promise<void> {
    await mkdir(join(this.stateFile, '..'), { recursive: true })
    await writeFile(`${this.stateFile}.tmp`, JSON.stringify(this.state, null, 2))
    await rename(`${this.stateFile}.tmp`, this.stateFile)
  }

  /** The current view. */
  snapshot(): PowellView {
    return this.view
  }

  /**
   * Subscribe to the owl's stream.
   * @param listener - receives every event.
   * @returns the unsubscribe function.
   */
  subscribe(listener: (event: PowellStreamEvent) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private emit(event: PowellStreamEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        // One broken stream never stops the others.
      }
    }
  }

  private setView(patch: Partial<PowellView>): void {
    this.view = { ...this.view, ...patch }
    this.emit({ type: 'view', view: this.view })
  }

  private speak(text: string): void {
    const clip = clipFor(text)
    this.emit({ type: 'say', id: randomUUID(), text, ...clip === undefined ? {} : { clip } })
  }

  private offer(sentence: string): void {
    if (this.stepActs || !this.fromOwl) return
    if (this.held === undefined && this.stepSpoken === 0) {
      this.held = sentence
      return
    }
    if (this.held !== undefined) {
      this.voiceLine(this.held)
      this.held = undefined
    }
    this.voiceLine(sentence)
  }

  private voiceLine(sentence: string): void {
    this.stepSpoken += 1
    this.spoken += 1
    this.speak(sentence)
  }

  /** Whether a session is Powell's. */
  isPowell(session: Session | undefined): boolean {
    return session !== undefined && this.state.sessionId !== undefined && String(session.header.id) === this.state.sessionId
  }

  /** The active project, when set. */
  project(): PowellProject | undefined {
    return this.state.project
  }

  /** The folders the guide names, from the vault and docs settings. */
  folders(): FolderSettings {
    const settings = this.ctx.get('settings')
    const read = (ns: string, key: string): string | undefined => {
      try {
        const section = settings?.get(settingsNamespace(ns)) as Record<string, unknown> | undefined
        const value = section?.[key]
        return typeof value === 'string' && value !== '' ? value : undefined
      } catch {
        return undefined
      }
    }
    const projectsRoot = read('idealize-vault', 'projectsRoot')
    const documentationFolder = read('idealize-docs', 'documentationFolder')
    return {
      ...projectsRoot === undefined ? {} : { projectsRoot },
      ...documentationFolder === undefined ? {} : { documentationFolder },
    }
  }

  /** The model picked for Powell in the Brains pane (`idealize-activity-pills.models.powell`), when one is. */
  brainsModel(): { provider: string; model: string } | undefined {
    try {
      const section = this.ctx.get('settings')?.get(settingsNamespace('idealize-activity-pills')) as { models?: Record<string, { provider?: unknown; model?: unknown }> } | undefined
      const picked = section?.models?.[POWELL_PRESET]
      return typeof picked?.provider === 'string' && typeof picked.model === 'string' && picked.provider !== '' && picked.model !== ''
        ? { provider: picked.provider, model: picked.model }
        : undefined
    } catch {
      return undefined
    }
  }

  /** Connected apps: MCP servers with tools registered right now. */
  apps(): string[] {
    const tools = this.ctx.get('tools') as { schemas?(): { name: string }[] } | undefined
    const names = new Set<string>()
    for (const schema of tools?.schemas?.() ?? []) {
      const app = appOfTool(schema.name)
      if (app !== undefined) names.add(app)
    }
    return [...names].sort()
  }

  /** Every project Powell can switch to. */
  async projects(): Promise<ProjectEntry[]> {
    const folders = this.folders()
    const known = (this.ctx.get('workspaceRegistry')?.list() ?? []).map(workspace => workspace.path)
    const roots = await subfolders(folders.projectsRoot)
    const notes = await subfolders(folders.documentationFolder === undefined ? undefined : join(folders.documentationFolder, 'Projects'))
    return mergeProjects(known, roots, notes)
  }

  /**
   * Set the active project.
   * @param said - a name, or an absolute folder.
   * @returns the project, or the candidates when the name is ambiguous.
   */
  async setProject(said: string): Promise<{ project?: PowellProject; candidates: string[] }> {
    let project: PowellProject | undefined
    let candidates: string[] = []
    if (isAbsolute(said)) {
      project = { name: said.split(/[\\/]/).filter(part => part !== '').pop() ?? said, path: resolve(said) }
    } else {
      const found = resolveProject(await this.projects(), said)
      candidates = found.candidates.map(candidate => candidate.name)
      if (found.match !== undefined) {
        project = {
          name: found.match.name,
          path: found.match.path ?? found.match.notes ?? '',
          ...found.match.notes === undefined ? {} : { notes: found.match.notes },
        }
      }
    }
    if (project === undefined) return { candidates }
    this.state.project = project
    await this.save()
    this.setView({ project })
    return { project, candidates }
  }

  /**
   * Record the voice consent or the mute switch.
   * @param prefs - the fields to change.
   */
  async setPrefs(prefs: { voiceConsent?: boolean; muted?: boolean }): Promise<void> {
    if (typeof prefs.voiceConsent === 'boolean') this.state.voiceConsent = prefs.voiceConsent
    if (typeof prefs.muted === 'boolean') this.state.muted = prefs.muted
    await this.save()
    this.setView({ voiceConsent: this.state.voiceConsent === true, muted: this.state.muted === true })
    if (prefs.muted === true) this.emit({ type: 'hush' })
  }

  /**
   * Give one agent context Powell's guide, its live context block and the
   * project tool. Called from the session's setup, so all three are scoped to
   * Powell's own agent: no other chat's prompt or tool list carries them.
   * @param agentCtx - the agent's context.
   */
  private scope(agentCtx: Context): void {
    const prompt = agentCtx.get('systemPrompt')
    prompt?.section({ name: 'idealize:powell', order: 130, text: powellGuide() })
    prompt?.context({
      name: 'idealize:powell-context',
      order: 130,
      text: () => powellContext(this.project(), this.folders(), this.apps()),
    })
    agentCtx.get('tools')?.register(defineTool({
      name: 'powell_project',
      description: 'Powell only: list the projects, read the active project, or set it. '
        + 'Set it when the user says which project they are working on ("we\'re on Idealize", "switch to JACQ"). '
        + 'Names are matched loosely, so pass what the user said.',
      parameters: {
        action: { type: 'string', required: true, description: '"list", "get" or "set".' },
        name: { type: 'string', description: 'For "set": the project name the user said, or an absolute folder.' },
      },
      output: {
        schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string', required: true } } },
        render: (_args, value) => [{ type: 'text', text: value.text }],
      },
      execute: async (args, exec) => {
        if (!this.isPowell(exec.agent?.session)) {
          return { text: 'powell_project belongs to Powell; this chat has no active-project state.' }
        }
        if (args.action === 'list') {
          const projects = await this.projects()
          return { text: projects.map(project => `${project.name}${project.path === undefined ? '' : ` — ${project.path}`}${project.notes === undefined ? '' : ` (notes: ${project.notes})`}`).join('\n') || 'No projects found.' }
        }
        if (args.action === 'set') {
          const outcome = await this.setProject((args.name ?? ''))
          if (outcome.project !== undefined) return { text: describeProject(outcome.project) }
          return { text: outcome.candidates.length === 0
            ? `No project matches "${(args.name ?? '')}". Ask the user which one, or list them.`
            : `"${(args.name ?? '')}" could be: ${outcome.candidates.join(', ')}. Ask the user which.` }
        }
        const project = this.project()
        return { text: project === undefined ? 'No active project yet.' : describeProject(project) }
      },
      presentCall: args => ({ card: 'generic', title: 'Project', kind: 'other', rawInput: args }),
    }))
  }

  /**
   * Keep the model router off Powell's chat: its brain was picked for speed,
   * and a routing decision would add a model call to every message. The
   * router reads its own lock event, so Powell writes that event rather than
   * importing the router (absent the router, the event is inert).
   * @param agent - Powell's live agent.
   */
  private lockRouting(agent: Agent): void {
    const events = agent.session.events as readonly { type: string; data?: unknown }[]
    const lock = events.findLast(event => event.type === 'idealize/router-lock')
    if ((lock?.data as { locked?: boolean } | undefined)?.locked === true) return
    try {
      (agent.session.append as unknown as (type: string, data: unknown, options: { ignorable: boolean }) => void)(
        'idealize/router-lock', { locked: true }, { ignorable: true })
    } catch (error) {
      this.ctx.logger.warn(`idealize-powell: could not keep the router off Powell's chat (${String(error)})`)
    }
  }

  /** Start, resume or return Powell's live agent. */
  async ensureAgent(): Promise<Agent> {
    const agents = this.ctx.get('agents')
    if (this.agent !== undefined && agents?.get(this.agent.id) === this.agent) return this.agent
    this.starting ??= this.launch().finally(() => { this.starting = undefined })
    return this.starting
  }

  private async launch(): Promise<Agent> {
    const loader = this.ctx.get('loader') as unknown as { await?: () => Promise<void> } | undefined
    await loader?.await?.()
    const agents = this.ctx.get('agents')
    const defaultModel = this.ctx.get('agentDefaultModel')
    if (agents === undefined || defaultModel === undefined) throw new Error('agent services unavailable')
    const fallback = defaultModel.currentSelection()
    const slash = this.config.model.indexOf('/')
    const routes = new Set((this.ctx.get('llm')?.listProviders() ?? []).map(entry => entry.id))
    // A model picked for Powell in the Brains pane wins; then the fast brain;
    // each only when its provider route is live (an adapter is registered,
    // which needs the provider set up and keyed), else the app default, so a
    // fresh install never lands on a route that cannot answer.
    const picked = this.brainsModel()
    const fast = slash > 0 ? { provider: this.config.model.slice(0, slash), model: this.config.model.slice(slash + 1) } : undefined
    const selection = [picked, fast].find(candidate => candidate !== undefined && routes.has(candidate.provider))
      ?? { provider: fallback.provider, model: fallback.model }
    const presets = this.ctx.get('agentPresets')
    let presetId: string | undefined
    if (presets !== undefined) {
      try {
        presetId = (await presets.resolve(POWELL_PRESET)).id
      } catch {
        presetId = undefined
      }
    }
    const setup = async (agentCtx: Context): Promise<void> => {
      const selected: ModelSelectionRef = { current: selection, assembled: undefined }
      installModelSelection(agentCtx, selected)
      if (presets !== undefined && presetId !== undefined) await presets.mount(agentCtx, presetId)
      this.scope(agentCtx)
    }
    const existing = this.state.sessionId
    if (existing !== undefined) {
      const live = agents.get(SessionId(existing))
      if (live !== undefined) {
        this.agent = live
        return live
      }
      try {
        const { agent } = await agents.resume({
          resumeSessionId: SessionId(existing),
          agentOptions: { provider: selection.provider, model: selection.model },
          setup,
        })
        this.lockRouting(agent)
        this.agent = agent
        return agent
      } catch (error) {
        this.ctx.logger.warn(`idealize-powell: could not resume ${existing}; starting fresh (${String(error)})`)
      }
    }
    const sessionId = SessionId(`session-${randomUUID()}`)
    const { agent } = await agents.create({
      sessionId,
      meta: { cwd: homedir(), ...presetId === undefined ? {} : { agentPreset: presetId } },
      agentOptions: { provider: selection.provider, model: selection.model },
      setup,
    })
    this.state.sessionId = String(sessionId)
    await this.save()
    this.lockRouting(agent)
    try {
      this.ctx.get('sessionTitle')?.rename(agent.session, 'Powell')
    } catch {
      // A title is cosmetic.
    }
    this.agent = agent
    return agent
  }

  /**
   * A message from the person, typed or spoken.
   * @param text - the words.
   * @param modality - how they arrived.
   */
  async say(said: string, modality: 'text' | 'voice'): Promise<void> {
    let text = said
    const words = text.trim()
    if (words === '') return
    clearTimeout(this.settle)
    // No hush here: the window quiets itself before it sends, then plays the
    // instant acknowledgement, which a hush from this side would cut off.
    this.lastUserText = words
    // A project switch happens here, before any model runs, so it is instant
    // and never rests on the model remembering to call a tool (proof run,
    // 2 Oct 2026: Haiku said "Switched to IDEalize" without switching).
    const switching = readProjectSwitch(words)
    if (switching !== undefined) {
      const outcome = await this.setProject(switching.said)
      if (outcome.project === undefined && outcome.candidates.length > 1 && switching.rest === '') {
        this.reply('Which one?', outcome.candidates.slice(0, 2).map((name, index) => ({ label: name, action: 'say' as const, ...index === 0 ? { primary: true } : {} })), true)
        return
      }
      if (outcome.project !== undefined) {
        if (switching.rest === '') {
          this.reply(`Switched to ${outcome.project.name}.`, [], false)
          return
        }
        text = switching.rest
      }
    }
    this.budget = wantsDetail(words) ? EXPLAIN_BUDGET : SPOKEN_BUDGET
    // A pending permission prompt is answered by what the person says next only through its buttons.
    this.setView({ mood: 'thinking', status: 'Thinking', bubble: null, busy: true })
    let agent: Agent
    try {
      agent = await this.ensureAgent()
    } catch (error) {
      this.problem(`I couldn't wake up: ${error instanceof Error ? error.message : String(error)}`)
      return
    }
    const message = createUserMessage({
      content: [{ type: 'text', text: modality === 'voice' ? `${text.trim()}\n\n(spoken; the transcript may contain slips)` : text.trim() }],
      source: { kind: 'user' },
    })
    // A correction while Powell is working reaches its very next step (spec
    // journey F); otherwise the message opens a turn.
    this.fromOwl = true
    if (agent.status === 'running') agent.steer(message)
    else agent.followup(message)
  }

  /** Stop Powell and every chat it started this turn. */
  stop(): void {
    const agents = this.ctx.get('agents')
    this.agent?.cancel({ kind: 'user' }, { keepInbox: false })
    for (const id of this.delegates) agents?.get(SessionId(id))?.cancel({ kind: 'user' }, { keepInbox: true })
    this.delegates.clear()
    for (const approval of this.approvals.values()) approval.resolve('rejected')
    this.approvals.clear()
    this.emit({ type: 'hush' })
    this.setView({ mood: 'idle', status: '', bubble: null, busy: false })
  }

  /**
   * A bubble button.
   * @param choice - what was pressed.
   */
  async choose(choice: PowellChoice): Promise<void> {
    switch (choice.action) {
      case 'allow':
      case 'deny': {
        const pending = this.approvals.get(choice.target ?? '')
        if (pending === undefined) return
        this.approvals.delete(pending.id)
        pending.resolve(choice.action === 'allow' ? 'allowed-once' : 'rejected')
        this.setView({ mood: 'acting', status: choice.action === 'allow' ? 'Working' : 'Thinking', bubble: null })
        return
      }
      case 'open':
        await this.open(choice.target ?? '')
        this.setView({ bubble: null, mood: 'idle', status: '' })
        return
      case 'retry':
        await this.say(this.lastUserText, 'text')
        return
      case 'say':
        await this.say(choice.label, 'text')
    }
  }

  /**
   * Open a destination for the person: a folder or file in its app, or a URL in the browser.
   * @param target - absolute path or URL.
   */
  async open(target: string): Promise<void> {
    if (target === '') return
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(target)) {
      const opener = process.platform === 'darwin' ? ['open', [target]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', target]] : ['xdg-open', [target]]
      execFile(opener[0] as string, opener[1] as string[], () => undefined)
      return
    }
    const desktop = this.ctx.get('desktopActions') as DesktopLike | undefined
    if (desktop?.openPath !== undefined) {
      const failed = await desktop.openPath(target).catch((error: unknown) => String(error))
      if (failed === '') return
    }
    if (process.platform === 'darwin') execFile('open', [target], () => undefined)
  }

  /** Show the full app. */
  async openApp(): Promise<void> {
    await (this.ctx.get('desktopActions') as DesktopLike | undefined)?.expandFromBar?.()
  }

  /**
   * Answer without the model: a bubble and its line, spoken.
   * @param text - the line.
   * @param choices - tap answers, when it asks.
   * @param asking - whether Powell waits for an answer.
   */
  private reply(text: string, choices: PowellChoice[], asking: boolean): void {
    this.setView({ mood: asking ? 'waiting' : 'done', status: asking ? 'Needs you' : '', busy: false, bubble: { text, choices, kind: asking ? 'question' : 'reply' } })
    this.speak(text)
    if (!asking) {
      this.settle = setTimeout(() => {
        if (this.view.mood === 'done') this.setView({ mood: 'idle', status: '' })
      }, this.config.doneMs)
    }
  }

  private problem(text: string, retry = true): void {
    const choices: PowellChoice[] = retry ? [{ label: 'Try again', action: 'retry', primary: true }] : []
    this.setView({ mood: 'problem', status: 'Problem', busy: false, bubble: { text, choices, kind: 'problem' } })
    this.speak(text.split(/(?<=[.!?])\s/)[0] ?? text)
  }

  /**
   * Fold one event from Powell's session into the view and the voice.
   * @param event - the session event.
   */
  observe(event: SessionEvent): void {
    switch (event.type) {
      case 'turn/start':
        clearTimeout(this.settle)
        this.lastStepText = ''
        this.spoken = 0
        this.setView({ mood: 'thinking', status: 'Thinking', busy: true })
        return
      case 'step/start':
        this.stream = new SentenceStream(Math.max(0, this.budget - this.spoken))
        this.lastStepText = ''
        this.held = undefined
        this.stepActs = false
        this.stepSpoken = 0
        return
      case 'assistant/chunk': {
        const chunk = event.data.chunk
        if (chunk.type !== 'text-delta') return
        this.lastStepText += chunk.text
        for (const sentence of this.stream?.push(chunk.text) ?? []) this.offer(sentence)
        return
      }
      case 'assistant/message': {
        const text = textOf(event.data.message.content)
        if (text.trim() !== '') this.lastStepText = text
        return
      }
      case 'step/end':
        for (const sentence of this.stream?.flush() ?? []) this.offer(sentence)
        if (this.held !== undefined && !this.stepActs && this.fromOwl) this.voiceLine(this.held)
        this.held = undefined
        this.stream = undefined
        return
      case 'tool/call': {
        this.stepActs = true
        this.held = undefined
        this.setView({ mood: 'acting', status: statusOfTool(event.data.name, event.data.arguments, this.state.project?.name) })
        return
      }
      case 'tool/result': {
        const text = textOf(event.data.message.content)
        for (const match of text.matchAll(/session-[0-9a-f]{8}-[0-9a-f-]{27}/g)) {
          if (match[0] !== this.state.sessionId) this.delegates.add(match[0])
        }
        return
      }
      case 'turn/end':
        this.finish(event.data.reason.kind)
        return
      default:
    }
  }

  private finish(reason: string): void {
    this.stream = undefined
    const fromOwl = this.fromOwl
    this.fromOwl = false
    if (!fromOwl) {
      this.delegates.clear()
      this.setView({ mood: 'idle', status: '', busy: false })
      return
    }
    if (reason === 'error') {
      this.problem('Something went wrong. Try again?')
      return
    }
    if (reason === 'aborted' || reason === 'interrupted') {
      this.setView({ mood: 'idle', status: '', busy: false })
      return
    }
    const reply = parseReply(this.lastStepText)
    const choices: PowellChoice[] = []
    if (reply.choices.length > 0) {
      for (const label of reply.choices) choices.push({ label, action: 'say', ...choices.length === 0 ? { primary: true } : {} })
    } else if (reply.open !== undefined) {
      choices.push({ label: 'Open', action: 'open', target: reply.open, primary: true })
    }
    const asking = reply.choices.length > 0 || reply.text.endsWith('?')
    const bubble: PowellBubble | null = reply.text === '' ? null : { text: reply.text, choices, kind: asking ? 'question' : 'reply' }
    this.delegates.clear()
    this.setView({ mood: asking ? 'waiting' : 'done', status: asking ? 'Needs you' : '', busy: false, bubble })
    if (!asking) {
      this.settle = setTimeout(() => {
        if (this.view.mood === 'done') this.setView({ mood: 'idle', status: '' })
      }, this.config.doneMs)
    }
  }

  /**
   * Ask the person to allow one tool call, in the bubble.
   * @param toolName - the tool asking.
   * @param reason - why it asks.
   * @param signal - withdraws the ask.
   * @returns the decision.
   */
  ask(toolName: string, reason: string | undefined, signal: AbortSignal | undefined): Promise<'allowed-once' | 'rejected' | 'cancelled'> {
    const id = randomUUID()
    const app = appOfTool(toolName)
    const what = reason !== undefined && reason !== '' ? reason : app !== undefined ? `use ${app}` : `run ${toolName}`
    const text = `Can I ${what.replace(/^(to )/i, '').replace(/\.$/, '')}?`
    return new Promise((resolveAsk) => {
      const done = (outcome: 'allowed-once' | 'rejected' | 'cancelled'): void => {
        this.approvals.delete(id)
        resolveAsk(outcome)
      }
      this.approvals.set(id, { id, resolve: done })
      signal?.addEventListener('abort', () => { done('cancelled') }, { once: true })
      this.setView({
        mood: 'waiting',
        status: 'Needs you',
        bubble: {
          text: text.length > 140 ? `${text.slice(0, 137)}…?` : text,
          kind: 'approval',
          choices: [
            { label: 'Allow', action: 'allow', target: id, primary: true },
            { label: 'Not now', action: 'deny', target: id },
          ],
        },
      })
      this.speak('Can I go ahead?')
    })
  }
}

// ── HTTP plumbing ────────────────────────────────────────────────────────────

function refuse(req: IncomingMessage, res: ServerResponse, mutating = false): boolean {
  const hostname = (req.headers.host ?? '').replace(/:\d+$/, '')
  if (hostname !== '127.0.0.1' && hostname !== 'localhost' && hostname !== '[::1]') {
    res.writeHead(403, { 'content-type': 'text/plain' }).end('loopback only')
    return true
  }
  if (mutating && req.headers['x-idealize-auth'] !== '1') {
    res.writeHead(403, { 'content-type': 'text/plain' }).end('missing x-idealize-auth header')
    return true
  }
  return false
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))
}

async function readBuffer(req: IncomingMessage, limit = 25 * 1024 * 1024): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > limit) throw new Error('body too large')
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks)
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown> | undefined> {
  try {
    const value = JSON.parse((await readBuffer(req, 1024 * 1024)).toString('utf8')) as unknown
    return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
}

export function apply(ctx: Context, config: Config): void {
  ctx.plugin(PowellService, config)

  ctx.inject(['idealizePowell'], (powellCtx) => {
    const powell = powellCtx.idealizePowell
    void powell.start()

    // Every event of Powell's own session drives the owl.
    powellCtx.on('session/event', (session, event) => {
      if (powell.isPowell(session)) powell.observe(event)
    })

    // Permission prompts for Powell's session are answered in its bubble;
    // every other chat's prompts pass through untouched.
    powellCtx.on('approval/request', async (req, next) => {
      if (!powell.isPowell(req.agent.session)) return next()
      return powell.ask(req.toolName, req.reason, req.signal)
    }, { prepend: true })
  })

  // The powell preset exists from first boot.
  ctx.inject(['agentPresets'], (presetCtx) => {
    const seed = async (): Promise<void> => {
      const presets = presetCtx.agentPresets
      if (!presets.authorable) return
      const root = writableRoot(presets.roots)
      const template = await presets.read((await presets.resolve()).id)
      if (await seedPreset(root, template)) presetCtx.logger.info('idealize-powell: created the Powell Activity Agent')
    }
    seed().catch((error: unknown) => {
      presetCtx.logger.warn(`idealize-powell: preset not seeded: ${String(error)}`)
    })
  })

  ctx.inject(['idealizePowell', 'webServer'], (webCtx) => {
    const powell = webCtx.idealizePowell
    type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<void>
    const register = (path: string, handler: Handler, kind: 'exact' | 'prefix' = 'exact'): void => {
      webCtx.effect(() => webCtx.webServer.register({ kind, path, handler }), `idealize-powell: ${path}`)
    }
    const post = (path: string, handler: Handler): void => {
      register(path, async (req, res) => {
        if (req.method !== 'POST') {
          res.writeHead(405, { 'content-type': 'text/plain', allow: 'POST' }).end('POST only')
          return
        }
        if (refuse(req, res, true)) return
        await handler(req, res)
      })
    }

    register('/idealize/powell/events', async (req, res) => {
      if (refuse(req, res)) return
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
      const write = (event: PowellStreamEvent): void => { res.write(`data: ${JSON.stringify(event)}\n\n`) }
      write({ type: 'view', view: powell.snapshot() })
      const stop = powell.subscribe(write)
      const keepAlive = setInterval(() => { res.write(': ping\n\n') }, 15_000)
      await new Promise<void>((done) => { req.on('close', () => { done() }) })
      clearInterval(keepAlive)
      stop()
    })

    post('/idealize/powell/say', async (req, res) => {
      const body = await readJson(req)
      const text = typeof body?.text === 'string' ? body.text : ''
      if (text.trim() === '') {
        sendJson(res, 400, { ok: false, error: 'text is required' })
        return
      }
      void powell.say(text, body?.modality === 'voice' ? 'voice' : 'text')
      sendJson(res, 202, { ok: true })
    })

    post('/idealize/powell/stop', async (_req, res) => {
      powell.stop()
      sendJson(res, 200, { ok: true })
      return Promise.resolve()
    })

    post('/idealize/powell/choose', async (req, res) => {
      const body = await readJson(req)
      const choice = body?.choice as PowellChoice | undefined
      if (choice === undefined || typeof choice.label !== 'string' || typeof choice.action !== 'string') {
        sendJson(res, 400, { ok: false, error: 'choice is required' })
        return
      }
      await powell.choose(choice)
      sendJson(res, 200, { ok: true })
    })

    post('/idealize/powell/prefs', async (req, res) => {
      const body = await readJson(req)
      await powell.setPrefs({
        ...typeof body?.voiceConsent === 'boolean' ? { voiceConsent: body.voiceConsent } : {},
        ...typeof body?.muted === 'boolean' ? { muted: body.muted } : {},
      })
      sendJson(res, 200, { ok: true })
    })

    post('/idealize/powell/open-app', async (_req, res) => {
      await powell.openApp()
      sendJson(res, 200, { ok: true })
    })

    post('/idealize/powell/hear', async (req, res) => {
      const started = Date.now()
      let wav: Buffer
      try {
        wav = await readBuffer(req)
      } catch {
        sendJson(res, 413, { ok: false, error: 'recording too large' })
        return
      }
      const terms = ['IDEalize', 'Powell', 'Paper', 'Hatch', ...(await powell.projects()).map(project => project.name)]
      try {
        const text = await powell.hearing.transcribe(wav, terms)
        sendJson(res, 200, { ok: true, text, ms: Date.now() - started })
      } catch (error) {
        const code = error instanceof SpeechError ? error.code : 'failed'
        sendJson(res, code === 'no-key' ? 412 : 502, { ok: false, error: error instanceof Error ? error.message : String(error), code })
      }
    })

    register('/idealize/powell/speak', async (req, res) => {
      if (refuse(req, res)) return
      const text = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get('text')?.trim() ?? ''
      if (text === '' || text.length > 600) {
        res.writeHead(400, { 'content-type': 'text/plain' }).end('text is required (600 characters at most)')
        return
      }
      const abort = new AbortController()
      req.on('close', () => { abort.abort() })
      try {
        const body = await powell.voice.stream(text, abort.signal)
        res.writeHead(200, { 'content-type': 'audio/mpeg', 'cache-control': 'no-store' })
        const reader = body.getReader()
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          res.write(Buffer.from(value))
        }
        res.end()
      } catch (error) {
        if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' }).end(error instanceof Error ? error.message : String(error))
        else res.end()
      }
    })

    // The owl's 42 run-cycle frames as data URLs, in one cacheable response
    // (a client bundle may not import another plugin's values).
    const frames = JSON.stringify(SPLASH_FRAMES)
    register('/idealize/powell/owl.json', async (req, res) => {
      if (refuse(req, res)) return
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'private, max-age=86400' }).end(frames)
      return Promise.resolve()
    })

    register('/idealize/powell/voice', async (req, res) => {
      if (refuse(req, res)) return
      sendJson(res, 200, powell.clips.manifest(id => `/idealize/powell/clip/${id}`))
      return Promise.resolve()
    })

    register('/idealize/powell/clip', async (req, res) => {
      if (refuse(req, res)) return
      const id = decodeURIComponent((req.url ?? '').split('?')[0]?.split('/').pop() ?? '')
      const bytes = await powell.clips.clip(id)
      if (bytes === undefined) {
        res.writeHead(404, { 'content-type': 'text/plain' }).end('no such clip')
        return
      }
      res.writeHead(200, { 'content-type': 'audio/mpeg', 'cache-control': 'private, max-age=86400' }).end(bytes)
    }, 'prefix')

    register('/idealize/powell/project', async (req, res) => {
      if (req.method === 'POST') {
        if (refuse(req, res, true)) return
        const body = await readJson(req)
        const outcome = await powell.setProject(typeof body?.name === 'string' ? body.name : '')
        sendJson(res, outcome.project === undefined ? 404 : 200, { ok: outcome.project !== undefined, ...outcome })
        return
      }
      if (refuse(req, res)) return
      sendJson(res, 200, { project: powell.project() ?? null, projects: await powell.projects() })
    })
  })
}
