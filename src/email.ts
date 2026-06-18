/** Email Worker handler: parse the inbound message and stash it in D1. */
import PostalMime from "postal-mime";
import type { Env, StoredMessage } from "./types";
import { storeMessage } from "./storage";
import { cap, extractCodes, projectFromAddress } from "./util";

/** Headers worth keeping for debugging; everything else is dropped to stay small. */
const KEEP_HEADERS = new Set([
  "message-id",
  "date",
  "subject",
  "from",
  "to",
  "reply-to",
  "return-path",
  "content-type",
  "list-unsubscribe",
]);

const MAX_BODY_CHARS = 256 * 1024;

export interface ForwardableEmailMessage {
  readonly to: string;
  readonly from: string;
  readonly raw: ReadableStream<Uint8Array>;
  readonly rawSize: number;
  setReject(reason: string): void;
}

export async function handleEmail(message: ForwardableEmailMessage, env: Env): Promise<void> {
  const project = projectFromAddress(message.to);
  if (!project) {
    // No `+<project>` subaddress (e.g. bare `inbox@`) — accept silently and drop
    // so we don't generate bounces for stray mail.
    console.log(`maildrop: ignoring non-matching recipient ${message.to}`);
    return;
  }

  const raw = await new Response(message.raw).arrayBuffer();
  const parsed = await new PostalMime().parse(raw);

  const text = cap(parsed.text ?? "", MAX_BODY_CHARS);
  const html = cap(parsed.html ?? "", MAX_BODY_CHARS);

  const headers: Record<string, string> = {};
  for (const h of parsed.headers ?? []) {
    const key = h.key.toLowerCase();
    if (KEEP_HEADERS.has(key)) headers[key] = h.value;
  }

  const attachmentList = (parsed.attachments ?? []).map((a) => ({
    filename: a.filename || "(unnamed)",
    mimeType: a.mimeType || "application/octet-stream",
    size: typeof a.content === "string" ? a.content.length : (a.content?.byteLength ?? 0),
  }));

  const id = `${Date.now().toString().padStart(15, "0")}-${crypto.randomUUID().slice(0, 8)}`;

  const stored: StoredMessage = {
    id,
    from: parsed.from?.address || message.from,
    to: message.to,
    subject: parsed.subject || "(no subject)",
    receivedAt: new Date().toISOString(),
    size: message.rawSize,
    hasText: text.length > 0,
    hasHtml: html.length > 0,
    attachments: attachmentList.length,
    codes: extractCodes(`${parsed.subject ?? ""}\n${parsed.text ?? ""}`),
    text,
    html,
    headers,
    attachmentList,
  };

  await storeMessage(env, project, stored);
  console.log(`maildrop: stored ${id} for project "${project}" (from ${stored.from})`);
}
