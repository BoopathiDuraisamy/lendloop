import type { AuthConfig } from "convex/server";

// Clerk issues JWTs (template/audience "convex"); Convex verifies them against
// the issuer's JWKS. Set CLERK_JWT_ISSUER_DOMAIN in the Convex deployment env.
export default {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN!,
      applicationID: "convex",
    },
  ],
} satisfies AuthConfig;
