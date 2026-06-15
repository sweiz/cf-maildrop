# cf-maildrop — design

**Date:** 2026-06-15

## Goal

A disposable dev email inbox on Cloudflare. Mail to
`‹prefix›+‹project›-‹run-id›@‹domain›` is captured per-project, readable via a
token-protected REST API and a basic web GUI, auto-expiring after ~24h, all within
the Cloudflare free tier. The repo must be safe as a public GitHub repo, deploying
to the owner's Cloudflare account via private GitHub Actions secrets/variables.

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
  `postal-mime` and stored in KV.
- `fetch(request, env)` — serves the REST API. Configured with
  `assets.run_worker_first = ["/api/*"]` so the Worker runs only for API routes and
  the static GUI in `public/` is served directly by Workers Assets.

### Storage: Cloudflare KV

- Key: `msg:‹project›:‹id›`, where `id = <padded epoch ms>-<rand8>` (sortable).
- Value: full message JSON (text, html, kept headers, attachment metadata).
- List-relevant metadata is stored in the KV entry's `metadata`, so the list
  endpoint is a single `list({prefix})` with no per-message reads.
- **TTL via `expirationTtl`** → automatic expiry, no cron, no delete sweep.
- Bodies capped at 256 KB each; attachment bytes are not stored.

KV chosen over R2/D1 specifically for native per-key TTL (zero-maintenance expiry)
and prefix listing, which map directly onto the two operations needed.

### Auth: deterministic HMAC tokens

`token = base64url(HMAC-SHA256(key = TOKEN_SALT, message = project))`. Salt is a
Worker secret. No token store. Verified in constant time. `npm run token <project>`
and `src/token.ts` compute identically (Node `digest('base64url')` ↔ Web Crypto).

### Config flow (public-repo safe)

`wrangler.template.jsonc` holds `__PLACEHOLDER__`s. `scripts/gen-config.mjs`
substitutes from env (CI) or `.dev.vars` (local) and writes the gitignored
`wrangler.jsonc`. CI passes `KV_NAMESPACE_ID`/`MAIL_DOMAIN` as GitHub *Variables*;
`CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID`/`TOKEN_SALT` as *Secrets*
(`TOKEN_SALT` uploaded by wrangler-action). Nothing sensitive is committed.

## Components

| File                  | Responsibility                                  |
| --------------------- | ----------------------------------------------- |
| `src/index.ts`        | Worker entry: email + fetch routing             |
| `src/email.ts`        | Parse inbound mail → `StoredMessage`            |
| `src/storage.ts`      | KV put/list/get/delete/clear                    |
| `src/api.ts`          | REST router + CORS + auth gate                  |
| `src/token.ts`        | HMAC token compute/verify                       |
| `src/util.ts`         | Address parsing, validation, code extraction    |
| `public/*`            | Static web GUI (no build step)                  |
| `scripts/gen-config`  | Template → wrangler.jsonc                        |
| `scripts/token`       | CLI to print a project token                     |
| `.github/workflows`   | Deploy on push to main                          |

## API

`GET /api/v1/config`, `GET /api/v1/‹p›/list`, `GET|DELETE /api/v1/‹p›/message/‹id›`,
`DELETE /api/v1/‹p›/clear`. Token via `?token=` or `Authorization: Bearer`.

## Error handling

400 invalid/missing project, 401 invalid token, 404 unknown route/message.
Non-matching recipients are accepted and dropped (no bounces). List/clear cap at 5
KV pages to bound request cost.

## Out of scope (v1)

Attachment body storage, multi-tenant token rotation, search, webhooks, pagination
UI. Retention is a single global window (`RETENTION_SECONDS`).
