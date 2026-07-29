/** Escape a string value for safe inclusion in a PocketBase filter query.
 * This prevents filter injection and ensures correct quoting.
 * Must be applied to ALL user-supplied values used in filter strings.
 */
export function escapePbFilterValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
