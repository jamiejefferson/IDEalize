/**
 * The new-chat permission default, as the composer's permission chip writes
 * it. The host permission plugin (`dsh-permission-presets`) registers the
 * namespace and validates the preset; the names are restated here because a
 * client plugin may not import a host package (bundle purity gate).
 */

/** Settings namespace the host permission plugin registers. */
export const PERMISSION_SETTINGS_NAMESPACE = 'permission'

/** The part of the permission section the chip writes. */
export interface PermissionDefaults {
  /** The preset a newly created chat starts with. */
  defaultPreset: string
}
