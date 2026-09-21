/**
 * The task types the router tells apart, what each asks of a model, and the
 * local reading of a message that stands in when Jev cannot be asked. The
 * local reading is keyword rules by design: it has to answer in under a
 * millisecond, and it only has to be right enough to route until Jev answers.
 */

/** What a model is scored on; every score is 0 to 1. */
export type Capability = 'reasoning' | 'coding' | 'math' | 'writing' | 'instructions' | 'multilingual'

export const CAPABILITIES: readonly Capability[] = ['reasoning', 'coding', 'math', 'writing', 'instructions', 'multilingual']

export type TaskType = 'code' | 'reasoning' | 'math' | 'writing' | 'summarise' | 'translate' | 'quick'

/** How much the task asks of the model; it scales how far capability counts against cost and speed. */
export type Difficulty = 'simple' | 'moderate' | 'hard'

export interface TaskDefinition {
  /** The line Jev chooses by, and the phrase the rationale uses ("better for …"). */
  label: string
  /** What Jev reads as this option's meaning. */
  criterion: string
  /** The capabilities the task draws on, weighted. */
  needs: Partial<Record<Capability, number>>
}

export const TASKS: Record<TaskType, TaskDefinition> = {
  code: {
    label: 'writing or fixing code',
    criterion: 'The user wants code written, changed, debugged, reviewed or explained, or a technical build problem solved.',
    needs: { coding: 0.9, reasoning: 0.7, instructions: 0.8 },
  },
  reasoning: {
    label: 'working through a hard problem',
    criterion: 'The user wants analysis, planning, a decision weighed, a strategy, or a problem with several steps worked through.',
    needs: { reasoning: 0.9, instructions: 0.6 },
  },
  math: {
    label: 'mathematics',
    criterion: 'The user wants a calculation, a proof, statistics, or a quantitative problem solved.',
    needs: { math: 0.9, reasoning: 0.85, coding: 0.3 },
  },
  writing: {
    label: 'writing',
    criterion: 'The user wants prose drafted or rewritten: copy, an email, a story, a post, naming, tone of voice.',
    needs: { writing: 0.9, instructions: 0.7, reasoning: 0.4 },
  },
  summarise: {
    label: 'summarising long material',
    criterion: 'The user wants existing material condensed, extracted from, or turned into notes.',
    needs: { reasoning: 0.6, instructions: 0.8 },
  },
  translate: {
    label: 'working across languages',
    criterion: 'The user wants text translated, or is writing in a language other than English.',
    needs: { multilingual: 0.9, writing: 0.6, instructions: 0.6 },
  },
  quick: {
    label: 'a quick answer',
    criterion: 'The user wants a short factual answer, a small lookup, a chat reply, or a one-line change.',
    needs: { instructions: 0.7, reasoning: 0.3 },
  },
}

export const TASK_TYPES = Object.keys(TASKS) as TaskType[]

/** A reading of one message: the task, how hard it is, and how sure the reader is. */
export interface TaskReading {
  task: TaskType
  difficulty: Difficulty
  /** 0 to 1. Jev's is calibrated; the local rules' is a fixed, modest figure. */
  confidence: number
  /** Who read it, for the log and the settings' own account of itself. */
  source: 'jev' | 'rules' | 'brain'
}

const RULES: ReadonlyArray<readonly [TaskType, RegExp]> = [
  ['code', /```|\b(function|class|const|import|npm|yarn|pnpm|git|typescript|javascript|python|swift|css|html|sql|regex|api|endpoint|stack trace|compile|refactor|debug|bug|unit tests?|pull request)\b|\.(ts|tsx|js|py|swift|css|json)\b/i],
  ['math', /\b(calculate|equation|integral|derivative|probability|statistics|proof|prove|theorem|solve for|percent(age)? of|standard deviation)\b|\d\s*[+*/^=]\s*\d/i],
  ['translate', /\b(translate|translation|in (french|spanish|german|italian|portuguese|japanese|chinese|korean|arabic|dutch))\b|[぀-ヿ一-鿿Ѐ-ӿ؀-ۿ]{4,}/i],
  ['summarise', /\b(summari[sz]e|summary|tl;?dr|key points|condense|extract the|minutes of|notes from)\b/i],
  ['writing', /\b(write|draft|rewrite|reword|copy|headline|tagline|email|blog|post|story|poem|tone of voice|proofread|caption|name for)\b/i],
  ['reasoning', /\b(plan|strategy|analy[sz]e|compare|trade-?offs?|pros and cons|should (i|we)|why does|evaluate|decide|architecture|approach|root cause)\b/i],
]

/**
 * The fixed confidence of a keyword match, of a brain's own task, and of the
 * fall-through. A keyword match clears the balanced gate (0.75) and not the
 * conservative one (0.9), so a user who asks for few switches gets them only
 * on Jev's calibrated reading. The fall-through clears no gate.
 */
const RULE_CONFIDENCE = 0.78
const BRAIN_CONFIDENCE = 0.85
const FALLTHROUGH_CONFIDENCE = 0.5

/** The shipped brains whose name states the task (spec §1.2: a chosen brain is explicit intent). */
const BRAIN_TASKS: Readonly<Record<string, TaskType>> = { coding: 'code', writing: 'writing', admin: 'quick' }

/**
 * Read a message with keyword rules. Length and structure set the difficulty:
 * a long or multi-part ask is harder than a one-liner whatever its subject.
 * @param message - the user's latest message.
 * @param brainId - the chat's brain, when it has one.
 * @returns the local reading.
 */
export function readLocally(message: string, brainId?: string): TaskReading {
  const text = message.trim()
  const matched = RULES.find(([, pattern]) => pattern.test(text))
  const words = text === '' ? 0 : text.split(/\s+/).length
  const parts = (text.match(/\n\s*([-*]|\d+[.)])\s/g) ?? []).length
  const difficulty: Difficulty = words > 220 || parts >= 4 ? 'hard' : words > 40 || parts >= 2 ? 'moderate' : 'simple'
  // The message outranks the brain when it names another kind of work: a
  // Coding chat asked to draft an email is writing for this turn.
  const intent = brainId === undefined ? undefined : BRAIN_TASKS[brainId]
  if (matched === undefined && intent !== undefined) return { task: intent, difficulty, confidence: BRAIN_CONFIDENCE, source: 'brain' }
  if (matched === undefined) {
    return { task: difficulty === 'simple' ? 'quick' : 'reasoning', difficulty, confidence: FALLTHROUGH_CONFIDENCE, source: 'rules' }
  }
  return { task: matched[0], difficulty, confidence: RULE_CONFIDENCE, source: 'rules' }
}
