#!/usr/bin/env node
/**
 * Print the access token for a project.
 *   npm run token <project>
 *
 * token = base64url(HMAC-SHA256(key = TOKEN_SALT, message = project))
 * TOKEN_SALT is read from process.env, falling back to .dev.vars.
 * This MUST match src/token.ts exactly.
 */
import { createHmac } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

let salt = process.env.TOKEN_SALT;
if (!salt && existsSync(join(root, ".dev.vars"))) {
  for (const line of readFileSync(join(root, ".dev.vars"), "utf8").split("\n")) {
    const m = line.match(/^\s*TOKEN_SALT\s*=\s*(.*)\s*$/);
    if (m) salt = m[1].replace(/^["']|["']$/g, "");
  }
}

const project = (process.argv[2] || "").toLowerCase();
if (!project) {
  console.error("usage: npm run token <project>");
  process.exit(1);
}
if (!/^[a-z0-9]{1,40}$/.test(project)) {
  console.error("project must be [a-z0-9], 1-40 chars");
  process.exit(1);
}
if (!salt) {
  console.error("TOKEN_SALT not set (export it or add it to .dev.vars)");
  process.exit(1);
}

const token = createHmac("sha256", salt).update(project).digest("base64url");
console.log(token);
