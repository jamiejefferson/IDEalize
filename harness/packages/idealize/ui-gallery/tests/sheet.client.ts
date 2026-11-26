/**
 * The Gallery view's stylesheet with comments removed, read from disk for the
 * specs that state a contract jsdom cannot lay out. It resolves from the
 * repository root, which is where vitest runs.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export const GALLERY_SHEET = readFileSync(resolve('packages/idealize/ui-gallery/src/client/GalleryView.module.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
