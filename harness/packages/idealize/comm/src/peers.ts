/**
 * The other chats open in a new chat's project, told to it at session start.
 * A chat used to learn only its own name, so one started this morning could
 * redo work a chat beside it had already finished. Pure, so the roster is the
 * only input.
 * @module @idealize/comm/peers
 */

import { sep } from 'node:path'

/** One chat as the notice reads it. */
export interface PeerRow {
  id: string
  name?: string
  title: string
  projectPath?: string
  role: string
  /** The chat's own status line, else `working` or `idle`. */
  status: string
  live: boolean
}

/** How many peers the notice names before it says how many more there are. */
const PEER_LIMIT = 8

/**
 * The project a folder belongs to: the deepest registered project holding
 * it, else the folder itself.
 * @param folder - a chat's working folder.
 * @param roots - IDEalize's registered project folders.
 * @returns the project folder.
 */
export function projectOf(folder: string, roots: readonly string[]): string {
  let best: string | undefined
  for (const root of roots) {
    if (folder !== root && !folder.startsWith(root.endsWith(sep) ? root : root + sep)) continue
    if (best === undefined || root.length > best.length) best = root
  }
  return best ?? folder
}

/**
 * The notice naming the other chats open in the same project.
 * @param self - the new chat's id.
 * @param folder - the new chat's working folder.
 * @param rows - the roster.
 * @param roots - IDEalize's registered project folders.
 * @returns the notice, or undefined when no other chat is open there.
 */
export function peersNotice(
  self: string,
  folder: string | undefined,
  rows: readonly PeerRow[],
  roots: readonly string[],
): string | undefined {
  if (folder === undefined || folder === '') return undefined
  const project = projectOf(folder, roots)
  const peers = rows.filter(row => row.live && row.id !== self && row.role !== 'studio-agent'
    && row.projectPath !== undefined && projectOf(row.projectPath, roots) === project)
  if (peers.length === 0) return undefined
  const lines = peers.slice(0, PEER_LIMIT).map((peer) => {
    const role = peer.role === 'project-agent' ? ' (the project coordinator)' : ''
    return `- ${peer.name ?? peer.id} · ${peer.title}${role}: ${peer.status}`
  })
  if (peers.length > PEER_LIMIT) lines.push(`- and ${String(peers.length - PEER_LIMIT)} more (\`idealize list\`)`)
  return 'Other chats open in this project right now. Before you start, check none of them already has your task; '
    + 'ask with `idealize send <name> "<question>"` rather than redo their work, and read one\'s recent work with '
    + '`idealize transcript <name>`.\n'
    + lines.join('\n')
}
