# Agent Note: the phone shows "typing…" while the Studio coordinator works

Status: implemented

JJ, 15 Sep 2026, once Studio replies reached the phone again: "there's no 'typing' message in telegram so it doesn't look like its working. can that be fixed?"

## Problem

A note from the phone reached the coordinator and the reply arrived a minute later; between the two the chat showed nothing, and a person reading a messaging app takes silence for failure. Telegram's own signal for this is a chat action, which the app shows for about five seconds after each `sendChatAction`.

## Decision

`@idealize/telegram` gains a `Typing` indicator over the messenger: started when an inbound note is delivered to the coordinator (a note that reached nobody shows nothing, the reply already says why), repeated every 4 seconds, and stopped when the coordinator's post is forwarded or when the bridge reports the coordinator's turn finished or failed, whether or not those are forwarded. A 120-second cap ends an indicator nothing stopped, so a turn the bridge never reports cannot leave the phone "typing" for good. The Bot API client gains `sendChatAction`, the messenger port gains `typing()`, and the plugin disposes the timer with its scope.

## Alternatives considered

Sending a placeholder text ("Working on it…") and editing it into the reply would have put a message in the chat for every note, including ones that fail, and Telegram already has a signal for this moment; the chat action costs nothing in the transcript. Starting the indicator when the note arrives rather than when it is delivered would have shown typing for a note that reached nobody, whose reply already says why.

## Consequences

The phone shows "typing…" from delivery until the coordinator's post is forwarded or its turn ends, refreshed every 4 seconds, and never for more than 120 seconds without a stop. A turn the bridge never reports therefore ends the indicator by the cap rather than leaving the chat typing for good. The messenger port carries `typing()` for any other surface that wants the same signal.

## Evidence

`tests/typing.spec.ts` (repeat, stop, cap, failure reported), the chat action in `api.spec.ts`, `typing` in `messenger.spec.ts`, the start in `inbound.spec.ts`, and the stops in `outbound.spec.ts`; 139 telegram tests pass. The live proof is JJ's phone after the landing.
