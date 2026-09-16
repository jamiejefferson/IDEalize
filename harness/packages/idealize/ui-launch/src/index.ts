/**
 * @idealize/ui-launch — Host half. The opening sequence is browser-only (a
 * shell.overlay occupant plus one injected stylesheet), so this half carries
 * no host contributions; it exists so the package loads through the host
 * resolver like every other bundle row.
 * @module @idealize/ui-launch
 */

/** Host apply: no host-side contributions — the browser half (`./client`) is the whole feature. */
export function apply(): void {
  // Browser-only feature; see src/client/index.ts.
}
