/** cf-maildrop entrypoint: an Email Worker that also serves a token-protected API. */
import type { Env } from "./types";
import { handleEmail, type ForwardableEmailMessage } from "./email";
import { handleApi } from "./api";

export default {
  /** Inbound mail (Cloudflare Email Routing -> this Worker). */
  async email(message: ForwardableEmailMessage, env: Env): Promise<void> {
    await handleEmail(message, env);
  },

  /** HTTP. Only reached for `/api/*`; static assets (the GUI) are served directly. */
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return handleApi(request, env, url);
    return new Response("Not found", { status: 404 });
  },
};
