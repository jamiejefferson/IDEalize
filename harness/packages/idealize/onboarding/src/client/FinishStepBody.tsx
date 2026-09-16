/**
 * The finish step body: the optional first-project name and the orientation
 * run behind Continue. While the host probes, persists, and scans, the body
 * shows its progress line; a 400's per-field refusals render verbatim and the
 * step stays put. Success lets the overlay complete the flow.
 */
import { useEffect, useState } from 'react'
import type { StepBodyProps } from './AgentsStepBody.tsx'
import type { OrientFailure, OrientOutcome } from './api.ts'
import css from './FinishStepBody.module.css'

/** Props for {@link FinishStepBody}. */
export interface FinishStepBodyProps extends StepBodyProps {
  /** The two folders the folder steps captured. */
  folders: { projects: string; documentation: string }
  /** Select the created first project (host workspace id). */
  selectProject: (workspaceId: string) => void
}

export function FinishStepBody({ api, t, registerCommit, folders, selectProject }: FinishStepBodyProps) {
  const [projectName, setProjectName] = useState(() => t('finish.project.default'))
  const [failures, setFailures] = useState<OrientFailure[]>([])
  const [generalError, setGeneralError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)

  useEffect(() => {
    registerCommit(async () => {
      const missing: OrientFailure[] = []
      if (folders.projects === '') missing.push({ field: 'projectsFolder', reason: t('finish.folderMissing') })
      if (folders.documentation === '') missing.push({ field: 'documentationFolder', reason: t('finish.folderMissing') })
      setFailures([])
      setGeneralError(null)
      if (missing.length > 0) {
        setFailures(missing)
        return false
      }
      setRunning(true)
      const outcome: OrientOutcome = await api.orient({
        projectsFolder: folders.projects,
        documentationFolder: folders.documentation,
        ...projectName.trim() === '' ? {} : { projectName: projectName.trim() },
      }).catch((): OrientOutcome => ({ ok: false, error: t('finish.generalError') }))
      setRunning(false)
      if (!outcome.ok) {
        setFailures(outcome.failures ?? [])
        if (outcome.error !== undefined) setGeneralError(outcome.error)
        return false
      }
      if (outcome.project !== undefined) selectProject(outcome.project.workspaceId)
      return true
    })
    return () => { registerCommit(null) }
    // The commit reads the latest state through the registered closure.
  }, [folders, projectName])

  return (
    <div className={css.body} data-finish-step>
      <div className={css.row} data-finish-field="projectName">
        <span className={css.label}>{t('finish.project.label')}</span>
        <input
          className={css.input}
          value={projectName}
          onChange={(event) => { setProjectName(event.target.value) }}
          data-finish-project
        />
        <p className={css.hint}>{t('finish.project.hint')}</p>
      </div>
      {failures.map(failure => (
        <p key={failure.field} className={css.error} data-finish-failure={failure.field}>{failure.reason}</p>
      ))}
      {generalError !== null && <p className={css.error} data-finish-error>{generalError}</p>}
      {running && <p className={css.hint} data-finish-progress>{t('finish.progress')}</p>}
    </div>
  )
}
