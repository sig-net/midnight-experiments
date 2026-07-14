// Runs ONCE in the main process before any test file: mints the benchmark
// run id every file stamps into its JSONL records (so one `yarn bench`
// invocation groups as one run in the report, however many files ran).
import type { TestProject } from "vitest/node";

export default function setup(project: TestProject): void {
  project.provide("benchRunId", new Date().toISOString());
}

declare module "vitest" {
  export interface ProvidedContext {
    benchRunId: string;
  }
}
