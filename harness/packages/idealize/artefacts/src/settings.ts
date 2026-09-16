/**
 * The `idealize-artefacts` settings section, shared by the host schema and the
 * browser scope: where a project's generated media saves. Each value is a
 * folder path relative to the project root (`/`-separated, no `..`, no leading
 * `/`), so a project stays self-contained and Finder-friendly; archived files
 * move into the `archive` subfolder of their kind's folder.
 * @module @idealize/artefacts/settings
 */

import z from '@deepseek-ai/schemastery'

/** Settings namespace owned by this package. */
export const ARTEFACT_SETTINGS_NAMESPACE = 'idealize-artefacts'

/** The folders, one per generated kind plus the archive subfolder name. */
export interface ArtefactFolderSettings {
  /** Where `image/*` artefacts save, relative to the project root. */
  images: string
  /** Where `audio/*` artefacts save. */
  sounds: string
  /** Where `video/*` artefacts save. */
  video: string
  /** Where anything else saves. */
  other: string
  /** The subfolder, under each kind's folder, that archived files move into. */
  archive: string
}

/** The shipped folders: visible, capitalised, one word each (JJ, 3 Sep 2026). */
export const ARTEFACT_FOLDER_DEFAULTS: ArtefactFolderSettings = {
  images: 'Images',
  sounds: 'Sounds',
  video: 'Video',
  other: 'Artefacts',
  archive: 'Archive',
}

/**
 * A project-relative folder: one or more `/`-separated segments, none empty,
 * none `.` or `..`, no leading or trailing slash, no backslash or NUL.
 * Enforced at the settings boundary so a stored value can never point outside
 * the project.
 */
export const FOLDER_PATTERN = /^(?!.*(?:^|\/)\.\.?(?:\/|$))[^\0\\/]+(?:\/[^\0\\/]+)*$/

const folder = (fallback: string): z<string> => z.string().pattern(FOLDER_PATTERN).default(fallback)

/** Durable schema; also the wire envelope the browser scope validates against. */
export const ArtefactFolderSettingsSchema: z<ArtefactFolderSettings> = z.object({
  images: folder(ARTEFACT_FOLDER_DEFAULTS.images),
  sounds: folder(ARTEFACT_FOLDER_DEFAULTS.sounds),
  video: folder(ARTEFACT_FOLDER_DEFAULTS.video),
  other: folder(ARTEFACT_FOLDER_DEFAULTS.other),
  archive: folder(ARTEFACT_FOLDER_DEFAULTS.archive),
})

/**
 * The folder one media type saves under.
 * @param settings - the resolved section.
 * @param mediaType - canonical `type/subtype`.
 * @returns the project-relative folder.
 */
export function folderFor(settings: ArtefactFolderSettings, mediaType: string): string {
  const kind = mediaType.toLowerCase()
  if (kind.startsWith('image/')) return settings.images
  if (kind.startsWith('audio/')) return settings.sounds
  if (kind.startsWith('video/')) return settings.video
  return settings.other
}
