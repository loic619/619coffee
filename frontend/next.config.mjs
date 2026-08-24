/** @type {import('next').NextConfig} */

// Baseline security headers (audit Finding 3). Applied to every response.
//
// The CSP is intentionally pragmatic, not maximal: Next.js injects inline
// bootstrap scripts and inline styles, so 'unsafe-inline' stays for script/
// style — removing it needs per-request nonces, a bigger change. What it DOES
// buy: script/style/connect are pinned to 'self' (no external script origin
// can execute), framing is denied outright (clickjacking — the concrete risk
// the audit named), and the map tile hosts are the only third parties allowed,
// and only for images.
//
// If a separate backend is wired via NEXT_PUBLIC_API_URL, add its origin to
// connect-src. Verify against a Vercel PREVIEW deploy before merging — a CSP
// that's too tight fails silently in the browser console, not at build.
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "img-src 'self' data: blob: https://*.basemaps.cartocdn.com https://server.arcgisonline.com",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "connect-src 'self' https://api.github.com",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "geolocation=(), microphone=(), camera=()" },
];

const nextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
