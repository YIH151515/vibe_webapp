/** Static defense also covers API responses, errors and maintenance pages. */
export const securityHeaders: { key: string; value: string }[] = [
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Content-Security-Policy", value: "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'" },
];

export function contentSecurityPolicy(nonce: string, development: boolean, loginOrigin = "https://login.microsoftonline.com"): string {
  if (!/^[A-Za-z0-9+/]{43}=$/.test(nonce)) throw new Error("INVALID_CSP_NONCE");
  if (loginOrigin !== "https://login.microsoftonline.com" && !(development && /^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(loginOrigin) && Number(new URL(loginOrigin).port) <= 65535)) throw new Error("INVALID_CSP_LOGIN_ORIGIN");
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    "script-src-attr 'none'",
    // React admin styles and ProseMirror require inline CSS, never inline scripts.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    `connect-src 'self'${development ? " ws: wss:" : ""}`,
    "object-src 'none'", "base-uri 'self'", `form-action 'self' ${loginOrigin}`,
    "frame-ancestors 'none'", "frame-src 'none'",
  ].join("; ");
}
