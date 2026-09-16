# Agent Note: the Telegram remote for the Studio

Status: implemented

JJ: "adding telegram integration to the 'studio' agent so i could manage the agents remotely". Scope chosen by JJ for the first version: chat with the Studio, answer approvals, status and stop, completion alerts. JJ accepted that the bot works only while the app is open.

## Problem

Directing agents required sitting at the Mac. An agent waiting for an approval or a question waited until the person came back, and the Studio coordinator's replies and task endings were visible only in the app window.

## Decision

**A new host plugin, `@idealize/telegram`, polls a bot the person creates.** It calls `getUpdates` from the Electron main process, where the Host tree runs. There is no webhook, so nothing is exposed to the internet and no server is needed. The bot is down when the app is closed, and JJ accepted that.

**One paired chat is the only authority.** The Settings row shows a six-digit code, and the chat that sends `/pair <code>` is stored as `chatId` in the `idealize-telegram` settings section.
- **Code limits.** The code is single-use, expires, and is withdrawn after a configured number of wrong guesses. Anyone who learns a bot's username can message it, so the bot's trust has to come from the app and never from Telegram.
- **Other chats.** Every other chat is ignored without a reply, except for `/pair`.
- **The token.** It is a credential resolved per call and is never written to the settings document. No error message quotes a Bot API URL, because the URL carries the token.

**Text from the phone is a Studio chat post.** The plugin calls `idealizeStudio.postFromChat`, the same call the Studio chat makes. `@name` routing, coordinator start-up, delivery records and the mailbox note therefore behave identically for a typed and a Telegram message. The model-visible input is unchanged: a Telegram post enters the same delivery path as a typed one. That is why this change adds no transcript snapshot.

**Approvals and questions are answered through the API proxy's own stream.** `apiProxy.events.mux` already yields every pending `approval/requested` and `question/requested` with the rpcId that answers it, and replays pending ones on open. `apiProxy.respond` already settles the first answer and reports a later one as not pending. The relay is therefore one more reader of the stream the window reads. The phone and the window race fairly, the loser is told, and no upstream file changed.

**Endings come from the Studio's own table.** `ENDING_WORDS` is now exported from `@idealize/studio`, so the Telegram forwarder and the group chat agree on which `task-update` subtypes end a task.
- **Project timelines.** Endings there are forwarded from the `task-update`.
- **The Studio timeline.** Endings there already arrive as coordinator posts, because the Studio posts them as messages.

**Stale messages are refused.** Telegram holds undelivered updates for a day. A message older than `staleAfterMinutes` gets "send it again" instead of running hours later, when the app next opens.

## Alternatives considered

**A webhook.** Telegram would push updates to a public HTTPS URL. That needs a tunnel or a hosted relay, and it exposes an endpoint for a bot whose value is controlling the person's machine.

**An `approval/request` waterfall listener in front of the API proxy.** It would see approvals without the mux, but it would have to settle the ask itself and so race the proxy's registry. The window would never learn that the phone answered. Questions have one provider slot, which the proxy holds.

**Exposing the API proxy's pending maps.** The information is already published on the mux with the answering ids, so a new accessor would duplicate it and touch an upstream file.

**Forwarding the bridge's `agent-finished`.** It fires on every running-to-idle flip, which is every turn, so the phone would buzz for every reply of every agent.

**A Studio "stop" command in comm.** `/stop` calls `agent.cancel({ kind: 'user' }, { keepInbox: true })`, the same call as the app's stop. A comm command would give agents a way to stop each other, which nobody asked for.

## Consequences

- The bundle composes `idealize-telegram`. It is idle until a token is stored.
- `@idealize/studio` exports `ENDING_WORDS`.
- Telegram answers a second poller of the same bot with HTTP 409, and the losing copy reports it in Settings. A scratch copy of the app built from live data must disable `idealize-telegram` in its copied `cordis.patch.yml`, as it already disables `idealize-mcp-paper`.
- The package's Model Experience is recorded as indirect in `verify-package-readme-model-experience.ts`.
