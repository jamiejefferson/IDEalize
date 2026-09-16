# Agent Note: a keys file connects several services at once

Status: implemented

JJ, 14 Sep 2026, planning the V1 release: an the team-internal version "that includes eqtr api keys for claude, openrouter, and fal, so it's ready to go", decided as one public build plus a small keys file rather than a second build with the keys inside it.

## Problem

A colleague installing IDEalize at the team should not have to find three dashboards, mint three keys and paste each into the Brains pane before anything works. Baking the keys into a separate build would do that, and it is the wrong shape: anyone holding the DMG can unpack the ASAR and read them, rotating one key means rebuilding and redistributing the app, and the public and internal builds would drift. The store the app already has (`$DSH_HOME/.credentials.yaml`, the writable layer of `@deepseek-ai/dsh-credentials-local`) is the right place for the keys; what was missing was a way to fill it from a file in one action.

## Decision

**One JSON document, one route, both surfaces.** A `.idealizekeys` file is `{"format": 1, "credentials": {NAME: key, …}}`. `POST /idealize/brains/services/import` in `@idealize/services` reads it, matches every credential name to the service that takes it (the chat route whose derived `<ROUTE>_API_KEY` it is, else the generation backend declaring the name) and stores each through the same write the single-key POST uses, so a chat route's `apiKeyEnv` lands in the `llm-pi-ai` settings section and a media backend's catalogue is re-read. The desktop app registers the extension with Launch Services (`build.fileAssociations`) and posts a double-clicked file to the route, then raises a notification naming what connected; the Brains pane's add flow carries an "Import a keys file…" link for a file already on disk. The file is sent as read: the host owns what a keys file may say.

**All or nothing.** Every name is matched before any key is stored. A name no service takes refuses the whole file, naming it, so a person never ends with half a file connected and no way to tell which half.

**The file layer, so a person can still override.** The keys go into `.credentials.yaml`, which the launching environment outranks and which a pasted key replaces. Injecting the keys into the process environment instead would have made every key read-only in the Brains pane (the store answers 409 when the environment supplies a key), which is the wrong default for a colleague who later wants their own account on one service.

## Addendum, the same afternoon: a key stored for a sign-in route

JJ, from the phone, after pairing Telegram: "Poe Dameron hit an error. Failed to extract accountId from token". The Studio's agent ran on the ChatGPT (Codex) route, whose only auth is sign-in: pi-ai sends the stored ChatGPT token and reads the account id out of it. The app's harness credentials carried an `OPENAI_CODEX_API_KEY` whose value was not a token at all, the route's profile recorded that name, and `llm-pi-ai` adds a harness key method beside an OAuth-only catalog provider whenever the profile names a credential, so the pasted value went out as the token and every turn on the route failed while a valid sign-in sat unused in the OAuth store. How the value got there is not recorded; the services list never marked ChatGPT as sign-in (`chat()` dropped the mark it computed), so the Add-a-service card and the keys-file import could both have taken a key for it.

The OAuth face's status rows now carry `keyless` (the catalog provider declares no API-key method); the services list marks those routes `signIn`, so the route refuses a new key for them while an empty key still removes a stray one; removing any chat key also drops the `apiKeyEnv` the plugin recorded, and the models page reads a keyless route as sign-in whatever its profile says. JJ's stray key was removed through the app's own route at 15:4x; the record follows on the next empty POST from the landed build. 259 tests across services, provider-pack and models pass.

## Alternatives considered

**A second build with the keys inside.** Extractable by anyone holding the DMG, and a rotation is a rebuild. Rejected.

**A build-time patch layer setting the keys.** Configuration carries credential references, never values (`packages/credentials/README.md`); a patch can name `apiKeyEnv` but cannot supply the key.

**An `idealize://keys?…` URL.** A URL with three keys in it lands in browser history, Slack previews and shell history. A file can be shared through a drive that limits who can open it.

**Encrypting the file.** A passphrase shared beside the file protects nothing the file's channel does not; the honest statement is that whoever holds the file holds the keys, which the READMEs now say.

## Consequences

- `@idealize/services`: `storeKey` is the one write behind both routes; `KEYS_FILE_FORMAT` is exported. Tests cover the join, the whole-file refusal, each malformed-file reason, the 409 partway, and the fences.
- `@idealize/ui-bar`: `data-services-keys-file` and `data-services-import` in the Services add flow; the status line names what connected.
- Desktop: `src/keys-file.ts` (recognising the extension in `open-file` and argv, reading with a size cap, posting to the route), `fileAssociations` in `package.json`, `scripts/issue-keys-file.mjs` to write a file from three environment variables so the keys never enter a repository.
- A wrong-but-well-formed key reads as connected until its first request fails, as with a pasted key; the import verifies nothing.
- The Claude Code CLI in the Terminal space signs in on its own subscription and reads no stored credential; the keys file does not reach it.
