# Agent Note: Group-chat follow-ups — retired preset opt-in, group-post wake, recovery copy unified

Status: implemented

The four follow-ups JJ answered on 2 Sep after the lead retirement landed: the seeded Lead Agent preset survives as an opt-in with no space; a group post wakes the coordinator; onboarding's media recovery copy and add-key action now match the Brains pane; and the brains-presets proof was repaired to assert the current behaviour.

## Problem

Four gaps were left by the lead retirement (`85cd9b1418`) and the earlier media work. Seeded `lead-agent` presets in existing stores would have landed in the Brains roster as a live space-holding brain, contradicting the retirement. A group post recorded on the Studio timeline woke nobody, so the coordinator missed the conduit it is supposed to read. Onboarding's Tools step showed different recovery sentences from the Brains pane for the same route verdict and offered "Add OpenRouter key" when `keyMissing` was false, promising a recovery that changes nothing. The brains-presets proof asserted the pre-retirement roles row, the old recovery copy, and an add-key walk the gating removed — ten failing checks, all pre-existing on main.

## Decision

- `RETIRED_ROLE_PRESETS` (`spaces/src/space-table.ts`) lists presets that default to **no space**: they render under Brains' "Agent roles" section and join a space only when the user stores a spaces list. Both `rolePresets()` helpers (spaces roster, activity-pills) append the constant, so the preset stays electable without being seeded into any space.
- `wakeLine` (`comm/src/service.ts`) treats a `message` event without a `target` as a group post and wakes the coordinator with `group post from <author>: <body>`; an addressed message still wakes nobody but its recipient path.
- Onboarding renders media recovery through the same structured-reason locale table the Brains pane uses (`tools.recovery.*` matching `brains.media.recovery` values) and gates its add-key action on `availability.keyMissing === true`, mirroring `BrainsPanel.tsx`.
- The proof (`ui-bar/proof/brains-presets-proof.mts`) asserts the coordinator-only roles row, the localised recovery sentences, and **no** add-key action on either surface — the fixture backend is credentialed, so `keyMissing` is false and a key would change nothing. The retention walk leaves Tools through `[data-onboarding-back]`; the add-key→agents route stays covered by the jsdom suite.

## Alternatives considered

- Deleting seeded `lead-agent` presets on load: destroys a user's stored instructions; opt-in keeps the data and removes the prominence, which is what JJ asked for ("allow a user to elect to use it rather than having it as a standout feature").
- Waking every roster member on a group post: the coordinator is the only participant whose job is reading the room; workers get addressed messages.
- Forcing `keyMissing: true` in the proof composition so the add-key walk survives: fakes the environment to preserve a test path; the jsdom suite already covers the route with a true flag.

## Consequences

- A retired preset id only ever joins `RETIRED_ROLE_PRESETS`; removing one from the list would re-seed it into spaces, so the constant is append-only.
- The wake contract now includes unaddressed messages; anything recording `kind: 'message'` without a target on a project timeline wakes that project's coordinator.
- Recovery copy has one home per surface pair: the locale tables. The server's `recovery` string remains the fallback for reasons the table does not map.
