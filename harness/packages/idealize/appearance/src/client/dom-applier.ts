/**
 * The one appearance value that is neither a theme token nor a stylesheet
 * rule, written straight to the document: interface size as a zoom on the
 * shell mount (`#root`, whose percentage height keeps it inside the viewport
 * at any factor).
 */

/**
 * Project the interface size onto a document. Idempotent; only ever touches
 * the `zoom` inline property of `#root`.
 * @param doc - the document to write.
 * @param scale - zoom factor; 1 clears the inline value.
 */
export function applyAppearanceDom(doc: Document, scale: number): void {
  const root = doc.getElementById('root')
  if (root === null) return
  if (scale === 1) root.style.removeProperty('zoom')
  else root.style.setProperty('zoom', String(scale))
}
