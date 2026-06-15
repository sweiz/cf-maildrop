/**
 * Per-project access tokens.
 *
 * token = base64url( HMAC-SHA256(key = TOKEN_SALT, message = project) )
 *
 * The salt is a server-side secret, so anyone who knows it can derive the token
 * for any project (and only they can). Tokens are deterministic — there is no
 * token store to manage. Compute yours with `npm run token <project>`.
 */
const encoder = new TextEncoder();

function base64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function computeToken(project: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(salt),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(project));
  return base64url(signature);
}

/** Constant-time string comparison to avoid leaking the token via timing. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

export async function verifyToken(
  project: string,
  token: string | null,
  salt: string,
): Promise<boolean> {
  if (!token || !salt) return false;
  const expected = await computeToken(project, salt);
  return timingSafeEqual(expected, token);
}
