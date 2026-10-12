#!/usr/bin/env node
/**
 * Replays the 9 Oct 2026 security audit's attacks against a running app and
 * fails when any gets through. Each attack is what a local process (an agent's
 * shell, another program) could send with `curl` before 1.0.15.
 *
 *   node scripts/security/replay-p1.mjs http://127.0.0.1:<port> [sessionId sessionKey]
 *
 * With a session id and its key (a chat shell's DSH_SESSION_ID and
 * DSH_IDEALIZE_KEY), it also checks that a chat's key opens the talk route
 * and nothing else. Run it against a scratch instance: nothing it sends
 * succeeds on a fixed build, but on an unfixed one some attacks would act.
 */

const [base, sessionId, sessionKey] = process.argv.slice(2)
if (base === undefined) {
  console.error('usage: replay-p1.mjs <base-url> [sessionId sessionKey]')
  process.exit(2)
}

const OLD = { 'x-idealize-auth': '1', 'content-type': 'application/json' }
const home = process.env.HOME ?? '/Users/nobody'

/** Every attack from the audit, sent the way the audit sent it. */
const attacks = [
  ['store a launch command the next Terminal chat runs', 'POST', '/idealize/terminal/launch', { command: 'touch /tmp/pwned' }],
  ['type into a running terminal', 'POST', '/idealize/terminal/input', { id: 'any', data: 'echo pwned\r' }],
  ['open a terminal of its own', 'POST', '/idealize/terminal/open', { key: 'x', cwd: home }],
  ['read the app key store', 'GET', `/idealize/bar/file?path=${encodeURIComponent(`${home}/.idealize/.credentials.yaml`)}`],
  ['read ~/.ssh/config', 'GET', `/idealize/bar/file?path=${encodeURIComponent(`${home}/.ssh/config`)}`],
  ['read shell history', 'GET', `/idealize/bar/file?path=${encodeURIComponent(`${home}/.zsh_history`)}`],
  ['write a file in home', 'POST', '/idealize/bar/write', { path: `${home}/.zshrc.pwned`, content: 'x' }],
  ['trash a file', 'POST', '/idealize/bar/trash', { path: `${home}/Documents/anything` }],
  ['rename a file', 'POST', '/idealize/bar/rename', { path: `${home}/a`, name: 'b' }],
  ['list home', 'GET', `/idealize/bar/browse?path=${encodeURIComponent(home)}`],
  ['spawn an agent in /', 'POST', '/idealize/comm', { command: 'spawn', path: '/', body: 'hi' }],
  ['send a note as the person', 'POST', '/idealize/comm', { command: 'send', from: 'user', target: 'any', body: 'push now' }],
  ['schedule a repeating task in home', 'POST', '/idealize/cron/tasks', { name: 'x', schedule: { kind: 'every', seconds: 60 }, prompt: 'x', cwd: home }],
  ['pair a Telegram chat', 'POST', '/idealize/telegram/pair', {}],
  ['set a Telegram bot token', 'POST', '/idealize/telegram/token', { token: '1:x' }],
  ['run a file through host.openPath', 'POST', '/api/rpc', { method: 'host.openPath', params: { path: '/System/Applications/Calculator.app' } }],
  ['read the event feed', 'GET', '/idealize/events/recent'],
]

let failed = 0
const check = (label, status, want) => {
  const ok = want.includes(status)
  if (!ok) failed += 1
  console.log(`${ok ? 'refused ' : 'GOT IN  '} ${String(status)}  ${label}`)
}

for (const [label, method, path, body] of attacks) {
  const response = await fetch(base + path, {
    method,
    headers: OLD,
    ...body === undefined ? {} : { body: JSON.stringify(body) },
  })
  await response.body?.cancel()
  check(label, response.status, [401, 403])
}

// A foreign Host (DNS rebinding) is refused before any route.
{
  const { request } = await import('node:http')
  const url = new URL(base)
  const status = await new Promise((resolve, reject) => {
    request({ host: url.hostname, port: url.port, path: '/', headers: { host: 'rebind.example' } }, (res) => {
      res.resume()
      resolve(res.statusCode)
    }).on('error', reject).end()
  })
  check('reach the app under a foreign Host name', status, [403])
}

if (sessionId !== undefined && sessionKey !== undefined) {
  const chat = { ...OLD, 'x-idealize-session': sessionId, 'x-idealize-key': sessionKey }
  const talk = await fetch(`${base}/idealize/comm`, { method: 'POST', headers: chat, body: JSON.stringify({ command: 'ping' }) })
  await talk.body?.cancel()
  const opened = talk.status === 200
  if (!opened) failed += 1
  console.log(`${opened ? 'allowed ' : 'BLOCKED '} ${String(talk.status)}  a chat's key on the talk route`)
  for (const [label, method, path, body] of attacks.filter(([, , path]) => !path.startsWith('/idealize/comm'))) {
    const response = await fetch(base + path, { method, headers: chat, ...body === undefined ? {} : { body: JSON.stringify(body) } })
    await response.body?.cancel()
    check(`with a chat's key: ${label}`, response.status, [401, 403])
  }
  const spawn = await fetch(`${base}/idealize/comm`, { method: 'POST', headers: chat, body: JSON.stringify({ command: 'spawn', path: home, body: 'hi' }) })
  const spawned = await spawn.json()
  const refused = spawned.ok === false
  if (!refused) failed += 1
  console.log(`${refused ? 'refused ' : 'GOT IN  '} ${String(spawn.status)}  with a chat's key: spawn an agent in home (${String(spawned.error ?? spawned.info)})`)
}

console.log(failed === 0 ? '\nEvery attack was refused.' : `\n${String(failed)} attack(s) got through.`)
process.exit(failed === 0 ? 0 : 1)
