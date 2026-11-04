import type { LogFileSink } from './log-files.ts'
import { maskSecrets } from './mask-secrets.ts'

/** Logger for Electron-main-scope messages that bypass Cordis `ctx.logger`. */
export interface DesktopLogger {
  /** Log an error message to the sink (and stderr for dev visibility). */
  error(message: string): void
  /** Log an unknown cause, normalizing errors/objects/strings. */
  errorCause(cause: unknown): void
}

/** Process events needed to make uncaught exceptions observable and fatal. */
export interface DesktopUncaughtExceptionProcess {
  once(event: 'uncaughtException', listener: (error: Error) => void): unknown
  off(event: 'uncaughtException', listener: (error: Error) => void): unknown
}

export interface DesktopChildProcessDetails {
  readonly type: string
  readonly reason: string
  readonly exitCode: number
  readonly serviceName?: string
  readonly name?: string
}

/** Electron app events that expose native child process failures. */
export interface DesktopChildProcessSource {
  on(event: 'child-process-gone', listener: (event: unknown, details: DesktopChildProcessDetails) => void): unknown
  off(event: 'child-process-gone', listener: (event: unknown, details: DesktopChildProcessDetails) => void): unknown
}

/** Render signed Electron exit codes with their Windows NTSTATUS bit pattern. */
export function formatDesktopExitCode(exitCode: number): string {
  return `${String(exitCode)} / 0x${(exitCode >>> 0).toString(16).padStart(8, '0')}`
}

/** Persist unexpected utility, GPU, and other Electron child process exits. */
export function installDesktopChildProcessLogging(
  app: DesktopChildProcessSource,
  logger: DesktopLogger,
): () => void {
  const handler = (_event: unknown, details: DesktopChildProcessDetails): void => {
    const identity = [
      `type: ${details.type}`,
      ...(details.name === undefined ? [] : [`name: ${details.name}`]),
      ...(details.serviceName === undefined ? [] : [`service: ${details.serviceName}`]),
    ]
    logger.error(
      `dsh-plugin-desktop: child process gone (${identity.join(', ')}, reason: ${details.reason}, exitCode: ${formatDesktopExitCode(details.exitCode)})`,
    )
  }
  app.on('child-process-gone', handler)
  return () => { app.off('child-process-gone', handler) }
}

/** Persist the first uncaught exception before requesting a fatal exit. */
export function installDesktopUncaughtExceptionLogging(
  proc: DesktopUncaughtExceptionProcess,
  logger: DesktopLogger,
  exit: (code: number) => void,
): () => void {
  let handled = false
  const handler = (error: Error): void => {
    if (handled) return
    handled = true
    proc.off('uncaughtException', handler)
    logger.errorCause(error)
    exit(1)
  }
  proc.once('uncaughtException', handler)
  return () => { proc.off('uncaughtException', handler) }
}

/**
 * The package the failing code belongs to, read from the deepest stack frame
 * under `node_modules`. A plugin is a package here, so this names the plugin
 * without any plugin having to cooperate.
 * @param stack - an error's stack, or undefined when there is none.
 * @returns the package name, or undefined when no frame names one.
 */
export function failingPackage(stack: string | undefined): string | undefined {
  if (stack === undefined) return undefined
  for (const line of stack.split('\n')) {
    if (!/^\s*at\s/u.test(line)) continue
    const matches = [...line.matchAll(/node_modules[\\/]((?:@[^\\/]+[\\/])?[^\\/]+)/gu)]
    const name = matches.at(-1)?.[1]
    if (name !== undefined) return name.replace('\\', '/')
  }
  return undefined
}

/**
 * One line for a failure the app survived, naming the plugin when the stack shows one.
 * @param kind - what kind of failure this was.
 * @param cause - what was thrown.
 * @returns the line to log.
 */
export function survivedFailureLine(kind: string, cause: unknown): string {
  const stack = cause instanceof Error ? cause.stack ?? cause.message : String(cause)
  const owner = failingPackage(cause instanceof Error ? cause.stack : undefined)
  return `dsh-plugin-desktop: ${kind} after start-up${owner === undefined ? '' : ` in ${owner}`}, kept running: ${stack}`
}

/** Failures logged per minute before the rest are counted and dropped. */
const SURVIVED_LOG_LIMIT = 20

/**
 * After start-up an uncaught exception is logged and the app carries on: one
 * plugin's slip, hours in, must not close every chat and terminal mid-reply.
 * A limit stops a failure that repeats, such as a broken stderr pipe whose own
 * write errors arrive here, from filling the disk or looping.
 * @param proc - the process events.
 * @param logger - where the line goes.
 * @param now - the clock; replaced in tests.
 * @returns the removal for this listener.
 */
export function installDesktopUncaughtExceptionSurvival(
  proc: Pick<DesktopUncaughtExceptionProcess, 'off'> & { on(event: 'uncaughtException', listener: (error: Error) => void): unknown },
  logger: DesktopLogger,
  now: () => number = Date.now,
): () => void {
  let windowStart = now()
  let logged = 0
  let dropped = 0
  let logging = false
  const handler = (error: Error): void => {
    if (logging) return
    logging = true
    try {
      if (now() - windowStart >= 60_000) {
        if (dropped > 0) logger.error(`dsh-plugin-desktop: ${String(dropped)} more uncaught exceptions were not logged`)
        windowStart = now()
        logged = 0
        dropped = 0
      }
      if (logged >= SURVIVED_LOG_LIMIT) {
        dropped += 1
        return
      }
      logged += 1
      logger.error(survivedFailureLine('uncaught exception', error))
    } catch {
      // The log is best-effort; losing a line must not become the next failure.
    } finally {
      logging = false
    }
  }
  proc.on('uncaughtException', handler)
  return () => { proc.off('uncaughtException', handler) }
}

/** DesktopLogger that writes to the shared sink and mirrors to process.stderr. */
export class ElectronStderrLogger implements DesktopLogger {
  constructor(private readonly sink: LogFileSink | undefined) {}

  /** Accept one fail-loud stderr diagnostic through the persistent logger. */
  write(chunk: string): boolean {
    this.error(chunk.replace(/\r?\n$/u, ''))
    return true
  }

  error(message: string): void {
    const masked = maskSecrets(message)
    try {
      this.sink?.write('error', masked)
    } catch {
      // Persistent diagnostics are best-effort; stderr must remain available.
    }
    process.stderr.write(`${masked}\n`)
  }

  errorCause(cause: unknown): void {
    const text = cause instanceof Error ? cause.stack ?? cause.message : String(cause)
    this.error(text)
  }
}
