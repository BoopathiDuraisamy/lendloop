/// <reference types="vite/client" />
// Module map for convex-test (must live at the root of the Convex functions directory).
// Used only by the test suite in /tests. Files with two dots (this file, *.config.ts)
// aren't function modules, so they're excluded.
export const modules = import.meta.glob(["./**/*.*s", "!./**/*.*.*s"]);
