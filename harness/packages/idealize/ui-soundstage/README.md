# @idealize/ui-soundstage

The Sound Stage: this chat's generated sounds as a list with a player, taking its own entry in the conversation view ring beside Chat and Terminal. The ring renders no tab row; a chat lands here because it was launched into Sound Stage, and stays here for its life.

The package is browser-only in effect. The client half registers one `conversation.view` entry, `soundstage`, at order 7, after the Images grid's 6. The host face registers nothing. Bytes are not served here: each row's `<audio>` element streams from `@idealize/artefacts`'s `GET /idealize/artefacts/raw?id=`.

## Where the rows come from

`@idealize/ui-gallery`'s Definitions publish one row per generation this chat ran, whatever it made, and one row per turn of the chat; the Sound Stage reads that per-session `gallery` view target and renders the rows whose `artefactKind` is `audio` beside the turns still thinking or ended with nothing made. Images and video from the same chat belong to their own spaces, and another chat's sounds never appear here (JJ, 4 Sep 2026: the galleries for sound, image and video are all chat-specific).

Rows come in five kinds, interleaved newest first by their position in the log:

1. **Turns still thinking** — from the moment a message is sent until the model calls a generation tool or the turn ends: the prompt, **Thinking…** and a progress bar (JJ, 8 Sep 2026: posting a message "looks like it's not working").
2. **Generations in flight** — every `generate_audio` call the conversation snapshot reports as running, with its prompt, **Generating…** and the same bar.
3. **Turns that made nothing** — a turn that ended without a generation call shows its prompt and the model's last reply in the sound's place ("Nothing was generated this turn." or "Stopped." when it left no text), so the person reads what the model said instead of an empty list.
4. **Failures** — a failed `generate_audio` call prints the adapter's provider cause and offers **Retry**, which writes the failing prompt back into the composer and sends it. A background generation settles its call before the work runs, so its failure arrives as an `artefact/failed` chat node instead; those rows carry the cause without a Retry, because the prompt left the window with the call.
5. **Stored sounds** — the chat's committed `audio/*` artefacts, each with a player, its project-relative file path, the byte size, the recorded length and when it was made. **Reveal**, **Keep** and **Archive** show on hover or focus only (`visibility: hidden` with no pointer events at rest; always shown where `hover: none`), so a settled list reads as sounds.

Nothing is re-read on demand and there is no Refresh button: the rows come from the live conversation snapshot, so a sound appears the moment its artefact event lands. For the packaged walk the DOM carries `data-soundstage-turn="thinking|no-generation"` and `data-soundstage-reply` on the turn rows, `data-soundstage-generating` on a running one, and `data-soundstage-sound` on a stored sound.

## Keep and Archive

Every stored sound carries the same verdict the Images grid does. **Archive** posts to `@idealize/artefacts`' `POST /idealize/artefacts/disposition`, which moves the file into the archive subfolder and logs the verdict; the sound leaves the list for a collapsed **n archived** fold beneath it. **Keep** on a folded sound brings both the file and the row back. The files themselves live in the project folder either way, so a chat is where sounds are seen and the project is where they are stored. **Reveal**, beside the verdict, opens the tool rail's Files pane on the file: the row raises `@idealize/artefacts`' `idealize:reveal-artefact` document event with the sound's project-relative path, and `@idealize/ui-bar` resolves it against the chat's project and lights the row.

## The length control

The composer's tool row carries `@idealize/ui-gallery`'s generation settings strip while the Sound Stage is the active view; this package registers no composer seat. The strip shows the fields the active sound model publishes on `GET /idealize/generate/inputs?space=soundstage` (fal's `minimax/music-3` publishes `duration` as a number from 1 to 300 with a default of 60, so the strip shows a `Length` number input), and falls back to one compact `Length` select (Auto, 5, 15, 30 seconds) when the model publishes no schema. A chosen length is written into the draft as the trailing tag `[duration 15]`, which the tool maps to `generate_audio`'s duration; Auto takes the part back out. The tag grammar, the refetch on `idealize:brains-changed` and the DOM attributes are documented in `@idealize/ui-gallery`'s README.

## Routes

None. Until 4 Sep 2026 the host face served `GET /idealize/soundstage/sounds?cwd=`, a project-wide listing of every audio artefact in the workspace. Making the stage chat-specific left that route with no reader, so it was deleted along with its `limit` config field rather than shimmed.

## Configuration (`idealize-ui-soundstage` row)

None. The host face registers nothing and the client half derives its list from the conversation snapshot.

## Rendered proofs

`packages/idealize/ui-soundstage/proof/soundstage-proof.mts` boots the real composition (storage, sessions, workspaces, the webserver, `@idealize/artefacts`, `@idealize/generate`, `@idealize/gen-fixture`, `@idealize/gen-tools` and this package), runs the real `generate_audio` tool through the real tool registry into four project chats, then renders this view over the session logs those runs left, at 1280x840 in both themes:

```sh
OUT=.idealize/proof pnpm exec tsx packages/idealize/ui-soundstage/proof/soundstage-proof.mts
```

It writes `soundstage-{list,playing,archived,generating,error,empty}-{light,dark}.png` and fails the run unless every row names its file under `Sounds/`, the tone row's `<audio>` reaches `readyState` 4 with a one-second duration and an advancing `currentTime` off `GET /idealize/artefacts/raw?id=`, Archive through the real disposition route moves the file under `Sounds/Archive` and the row into the fold while Keep moves both back, the in-flight row is present, the failed row carries the provider's cause and one Retry, and the empty state says the chat is empty rather than the project. Two backends serve the runs: `@idealize/gen-fixture`'s silent WAV, and a proof-only backend on the same `ctx.generation` seam that synthesises a 440 Hz tone (the fixture payload decodes to a zero duration, so only a real tone can prove playback) plus the never-settling and always-refusing models the other two proofs need.

## Model Experience

Indirectly, through the prompt Retry resubmits, which reaches the model as ordinary user-message text; the view registers no tool, prompt contribution or session event, and reads only the per-chat rows `@idealize/ui-gallery` folds out of the session log. The length tag on the draft belongs to `@idealize/ui-gallery`'s strip.

#### KV Cache effect

Independent: a retried prompt is a user turn appended after the reusable prefix; nothing this package does changes a request prefix.

## Known Limitations and Deferred Work

- **A generation whose `tool/call` fell out of the loaded window renders no row.** The rows start at the call, so paging further back is what recovers older sounds; nothing here fetches artefact records independently of the log.
- **A background generation shows nothing while it runs.** `dsh-jobs` publishes no session events, so a `run_in_background: true` generation is invisible between its call settling and its `artefact/created`. Restoring the in-flight row needs a job event vocabulary this package cannot add alone.
