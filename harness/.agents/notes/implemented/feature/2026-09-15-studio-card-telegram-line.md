# Agent Note: Studio card — the Telegram status line

Status: implemented

## Problem

The pinned Studio card's second line read "Watching every project's agents", a fixed caption carried over from V0's lead-agent card ([wave E](2026-09-03-wave-e.md)). JJ wanted the line to carry a fact: "instead of this 'watching' message - can you put a status line for 'Telegram - Connected' or 'Telegram - Not Connected'". The Telegram remote is how the Studio is directed from a phone, and its standing was visible only in Settings.

## Decision

The card's second line reads `Telegram - Connected` or `Telegram - Not Connected`, marked `data-studio-card-telegram="connected|disconnected"`. Connected means `GET /idealize/telegram/status` answers a stored bot token, a paired chat and an empty problem; a token alone sends nothing, so it reads as not connected. The card's `sync` reads the status alongside the Studio overview on the same 3-second poll, so the line follows a pairing or an unpairing made in Settings without a reload. A refusal, a host that is away, or a composition without the Telegram row reads as not connected. The line's two keys replace `studio.card.subtitle` in both dictionaries. Owners: `packages/idealize/ui-bar` (the card and its poll); `packages/idealize/telegram` (the status route it reads).

## Alternatives considered

**Sharing the Telegram row's client store.** The row's store lives in `@idealize/telegram`'s client plugin and refreshes only while a pairing code is live; the client bundle purity gate forbids a value import across plugins, and a shared service for one boolean is more seam than the line needs.

**Counting a stored token as connected.** The Settings row says "Connected to @bot" once a token resolves, but the remote does nothing until a chat pairs; the card answers the question JJ asks of it, whether the phone is wired up.

## Consequences

The card makes one more loopback request every 3 seconds while a project is listed, the same cadence as the overview read. The status is derived in the card's plugin from three response fields, so a change to what the route answers has two readers to keep aligned: the Settings row and the card. Evidence: `ui-bar/tests/studio-card.client.spec.tsx` (the line reads disconnected then connected from the injected store; the plugin's `sync` derives connected only from a stored token, a paired chat and no problem, and reads not connected on a 404 or a failed fetch).
