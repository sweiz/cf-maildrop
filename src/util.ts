/** Shared helpers for address parsing, validation, and code extraction. */

const PROJECT_RE = /^[a-z0-9]{1,40}$/;
/** Local part must be `<project>-<anything>-dev`; `<project>` is the leading token. */
const ADDRESS_RE = /^([a-z0-9]{1,40})-(?:.+-)?dev$/;

/** Extract the project folder from a recipient address, or null if it doesn't match. */
export function projectFromAddress(address: string): string | null {
  const local = (address.split("@")[0] || "").toLowerCase().trim();
  const match = local.match(ADDRESS_RE);
  return match ? match[1] : null;
}

/** Validate a project name supplied via the API path. */
export function isValidProject(project: string): boolean {
  return PROJECT_RE.test(project);
}

/**
 * Pull out short numeric one-time codes (4-8 digits) from text — the common case
 * for this tool. Returns de-duplicated matches, most useful first.
 */
export function extractCodes(text: string): string[] {
  if (!text) return [];
  const matches = text.match(/\b\d{4,8}\b/g) || [];
  return [...new Set(matches)].slice(0, 5);
}

/** Truncate a string to a byte-ish cap so a single value stays small in KV. */
export function cap(value: string, maxChars: number): string {
  if (!value) return "";
  return value.length > maxChars ? value.slice(0, maxChars) + "\n…[truncated]" : value;
}

/** Clamp retention to a sane window: default 24h, min 1m, max 7d. */
export function retentionSeconds(raw: string | undefined): number {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n)) return 86400;
  return Math.min(Math.max(n, 60), 604800);
}
