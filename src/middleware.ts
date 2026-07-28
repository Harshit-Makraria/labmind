import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";

export default NextAuth(authConfig).auth;

export const config = {
  matcher: [
    // Excludes /api (gated inside the Hono layer instead), Next internals, and
    // every static asset. Static files MUST be excluded — otherwise an
    // unauthenticated fetch of /manifest.json is redirected to /auth and the
    // browser tries to parse the HTML login page as JSON ("Syntax error").
    "/((?!api/|_next/static|_next/image|favicon\\.ico|manifest\\.json|robots\\.txt|sitemap\\.xml|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|webmanifest)$|$|auth|signup).*)",
  ],
};
