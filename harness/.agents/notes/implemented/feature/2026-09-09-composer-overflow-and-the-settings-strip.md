# Agent Note: The composer's standing settings move into a three-dot control, and the space's own settings read as a set

Status: implemented

JJ, 9 Sep 2026: "the main ask bar settings is a mess - my suggestion is to put workspace permissions and brain choice in a 3-dot nav and then properly style the area specific settings."

## Problem

On a media space the composer's tool row carried five kinds of control at once, in no order a reader could use. The access chip ("Workspace Write") sat at the left end, the brain chip ("Gallery") at the right end beside the send button, and between them the generation settings strip laid out whatever the active model's schema published — Aspect, Resolution, Duration, Count, Thinking level. Two of those controls belong to the chat and change once a week; the rest belong to the picture or the clip the person is about to make and change on every message. The row gave both the same weight and the same shape.

The strip had a second fault of its own. `useCompact` measured the row and switched between two layouts: label beside control while there was room, label stacked above it when there was not. The same three settings therefore sat on one line at one window width and on two lines at another, and the width where it flipped was wherever the sibling chips happened to overflow. A number field stacked into three lines rather than two, because the unit ("s" after a duration) was a sibling of the input rather than a child of one box, so the column put it on a line of its own. Each select sized to its own longest option, so Aspect, Resolution and Count stood at three different widths.

The access chip was a fixed element of `InputBar`, not a seat, so no plugin could move it. The plan chip immediately beside it already had one.

## Decision

**A new upstream seat, `conversation.input.access`.** Single, session-scoped, declared beside `conversation.input.plan` and rendered at the same place in the tool row. It is the one composer seat that renders something while unoccupied: `renderSlot`'s documented `fallback` option carries the bar's own permission chip, so a composition without an occupant is unchanged, byte for byte. An occupant receives that chip as `control` on its owner share (`InputAccessOwnerProps`), already built, and decides only where it goes. The bar keeps ownership of the permission affordance, its menu, and its full-access confirmation; the seat moves the element, never the behaviour.

**`@idealize/activity-pills` occupies it with `ComposerOverflow`.** A 28px three-dot button on the tool row opening a panel above the composer card, holding two labelled rows: Project access (the `control` the seat handed in) and Brain (this package's `BrainSwitcher`, unchanged except for its props type). The package stops occupying `conversation.input.model`, so the brain chip leaves the row's trailing group, and the send button now follows the context meter directly. The overflow owns the brain half already, which is why it lives here rather than in `@idealize/ui-bar`: the switcher needs the injected brain face (`hooks.brainSwitcher`, `load`, `select`, `addBrain`), and no other package can supply it.

The panel closes on a `pointerdown` landing on the page, and stays open for one landing inside an element with `role="menu"` or `role="dialog"`. Both controls it holds open portalled menus, which render into the body and therefore outside the panel's own subtree; without that exception the panel would close underneath the menu it had just opened. `pointerdown` rather than `click` for the same reason — the close would otherwise run before the menu row's own handler. A removed session (`locked`) shuts the panel and refuses the trigger.

**The strip stacks its labels at every width.** `.control` puts the label above its control unconditionally; the compact flag now closes the gaps from 10px to 8px and changes nothing else. The measurement stays because the row still needs to know it is short, and the strip no longer changes shape as the window moves. A number field's input and unit share a `.numberBox`, so a stacked control is two lines and not three. Every select takes a `min-width` of 4.75em and the number input 4.5em, so the settings read as one set rather than as three widths.

**The disabled send button dims to 0.75, not 0.4.** At 0.4 a warm action colour washes to a pale tint — #FF7B00 at 100% renders as #FFCA99 over white — which reads as a different colour from the one chosen in Appearance, whose own copy promises that buttons keep it. The button still reads inactive at 0.75 and the hue stays the chosen one.

## Alternatives considered

**Shadow the two seats from `@idealize/ui-bar` and rebuild both controls inside a menu.** It needs no upstream change, and it duplicates the permission affordance: the option list, the `/permission` write, the full-access risk dialog and its copy. Two permission surfaces that must agree is exactly what a seat avoids.

**Hide the chips with CSS and render copies in the panel.** Cheaper still, and it leaves both originals mounted and reachable by keyboard while invisible.

**Put the settings in the `Menu` primitive as rows.** The panel would then be a list of choices rather than a place where the two existing chips live, and each chip's own menu would have to become a submenu. The chips are already built and already correct.

**Keep the two strip layouts and fix only the unit and the widths.** The flip between them is the fault JJ named: a settings row that changes shape as the window moves cannot be learned. Stacking always costs one line of height on a wide window and buys a layout that holds still.

**Give the disabled send button the full colour.** It would honour the Appearance copy exactly, and a disabled primary button that looks live is worse than one that looks dim.

## Consequences

The composer's tool row on a media space now reads: the command launcher, the space's own settings each under its label, the three-dot control, then the plan icon, the context meter, the Return toggle, the heart and send. The access mode and the brain are one click away rather than at the two ends of the row. A composition without `@idealize/activity-pills` still renders the permission chip in place, through the seat's fallback.

The brain chip no longer names the current brain on the row, so reading which brain a chat runs takes a click. `data-brain-switcher` still identifies the trigger, now inside `[data-composer-overflow-panel]`, and any walk or proof that reads it must open the panel first.

Upstream touches logged in FORK.md: `packages/client/ui-conversation` gains the seat (`contract/slots.ts`, `apply.ts`, `skeleton/InputBar.tsx`, its input-bar spec), and `skeleton/InputBar.module.css` raises the disabled send opacity. `slot-catalog.ts` regenerated with `conversation.input.access`.
