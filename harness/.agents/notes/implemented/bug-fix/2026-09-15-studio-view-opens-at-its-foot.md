# Agent Note: the Studio view opens at its foot

Status: implemented

JJ, 15 Sep 2026: "the studio chat seems to default to be scrolled to the top so you have to scroll down every time you open it."

## Problem

The Studio view scrolls itself and orders its merged timeline oldest first, so the newest rows, the ones a person opens the Studio to read, sat below the fold on every open, and every poll that added a row left the reader where they were.

## Decision

The view lands at its foot before first paint once it has anything to show, and follows new rows while the reader is at the foot (within 24px); a reader who scrolled up keeps their place until they return to the foot, an alert landing (`focus`) takes precedence and suspends following for that mount, and an empty Studio scrolls nowhere. Component state, so each open lands afresh.

## Alternatives considered

Ordering the timeline newest first would have put the latest row at the top without any scrolling, at the cost of reading a conversation backwards and of every other timeline in the app running oldest first. Always following new rows, whatever the scroll position, would have pulled a reader away from an older row they were reading each time a poll landed.

## Consequences

Opening the Studio shows its newest rows; a reader at the foot follows new rows, a reader who scrolled up keeps their place, an alert landing wins for that mount, and an empty Studio scrolls nowhere. The state is per mount, so each open lands afresh.

## Evidence

`opens at the foot, follows new rows there, and holds the place of a reader who scrolled up` and `stays off the foot on an empty Studio, and an alert landing is not followed by a jump to the foot` in `studio-view.client.spec.tsx`, over a jsdom given a fixed layout; 27 ui-studio tests pass.
