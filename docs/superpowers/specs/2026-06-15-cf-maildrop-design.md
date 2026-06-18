# cf-maildrop — design

**Date:** 2026-06-15

## Goal

A disposable dev email inbox on Cloudflare. Mail to
`‹prefix›+‹project›-‹run-id›@‹domain›` is captured per-project, readable via a
token-protected REST API and a basic web GUI, auto-expiring after ~24h, all within
the Cloudflare free tier. The repo must be safe as a public GitHub repo; it deploys
locally via `wrangler login` (OAuth) with no API token or CI secrets, and the only
secret (`TOKEN_SALT`) plus the real config stay gitignored.

**Routing (revised 2026-06-16):** rather than a catch-all, a single custom-address
rule (`‹prefix›@‹domain›` → Worker) plus Cloudflare **subaddressing** handles every
project: `‹prefix›+‹project›-‹run-id›@` is matched by the one rule and the `+detail`
is preserved in `message.to`. This never claims the catch-all, so it coexists with
existing email routing on the domain. The Worker needs no Cloudflare API token — the
subaddressing-only model was chosen over a runtime "create routing rule" API
specifically to avoid storing a zone-scoped credential in an internet-facing Worker.

## Architecture

Single Cloudflare Worker with two entrypoints:

- `email(message, env)` — Cloudflare Email Routing delivers inbound mail here. The
  recipient local part is parsed for the project; the message is parsed with
  `postal-mime` and inserted into D1.
- `fetch(request, env)` — serves the REST API. Configured with
  `assets.run_worker_first = ["/api/*"]` so the Worker runs only for API routes and
  the static GUI in `public/` is served directly by Workers Assets.
- `scheduled(event, env)` — hourly Cron Trigger that prunes expired rows.

### Storage: Cloudflare D1 (revised 2026-06-17 — was KV)

- Table `messages(project, id, received_at, expires_at, meta, body)`, PK `(project,
  id)`; `id = <padded epoch ms>-<rand8>`. `meta`/`body` are JSON columns.
- Index `(project, received_at DESC)` so `list` is an indexed, `LIMIT`ed `SELECT`
  (verified via EXPLAIN QUERY PLAN — `SEARCH ... USING INDEX`, no table scan).
- TTL: reads filter `expires_at > now`; an hourly cron `DELETE`s expired rows
  (index `(expires_at)`). D1 has no native TTL.
- Bodies capped at 256 KB each; attachment bytes are not stored.

**Why D1 over KV (the original choice):** KV's free tier allows only **1,000 list
ops/day**, and both the GUI auto-refresh and the test client's `waitFor` poll the
list endpoint — which exhausted the free tier in ~1 hour. D1 bills *rows read*
(5M/day free) for an indexed `SELECT`, ~5,000× the headroom, and is strongly
consistent (KV is eventual), so `waitFor` sees mail the instant it commits. The cost
is a cron for TTL (KV's `expirationTtl` was free/automatic) — a worthwhile trade.

### Auth: deterministic HMAC tokens

`token = base64url(HMAC-SHA256(key = TOKEN_SALT, message = project))`. Salt is a
Worker secret. No token store. Verified in constant time. `npm run token <project>`
and `src/token.ts` compute identically (Node `digest('base64url')` ↔ Web Crypto).

### Config flow (public-repo safe)

**Deploy (revised 2026-06-17):** deploy is local-only via `wrangler login` (OAuth) —
no GitHub Actions, no Cloudflare API token, no CI secrets. `wrangler.jsonc.example`
is committed; the user copies it to the gitignored `wrangler.jsonc` and fills in the
D1 database_id + `MAIL_DOMAIN` (neither is secret, but keeping them gitignored
avoids putting anything real in the public repo). `TOKEN_SALT` is the only secret:
set on the Worker with `wrangler secret put`, and kept in the gitignored `.dev.vars`
for `wrangler dev` + the token CLI. Nothing sensitive is committed.

## Components

| File                  | Responsibility                                  |
| --------------------- | ----------------------------------------------- |
| `src/index.ts`        | Worker entry: email + fetch routing             |
| `src/email.ts`        | Parse inbound mail → `StoredMessage`            |
| `src/storage.ts`      | D1 insert/list/get/delete/clear + cleanupExpired |
| `migrations/*.sql`    | D1 schema (table + indexes)                     |
| `src/api.ts`          | REST router + CORS + auth gate                  |
| `src/token.ts`        | HMAC token compute/verify                       |
| `src/util.ts`         | Address parsing, validation, code extraction    |
| `public/*`            | Static web GUI (no build step)                  |
| `scripts/token`       | CLI to print a project token                     |
| `wrangler.jsonc.example` | Committed config template (copy → wrangler.jsonc) |

## API

`GET /api/v1/config`, `GET /api/v1/‹p›/list`, `GET|DELETE /api/v1/‹p›/message/‹id›`,
`DELETE /api/v1/‹p›/clear`. Token via `?token=` or `Authorization: Bearer`.

## Error handling

400 invalid/missing project, 401 invalid token, 404 unknown route/message.
Non-matching recipients are accepted and dropped (no bounces). The list endpoint
returns the newest 200 rows (`LIMIT`) to bound rows read per request.

## Out of scope (v1)

Attachment body storage, multi-tenant token rotation, search, webhooks, pagination
UI. Retention is a single global window (`RETENTION_SECONDS`).
