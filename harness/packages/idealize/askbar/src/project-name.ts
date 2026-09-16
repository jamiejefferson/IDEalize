/**
 * A project folder's display name, shared by the roster's groups and the
 * rail's project cell so both name a folder the same way.
 * @module @idealize/askbar/src/project-name
 */

/**
 * The name a project folder shows.
 * @param project - the resolved folder, or '' when there is none.
 * @returns the folder's last segment; the path itself when it has no segments (the filesystem root, or '').
 */
export function projectDisplayName(project: string): string {
  return project.split('/').filter(part => part !== '').pop() ?? project
}
