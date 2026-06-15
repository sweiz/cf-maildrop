/** REST API router. Only invoked for `/api/*` (see run_worker_first in wrangler). */
import type { Env } from "./types";
import { verifyToken } from "./token";
import { clearProject, deleteMessage, getMessage, listMessages } from "./storage";
import { isValidProject } from "./util";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS },
  });
}

function tokenFrom(request: Request, url: URL): string | null {
  const auth = request.headers.get("Authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7).trim();
  return url.searchParams.get("token");
}

export async function handleApi(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  // /api/v1/config  -> public config for the GUI (no auth; domain is not secret).
  if (url.pathname === "/api/v1/config") {
    const prefix = env.MAIL_PREFIX || "inbox";
    return json({
      domain: env.MAIL_DOMAIN,
      prefix,
      addressFormat: `${prefix}+<project>-<run-id>`,
    });
  }

  // /api/v1/<project>/<action>[/<id>]
  const parts = url.pathname.replace(/^\/api\/v1\//, "").split("/").filter(Boolean);
  const [project, action, id] = parts;

  if (!project || !isValidProject(project)) {
    return json({ error: "invalid or missing project (use [a-z0-9], 1-40 chars)" }, 400);
  }

  if (!(await verifyToken(project, tokenFrom(request, url), env.TOKEN_SALT))) {
    return json({ error: "invalid token" }, 401);
  }

  // GET /api/v1/<project>/list
  if (action === "list" && request.method === "GET") {
    return json({ project, messages: await listMessages(env, project) });
  }

  // GET /api/v1/<project>/message/<id>
  if (action === "message" && id && request.method === "GET") {
    const msg = await getMessage(env, project, id);
    return msg ? json(msg) : json({ error: "not found" }, 404);
  }

  // DELETE /api/v1/<project>/message/<id>
  if (action === "message" && id && request.method === "DELETE") {
    await deleteMessage(env, project, id);
    return json({ ok: true, deleted: id });
  }

  // DELETE /api/v1/<project>/clear
  if (action === "clear" && request.method === "DELETE") {
    return json({ ok: true, removed: await clearProject(env, project) });
  }

  return json({ error: "unknown route" }, 404);
}
