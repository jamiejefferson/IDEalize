/**
 * The questions a person answers before something outside the app changes it.
 * Any app, web page or email can hand the operating system an `idealize://`
 * link or a `.idealizekeys` file, so a double-click must not be enough.
 */

/** A question for a native dialog. */
export interface ConfirmationQuestion {
  readonly title: string
  readonly message: string
  readonly detail: string
  /** The button that goes ahead; the other is Cancel. */
  readonly confirm: string
}

/** Ask one question; true when the person chose to go ahead. */
export type AskConfirmation = (question: ConfirmationQuestion) => Promise<boolean>

/**
 * A path or name as a dialog may show it. Control characters and text-direction
 * marks could otherwise fake extra lines or disguise a file's name.
 */
export function displayable(text: string): string {
  return text.replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, '?')
}

/**
 * @param path - the folder the link names.
 * @returns the question for an `idealize://project` link.
 */
export function projectLinkQuestion(path: string): ConfirmationQuestion {
  return {
    title: 'Open This Folder?',
    message: 'A link is asking IDEalize to open this folder as a project.',
    detail: `${displayable(path)}\n\nIDEalize will add it to your projects, and agents you start there can read and change its files. Choose Open only if you asked for this.`,
    confirm: 'Open',
  }
}

/**
 * @param address - the gateway address the link names.
 * @returns the question for an `idealize://gateway` link.
 */
export function gatewayLinkQuestion(address: string): ConfirmationQuestion {
  let host = address
  try {
    host = new URL(address).host
  } catch {
    // The parser only passes https addresses, so this keeps the text as given.
  }
  return {
    title: 'Connect Key Gateway?',
    message: `A link is asking IDEalize to connect the key gateway at ${displayable(host)}.`,
    detail: `${displayable(address)}\n\nYour chats, pictures and videos will run through this gateway, and it will see them. Choose Connect only if you pressed Connect in your organisation's gateway just now.`,
    confirm: 'Connect',
  }
}

/** One service as the Host lists it. */
export interface ServiceSummary {
  readonly id: string
  readonly name: string
  readonly connected: boolean
  readonly signIn?: boolean
}

/** The credential name a chat service reads its key from, as the Host derives it. */
function credentialNameFor(id: string): string {
  return `${id.toUpperCase().replace(/[^A-Z0-9]+/gu, '_')}_API_KEY`
}

/** The service one credential name belongs to, when the name says so. */
function serviceFor(credential: string, services: readonly ServiceSummary[]): ServiceSummary | undefined {
  const stem = credential.replace(/_API_KEY$|_KEY$/u, '')
  return services.find(service => service.signIn !== true
    && (credentialNameFor(service.id) === credential
      || service.id.toUpperCase().replace(/[^A-Z0-9]+/gu, '_') === stem))
}

/**
 * The credential names a keys file carries; the keys themselves stay out of it.
 * @param text - the file's text.
 * @returns the names, or undefined when the text is not a keys file, which the import route then refuses by itself.
 */
export function keysFileCredentials(text: string): readonly string[] | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }
  const credentials = (parsed as { credentials?: unknown } | null)?.credentials
  if (typeof credentials !== 'object' || credentials === null || Array.isArray(credentials)) return undefined
  const names = Object.keys(credentials)
  return names.length === 0 ? undefined : names
}

/**
 * @param fileName - the file's name.
 * @param credentials - the credential names it carries.
 * @param services - the services the Host lists, or undefined when it could not say.
 * @returns the question for opening a keys file, naming what would change.
 */
export function keysFileQuestion(
  fileName: string,
  credentials: readonly string[],
  services: readonly ServiceSummary[] | undefined,
): ConfirmationQuestion {
  const lines = credentials.map((credential) => {
    const service = services === undefined ? undefined : serviceFor(credential, services)
    if (service === undefined) return `${displayable(credential)}: replaces any key you have for it`
    return service.connected
      ? `${displayable(service.name)}: replaces the key you have now`
      : `${displayable(service.name)}: adds a new key`
  })
  return {
    title: 'Add These Keys?',
    message: `"${displayable(fileName)}" wants to change the keys IDEalize uses.`,
    detail: `${lines.join('\n')}\n\nYour work on these services will then run on the accounts in this file, and whoever owns those accounts can see that use. Your current keys are not kept. Choose Add Keys only if you trust the person who sent it.`,
    confirm: 'Add Keys',
  }
}

/**
 * Ask one question at a time. A page firing the same link in a loop then shows
 * one dialog and drops the rest, leaving the person able to answer it.
 * @param ask - the real question.
 * @returns the same question, answering false while another is open.
 */
export function oneQuestionAtATime(ask: AskConfirmation): AskConfirmation {
  let open = false
  return async (question) => {
    if (open) return false
    open = true
    try {
      return await ask(question)
    } finally {
      open = false
    }
  }
}
