# Agent Note: The weekly documentation review is offered at setup and stays off until accepted

Status: implemented

## Problem

JJ's own documentation folder is tidied each Monday by a launchd job that runs a command stored in the folder. Other IDEalize users have neither, so their notes lose frontmatter, links and index lines as agents and people add to them. JJ's command also carries her own folder names, a spreadsheet service and a meeting tool, none of which another person has. Her review on 16 Nov 2026 rewrote `research` to `reference` and `building` to `active`, which discarded a distinction the writer had made on purpose. JJ approved an IDEalize weekly review on 16 Nov 2026 (decision D4 of the knowledge and playbooks scope): offered at setup once a documentation folder is chosen, off until the person accepts, Monday 08:00 local time, with the documentation folder as its workspace.

## Decision

`@idealize/setup` owns the review, because it owns the moment a documentation folder is chosen.

- **The skill.** `packages/idealize/setup/skills/vault-review/SKILL.md` keeps the method of JJ's command (find the notes changed in 7 days, apply mechanical fixes, flag judgement calls, write a dated note) and nothing specific to her folder. Her excluded folders became two settings in the `idealize-vault-review` section: `skipFolders` and `neverEditFolders` (default `sessions`, the transcripts `@idealize/vault` writes). A `@deepseek-ai/dsh-skill-filesystem` child with `bundledSkillDir` registers the skill, so it is listed in every chat's catalogue and can be run by hand.
- **The offer.** `GET` and `POST /idealize/setup/weekly-review` report and accept it. `@idealize/onboarding`'s documentation step shows one unticked box once the folder passes its probe, and calls the route on Continue only when the box is ticked. Accepting saves one `@idealize/cron` entry as the person's own, so it arms at once.
- **The settings reach the model in the entry's instructions.** `reviewPrompt` names the skill and lists both folder lists. A changed list or documentation folder rewrites the accepted entry.
- **The scheduler accepts the documentation folder.** `IdealizeCron.assertTaskFolder` let a chat run only in an opened project or the app's own folder. It now also passes the folder `ctx.docPolicy.folder()` reports, and only that folder. A documentation folder that is the home folder or holds it is refused, which keeps the case the check was written for (security audit, 9 Oct 2026).
- **The never-edit list is enforced for the file tools.** `@idealize/cron` emits `idealize/cron-run-started(task, sessionId)` before a run's chat receives its instructions. The review records its own entry's session and, until `idealize/cron-run`, a prepended `fs/write-intent` and `fs/edit-intent` listener refuses a target inside a never-edit folder.
- **The review reads the folder itself.** It flags `stale`, `index-oversize`, a missing `description` and skills with new learnings by reading frontmatter, counting characters and reading `Reference/playbook-learnings/`, under the names `@idealize/doc-policy`'s scan uses. It needs no scan result, so it works on a build whose scan does not raise those findings.
- **It never chooses or rewrites a `type` or `status`.** The skill adds a `type` only when the field is missing, never adds a `status`, and flags an unrecognised value grouped by value. It does not write `last_touched`, which other tools own.

## Alternatives considered

**A package of its own.** A new workspace package needs a profile row, root config entries and a vendoring step in the desktop app before any user receives it. The review has one settings section and one route, both about the documentation folder setup already captures.

**A `ctx` service for the review.** Its only callers are setup's own route and its `documentation` alias write, so the plugin body holds one `WeeklyReview` object and passes `WorkspaceAliases` a callback.

**Creating the entry switched off at setup.** A paused entry nobody asked for would sit in every person's Schedule pane. The entry exists only once the person accepts.

**Feeding the scan's findings to the review.** The scheduler sends an entry's stored instructions verbatim, and a chat has no tool that returns scan findings. Reading the folder gives the same facts without a new tool.

**Enforcing the never-edit list in the sandbox.** The sandbox expresses a mode as a list of writable roots shared by the Seatbelt profile and the in-process file check; it has no list of read-only folders inside a writable root. Adding one changes three upstream packages.

## Consequences

Three guarantees rest on the skill's instructions alone: the review never renames, moves or deletes a note; it leaves an unrecognised `type` or `status` as written; and it keeps shell commands out of a never-edit folder. The skill tells the model to change files with the file tools only, which is where the refusal applies. A comparison of note paths before and after a run would detect a rename and is not built.

A scheduled chat can now run in one folder that is no project. The chat is confined to that folder and cannot ask for permission, as every scheduled chat is.

The offer appears in the first-run wizard. A person who finished setup earlier sees it by running setup again from Settings.

Evidence: `packages/idealize/setup/tests/review.spec.ts` (the offer, the entry and its schedule, the settings, the listed skill, the refused writes), `packages/idealize/cron/tests/routes.spec.ts` ("runs a chat in the documentation folder itself" and the refusal cases), and `packages/idealize/onboarding/tests/folders-finish.client.spec.tsx` ("the weekly review offer"). No test runs the skill against a model; `packages/idealize/setup/tests/review-fixture.ts` builds the folder for that run.
