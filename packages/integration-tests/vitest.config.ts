// Benchmark orchestration:
// - Files can NEVER run in parallel: they share one chain, one deployer
//   wallet (nonces/funds) and one proof server whose queueing would poison
//   the timing measurements. fileParallelism false runs them one at a time.
// - The sequencer pins a stable order (vitest's default orders by results
//   cache — failed/slowest first — which would shuffle runs).
// - globalSetup mints the run id all files stamp into their records.
import { basename } from "node:path";
import { defineConfig } from "vitest/config";
import { BaseSequencer, type TestSpecification } from "vitest/node";

const FILE_ORDER = [
  "baseline.test.ts",
  "events.test.ts",
  "hashing.test.ts",
  "xcall.test.ts",
  "xcall-with-payment.test.ts",
  "xcall-with-payment-atomic.test.ts",
];

const rank = (moduleId: string): number => {
  const index = FILE_ORDER.indexOf(basename(moduleId));
  return index === -1 ? FILE_ORDER.length : index;
};

class BenchSequencer extends BaseSequencer {
  override async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    return [...files].sort(
      (a, b) => rank(a.moduleId) - rank(b.moduleId) || a.moduleId.localeCompare(b.moduleId),
    );
  }
}

export default defineConfig({
  test: {
    globalSetup: "./src/global-setup.ts",
    fileParallelism: false,
    sequence: { sequencer: BenchSequencer },
    testTimeout: 30 * 60_000,
    hookTimeout: 10 * 60_000,
  },
});
