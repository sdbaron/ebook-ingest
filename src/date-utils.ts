/**
 * Convert an ISO-8601 timestamp to a YYYY-MM-DD date string.
 */
export function toDateOnly(isoTimestamp: string): string {
  return isoTimestamp.slice(0, 10);
}

/**
 * Today's date as YYYY-MM-DD, for `updated`/`updated_at` fields.
 */
export function todayDateOnly(): string {
  return new Date().toISOString().slice(0, 10);
}
