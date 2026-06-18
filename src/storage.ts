/**
 * D1-backed storage. One `messages` table; expired rows are filtered on read and
 * pruned by an hourly cron (see cleanupExpired + the scheduled handler in index.ts).
 * Listing is an indexed, LIMITed SELECT so polling stays cheap (billed as rows read).
 */
import type { Env, MessageMeta, StoredMessage } from "./types";
import { retentionSeconds } from "./util";

/** Newest N messages returned by the list endpoint (bounds rows read per poll). */
const LIST_LIMIT = 200;

interface BodyFields {
  text: string;
  html: string;
  headers: Record<string, string>;
  attachmentList: { filename: string; mimeType: string; size: number }[];
}

function splitMessage(message: StoredMessage): { meta: MessageMeta; body: BodyFields } {
  const { text, html, headers, attachmentList, ...meta } = message;
  return { meta, body: { text, html, headers, attachmentList } };
}

/** Parse a stored JSON column defensively — a corrupt row is skipped, never a 500. */
function safeParse<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export async function storeMessage(
  env: Env,
  project: string,
  message: StoredMessage,
): Promise<void> {
  const { meta, body } = splitMessage(message);
  const expiresAt = Date.now() + retentionSeconds(env.RETENTION_SECONDS) * 1000;
  await env.DB.prepare(
    `INSERT OR REPLACE INTO messages (project, id, received_at, expires_at, meta, body)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
  )
    .bind(project, message.id, message.receivedAt, expiresAt, JSON.stringify(meta), JSON.stringify(body))
    .run();
}

/** List message metadata for a project, newest first. Indexed; expired rows excluded. */
export async function listMessages(env: Env, project: string): Promise<MessageMeta[]> {
  const { results } = await env.DB.prepare(
    `SELECT meta FROM messages
     WHERE project = ?1 AND expires_at > ?2
     ORDER BY received_at DESC
     LIMIT ?3`,
  )
    .bind(project, Date.now(), LIST_LIMIT)
    .all<{ meta: string }>();
  return (results ?? [])
    .map((row) => safeParse<MessageMeta>(row.meta))
    .filter((m): m is MessageMeta => m !== null);
}

export async function getMessage(
  env: Env,
  project: string,
  id: string,
): Promise<StoredMessage | null> {
  const row = await env.DB.prepare(
    `SELECT meta, body FROM messages
     WHERE project = ?1 AND id = ?2 AND expires_at > ?3`,
  )
    .bind(project, id, Date.now())
    .first<{ meta: string; body: string }>();
  if (!row) return null;
  const meta = safeParse<MessageMeta>(row.meta);
  const body = safeParse<BodyFields>(row.body);
  if (!meta || !body) return null;
  return { ...meta, ...body };
}

export async function deleteMessage(env: Env, project: string, id: string): Promise<void> {
  await env.DB.prepare(`DELETE FROM messages WHERE project = ?1 AND id = ?2`)
    .bind(project, id)
    .run();
}

/** Delete every message in a project. Returns the count removed. */
export async function clearProject(env: Env, project: string): Promise<number> {
  const res = await env.DB.prepare(`DELETE FROM messages WHERE project = ?1`).bind(project).run();
  return res.meta.changes ?? 0;
}

/** Delete expired rows. Called by the scheduled (cron) handler. Returns rows removed. */
export async function cleanupExpired(env: Env): Promise<number> {
  const res = await env.DB.prepare(`DELETE FROM messages WHERE expires_at < ?1`)
    .bind(Date.now())
    .run();
  return res.meta.changes ?? 0;
}
