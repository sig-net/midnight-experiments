import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fileParallelism: false,
    // Real proving: a single call can take minutes.
    testTimeout: 30 * 60_000,
    hookTimeout: 10 * 60_000,
  },
});
