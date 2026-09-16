/**
 * The shell.overlay occupant: the first-run onboarding wizard. One full-screen
 * panel per step — the placeholder owl, headline and one-line sub, a body the
 * later pieces fill (`data-onboarding-body` per step), the five-dot progress,
 * and the navigation row — plus the rainbow burst over each completed step.
 * Renders nothing once the flow is closed.
 */
import { useRef, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { ONBOARDING_STEP_IDS } from './steps.ts'
import type { OnboardingStepId } from './steps.ts'
import type { OnboardingKey } from './locales.ts'
import type { OnboardingApi } from './api.ts'
import { OwlArt } from './OwlArt.tsx'
import { RainbowBurst } from './RainbowBurst.tsx'
import { AgentsStepBody } from './AgentsStepBody.tsx'
import { ToolsStepBody } from './ToolsStepBody.tsx'
import { FolderStepBody } from './FolderStepBody.tsx'
import { FinishStepBody } from './FinishStepBody.tsx'
import type { OnboardingViewState } from './flow.ts'
import css from './OnboardingOverlay.module.css'
import { notifyBrainsChanged } from './brains-changed.ts'

export type { OnboardingCelebration, OnboardingViewState } from './flow.ts'

/** Registration-side face. */
export interface OnboardingInjected {
  hooks: {
    /** The wizard state. */
    view: SnapshotStore<OnboardingViewState>
  }
  /** The wizard's host route client. */
  api: OnboardingApi
  /** Open the Host directory picker; null when cancelled or unavailable. */
  pickDirectory: () => Promise<string | null>
  /** The pre-fill source for the folder steps: the `idealize-setup` aliases, when they stand. */
  readSetupAliases: () => { projectsRoot?: string; documentation?: string }
  /** Select the created first project (host workspace id) after orientation. */
  selectProject: (workspaceId: string) => void
  /** Mark one step done, fire its burst, and advance. */
  completeStep: (step: OnboardingStepId) => void
  /** Record one step as skipped and advance without a burst. */
  skipStep: (step: OnboardingStepId) => void
  /** Skip the whole flow: persist `done` and close. */
  quitAll: () => void
  /** Return to the previous step without touching recorded outcomes. */
  back: () => void
  /** Retain unsaved Tools choices while its key recovery visits Agents. */
  setToolDrafts: (drafts: Record<string, string>) => void
  /** The finish step's completion: persist `done` + `completedAt`, final burst. */
  finish: () => void
  /** The burst's lifetime ended; a final burst closes the flow. */
  celebrationDone: () => void
  /** Whether the user asked for reduced motion (drives the static burst). */
  prefersReducedMotion: () => boolean
}

export type OnboardingOverlayProps = PropsRuntime<'shell.overlay'>
  & PropsLocale<'idealize-onboarding'>
  & InjectFace<OnboardingInjected>

/* Computed template keys don't narrow through `t`, so each step maps to its
   dictionary keys explicitly. */
const STEP_TITLE: Record<OnboardingStepId, OnboardingKey> = {
  agents: 'step.agents.title',
  tools: 'step.tools.title',
  'projects-folder': 'step.projects-folder.title',
  'documentation-folder': 'step.documentation-folder.title',
  'skills-folder': 'step.skills-folder.title',
  finish: 'step.finish.title',
}

const STEP_SUB: Record<OnboardingStepId, OnboardingKey> = {
  agents: 'step.agents.sub',
  tools: 'step.tools.sub',
  'projects-folder': 'step.projects-folder.sub',
  'documentation-folder': 'step.documentation-folder.sub',
  'skills-folder': 'step.skills-folder.sub',
  finish: 'step.finish.sub',
}

const CELEBRATION_LABEL: Record<OnboardingStepId, OnboardingKey> = {
  agents: 'celebrate.agents',
  tools: 'celebrate.tools',
  'projects-folder': 'celebrate.projects-folder',
  'documentation-folder': 'celebrate.documentation-folder',
  'skills-folder': 'celebrate.skills-folder',
  finish: 'celebrate.finish',
}

export function OnboardingOverlay(props: OnboardingOverlayProps) {
  const { t, api, pickDirectory, readSetupAliases, selectProject } = props
  const { completeStep, skipStep, quitAll, back, setToolDrafts, finish, celebrationDone, prefersReducedMotion } = props
  const step = props.useView(state => state.step)
  const celebration = props.useView(state => state.celebration)
  const toolDrafts = props.useView(state => state.toolDrafts)
  // The step body's gate and commit: the body reports readiness and registers
  // its save-on-Continue action; both reset on every step change. The reset
  // runs during render (the documented adjust-state-on-prop-change pattern):
  // an effect would fire AFTER the freshly mounted body's own effects and
  // clobber the readiness and commit it just registered.
  const [prevStep, setPrevStep] = useState(step)
  const [stepReady, setStepReady] = useState(true)
  const [busy, setBusy] = useState(false)
  const commitRef = useRef<(() => Promise<boolean>) | null>(null)
  const [editOpenRouter, setEditOpenRouter] = useState(false)
  // The captured folders, held across the three folder steps and the finish;
  // the finish orients on the first two, the skills folder persists at its own step.
  const [folders, setFolders] = useState({ projects: '', documentation: '', skills: '' })
  if (step !== prevStep) {
    setPrevStep(step)
    setStepReady(true)
    commitRef.current = null
  }
  if (step === null) return null
  const index = ONBOARDING_STEP_IDS.indexOf(step)
  const isFinish = step === 'finish'

  const advance = (): void => {
    const commit = commitRef.current
    setBusy(true)
    void (commit === null ? Promise.resolve(true) : commit())
      .then((proceed) => {
        setBusy(false)
        if (!proceed) return
        // A key stored on the agents step or a model saved on the tools step
        // changes what the welcome card under this overlay can offer.
        if (step === 'agents' || step === 'tools') notifyBrainsChanged()
        // The finish step's commit runs the orientation; its success completes
        // the flow (final burst, then close).
        if (isFinish) finish()
        else completeStep(step)
      }, () => {
        // A body's commit rejects only on a dropped wire; the step stays put.
        setBusy(false)
      })
  }

  const recoverOpenRouter = (): void => {
    setEditOpenRouter(true)
    back()
  }

  return (
    <div className={css.root} data-idealize-onboarding role="dialog" aria-label={t('onboarding.title')}>
      <button type="button" className={css.skipAll} onClick={quitAll} data-onboarding-skip-all>
        {t('skip.all')}
      </button>
      <div className={css.panel} data-onboarding-step={step}>
        <OwlArt step={step} reduced={prefersReducedMotion()} />
        <h2 className={css.title}>{t(STEP_TITLE[step])}</h2>
        <p className={css.sub}>{t(STEP_SUB[step])}</p>
        {/* Each body owns its gate (onReadyChange) and its save-on-Continue
            action (registerCommit); Tools can return to Agents when a provider
            key is the recovery, and the folder paths live here so Finish reads
            both. */}
        <div className={css.body} data-onboarding-body={step}>
          {step === 'agents' && (
            <AgentsStepBody
              api={api}
              t={t}
              onReadyChange={setStepReady}
              registerCommit={(commit) => { commitRef.current = commit }}
              editOpenRouter={editOpenRouter}
            />
          )}
          {step === 'tools' && (
            <ToolsStepBody
              api={api}
              t={t}
              onReadyChange={setStepReady}
              registerCommit={(commit) => { commitRef.current = commit }}
              onAddOpenRouterKey={recoverOpenRouter}
              drafts={toolDrafts}
              onDraftsChange={setToolDrafts}
            />
          )}
          {step === 'projects-folder' && (
            <FolderStepBody
              api={api}
              t={t}
              onReadyChange={setStepReady}
              registerCommit={(commit) => { commitRef.current = commit }}
              alias="projectsRoot"
              value={folders.projects}
              onChange={(path) => { setFolders(current => ({ ...current, projects: path })) }}
              readSetupAliases={readSetupAliases}
              pickDirectory={pickDirectory}
            />
          )}
          {step === 'documentation-folder' && (
            <FolderStepBody
              api={api}
              t={t}
              onReadyChange={setStepReady}
              registerCommit={(commit) => { commitRef.current = commit }}
              alias="documentation"
              value={folders.documentation}
              onChange={(path) => { setFolders(current => ({ ...current, documentation: path })) }}
              readSetupAliases={readSetupAliases}
              pickDirectory={pickDirectory}
            />
          )}
          {step === 'skills-folder' && (
            <FolderStepBody
              api={api}
              t={t}
              onReadyChange={setStepReady}
              registerCommit={(commit) => { commitRef.current = commit }}
              alias="skills"
              value={folders.skills}
              onChange={(path) => { setFolders(current => ({ ...current, skills: path })) }}
              readSetupAliases={readSetupAliases}
              pickDirectory={pickDirectory}
            />
          )}
          {step === 'finish' && (
            <FinishStepBody
              api={api}
              t={t}
              onReadyChange={setStepReady}
              registerCommit={(commit) => { commitRef.current = commit }}
              folders={folders}
              selectProject={selectProject}
            />
          )}
        </div>
        <div className={css.dots} aria-hidden="true" data-onboarding-dots>
          {ONBOARDING_STEP_IDS.map(id => <span key={id} className={css.dot} data-active={id === step ? '' : undefined} />)}
        </div>
        <div className={css.foot}>
          {index > 0 && (
            <button type="button" className={css.back} onClick={back} data-onboarding-back>
              {t('nav.back')}
            </button>
          )}
          {/* On finish the per-step skip would duplicate "Skip setup". */}
          {!isFinish && (
            <button type="button" className={css.skipStep} onClick={() => { skipStep(step) }} data-onboarding-skip-step>
              {t('skip.step')}
            </button>
          )}
          <button
            type="button"
            className={css.primary}
            disabled={!stepReady || busy}
            onClick={advance}
            data-onboarding-continue
          >
            {isFinish ? t('nav.finish') : busy ? t('nav.busy') : t('nav.continue')}
          </button>
        </div>
      </div>
      {celebration !== null && (
        <RainbowBurst
          key={celebration.token}
          step={celebration.step}
          label={t(CELEBRATION_LABEL[celebration.step])}
          reduced={prefersReducedMotion()}
          onDone={celebrationDone}
        />
      )}
    </div>
  )
}
