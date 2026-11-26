# Agent Note: brains leave the screen, and a new chat is a Chat, a Coding session or a Studio session

Status: implemented

JJ set the brief on 24 Nov 2026 and approved the sketches with four comments on 25 Nov 2026 (Paper file Idealize, page "One core model", boards 00 to 05).

## Problem

A new chat asked for one of five spaces and then a brain, and each brain carried its own model and its own router sliders. JJ: "the model thing has become way too complicated". A person had to understand presets, routes and routing weights before typing a first message, and the screen could not say in one line which model would answer or what a generation would cost.

## Decision

**Three views.** A new chat shows three tiles: Chat, Coding and Studio. A blank chat is a Chat already, so typing needs no choice. Coding opens the Terminal space. Studio opens the media view, and its chat box carries an Image, Video, Sound toggle that moves the chat between the three media spaces and shows that kind's model and settings. The view is chosen when the chat is opened and the chat keeps it.

**Presets stay underneath.** A preset is still what gives a chat its tools and opening instructions. `@idealize/activity-pills` seeds one more, `core`, derived from `standard` with neutral instructions, and sets `agent-presets.default` to it once (`coreAdopted` in the `idealize-activity-pills` section records the move). Chat and Coding run on `core`; Studio runs on the seeded media presets. The five activity presets and anything a person authored stay on disk, and a chat that records one keeps working.

**The space ids are unchanged.** `terminal`, `gallery`, `soundstage` and `motion` keep their ids, records and views; only their labels changed ("Coding", "Studio"). The id `studio` still belongs to the project group chat, so the Studio view never uses it.

**A Studio chat's kind is recorded.** The toggle raises `idealize:studio-kind`; `@idealize/ui-bar` writes the chat's space through the existing `POST /idealize/spaces/select`, with that kind's preset and one set of instructions covering all three generation tools, so a reload reopens the chat on the kind last picked.

**The router has one set of settings.** `idealize-router` gains `mode` (`auto`, `ask`, `fixed`), `lean` (0 cheapest to 100 smartest), `excluded` (models the person unticked) and `sameCompany` (default true). Per-brain criteria and `offBrains` are ignored. A routed move stays inside the company of the chat's own model. The chip on the chat box names the model answering and holds the three modes, the slider and the tick list with prices.

**Studio asks once per paid model.** `confirmPaidGeneration` asks before the first generation on each model that may charge, naming the model and its price when the provider publishes one, including when the person typed the request. The yes is kept in the `idealize-gen-tools` settings section (`approved`: `backend/model` to name). `GET /idealize/generate/approved` lists them and `POST { key, approved: false }` removes one. The route refuses `approved: true`, so a yes can only come from the question that shows the price.

**Set-up asks for three things.** The coding subscription's command-line app, an OpenRouter key and a fal key, each with one sentence on what it unlocks. `POST /idealize/onboarding/align` sets the Terminal's launch command and, when an OpenRouter key is connected, the default chat model to the same company's model on OpenRouter. A person who updates sees one welcome sheet, once (`simplerSeen`).

**The Brains pane is the Models pane.** It states what runs each view, offers the other routes under "Add another model", and lists the approved Studio models.

## Alternatives considered

**Deleting presets and spaces.** Every stored chat records a space and most record a brain, the composition gives a chat its tools through a preset, and the desktop shell and the sidebar read the space ids. Removing them would have put every existing chat at risk for no change a person could see.

**Driving the subscription's command-line app behind Chat.** Anthropic's terms allow a person to type into the unmodified app in a hosted terminal and are unclear about an app drawing its replies in a chat of its own. JJ ruled that Chat and Studio run on the person's OpenRouter key, so no subscription is used outside its own app.

**One new `studio` space for all media.** The id is taken by the group chat, and the three media spaces already carry the views, the per-kind model and the settings strip. A toggle over the three reuses all of it.

**Per-chat router settings.** The sketch showed "This chat / All chats". The settings section is app-wide and the per-chat lock already exists, so the first version writes app-wide settings and keeps the lock.

## Consequences

- "Ask me" is the existing non-blocking offer: the turn answers on the current model and the notice offers the move.
- OpenRouter publishes no price for media models, so its Studio question says the model may charge without a figure. fal models show a price.
- The word "Studio" names both the media view and the project group chat on screen.
- The activity presets' instructions (Coding, Design, Writing, Admin) are no longer offered to new chats.
