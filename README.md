# 📮 cf-maildrop

A disposable **dev email inbox** on Cloudflare. A single Email Routing rule
(`inbox@yourdomain`) sends mail to the Worker, and thanks to **subaddressing** every
message to `inbox+‹project›-‹run-id›@yourdomain` lands in a per-project bucket you
can read over a token-protected REST API or a tiny web GUI. Because it uses one
ordinary address rule (not the catch-all), it **coexists with your existing email
routing** and never overrides it. Messages auto-expire after ~24h. The whole thing
is designed to sit comfortably **inside Cloudflare's free tier**, and the repo is
safe to make **public** — all deploy config lives in GitHub Actions
secrets/variables, not in the code.

Great for grabbing OTPs / magic links in end-to-end tests without a real mailbox.

```
  inbox+acme-run42@   ┌──────────────────────┐   put (TTL 24h)   ┌──────────┐
  ────────────────▶   │  Cloudflare Email     │ ────────────────▶ │   KV     │
  (one rule:          │  Routing → Worker     │                   │ msg:proj │
   inbox@yourdomain   │  (email handler)      │ ◀──────────────── │  :id     │
   + subaddressing)   │  (fetch handler)      │   list / get       └──────────┘
                      └──────────┬───────────┘
                                 │  GET /api/v1/‹project›/list?token=…
                                 ▼
                      REST API  +  web GUI (static assets)
```

## How addresses map to buckets

With one rule for `inbox@yourdomain` and subaddressing enabled, the `+detail` is
preserved and read by the Worker:

| Address                                | Bucket (`project`) |
| -------------------------------------- | ------------------ |
| `inbox+acme@yourdomain`                | `acme`             |
| `inbox+acme-run42@yourdomain`          | `acme`             |
| `inbox+acme-anything-here@yourdomain`  | `acme`             |
| `inbox@yourdomain` (no `+detail`)      | *(ignored)*        |

Rule: the project is the leading `[a-z0-9]` token (1–40 chars) of the subaddress
detail — the part after the first `+`. Everything after the project (a `-run-id`
for uniqueness) is ignored for bucketing but keeps each test's address distinct.
`inbox` is just the base label (set via `MAIL_PREFIX`); the Worker ignores it, so
any base you point at the Worker works. Mail with no `+detail` is dropped silently.

## Access tokens

Each project has one deterministic token:

```
token = base64url( HMAC-SHA256(key = TOKEN_SALT, message = project) )
```

`TOKEN_SALT` is a server secret. Anyone who knows it can derive any project's
token; nobody else can. There is no token database. Get a project's token with:

```bash
npm run token acme        # reads TOKEN_SALT from .dev.vars or $TOKEN_SALT
```

## REST API

All endpoints take the token via `?token=…` **or** `Authorization: Bearer …`.

| Method   | Path                                  | Description                          |
| -------- | ------------------------------------- | ------------------------------------ |
| `GET`    | `/api/v1/config`                      | Public: `{ domain, addressFormat }`  |
| `GET`    | `/api/v1/‹project›/list`              | Message metadata, newest first       |
| `GET`    | `/api/v1/‹project›/message/‹id›`      | Full message (text, html, headers)   |
| `DELETE` | `/api/v1/‹project›/message/‹id›`      | Delete one message                   |
| `DELETE` | `/api/v1/‹project›/clear`             | Delete all messages for the project  |

```bash
TOKEN=$(npm run --silent token acme)
curl "https://your-worker.workers.dev/api/v1/acme/list?token=$TOKEN"
```

`list` returns each message's `id`, `from`, `to`, `subject`, `receivedAt`, `size`,
`hasText`, `hasHtml`, `attachments`, and any detected `codes` (4–8 digit numbers —
handy for OTPs). Attachment **metadata** is kept; attachment bytes are not stored.

## Web GUI

Visit the Worker's root URL. Enter a project + token (saved per-project in
`localStorage`), Load, and browse. Features: HTML/text/headers tabs (HTML rendered
in a sandboxed iframe), one-click copy of detected codes, auto-refresh, delete, and
clear-all. Deep-link a project with `#project` in the URL.

---

## Setup

### 1. Cloudflare prerequisites

- A domain (or subdomain) on Cloudflare with **Email Routing** enabled
  (dashboard → your domain → *Email* → enable; this adds the MX/SPF records).
- **Enable subaddressing**: Email Routing → **Settings** → turn on *Subaddressing*
  (so `inbox+anything@` is matched by the `inbox@` rule and the `+detail` reaches
  the Worker).
- Create the KV namespace and note its id:

  ```bash
  npx wrangler kv namespace create MAIL
  ```

- Create an API token (My Profile → API Tokens) with **Workers Scripts: Edit** and
  **Workers KV Storage: Edit**, and grab your **Account ID**.

### 2. GitHub config (public repo friendly)

In the repo's **Settings → Secrets and variables → Actions**:

**Secrets**
| Name                   | Value                                            |
| ---------------------- | ------------------------------------------------ |
| `CLOUDFLARE_API_TOKEN` | the API token from step 1                        |
| `CLOUDFLARE_ACCOUNT_ID`| your account id                                  |
| `TOKEN_SALT`           | a long random string (e.g. `openssl rand -hex 32`) |

**Variables**
| Name                | Value                                                |
| ------------------- | ---------------------------------------------------- |
| `KV_NAMESPACE_ID`   | id from `wrangler kv namespace create`               |
| `MAIL_DOMAIN`       | e.g. `mail.example.com`                              |
| `MAIL_PREFIX`       | base local part of your rule (default `inbox`)       |
| `RETENTION_SECONDS` | *(optional)* default `86400` (24h)                   |

Push to `main` → the `Deploy` workflow generates `wrangler.jsonc` from the template,
deploys the Worker, and uploads `TOKEN_SALT`.

### 3. Route mail to the Worker (no catch-all)

In Cloudflare → your domain → **Email → Email Routing → Routing rules**, add a
**custom address** rule:

- **Address:** `inbox@yourdomain` (must match `MAIL_PREFIX`)
- **Action:** **Send to a Worker → `cf-maildrop`**

That's the only rule needed. Subaddressing (enabled in step 1) means every
`inbox+‹project›-‹run-id›@yourdomain` is matched by this one rule, so you never touch
the **catch-all** and any existing email routing on the domain keeps working.

### 4. Use it

```bash
TOKEN=$(TOKEN_SALT=… npm run --silent token acme)
# send something to inbox+acme-run42@mail.example.com, then:
curl "https://cf-maildrop.<your-subdomain>.workers.dev/api/v1/acme/list?token=$TOKEN"
```

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars     # set TOKEN_SALT, KV_NAMESPACE_ID, MAIL_DOMAIN
npm run dev                        # generates wrangler.jsonc, starts wrangler dev
```

`wrangler dev` won't receive real email, but you can exercise the API/GUI by
seeding KV directly, e.g.:

```bash
npx wrangler kv key put --binding MAIL "msg:acme:000-test" \
  '{"id":"000-test","from":"a@b.com","to":"inbox+acme-run42@x","subject":"hi","receivedAt":"2026-01-01T00:00:00Z","size":1,"hasText":true,"hasHtml":false,"attachments":0,"codes":["123456"],"text":"code 123456","html":"","headers":{},"attachmentList":[]}'
```

Other scripts: `npm run typecheck`, `npm run config` (regenerate `wrangler.jsonc`),
`npm run deploy` (deploy from your machine).

## Free-tier notes

- **KV** auto-expires messages via `expirationTtl`, so there's **no cron** and no
  delete sweep. Free limits (~1k writes/day, 100k reads/day, 1 GB) are far above
  what a dev mailbox needs.
- **Workers** free tier is 100k requests/day; the GUI is served as static assets.
- Bodies are capped at 256 KB each and attachment bytes aren't stored, keeping
  every KV value tiny (well under the 25 MB value limit).

## Security model

- Tokens are HMAC'd with a server-only salt and compared in constant time.
- HTML is rendered only inside a sandboxed, no-referrer iframe.
- The GUI sends `noindex`. There is no auth beyond the per-project token, so treat
  the salt as sensitive.
- Routing uses a single custom-address rule plus subaddressing, so it never claims
  the catch-all and can run alongside a domain that also carries real mail. Note
  that anyone who can send mail to `inbox+‹project›@` can write into that bucket
  (reading still requires the token) — use non-obvious project names for anything
  sensitive.

MIT licensed.
