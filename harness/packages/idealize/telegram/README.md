# @idealize/telegram

Directs the Studio from a phone. The person creates a Telegram bot with @BotFather, pastes its token into the Telegram remote row in General settings, and pairs one chat. The app polls Telegram for new messages from inside the running process (`getUpdates` long polling), so there is no server and no public URL. As a result the bot answers only while IDEalize is open. The `idealize-telegram` row of the `idealize` profile bundle mounts it. It stays idle until a token is stored.

## Pairing and trust

The Settings row issues a six-digit code (`POST /idealize/telegram/pair`). The person sends `/pair <code>` to the bot, and the chat that sent a live code becomes the only chat the bot obeys; its id is stored as `chatId` in the `idealize-telegram` settings section.
- **Code rules.** A code is single-use and expires after `pairCodeTtlMinutes`. It is withdrawn after `maxWrongPairCodes` wrong guesses, because anyone who learns the bot's username can message it.
- **Other chats.** `/pair` is the only thing another chat can do. Its other messages and button presses are ignored without a reply.
- **Unpairing.** `DELETE /idealize/telegram/pair` clears `chatId`.

The token is the credential `IDEALIZE_TELEGRAM_BOT_TOKEN`, resolved on every poll and every send and never written to the settings document. `POST /idealize/telegram/token` checks a token with `getMe` before storing it; an empty token removes the stored one. Refusals:
- 400 for a malformed token, or one Telegram rejects.
- 502 when Telegram cannot be reached.
- 409 when the launching environment sets the credential.

No message this package logs or returns quotes a request URL, because the token is part of it.

## From the phone

| Sent | Effect |
|---|---|
| Plain text | `ctx.idealizeStudio.postFromChat(text, 'telegram-<chat>-<message>')`. This is the same call the Studio chat composer makes, so a leading `@name` reaches one agent and anything else reaches the Studio coordinator. The message id is stable per Telegram message, so a redelivered update does not post twice. The bot replies only when the post was queued, the name did not resolve, or the coordinator could not start. |
| `/status` | Running agents, how many approvals and questions wait on the phone, and every open task (queued, working, waiting or paused) across the Studio overview |
| `/agents` | comm's roster with running or idle state |
| `/stop <name>` | Resolves the name with comm's `resolveTarget`, asks for confirmation, then calls `cancel({ kind: 'user' }, { keepInbox: true })`, the same call as the app's stop button |
| Approval buttons | Allow once or Deny |
| Question buttons | A single-select option answers; a multi-select question ticks options and sends on Done; Other and option-less questions take the next text message as the answer. A request with several questions shows them one at a time and sends all answers together. |
| Anything else starting with `/` | The help text |

A message older than `staleAfterMinutes` is refused with a request to send it again. Telegram keeps undelivered updates for a day, so without this limit a command sent while the Mac slept would run when the app next opened.

## Approvals and questions

`Relay` reads `ctx.apiProxy.events.mux` in-process, which is the stream the app window reads. Every `approval/requested` and `question/requested` frame becomes one message with buttons, and answers go through `ctx.apiProxy.respond`.
- **First answer wins.** If the window answered first, `respond` reports the request as not pending, and the phone message changes to "Already answered in the app". If the phone answered first, the window receives `approval/resolved` or `question/resolved` and clears.
- **Resolution edits.** Resolved frames edit the phone message to show the outcome.
- **Reopening.** The stream reopens after `muxReopenDelayMs` when it ends, and whenever the paired chat or the approvals toggle changes. The proxy replays still-pending requests on open, and the relay skips requests it already sent (keyed by approval id or question request id).
- **Button data.** Buttons carry a short id into an in-process table, because Telegram caps button data at 64 bytes. After a restart the old buttons answer "No longer waiting", and the replay sends the requests still pending as new messages.

## To the phone

Each kind has a toggle in the settings section, all on by default:

| Toggle | Sends |
|---|---|
| `forwardStudioReplies` | Studio coordinator posts: `message` events on the Studio timeline not authored by the person and not addressed to another participant |
| `forwardTaskEndings` | One line per `task-update` whose subtype is in the Studio's `ENDING_WORDS`, on project timelines. The Studio already posts endings on its own timeline as messages, which arrive as coordinator posts. |
| `forwardAttention` | The bridge feed's `attention` events (the Studio alerts `@idealize/notify` raises) and `agent-error` events |
| `forwardApprovals` | Approvals and questions, described above |

The bridge's `agent-finished` is not sent, because it fires each time an agent goes idle, which is every turn.

While the Studio coordinator works on a note from the phone, the chat shows "typing…" (JJ, 15 Sep 2026): a note that reaches the coordinator starts a repeated `sendChatAction`, every 4 seconds since Telegram clears one after about five, and it stops when the coordinator's reply is forwarded, when the bridge reports the coordinator's turn finished or failed, or after 120 seconds if neither arrives. Nothing shows for a note that reached nobody.

## Configuration

| Key | Default | Meaning |
|---|---|---|
| `apiBase` | `https://api.telegram.org` | Bot API origin |
| `holdSeconds` | `50` | Long-poll hold |
| `requestTimeoutMs` | `15000` | Timeout for an ordinary call; a poll adds its hold |
| `retryDelaysMs` | `[2000, 10000, 60000]` | Backoff between polling failures; the last repeats. HTTP 429 waits for Telegram's `retry_after` instead. |
| `staleAfterMinutes` | `10` | Refuse older messages |
| `pairCodeTtlMinutes` | `10` | Pairing code lifetime |
| `maxWrongPairCodes` | `5` | Wrong guesses before the code is withdrawn |
| `muxReopenDelayMs` | `2000` | Wait before reopening the approvals stream |

## Routes (loopback; mutations need `x-idealize-auth: 1`)

- `GET /idealize/telegram/status` returns `TelegramStatus` with these fields:
  - `configured`, `shadowed`, `botUsername`, `paired`
  - `pairing` (the live code and its expiry)
  - `problem` (a plain-words line for a rejected token, an unreachable Telegram, or another client polling the same bot)
- `POST /idealize/telegram/token` takes `{ "token": "..." }` and returns the status.
- `POST /idealize/telegram/pair` issues a code; it returns 400 before a token is stored. `DELETE /idealize/telegram/pair` unpairs. Both return the status.

## Model Experience

Indirectly, through the Studio delivery the paired chat's text becomes, whose mailbox note `@idealize/comm` owns.

#### KV Cache effect

None of its own: a Telegram post enters an agent's context exactly as the same text typed in the Studio chat, and answering an approval or question changes only the outcome the tool call already waits for.

## Known Limitations and Deferred Work

- **The bot is down while the app is closed or the Mac sleeps.** Messages sent meanwhile are refused as stale when the app reopens, and alerts raised meanwhile are never sent. An always-on relay would need a hosted service.
- **Two running copies share one bot badly.** Telegram serves updates to one poller at a time and answers the other with HTTP 409. The losing copy keeps retrying and reports the conflict in Settings, so a scratch copy of the app must not compose this plugin with the live token.
- **Approvals only reach the phone while the approvals stream is open.** A composition without the API proxy sends none, and nothing warns the phone about it.
