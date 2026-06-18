/** Shared helpers for address parsing, validation, and code extraction. */

const PROJECT_RE = /^[a-z0-9]{1,40}$/;
/**
 * Project is the leading [a-z0-9] token of the subaddress detail, optionally
 * followed by `-`/`+`/`.` and arbitrary uniqueness text.
 */
const DETAIL_RE = /^([a-z0-9]{1,40})(?:[-+.].*)?$/;

/**
 * Extract the project from a recipient address, or null if it isn't a project
 * mailbox. Routing uses subaddressing: mail arrives at `<base>+<project>[-<run>]@`
 * via a single Email Routing rule for `<base>@`, and Cloudflare preserves the
 * `+detail` in the recipient. The base label is ignored; the project comes from
 * the part after the first `+`.
 */
export function projectFromAddress(address: string): string | null {
  const local = (address.split("@")[0] || "").toLowerCase().trim();
  const plus = local.indexOf("+");
  if (plus === -1) return null; // no subaddress -> not a project mailbox
  const match = local.slice(plus + 1).match(DETAIL_RE);
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

/** Truncate a string to a byte-ish cap so a single stored row stays small. */
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
