import type { NextConfig } from "next";

// Baseline security headers every real SaaS should ship. Deliberately no
// Content-Security-Policy here — the app renders a lot of inline base64
// photo data (data: URIs) and relies on Next.js/framer-motion's runtime
// injected styles, so a strict CSP needs to be built and tested
// page-by-page rather than bolted on as a one-line guess; a wrong CSP fails
// silently (blocked resources, no error the user sees) which is worse than
// having none yet.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["sharp", "@prisma/client", "prisma"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
