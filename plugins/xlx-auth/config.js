/** Account and role identifiers accepted by the project authorization API. */
export const ADMIN_ROLE = 'admin'

/**
 * Check identifiers before persistence or inclusion in routes.
 * @param {unknown} value Submitted identifier.
 * @returns {boolean} Whether the identifier is canonical.
 */
export function isKey(value) {
  return typeof value === 'string' && /^[a-z][a-z0-9_-]{0,62}$/.test(value)
}
