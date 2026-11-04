/**
 * What pages in the app's windows may ask for. Electron answers yes to every
 * permission request unless told otherwise, so any page that reached a window
 * could use the microphone with no prompt once macOS had granted it to Powell.
 *
 * Only the app's own pages get anything: the microphone, and notifications.
 * Writing to the clipboard stays too, because every Copy button in the app uses
 * it and Chromium asks through this same gate. Everything else is refused,
 * the camera included.
 */

/** The permissions a page of the app's own may hold. */
const OWN_PAGE_PERMISSIONS: ReadonlySet<string> = new Set([
  'media',
  'notifications',
  'clipboard-sanitized-write',
])

/** One permission question, from either of Electron's two handlers. */
export interface PermissionQuestion {
  readonly permission: string
  /** The asking frame's URL or origin; empty when Electron gives neither. */
  readonly requester: string
  /** The app's own origin; undefined until the Host is up. */
  readonly appOrigin: string | undefined
  /** The kinds of capture a `media` request wants, when Electron says. */
  readonly mediaTypes?: readonly string[]
}

function originOf(url: string): string | undefined {
  try {
    return new URL(url).origin
  } catch {
    return undefined
  }
}

/**
 * @param question - who asks for what.
 * @returns true only for an allowed permission from the app's own origin.
 */
export function permissionAllowed(question: PermissionQuestion): boolean {
  if (question.appOrigin === undefined) return false
  if (originOf(question.requester) !== question.appOrigin) return false
  if (!OWN_PAGE_PERMISSIONS.has(question.permission)) return false
  if (question.permission !== 'media') return true
  return (question.mediaTypes ?? []).every(kind => kind === 'audio')
}

/** The part of an Electron session the policy installs on. */
export interface PermissionSession {
  setPermissionRequestHandler(handler: (
    webContents: unknown,
    permission: string,
    callback: (granted: boolean) => void,
    details: { readonly requestingUrl?: string; readonly mediaTypes?: readonly string[] },
  ) => void): void
  setPermissionCheckHandler(handler: (
    webContents: unknown,
    permission: string,
    requestingOrigin: string,
    details: { readonly requestingUrl?: string; readonly mediaType?: string },
  ) => boolean): void
}

/**
 * Install the policy on one session.
 * @param session - the session every app window shares.
 * @param appOrigin - reads the app's current origin, which changes with each Host generation.
 */
export function installPermissionPolicy(session: PermissionSession, appOrigin: () => string | undefined): void {
  session.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    callback(permissionAllowed({
      permission,
      requester: details.requestingUrl ?? '',
      appOrigin: appOrigin(),
      ...details.mediaTypes === undefined ? {} : { mediaTypes: details.mediaTypes },
    }))
  })
  session.setPermissionCheckHandler((_webContents, permission, requestingOrigin, details) => permissionAllowed({
    permission,
    requester: details.requestingUrl ?? requestingOrigin,
    appOrigin: appOrigin(),
    ...details.mediaType === undefined || details.mediaType === 'unknown' ? {} : { mediaTypes: [details.mediaType] },
  }))
}
