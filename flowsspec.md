---
title: Guided Workflow Builder V1
status: Draft
owner: JJ
project: Idealize
---

# Guided Workflow Builder V1

## Vision

Enable non-technical users to create sophisticated AI workflows without ever needing to understand nodes, loops or programming concepts.

The user describes **what they want to achieve**.

The AI interviews them, progressively clarifies their thinking, and builds a workflow alongside the conversation.

The conversation is the source of truth.

The workflow visualisation is simply a live representation of that conversation.

---

# Problem

Traditional workflow builders require users to think like programmers.

Even visual builders (Apple Shortcuts, Zapier, Make, n8n etc.) require an understanding of concepts such as:

- sequence
- conditions
- loops
- branching
- variables
- triggers

These are unnecessary cognitive hurdles for designers and non-technical users.

The goal is to remove this complexity entirely.

---

# Design Principles

## 1. Conversation First

Users never build diagrams.

They simply answer questions.

The AI constructs the workflow.

---

## 2. Start With The End

The interview should always begin with the desired outcome.

Questions should establish:

- What are you trying to achieve?
- What does success look like?
- How will you know when you're finished?

Only once success is clear should the workflow be broken into stages.

The process works backwards from the outcome rather than forwards from the first step.

---

## 3. Guided Interview

This is **not** an open chat.

It is a structured interview.

The AI progressively asks the next best question.

Examples include:

- What's the outcome?
- What needs to happen before that?
- Who is involved?
- What information is needed?
- What could go wrong?
- What should happen if that occurs?
- Is anyone required to approve this?

The AI should drive the conversation rather than wait for instructions.

---

## 4. Progressive Refinement

The workflow starts simple.

Each stage can then be expanded.

Example:

Outcome

↓

Planning

↓

Execution

↓

Approval

↓

Delivery

Each stage can then be explored individually.

---

## 5. Definition of Done

Every stage should finish with a clear definition of done.

Examples:

Planning is complete when...

Approval is complete when...

Research is complete when...

This ensures every stage has measurable completion criteria.

The workflow becomes outcome-driven rather than task-driven.

---

## 6. Continuous Confirmation

After generating a stage the AI confirms it.

Example:

> I've added an Approval stage.
> This ensures someone signs off the design before development begins.
> Does that sound correct?

Options:

- Yes
- Change it
- Remove it

This keeps users confident while allowing the AI to do most of the work.

---

## 7. Suggestions Instead of Questions

If confidence is low, the AI should suggest options.

For example:

"I think one of these fits best..."

instead of

"What should happen next?"

This reduces decision fatigue.

---

## 8. Natural Discovery of Loops

Users should never need to understand loops.

Instead the AI asks natural questions.

Examples:

- What happens if this fails?
- Should someone try again?
- How many attempts?
- What happens if nobody replies?
- What if approval is rejected?

These answers become conditions and loops automatically.

---

# User Experience

## Layout

Split screen.

### Left

Guided conversation.

### Right

Live workflow visualisation.

The workflow updates in real time as the interview progresses.

The visual representation is informative, not the primary editing surface.

---

# Workflow Visualisation

The workflow should feel alive.

Each confirmed answer immediately updates the diagram.

Users watch the workflow emerge naturally.

The diagram should communicate understanding rather than require interaction.

---

# Editing

Editing should reopen the conversation.

Examples:

"Add another approval."

"Move this earlier."

"What if marketing needs to review it?"

The AI updates both:

- conversation
- workflow

No manual node editing should be required.

---

# Workflow Library

Completed workflows can be saved.

Each workflow includes:

- Name
- Description
- Created by
- Last edited
- Tags
- Version

Users can:

- Run
- Edit
- Duplicate
- Archive
- Delete

The library should feel like a collection of reusable playbooks.

---

# Version History

Every significant edit creates a new version.

Users should be able to:

- view history
- restore previous versions
- compare changes

This encourages experimentation without fear.

---

# Future Vision (V2)

Version 1 remains domain-agnostic.

Future versions introduce domain intelligence.

Examples:

The AI may automatically recommend:

- approvals
- legal review
- accessibility checks
- security reviews
- stakeholder sign-off
- testing
- governance

The AI gradually becomes an expert workflow coach rather than simply documenting the user's thinking.

---

# Core Philosophy

People describe outcomes.

The AI builds workflows.

The conversation creates understanding.

The workflow is simply the visible result.