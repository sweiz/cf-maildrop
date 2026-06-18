/**
 * cf-maildrop test client — a single, zero-dependency file you can copy into any
 * test suite. Works in Node 18+ and modern browsers (uses global `fetch`, Web Crypto,
 * `btoa`, `TextEncoder` — no imports).
 *
 * Quick start (e.g. Playwright / Vitest):
 *
 *   import { createMaildrop } from "./maildrop";
 *
 *   const mail = createMaildrop({
 *     baseUrl: "https://cf-maildrop.<your-subdomain>.workers.dev",
 *     domain:  "mail.example.com",
 *     salt:    process.env.MAILDROP_SALT!,   // OR token: process.env.MAILDROP_TOKEN
 *   });
 *
 *   const to = mail.address("acme");                  // inbox+acme-<unique>@mail.example.com
 *   // ...drive your app to send a sign-in email to `to`...
 *   const msg  = await mail.waitFor("acme", { to });  // polls until it arrives
 *   const code = mail.extractCode(msg);               // "123456" (OTP), or null
 *   const link = mail.extractLink(msg);               // first https URL, or null
 *
 * Auth: pass `salt` (the Worker's TOKEN_SALT) to derive a token for any project, OR
 * pass a precomputed `token` (from `npm run token <project>`) if you'd rather keep the
 * salt out of your test environment. The salt is the master secret — if you use it,
 * inject it from a CI/test secret, never commit it.
 */

export interface MaildropConfig {
  /** Worker base URL, e.g. https://cf-maildrop.<sub>.workers.dev (trailing slash ok). */
  baseUrl: string;
  /** Mail domain used to build addresses, e.g. "mail.example.com". */
  domain: string;
  /** Base label of your routing rule (matches MAIL_PREFIX). Default "inbox". */
  prefix?: string;
  /** HMAC salt (the Worker's TOKEN_SALT) to derive per-project tokens. Provide this OR `token`. */
  salt?: string;
  /** A precomputed project token (from `npm run token`). Used as-is for every request. */
  token?: string;
  /** Override the fetch implementation (defaults to global `fetch`). */
  fetchImpl?: typeof fetch;
}

export interface MaildropMeta {
  id: string;
  from: string;
  to: string;
  subject: string;
  receivedAt: string;
  size: number;
  hasText: boolean;
  hasHtml: boolean;
  attachments: number;
  /** Short numeric codes (4–8 digits) detected in the message — handy for OTPs. */
  codes: string[];
}

export interface MaildropMessage extends MaildropMeta {
  text: string;
  html: string;
  headers: Record<string, string>;
  attachmentList: { filename: string; mimeType: string; size: number }[];
}

export interface WaitOptions {
  /** Only match mail sent to this exact recipient — pass the address() you generated. */
  to?: string;
  /** Only match mail received at/after this time. Default: when the client was created. */
  since?: Date | string | number;
  /** Case-insensitive substring the subject must contain. */
  subjectIncludes?: string;
  /** Custom predicate over message metadata (combined with the other filters). */
  match?: (m: MaildropMeta) => boolean;
  /** Give up after this many ms (default 30000). */
  timeoutMs?: number;
  /** Poll interval in ms (default 1500). */
  intervalMs?: number;
}

export interface MaildropClient {
  /** Build a unique recipient: `<prefix>+<project>-<runId>@<domain>`. */
  address(project: string, runId?: string): string;
  /** The access token for a project (derived from salt, or the configured token). */
  token(project: string): Promise<string>;
  /** Message metadata for a project, newest first. */
  list(project: string): Promise<MaildropMeta[]>;
  /** Full message by id. */
  get(project: string, id: string): Promise<MaildropMessage>;
  /** Poll until a message matches the filters, then return it in full. Throws on timeout. */
  waitFor(project: string, opts?: WaitOptions): Promise<MaildropMessage>;
  /** Delete one message. */
  remove(project: string, id: string): Promise<void>;
  /** Delete all messages for a project. Returns the count removed. */
  clear(project: string): Promise<number>;
  /** First detected OTP-style code, or null. */
  extractCode(message: MaildropMessage | MaildropMeta): string | null;
  /** First URL (optionally matching a pattern) found in the body, or null. */
  extractLink(message: MaildropMessage, pattern?: string | RegExp): string | null;
}

const textEncoder = new TextEncoder();

function base64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** HMAC-SHA256(salt, project) as base64url — must match the Worker's token.ts exactly. */
async function deriveToken(salt: string, project: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(salt),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, textEncoder.encode(project));
  return base64url(signature);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function normalizeProject(project: string): string {
  const p = project.toLowerCase();
  if (!/^[a-z0-9]{1,40}$/.test(p)) {
    throw new Error(`maildrop: invalid project "${project}" (must be [a-z0-9], 1–40 chars)`);
  }
  return p;
}

export function createMaildrop(config: MaildropConfig): MaildropClient {
  if (!config.salt && !config.token) {
    throw new Error("maildrop: provide either `salt` or `token` in the config");
  }
  const prefix = config.prefix ?? "inbox";
  const base = config.baseUrl.replace(/\/+$/, "");
  const doFetch = config.fetchImpl ?? globalThis.fetch;
  const createdAt = Date.now();
  const tokenCache = new Map<string, string>();

  async function tokenFor(project: string): Promise<string> {
    if (config.token) return config.token;
    const cached = tokenCache.get(project);
    if (cached) return cached;
    const t = await deriveToken(config.salt!, project);
    tokenCache.set(project, t);
    return t;
  }

  async function call(
    project: string,
    path: string,
    init?: RequestInit,
  ): Promise<any> {
    const token = await tokenFor(project);
    // Send the token as a Bearer header, not in the URL, so it isn't captured in
    // request/observability logs.
    const res = await doFetch(`${base}/api/v1/${project}/${path}`, {
      ...init,
      headers: { ...init?.headers, Authorization: `Bearer ${token}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`maildrop: ${init?.method ?? "GET"} ${path} -> ${res.status} ${data?.error ?? ""}`.trim());
    }
    return data;
  }

  function extractCode(message: MaildropMessage | MaildropMeta): string | null {
    if (message.codes && message.codes.length) return message.codes[0];
    const haystack = `${message.subject ?? ""}\n${(message as MaildropMessage).text ?? ""}`;
    const m = haystack.match(/\b\d{4,8}\b/);
    return m ? m[0] : null;
  }

  function extractLink(message: MaildropMessage, pattern?: string | RegExp): string | null {
    const haystack = `${message.text ?? ""}\n${message.html ?? ""}`;
    const urls = haystack.match(/https?:\/\/[^\s"'<>)\]]+/g) ?? [];
    if (!pattern) return urls[0] ?? null;
    const re = typeof pattern === "string" ? new RegExp(pattern) : pattern;
    return urls.find((u) => re.test(u)) ?? null;
  }

  return {
    address(project, runId) {
      const p = normalizeProject(project);
      const id = runId ?? (crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : `${createdAt}`);
      return `${prefix}+${p}-${id}@${config.domain}`;
    },

    token(project) {
      return tokenFor(normalizeProject(project));
    },

    async list(project) {
      const data = await call(normalizeProject(project), "list");
      return (data.messages ?? []) as MaildropMeta[];
    },

    get(project, id) {
      return call(normalizeProject(project), `message/${encodeURIComponent(id)}`) as Promise<MaildropMessage>;
    },

    async waitFor(project, opts = {}) {
      const p = normalizeProject(project);
      const timeoutMs = opts.timeoutMs ?? 30000;
      const intervalMs = opts.intervalMs ?? 1500;
      const sinceMs = opts.since != null ? new Date(opts.since).getTime() : createdAt;
      const toLower = opts.to?.toLowerCase();
      const subjLower = opts.subjectIncludes?.toLowerCase();
      const deadline = Date.now() + timeoutMs;

      for (;;) {
        const messages = await this.list(p);
        const hit = messages.find(
          (m) =>
            (toLower ? m.to.toLowerCase() === toLower : true) &&
            new Date(m.receivedAt).getTime() >= sinceMs - 1000 && // 1s clock slack
            (subjLower ? (m.subject ?? "").toLowerCase().includes(subjLower) : true) &&
            (opts.match ? opts.match(m) : true),
        );
        if (hit) return this.get(p, hit.id);
        if (Date.now() >= deadline) {
          throw new Error(
            `maildrop.waitFor: no matching email for project "${p}"` +
              `${opts.to ? ` to ${opts.to}` : ""} within ${timeoutMs}ms`,
          );
        }
        await sleep(intervalMs);
      }
    },

    async remove(project, id) {
      await call(normalizeProject(project), `message/${encodeURIComponent(id)}`, { method: "DELETE" });
    },

    async clear(project) {
      const data = await call(normalizeProject(project), "clear", { method: "DELETE" });
      return (data.removed ?? 0) as number;
    },

    extractCode,
    extractLink,
  };
}
