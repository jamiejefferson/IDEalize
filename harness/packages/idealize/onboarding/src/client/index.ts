/**
 * IDEalize first-run onboarding, browser half. One occupant on the frame's
 * shell.overlay seat renders the five-step wizard, gated by the
 * `idealize-onboarding` settings seed exactly as the tour is gated by
 * `hasSeenTour`. A second occupant renders the welcome sheet, once, for someone
 * whose wizard was done before the three-part set-up arrived (`done` true,
 * `simplerSeen` not yet true); it never shows while the wizard does. Both run
 * BEFORE the showcase tour: a `ctx.tour.holdFirstRun()` hold is taken at
 * plugin start and released exactly once — when the seed calls for neither
 * surface, when settings are unavailable (a remote browser), when the user
 * finishes or skips the wizard, or when the welcome sheet closes.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { IWorkspaces } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: the ui-layout SlotMap merge (shell.overlay).
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: ctx.settingsScope and the settings.general.item SlotMap merge.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: ctx.locale.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: ctx.tour (the first-run hold and the showcase).
import type {} from '@idealize/ui-tour/client'
import { createOnboardingFlow } from './flow.ts'
import type { OnboardingSeedLike } from './steps.ts'
import { createOnboardingApi } from './api.ts'
import { OnboardingOverlay } from './OnboardingOverlay.tsx'
import type { OnboardingInjected } from './OnboardingOverlay.tsx'
import { createSimplerSheet } from './simpler.ts'
import { SimplerSheet } from './SimplerSheet.tsx'
import type { SimplerSheetInjected } from './SimplerSheet.tsx'
import { OnboardingRow } from './OnboardingRow.tsx'
import type { OnboardingRowInjected } from './OnboardingRow.tsx'
import { en, zh, type OnboardingKey } from './locales.ts'

export { deriveStep, advance, skipAll, stepBefore, ONBOARDING_STEP_IDS } from './steps.ts'
export type { OnboardingSeedLike, OnboardingStepId, OnboardingStepOutcome } from './steps.ts'
export { createOnboardingApi } from './api.ts'
export type { AgentsState, AlignOutcome, AlignResult, LaunchChoice, Launches, OnboardingApi, OrientOutcome, SaveOutcome } from './api.ts'
export { SimplerSheet } from './SimplerSheet.tsx'
export type { SimplerSheetInjected, SimplerSheetProps } from './SimplerSheet.tsx'
export { createSimplerSheet, simplerSheetDue } from './simpler.ts'
export type { SimplerSheet as SimplerSheetController, SimplerSheetDeps, SimplerSheetState } from './simpler.ts'
export { OnboardingOverlay } from './OnboardingOverlay.tsx'
export type { OnboardingInjected, OnboardingOverlayProps, OnboardingCelebration, OnboardingViewState } from './OnboardingOverlay.tsx'
export { OnboardingRow } from './OnboardingRow.tsx'
export type { OnboardingRowInjected } from './OnboardingRow.tsx'
export type { OnboardingKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The onboarding wizard's copy. */
    'idealize-onboarding': OnboardingKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'idealize-onboarding'

/** The `idealize-setup` section's aliases, as far as the folder steps read them. */
interface SetupAliasesLike {
  aliases?: {
    projectsRoot?: string
    documentation?: string
    skills?: string
  }
}

/** Required services. */
export const inject = ['slots', 'locale', 'settingsScope', 'workspaces', 'tour']

/**
 * Client plugin body: the gate over the settings seed, the overlay occupant,
 * and the tour hold that sequences onboarding before the showcase.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'idealize-onboarding: dictionaries')

  // Held from plugin start so the tour cannot fire while the seed is still
  // loading; released exactly once — when the flow turns out closed (or the
  // section is unavailable), or when the user finishes or skips the wizard.
  const releaseHold = ctx.tour.holdFirstRun()
  let released = false
  const releaseOnce = (): void => {
    if (released) return
    released = true
    releaseHold()
  }
  ctx.effect(() => releaseOnce, 'idealize-onboarding: tour hold release')

  const scope = ctx.settingsScope.bind<OnboardingSeedLike>({ namespace: NS })
  // The folder steps pre-fill from an existing orientation (a returning user).
  const setupScope = ctx.settingsScope.bind<SetupAliasesLike>({ namespace: 'idealize-setup' })
  const flow = createOnboardingFlow({
    persist: (field, value) => {
      scope.set(field, value).catch(() => {
        // The seed is a convenience: a failed write replays the step next launch.
      })
    },
    releaseHold: releaseOnce,
  })
  const sheet = createSimplerSheet({
    markSeen: () => {
      scope.set('simplerSeen', true).catch(() => {
        // A failed write shows the sheet again next launch.
      })
    },
    releaseHold: releaseOnce,
  })

  // ── The gate ───────────────────────────────────────────────────────────
  // The first-run gate mirrors the pattern the retired @idealize/setup client
  // gate established (the template for this flow).
  ctx.effect(() => {
    let decided = false
    const check = (): void => {
      if (decided) return
      const snapshot = scope.getSnapshot()
      if (snapshot.status === 'loading') return
      decided = true
      if (snapshot.status === 'unavailable') {
        // A remote browser keeps preferences process-local; first-run
        // onboarding is a Host concern, so the wizard stays away and the
        // tour runs.
        releaseOnce()
        return
      }
      // The wizard comes first; the welcome sheet is for a seed the wizard has closed.
      if (flow.open(snapshot.value)) return
      if (!sheet.open(snapshot.value)) releaseOnce()
    }
    const off = scope.subscribe(check)
    check()
    return off
  }, 'idealize-onboarding: first-run gate')

  // ctx.get, not the Context property: this package compiles host and client
  // halves in one project, and the host-side merges shadow the client typing.
  const workspaces = ctx.get('workspaces') as unknown as IWorkspaces

  const injected = (): OnboardingInjected => ({
    hooks: { view: flow.view },
    api: createOnboardingApi(),
    pickDirectory: () => workspaces.pickDirectory(),
    readSetupAliases: () => setupScope.getSnapshot().value?.aliases ?? {},
    selectProject: (workspaceId) => {
      workspaces.startSession(workspaceId as Parameters<IWorkspaces['startSession']>[0])
    },
    completeStep: flow.completeStep,
    skipStep: flow.skipStep,
    quitAll: flow.quitAll,
    back: flow.back,
    finish: flow.finish,
    celebrationDone: flow.celebrationDone,
    prefersReducedMotion: () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  })

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'idealize-onboarding',
    order: 95,
    locale: NS,
    inject: injected,
  }, OnboardingOverlay))

  const api = createOnboardingApi()
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'idealize-onboarding-simpler',
    order: 94,
    locale: NS,
    inject: (): SimplerSheetInjected => ({
      hooks: { sheet: sheet.view },
      api,
      close: sheet.close,
    }),
  }, SimplerSheet))

  // The General-section re-run row: reset the seed so the wizard re-arms on
  // next launch (the same escape hatch clearing `done` in settings.yaml gives).
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'idealize-onboarding',
    order: 50,
    locale: NS,
    inject: (): OnboardingRowInjected => ({
      rerun: () => {
        scope.set('done', false).catch(() => {
          // A failed write simply leaves the flow closed.
        })
        scope.set('steps', {}).catch(() => {
          // A failed write simply leaves the flow closed.
        })
      },
    }),
  }, OnboardingRow))
}
