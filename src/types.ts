/** Bindings and vars available to the Worker. Mirrors wrangler.jsonc. */
export interface Env {
  /** KV namespace holding stored messages, keyed `msg:<project>:<id>`. */
  MAIL: KVNamespace;
  /** Static assets binding (the web GUI). Not used directly; assets auto-serve. */
  ASSETS: Fetcher;
  /** The mail domain, e.g. "mail.example.com". Shown in the GUI as example addresses. */
  MAIL_DOMAIN: string;
  /** The base local part of the single Email Routing rule, e.g. "inbox". Display only. */
  MAIL_PREFIX?: string;
  /** How long messages live before KV auto-deletes them, in seconds (string var). */
  RETENTION_SECONDS?: string;
  /** Secret. HMAC key used to derive per-project access tokens. */
  TOKEN_SALT: string;
}

/** Lightweight metadata stored alongside each KV entry; returned by the list endpoint. */
export interface MessageMeta {
  id: string;
  from: string;
  to: string;
  subject: string;
  /** ISO timestamp the message was received. */
  receivedAt: string;
  /** Original size of the raw message in bytes. */
  size: number;
  hasText: boolean;
  hasHtml: boolean;
  attachments: number;
  /** Any short numeric codes detected in the body (handy for OTP testing). */
  codes: string[];
}

/** Full stored message (KV value). */
export interface StoredMessage extends MessageMeta {
  text: string;
  html: string;
  /** Selected headers, lower-cased keys. */
  headers: Record<string, string>;
  attachmentList: { filename: string; mimeType: string; size: number }[];
}
