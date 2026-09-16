# Agent Note: The Files pane follows landed artefacts, and minimode leaves full screen first

Status: implemented

## Problem

JJ, 16 Sep 2026, demoing: "when i created a video, the file listing didnt refresh to show the new video folder. the images and sounds ones seemed to work fine" and "minimode launched on a full black screen again". The Files pane re-listed a folder only after its own creates, renames and drops, or a reveal; an artefact written by a generation reached no listing. Images and sounds appeared to work because their folders already existed and a folder lists live when it is opened; the first video created `Video/`, and the root listing that predated it never showed the folder until Refresh. The collapse to the Askbar hid the main window as it was; a window hidden while in macOS full screen leaves its empty space on screen, so the bar floated over a black desktop, the same look as the 13 Sep Stage Manager fault with a different cause.

## Decision

`@idealize/artefacts` raises an `idealize:artefact-landed` document event from `ArtefactNodeView` once a created artefact's node is in the transcript (`announceArtefact`, `onArtefactLanded` beside the reveal signal in `reveal.ts`); `@idealize/ui-bar` bumps `filesReload` in its view state and the Files pane re-lists every folder it has loaded, so a new folder shows. The desktop's collapse transform leaves full screen first when the window is in it, glides once `leave-full-screen` fires, and the expand returns the window to full screen after the show.

## Alternatives considered

Announcing from the node definition's `start`: rejected, definitions are pure and replay runs them for every historical event. Subscribing the Files pane to the chat store: rejected, the pane knows no session and the document event already carries reveals between the same two plugins. Hiding the full-screen window without leaving full screen: the fault itself.

## Consequences

Opening a chat replays its artefact nodes and bumps the counter once per node; the re-list of a handful of loaded folders is cheap. A failed artefact announces nothing. The collapse from full screen takes the system's leave-full-screen animation before the glide; a window collapsed from full screen expands back into full screen.

## Evidence

`packages/idealize/artefacts/tests/{reveal,artefact-node}.client.spec.*`, `packages/idealize/ui-bar/tests/{reveal,files-panel}.client.spec.*`; the desktop change is exercised by hand, `ElectronShellGeneration` has no unit harness.
