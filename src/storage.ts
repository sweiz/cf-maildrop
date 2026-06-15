/** KV-backed storage. Keys: `msg:<project>:<id>`. Values auto-expire via TTL. */
import type { Env, MessageMeta, StoredMessage } from "./types";
import { retentionSeconds } from "./util";

const PREFIX = (project: string) => `msg:${project}:`;

export async function storeMessage(
  env: Env,
  project: string,
  message: StoredMessage,
): Promise<void> {
  const key = PREFIX(project) + message.id;
  const meta: MessageMeta = {
    id: message.id,
    from: message.from,
    to: message.to,
    subject: message.subject,
    receivedAt: message.receivedAt,
    size: message.size,
    hasText: message.hasText,
    hasHtml: message.hasHtml,
    attachments: message.attachments,
    codes: message.codes,
  };
  await env.MAIL.put(key, JSON.stringify(message), {
    expirationTtl: retentionSeconds(env.RETENTION_SECONDS),
    metadata: meta,
  });
}

/** List message metadata for a project, newest first. */
export async function listMessages(env: Env, project: string): Promise<MessageMeta[]> {
  const out: MessageMeta[] = [];
  let cursor: string | undefined;
  // Cap at a few pages so a runaway project can't blow the request budget.
  for (let page = 0; page < 5; page++) {
    const res = await env.MAIL.list<MessageMeta>({ prefix: PREFIX(project), cursor });
    for (const k of res.keys) {
      if (k.metadata) out.push(k.metadata);
    }
    if (res.list_complete) break;
    cursor = res.cursor;
  }
  out.sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1));
  return out;
}

export async function getMessage(
  env: Env,
  project: string,
  id: string,
): Promise<StoredMessage | null> {
  return env.MAIL.get<StoredMessage>(PREFIX(project) + id, "json");
}

export async function deleteMessage(env: Env, project: string, id: string): Promise<void> {
  await env.MAIL.delete(PREFIX(project) + id);
}

/** Delete every message in a project. Returns the count removed. */
export async function clearProject(env: Env, project: string): Promise<number> {
  let removed = 0;
  let cursor: string | undefined;
  for (let page = 0; page < 5; page++) {
    const res = await env.MAIL.list({ prefix: PREFIX(project), cursor });
    await Promise.all(res.keys.map((k) => env.MAIL.delete(k.name)));
    removed += res.keys.length;
    if (res.list_complete) break;
    cursor = res.cursor;
  }
  return removed;
}
