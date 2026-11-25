import { defineConfig } from "vitest/config";

// Backend tests run Convex functions against convex-test's in-memory backend.
export default defineConfig({
  test: {
    environment: "edge-runtime",
    include: ["tests/**/*.test.ts"],
    server: { deps: { inline: ["convex-test"] } },
  },
});
