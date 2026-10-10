/** @type {import('next').NextConfig} */
const prod = process.env.NODE_ENV === 'production';
// The map draws tiles from the provider (https images) and runs its worker from a blob.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${prod ? '' : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob: https:",
  // wss: for the live connection; in development the platform service is on another port of this computer
  `connect-src 'self' https: wss:${prod ? '' : ' ws://localhost:* http://localhost:*'}`,
  "worker-src 'self' blob:",
  "child-src blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');
const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'geolocation=(self), camera=(self), microphone=()' },
  ...(prod && process.env.COOKIE_SECURE !== 'false' ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }] : []),
];
const nextConfig = {
  serverExternalPackages: ['pg', 'exceljs', 'bcryptjs', 'hash-wasm'],
  poweredByHeader: false,
  async headers() { return [{ source: '/:path*', headers: securityHeaders }]; },
  // Without the reverse proxy (local development) the web app passes platform calls on to the Python service itself.
  // In production Caddy sends /api/v1 straight to it and this rule is never reached. The address is fixed when the app is built.
  async rewrites() {
    const to = (process.env.PLATFORM_URL || 'http://localhost:8000').replace(/\/+$/, '');
    return [{ source: '/api/v1/:path*', destination: `${to}/api/v1/:path*` }, { source: '/ws', destination: `${to}/ws` }];
  },
};
export default nextConfig;
