/**
 * The Studio models a person has approved, kept in the `idealize-gen-tools`
 * settings section as `backend/model` → the name they were shown. The section
 * is registered by the host plugin (`./index.ts`); the generation tools, which
 * mount per chat, read and write it through the settings service.
 * @module @idealize/gen-tools/approved
 */

import z from '@deepseek-ai/schemastery'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { ApprovedModels } from './paid.ts'

/** The settings section holding the approved models. */
export const GEN_TOOLS_NS = settingsNamespace('idealize-gen-tools')

/** The section's shape. */
export interface GenToolsSettings {
  /** `backend/model` → the model's display name, for each model the person approved. */
  approved?: Record<string, string>
}

/** Runtime schema for {@link GenToolsSettings}. */
export const GenToolsSettings: z<GenToolsSettings> = z.object({
  approved: z.dict(z.string()).default({}),
})

/** The slice of the settings service the store uses, read structurally. */
export interface ApprovedSettingsFace {
  get(ns: typeof GEN_TOOLS_NS): unknown
  update(ns: typeof GEN_TOOLS_NS, patch: GenToolsSettings): Promise<unknown>
}

/**
 * Read the approved map out of the section.
 * @param settings - the settings service.
 * @returns the map; empty when the section holds none.
 */
export function approvedOf(settings: ApprovedSettingsFace): Record<string, string> {
  return (settings.get(GEN_TOOLS_NS) as GenToolsSettings | undefined)?.approved ?? {}
}

/**
 * The approved-models store over the settings service.
 * @param settings - the settings service, when composed.
 * @returns the store, or undefined when there is nowhere to keep an answer.
 */
export function approvedModels(settings: ApprovedSettingsFace | undefined): ApprovedModels | undefined {
  if (settings === undefined) return undefined
  return {
    has: key => Object.hasOwn(approvedOf(settings), key),
    add: async (key, name) => {
      await settings.update(GEN_TOOLS_NS, { approved: { ...approvedOf(settings), [key]: name } })
    },
  }
}

/** One approved model as `GET /idealize/generate/approved` lists it. */
export interface ApprovedModelRow {
  key: string
  backend: string
  model: string
  name: string
}

/**
 * The approved map as rows, in name order.
 * @param approved - the stored map.
 * @returns one row per approved model.
 */
export function approvedRows(approved: Readonly<Record<string, string>>): ApprovedModelRow[] {
  return Object.entries(approved)
    .map(([key, name]) => {
      const slash = key.indexOf('/')
      return { key, backend: slash < 0 ? key : key.slice(0, slash), model: slash < 0 ? '' : key.slice(slash + 1), name }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}
