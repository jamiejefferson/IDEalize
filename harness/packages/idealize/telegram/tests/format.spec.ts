/** The bot's wording: every line a person reads on the phone. */

import { describe, expect, it } from 'vitest'
import type { StudioOverviewProject } from '@idealize/studio'
import {
  agentsText,
  alertText,
  approvalOutcomeText,
  approvalText,
  chatPostReply,
  errorText,
  projectName,
  questionKeyboard,
  questionText,
  statusText,
  studioPostText,
  taskEndingText,
} from '../src/format.ts'
import type { RosterRow } from '../src/ports.ts'

const roster: RosterRow[] = [
  { id: 's1', name: 'Ada', label: 'Landing page', cwd: '/work/site', role: 'project-agent', running: true },
  { id: 's2', label: 'Notes', role: 'chat', running: false },
  { id: 's3', name: 'Bo', label: 'Bo', role: 'studio-agent', running: false },
]

function project(path: string, tasks: Array<Record<string, unknown>>): StudioOverviewProject {
  const state = { tasks, agents: {}, deliveries: {}, presence: {} }
  return { project: path, lastSeq: 1, recent: [], state } as unknown as StudioOverviewProject
}

describe('status and roster', () => {
  it('lists running agents, waiting requests and open tasks across projects', () => {
    const text = statusText([
      project('/work/site', [
        { id: 't1', goal: 'Hero copy', owner: 's1', state: 'working', attention: 'needs-input' },
        { id: 't2', goal: '', owner: 's2', state: 'queued', attention: 'none' },
        { id: 't3', goal: 'Old', owner: 's1', state: 'done', attention: 'completion' },
      ]),
      project('studio', [{ id: 't4', goal: 'Plan week', owner: 's3', state: 'paused', attention: 'none' }]),
    ], roster, 2)
    expect(text).toBe([
      'Running: Ada.',
      'Waiting for you: 2 approvals or questions.',
      'Open tasks:\n• Hero copy (Ada, site): working, needs input\n• Untitled task (Notes, site): queued\n• Plan week (Bo, Studio): paused',
    ].join('\n\n'))
  })

  it('says when nothing runs, one request waits, and no task is open', () => {
    expect(statusText([], [], 1)).toBe('Nothing is running.\n\nWaiting for you: 1 approval or question.\n\nNo open tasks.')
    expect(statusText([], [], 0)).toBe('Nothing is running.\n\nNo open tasks.')
  })

  it('lists every agent with its label when the name differs', () => {
    expect(agentsText(roster)).toBe('• Ada (Landing page): running\n• Notes: idle\n• Bo: idle')
    expect(agentsText([])).toBe('No agents yet.')
  })

  it('names the Studio timeline and project folders', () => {
    expect(projectName('studio')).toBe('Studio')
    expect(projectName('/work/site')).toBe('site')
  })
})

describe('approvals and questions', () => {
  it('asks with and without a reason', () => {
    expect(approvalText('Ada', 'bash', 'writes outside the project')).toBe('Ada wants to run bash.\nwrites outside the project')
    expect(approvalText('Ada', 'bash')).toBe('Ada wants to run bash.')
    expect(approvalText('Ada', 'bash', '')).toBe('Ada wants to run bash.')
  })

  it('reports each outcome', () => {
    expect(approvalOutcomeText('Ada', 'bash', 'allowed-once')).toBe('Allowed: Ada runs bash.')
    expect(approvalOutcomeText('Ada', 'bash', 'rejected')).toBe('Denied: Ada does not run bash.')
    expect(approvalOutcomeText('Ada', 'bash', 'cancelled')).toBe('Withdrawn: Ada no longer needs bash.')
  })

  it('shows a single-select question with its option notes and an Other button', () => {
    const item = { id: 'q', question: 'Which font?', header: 'Type', detail: 'For the hero', options: [{ label: 'Serif', description: 'classic' }, { label: 'Sans' }] }
    expect(questionText('Ada', item, 0, 1)).toBe('Ada asks:\nType\nWhich font?\nFor the hero\n• Serif: classic')
    expect(questionKeyboard('7', item, [])).toEqual([
      [{ text: 'Serif', data: 'q:7:0' }],
      [{ text: 'Sans', data: 'q:7:1' }],
      [{ text: 'Other (type it)', data: 'q:7:other' }],
    ])
  })

  it('shows a multi-select question with ticks and a Done button, numbered among several', () => {
    const item = { id: 'q', question: 'Which pages?', multiSelect: true, options: [{ label: 'Home' }, { label: 'About' }] }
    expect(questionText('Ada', item, 1, 3)).toBe('Ada asks (2 of 3):\nWhich pages?\nTick every answer that applies, then choose Done.')
    expect(questionKeyboard('7', item, ['About'])).toEqual([
      [{ text: 'Home', data: 'q:7:0' }],
      [{ text: '✓ About', data: 'q:7:1' }],
      [{ text: 'Other (type it)', data: 'q:7:other' }, { text: 'Done', data: 'q:7:done' }],
    ])
  })

  it('asks for a typed answer when a question has no options', () => {
    const item = { id: 'q', question: 'What should it say?' }
    expect(questionText('Ada', item, 0, 1)).toBe('Ada asks:\nWhat should it say?\nReply with your answer.')
    expect(questionKeyboard('7', item, [])).toEqual([])
  })
})

describe('Studio post replies', () => {
  it('stays quiet for a delivery to the coordinator and says when it queued', () => {
    expect(chatPostReply({ kind: 'delivered', target: 's3', project: 'studio', delivery: 'delivered' }, roster)).toBeUndefined()
    expect(chatPostReply({ kind: 'delivered', target: 's3', project: 'studio', delivery: 'queued' }, roster))
      .toBe('Queued. The Studio coordinator reads it when it is free.')
  })

  it('confirms a delivery to one agent, or that it waits', () => {
    expect(chatPostReply({ kind: 'delivered', target: 's1', project: '/work/site', delivery: 'delivered' }, roster)).toBe('Sent to Ada.')
    expect(chatPostReply({ kind: 'delivered', target: 's1', project: '/work/site', delivery: 'queued' }, roster))
      .toBe('Queued for Ada. Their chat is closed, so it waits until it opens.')
  })

  it('explains a coordinator that could not start and a name that did not resolve', () => {
    expect(chatPostReply({ kind: 'no-coordinator', reason: 'No model is set.' }, roster))
      .toBe('The Studio coordinator could not start, so the message was not sent. No model is set.')
    expect(chatPostReply({ kind: 'unresolved', token: 'Cy', names: ['Ada', 'Bo'] }, roster)).toBe('Nobody called @Cy is here. Try one of: Ada, Bo.')
    expect(chatPostReply({ kind: 'unresolved', token: 'Cy', names: [] }, roster)).toBe('Nobody called @Cy is here.')
  })
})

describe('forwarded lines', () => {
  it('prefixes a coordinator post with its author', () => {
    expect(studioPostText('Bo', 'Two tasks are done.')).toBe('Bo: Two tasks are done.')
  })

  it('names the task and project when a task ends', () => {
    expect(taskEndingText('Finished', '/work/site', 'Hero copy', 'Shipped to staging')).toBe('Finished: Hero copy (site)\nShipped to staging')
    expect(taskEndingText('Cancelled', '/work/site', undefined, '')).toBe('Cancelled (site)')
    expect(taskEndingText('Could not finish', '/work/site', '', 'Timed out')).toBe('Could not finish (site)\nTimed out')
  })

  it('carries an alert and an error with and without detail', () => {
    expect(alertText('Ada needs your input', 'Which font?')).toBe('Ada needs your input\nWhich font?')
    expect(alertText('Ada is blocked', '')).toBe('Ada is blocked')
    expect(errorText('Ada', 'the key expired')).toBe('Ada hit an error.\nthe key expired')
    expect(errorText(undefined, '')).toBe('An agent hit an error.')
  })
})
