#!/usr/bin/env node
/**
 * Generate wrangler.jsonc from wrangler.template.jsonc by substituting placeholders
 * with environment variables. Used by both `npm run dev/deploy` and CI.
 *
 * Local dev: values are read from process.env, falling back to .dev.vars.
 * CI: the workflow exports KV_NAMESPACE_ID / MAIL_DOMAIN before running this.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Load .dev.vars (KEY=value lines) as a fallback for local development.
const devVars = {};
const devVarsPath = join(root, ".dev.vars");
if (existsSync(devVarsPath)) {
  for (const line of readFileSync(devVarsPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) devVars[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const get = (key, fallback) => process.env[key] ?? devVars[key] ?? fallback;

const replacements = {
  __KV_NAMESPACE_ID__: get("KV_NAMESPACE_ID", ""),
  __MAIL_DOMAIN__: get("MAIL_DOMAIN", "example.com"),
  __RETENTION_SECONDS__: get("RETENTION_SECONDS", "86400"),
};

if (!replacements.__KV_NAMESPACE_ID__) {
  console.warn(
    "[gen-config] WARNING: KV_NAMESPACE_ID is empty. Create one with " +
      "`npx wrangler kv namespace create MAIL` and set it in .dev.vars (local) " +
      "or the KV_NAMESPACE_ID GitHub Actions variable (CI).",
  );
}

let out = readFileSync(join(root, "wrangler.template.jsonc"), "utf8");
for (const [placeholder, value] of Object.entries(replacements)) {
  out = out.replaceAll(placeholder, value);
}

writeFileSync(join(root, "wrangler.jsonc"), out);
console.log(
  `[gen-config] wrote wrangler.jsonc (domain=${replacements.__MAIL_DOMAIN__}, ` +
    `retention=${replacements.__RETENTION_SECONDS__}s)`,
);
