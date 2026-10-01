/**
 * Which files a chat opens in the bar's viewer. Markdown does: it is what
 * agents write for people to read, and the viewer renders it with an
 * outline. Every other file keeps the OS default application, as before.
 * @param path - The file's path, absolute or `~/`.
 * @returns Whether the bar's viewer shows it.
 */
export function viewsInBar(path: string): boolean {
  return /\.(?:md|markdown)$/i.test(path)
}
