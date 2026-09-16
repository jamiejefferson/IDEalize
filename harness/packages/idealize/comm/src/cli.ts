#!/usr/bin/env node
/**
 * `idealize` — the command-line face of the command surface. Parses V0's
 * command grammar, posts one request to the host, prints the response in
 * V0's text shapes (or `--json`). Identity comes from the harness's
 * `DSH_SESSION_ID` (else V0's `IDEALIZE_SESSION_ID`); the host origin from
 * `DSH_IDEALIZE_HOST`, else `IDEALIZE_HOST`, else `<DSH_HOME>/idealize/comm-host.json`.
 */

import { readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { commHostPath } from './index.ts'
import { clockTime, Wire } from './wire.ts'
import type { CommRequest, CommResponse } from './wire.ts'

const args = process.argv.slice(2)
const env = process.env
// The harness stamps DSH_SESSION_ID on every chat shell per call, scrubbed of
// stale parents, so it wins; IDEALIZE_SESSION_ID is V0's name and reaches a V1
// shell as ambient login-environment residue (JJ's shells carried V0's
// `t-…` id, and every `idealize` call from a chat answered "unknown sender
// session", 14 Sep 2026). It counts only where the harness stamped nothing.
const mySession = env.DSH_SESSION_ID ?? env.IDEALIZE_SESSION_ID

function fail(message: string, code = 1): never {
  process.stderr.write(`idealize: ${message}\n`)
  process.exit(code)
}

function out(line: string): void {
  process.stdout.write(`${line}\n`)
}

function warn(line: string | undefined): void {
  if (line !== undefined && line !== '') process.stderr.write(`idealize: ${line}\n`)
}

/** `--flag value` and boolean `--flag` out of an argument list. */
class Flags {
  values = new Map<string, string>()
  bools = new Set<string>()
  positionals: string[] = []

  constructor(raw: readonly string[], boolFlags: readonly string[] = []) {
    for (let i = 0; i < raw.length; i += 1) {
      const arg = raw[i] ?? ''
      if (arg.startsWith('--')) {
        const key = arg.slice(2)
        const next = raw[i + 1]
        if (boolFlags.includes(key)) {
          this.bools.add(key)
        } else if (next !== undefined) {
          this.values.set(key, next)
          i += 1
        } else {
          this.bools.add(key)
        }
      } else {
        this.positionals.push(arg)
      }
    }
  }
}

function hostOrigin(): string {
  const fromEnv = env.DSH_IDEALIZE_HOST ?? env.IDEALIZE_HOST
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv.replace(/\/$/, '')
  const file = commHostPath(resolveDshHome())
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { url?: unknown }
    if (typeof parsed.url === 'string') return parsed.url.replace(/\/$/, '')
  } catch {
    // Fall through to the failure below.
  }
  return fail(`IDEalize is not running (no host at $IDEALIZE_HOST or ${file}).`)
}

async function send(request: CommRequest): Promise<CommResponse> {
  const origin = hostOrigin()
  let response: Response
  try {
    response = await fetch(`${origin}/idealize/comm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-idealize-auth': '1' },
      body: JSON.stringify({ ...request, ...mySession === undefined ? {} : { from: mySession } }),
    })
  } catch (error) {
    return fail(`IDEalize is not reachable at ${origin} (${error instanceof Error ? error.message : String(error)})`)
  }
  const text = await response.text()
  try {
    return JSON.parse(text) as CommResponse
  } catch {
    return fail(`unexpected reply from ${origin} (${response.status}): ${text.slice(0, 200)}`)
  }
}

function usage(): void {
  out(`idealize — control & message IDEalize chats

USAGE:
  idealize <command> [args]

COMMANDS:
  notify <text> [--title T] [--sound]   show a system notification
  send <session> <text>                 message another chat's inbox
  rung <piece> <rung> [--blocker B] [--note T]  record where a piece has got to; the status line also posts to the project's group chat. Rungs: ${Wire.rungs.join('|')}. Blockers: ${Wire.blockers.join('|')}
  board [--path DIR] [--json]           where every piece in the project stands (from what chats reported)
  inbox [--wait] [--json] [--timeout S]  read & clear my messages
  peek [--json]                         read my messages without clearing
  list [--json]                         list chats
  spawn <task> [--name LABEL] [--path DIR] [--model M]  start a new chat (in DIR, else my project) with an opening task; prints its id. --name labels it (else one is read off the task)
  spawn --coordinator [--path DIR]      start (or surface) DIR's Project Coordinator; prints its id
  spawn --studio                        start (or surface) the one Studio Coordinator; prints its id
  transcript <session> [--last N] [--json]  read a chat's recent Q&A
  reveal <path> [--open]                show a file in the app's file panel
  status <text>                         set this chat's status label
  focus <session>                       bring a chat to the front
  post <text>                           post to the project's group chat on the Studio timeline (everyone sees it; nobody is invoked)
  chat [--last N]                       read the project's recent group-chat messages
  task <goal> --to <session>            assign a Studio task to a chat; prints its id
  progress <taskId> [note]              report the task working, with what changed
  blocked <taskId> <cause> [--owner TARGET]  report the task blocked; no --owner leaves it unassigned
  need <taskId> <question> [--owner TARGET] [--action]  ask for input (--action: an approval); default owner: the user
  done <taskId> <outcome>               report the task complete, with the outcome
  studio [--path DIR] [--json]          the project's Studio tasks and their attention
  handoff <taskId> --to <session> [reason]  offer a task's ownership to another chat
  accept <taskId>                       take ownership of a task offered to me
  reject <taskId> [reason]              decline an offered task; the sender keeps it
  decide <text>                         record a project decision on the Studio timeline
  synthesis <text>                      publish the project view (coordinator only)
  whoami                                print my session id
  ping                                  check the app is reachable

Identity is taken from $DSH_SESSION_ID inside a chat's shell (else $IDEALIZE_SESSION_ID).

ADDRESSING: a <session> is a session id, an agent name (see list), a task title, or a project folder name.
Aliases: \`coordinator\` / \`project-agent\` → your own project's coordinating
chat; \`studio-agent\` → the Studio coordinator, which runs across every project.`)
}

function printJson(value: unknown): void {
  out(JSON.stringify(value, null, 2))
}

function sleep(ms: number): Promise<void> {
  return new Promise(done => setTimeout(done, ms))
}

async function main(): Promise<void> {
  const command = args[0]
  if (command === undefined) {
    usage()
    return
  }
  const rest = args.slice(1)

  switch (command) {
    case 'help':
    case '-h':
    case '--help':
      usage()
      return

    case 'whoami':
      out(mySession ?? '(not inside an IDEalize chat)')
      return

    case 'ping': {
      const resp = await send({ command: 'ping' })
      out(resp.ok ? 'pong' : `error: ${resp.error ?? 'unknown'}`)
      return
    }

    case 'notify': {
      const flags = new Flags(rest, ['sound'])
      const text = flags.positionals[0]
      if (text === undefined) fail('notify needs a message')
      const resp = await send({ command: 'notify', body: text, title: flags.values.get('title') ?? 'IDEalize', sound: flags.bools.has('sound') })
      if (!resp.ok) fail(resp.error ?? 'notify failed')
      return
    }

    case 'send': {
      const [target, ...words] = rest
      if (target === undefined || words.length === 0) fail('usage: idealize send <session> <text>')
      const resp = await send({ command: 'send', target, body: words.join(' ') })
      if (!resp.ok) fail(resp.error ?? 'send failed')
      warn(resp.warning)
      out(resp.info ?? 'sent')
      return
    }

    case 'rung': {
      const flags = new Flags(rest)
      if (flags.positionals.length < 2) {
        fail(`usage: idealize rung <piece> <${Wire.rungs.join('|')}> [--blocker ${Wire.blockers.join('|')}] [--note TEXT]`)
      }
      const piece = flags.positionals.slice(0, -1).join(' ')
      const rung = flags.positionals.at(-1) ?? ''
      const note = flags.values.get('note')
      const resp = await send({
        command: 'rung',
        ...note === undefined ? {} : { body: note },
        piece,
        rung,
        blocker: flags.values.get('blocker') ?? 'none',
      })
      if (!resp.ok) fail(resp.error ?? 'rung failed')
      warn(resp.warning)
      out(resp.info ?? 'recorded')
      return
    }

    case 'board': {
      const flags = new Flags(rest, ['json'])
      const path = flags.values.get('path')
      const resp = await send({ command: 'board', ...path === undefined ? {} : { path: resolve(path) } })
      if (!resp.ok) fail(resp.error ?? 'board failed')
      const rows = resp.rungs ?? []
      if (flags.bools.has('json')) {
        printJson(rows)
      } else if (rows.length === 0) {
        out(resp.info ?? 'no pieces reported yet')
      } else {
        for (const row of rows) {
          let line = `${row.piece} → ${row.rung}`
          if (row.blocker !== 'none') line += ` — blocker: ${row.blocker}`
          line += `  (${row.sessionLabel ?? row.session})`
          if (row.note !== undefined && row.note !== '') line += ` — ${row.note}`
          out(line)
        }
      }
      return
    }

    case 'inbox':
    case 'peek': {
      const flags = new Flags(rest, ['wait', 'json'])
      const wantWait = flags.bools.has('wait')
      let timeout = 0
      const rawTimeout = flags.values.get('timeout')
      if (rawTimeout !== undefined) {
        timeout = Number(rawTimeout)
        if (!Number.isFinite(timeout) || timeout < 0) fail(`invalid --timeout '${rawTimeout}' (expected seconds)`)
      }
      const deadline = Date.now() + timeout * 1000
      for (;;) {
        const resp = await send({ command })
        if (!resp.ok) fail(resp.error ?? 'inbox failed')
        const messages = resp.messages ?? []
        if (messages.length === 0 && wantWait) {
          if (timeout > 0 && Date.now() >= deadline) fail(`timed out after ${Math.trunc(timeout)}s waiting for messages`, 2)
          await sleep(500)
          continue
        }
        if (flags.bools.has('json')) {
          printJson(messages)
        } else if (messages.length === 0) {
          out('(no messages)')
        } else {
          for (const message of messages) {
            out(`[${clockTime(message.timestamp)}] ${message.fromLabel ?? message.from}: ${message.body}`)
            // The person typed it in the Studio and reads the answer there.
            if (message.from === 'user') out('    (sent from the Studio: answer there with `idealize post <text>`)')
          }
        }
        return
      }
    }

    case 'reveal': {
      const flags = new Flags(rest, ['open'])
      const path = flags.positionals[0]
      if (path === undefined) fail('usage: idealize reveal <path> [--open]')
      const resp = await send({ command: 'reveal', target: resolve(path), open: flags.bools.has('open') })
      if (!resp.ok) fail(resp.error ?? 'reveal failed')
      out(resp.info ?? 'revealed')
      return
    }

    case 'transcript': {
      const flags = new Flags(rest, ['json'])
      const target = flags.positionals[0]
      if (target === undefined) fail('usage: idealize transcript <session> [--last N] [--json]')
      let limit = 10
      const rawLast = flags.values.get('last')
      if (rawLast !== undefined) {
        limit = Number(rawLast)
        if (!Number.isSafeInteger(limit) || limit <= 0) fail(`invalid --last '${rawLast}' (expected a positive number)`)
      }
      const resp = await send({ command: 'transcript', target, limit })
      if (!resp.ok) fail(resp.error ?? 'transcript failed')
      const exchanges = resp.exchanges ?? []
      if (flags.bools.has('json')) {
        printJson(exchanges)
      } else if (exchanges.length === 0) {
        out('(no exchanges yet)')
      } else {
        for (const exchange of exchanges) {
          out(`Q: ${exchange.question}`)
          if (exchange.answer !== undefined) out(`A: ${exchange.answer}`)
          out('')
        }
      }
      return
    }

    case 'list': {
      const flags = new Flags(rest, ['json'])
      const resp = await send({ command: 'list' })
      if (!resp.ok) fail(resp.error ?? 'list failed')
      const sessions = resp.sessions ?? []
      if (flags.bools.has('json')) {
        printJson(sessions)
      } else if (sessions.length === 0) {
        out('(no active sessions)')
      } else {
        for (const session of sessions) {
          const me = session.id === mySession ? ' *' : '  '
          const who = session.name === undefined ? session.title : `${session.name} · ${session.title}`
          const project = session.projectPath === undefined ? '' : ` — ${basename(session.projectPath)}`
          const role = session.role === 'chat' ? '' : ` [${session.role}]`
          const unread = session.unread > 0 ? ` (${session.unread} unread)` : ''
          out(`${me}${session.id}  ${who}${project}${role}${unread}`)
        }
      }
      return
    }

    case 'spawn': {
      const flags = new Flags(rest, ['coordinator', 'studio'])
      const task = flags.positionals.join(' ').trim()
      const path = flags.values.get('path')
      const coordinator = flags.bools.has('coordinator')
      const studio = flags.bools.has('studio')
      if (task === '' && path === undefined && !coordinator && !studio) {
        fail('usage: idealize spawn <task> [--name LABEL] [--path DIR] [--model M] | idealize spawn --coordinator [--path DIR] | idealize spawn --studio')
      }
      const name = flags.values.get('name')
      const model = flags.values.get('model')
      const resp = await send({
        command: 'spawn',
        ...path === undefined ? {} : { path: resolve(path) },
        ...task === '' ? {} : { body: task },
        ...name === undefined ? {} : { name },
        ...model === undefined ? {} : { model },
        ...coordinator ? { coordinator: true } : {},
        ...studio ? { studio: true } : {},
      })
      if (!resp.ok) fail(resp.error ?? 'spawn failed')
      out(resp.info ?? 'spawned')
      return
    }

    case 'status': {
      if (rest.length === 0) fail('usage: idealize status <text>')
      const resp = await send({ command: 'setStatus', body: rest.join(' ') })
      if (!resp.ok) fail(resp.error ?? 'status failed')
      return
    }

    case 'focus': {
      const target = rest[0]
      if (target === undefined) fail('usage: idealize focus <session>')
      const resp = await send({ command: 'focus', target })
      if (!resp.ok) fail(resp.error ?? 'focus failed')
      return
    }

    case 'post': {
      if (rest.length === 0) fail('usage: idealize post <text>')
      const resp = await send({ command: 'post', body: rest.join(' ') })
      if (!resp.ok) fail(resp.error ?? 'post failed')
      out(resp.info ?? 'posted')
      return
    }

    case 'chat': {
      const flags = new Flags(rest)
      const last = flags.values.get('last')
      const resp = await send({ command: 'chat', ...last === undefined ? {} : { limit: Number(last) } })
      if (!resp.ok) fail(resp.error ?? 'chat failed')
      out(resp.info ?? '')
      return
    }

    case 'task': {
      const flags = new Flags(rest)
      const goal = flags.positionals.join(' ').trim()
      const to = flags.values.get('to')
      if (goal === '' || to === undefined) fail('usage: idealize task <goal> --to <session>')
      const resp = await send({ command: 'task', target: to, body: goal })
      if (!resp.ok) fail(resp.error ?? 'task failed')
      out(resp.info ?? 'assigned')
      return
    }

    case 'progress':
    case 'done': {
      const flags = new Flags(rest)
      const [taskId, ...words] = flags.positionals
      const text = words.join(' ').trim()
      if (taskId === undefined || (command === 'done' && text === '')) {
        fail(`usage: idealize ${command} <taskId> ${command === 'done' ? '<outcome>' : '[note]'}`)
      }
      const resp = await send({ command, task: taskId, ...text === '' ? {} : { body: text } })
      if (!resp.ok) fail(resp.error ?? `${command} failed`)
      out(resp.info ?? 'recorded')
      return
    }

    case 'blocked':
    case 'need': {
      const flags = new Flags(rest, ['action'])
      const [taskId, ...words] = flags.positionals
      const text = words.join(' ').trim()
      if (taskId === undefined || text === '') {
        fail(`usage: idealize ${command} <taskId> <${command === 'need' ? 'question' : 'cause'}> [--owner TARGET]${command === 'need' ? ' [--action]' : ''}`)
      }
      const owner = flags.values.get('owner')
      const resp = await send({
        command, task: taskId, body: text,
        ...owner === undefined ? {} : { owner },
        ...command === 'need' && flags.bools.has('action') ? { action: true } : {},
      })
      if (!resp.ok) fail(resp.error ?? `${command} failed`)
      out(resp.info ?? 'recorded')
      return
    }

    case 'handoff': {
      const flags = new Flags(rest)
      const [taskId, ...words] = flags.positionals
      const to = flags.values.get('to')
      if (taskId === undefined || to === undefined) fail('usage: idealize handoff <taskId> --to <session> [reason]')
      const reason = words.join(' ').trim()
      const resp = await send({ command: 'handoff', task: taskId, target: to, ...reason === '' ? {} : { body: reason } })
      if (!resp.ok) fail(resp.error ?? 'handoff failed')
      out(resp.info ?? 'offered')
      return
    }

    case 'accept':
    case 'reject': {
      const flags = new Flags(rest)
      const [taskId, ...words] = flags.positionals
      if (taskId === undefined) fail(`usage: idealize ${command} <taskId>${command === 'reject' ? ' [reason]' : ''}`)
      const reason = words.join(' ').trim()
      const resp = await send({ command, task: taskId, ...reason === '' ? {} : { body: reason } })
      if (!resp.ok) fail(resp.error ?? `${command} failed`)
      out(resp.info ?? command)
      return
    }

    case 'decide':
    case 'synthesis': {
      if (rest.length === 0) fail(`usage: idealize ${command} <text>`)
      const resp = await send({ command, body: rest.join(' ') })
      if (!resp.ok) fail(resp.error ?? `${command} failed`)
      out(resp.info ?? 'recorded')
      return
    }

    case 'studio': {
      const flags = new Flags(rest, ['json'])
      const path = flags.values.get('path')
      const resp = await send({ command: 'studio', ...path === undefined ? {} : { path: resolve(path) } })
      if (!resp.ok) fail(resp.error ?? 'studio failed')
      const tasks = resp.tasks ?? []
      if (flags.bools.has('json')) {
        printJson(tasks)
      } else if (tasks.length === 0) {
        out(resp.info ?? 'no tasks yet')
      } else {
        for (const task of tasks) {
          out(`${task.id} [${task.state}] ${task.goal} — ${task.ownerLabel ?? task.owner}`)
          if (task.attention !== 'none') {
            out(`  ! ${task.attention} → ${task.attentionOwnerLabel ?? task.attentionOwner ?? 'unassigned'}`)
          }
        }
        if (resp.synthesis !== undefined) {
          const first = resp.synthesis.body.split('\n')[0] ?? ''
          out(`synthesis${resp.synthesis.stale ? ' (stale)' : ''}: ${first.length > 120 ? `${first.slice(0, 120)}…` : first}`)
        }
      }
      return
    }

    default:
      fail(`unknown command '${command}'. Run \`idealize help\`.`)
  }
}

main().catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)))
