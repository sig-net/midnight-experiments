// Renders reports/REPORT.md from:
//   1. STATIC circuit metrics — read off each contract package's compiled
//      managed/ output (zkir instruction counts, prover/verifier key sizes).
//      Requires a full `yarn compile:zk` (keys must exist).
//   2. DYNAMIC benchmark records — reports/raw/records.jsonl, appended by
//      `yarn bench` (the integration tests). The report uses the LATEST run
//      id present in the file.
//
// Run: yarn report   (from the repo root or this package)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import {
  collectContractStaticMetrics,
  type BenchRecord,
  type CircuitStaticMetrics,
} from "@midnight-experiments/lib";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const recordsFile = join(repoRoot, "reports", "raw", "records.jsonl");
const reportFile = join(repoRoot, "reports", "REPORT.md");

// ── static metrics ──────────────────────────────────────────────────────────

const CONTRACTS: { experiment: string; contract: string; managedPath: string }[] = [
  { experiment: "baseline", contract: "baseline", managedPath: "packages/baseline-contract/src/managed/baseline" },
  { experiment: "events", contract: "events", managedPath: "packages/events-contract/src/managed/events" },
  { experiment: "hashing", contract: "hashing", managedPath: "packages/hashing-contract/src/managed/hashing" },
  { experiment: "xcall", contract: "caller", managedPath: "packages/xcall-contract/src/managed/caller" },
  { experiment: "xcall", contract: "target", managedPath: "packages/xcall-contract/src/managed/target" },
];

// ── dynamic records ─────────────────────────────────────────────────────────

function loadRecords(): BenchRecord[] {
  if (!existsSync(recordsFile)) return [];
  return readFileSync(recordsFile, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as BenchRecord);
}

interface Stats {
  n: number;
  mean: number;
  min: number;
  max: number;
}

function stats(values: number[]): Stats | undefined {
  if (values.length === 0) return undefined;
  return {
    n: values.length,
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

// ── formatting ──────────────────────────────────────────────────────────────

const fmtMs = (ms?: number): string => (ms === undefined ? "—" : `${(ms / 1000).toFixed(2)}s`);
const fmtInt = (n?: number): string => (n === undefined ? "—" : n.toLocaleString("en-US"));
const fmtBytes = (n?: number): string => (n === undefined ? "—" : `${n.toLocaleString("en-US")} B`);
const fmtRatio = (a?: number, b?: number): string =>
  a === undefined || b === undefined || b === 0 ? "—" : `${(a / b).toFixed(2)}×`;

function table(headers: string[], rows: string[][]): string {
  const line = (cells: string[]) => `| ${cells.join(" | ")} |`;
  return [line(headers), line(headers.map(() => "---")), ...rows.map(line)].join("\n");
}

// ── main ────────────────────────────────────────────────────────────────────

const records = loadRecords();
const runIds = [...new Set(records.map((record) => record.runId))].sort();

// Independent runs COMPOSE: for each (experiment, circuit) the report uses
// that circuit's most recent run only, so `yarn bench:hashing-control32`
// refreshes one row without invalidating the rest.
function latestRunRecords(experiment: string, circuit: string): BenchRecord[] {
  const mine = records.filter((record) => record.experiment === experiment && record.circuit === circuit);
  const lastRunId = [...new Set(mine.map((record) => record.runId))].sort().at(-1);
  return mine.filter((record) => record.runId === lastRunId);
}

const reps = records.length > 0 ? Math.max(...records.map((record) => (record.rep ?? 0) + 1)) : 0;

interface CircuitDynamics {
  experiment: string;
  circuit: string;
  callTx?: Stats;
  /** keyed by the proved circuit id (cross-contract calls prove several). */
  proves: Map<string, { ms: Stats; proofBytes: number; preimageBytes: number; perCall: number }>;
  checkMs?: Stats;
}

function circuitDynamics(experiment: string, circuit: string): CircuitDynamics {
  const mine = latestRunRecords(experiment, circuit);
  const callTxs = mine.filter((record) => record.kind === "callTx" && record.error === undefined);
  const proves = mine.filter((record) => record.kind === "prove");
  const checks = mine.filter((record) => record.kind === "check");

  const byKey = new Map<string, BenchRecord[]>();
  for (const prove of proves) {
    const key = prove.keyCircuit ?? prove.keyLocation ?? "?";
    byKey.set(key, [...(byKey.get(key) ?? []), prove]);
  }

  const provesOut = new Map<string, { ms: Stats; proofBytes: number; preimageBytes: number; perCall: number }>();
  for (const [key, group] of byKey) {
    const ms = stats(group.map((record) => record.ms ?? 0))!;
    provesOut.set(key, {
      ms,
      proofBytes: group[0].proofBytes ?? 0,
      preimageBytes: Math.round(
        group.reduce((sum, record) => sum + (record.preimageBytes ?? 0), 0) / group.length,
      ),
      perCall: callTxs.length > 0 ? group.length / callTxs.length : group.length,
    });
  }

  return {
    experiment,
    circuit,
    callTx: stats(callTxs.map((record) => record.ms ?? 0)),
    proves: provesOut,
    checkMs: stats(checks.map((record) => record.ms ?? 0)),
  };
}

/** Sum of mean prove times across all proofs of one call (the "proving cost" of the circuit). */
function totalProveMs(dynamics: CircuitDynamics): number | undefined {
  if (dynamics.proves.size === 0) return undefined;
  let total = 0;
  for (const prove of dynamics.proves.values()) total += prove.ms.mean * prove.perCall;
  return total;
}

/** Sum of proof bytes across all proofs of one call. */
function totalProofBytes(dynamics: CircuitDynamics): number | undefined {
  if (dynamics.proves.size === 0) return undefined;
  let total = 0;
  for (const prove of dynamics.proves.values()) total += prove.proofBytes * prove.perCall;
  return Math.round(total);
}

const staticByContract = new Map<string, CircuitStaticMetrics[]>();
for (const { experiment, contract, managedPath } of CONTRACTS) {
  const absolute = join(repoRoot, managedPath);
  if (!existsSync(join(absolute, "zkir"))) {
    console.warn(`skipping static metrics for ${contract}: ${managedPath}/zkir missing (run yarn compile:zk)`);
    continue;
  }
  staticByContract.set(`${experiment}/${contract}`, collectContractStaticMetrics(absolute, contract));
}

const staticFor = (key: string, circuit: string): CircuitStaticMetrics | undefined =>
  staticByContract.get(key)?.find((row) => row.circuit === circuit);

// Experiment plans (kept in sync with each package's bench plan).
const PLANS: { experiment: string; contractKey: string; circuits: string[] }[] = [
  { experiment: "baseline", contractKey: "baseline/baseline", circuits: ["noop", "base"] },
  { experiment: "events", contractKey: "events/events", circuits: ["base", "emit1", "emit2", "emit4"] },
  {
    experiment: "hashing",
    contractKey: "hashing/hashing",
    circuits: [
      "control32",
      "control256",
      "control1024",
      "persistent32",
      "persistent256",
      "persistent1024",
      "persistentVec8",
      "transient32",
      "transient256",
      "transient1024",
    ],
  },
  {
    experiment: "xcall",
    contractKey: "xcall/caller",
    circuits: ["localBase", "callOnce", "callTwice", "callBig", "callEmit"],
  },
];

const sections: string[] = [];

sections.push(`# Compact performance study — circuit size, proof size, proving time

Generated ${new Date().toISOString()} from ${runIds.length} recorded benchmark run(s)
(latest: \`${runIds.at(-1) ?? "none"}\`; reps per circuit: ${reps || "—"}). Each circuit
row shows its MOST RECENT measurement, so single-experiment runs (see the
"run it" lines above each table) refresh one row without invalidating the rest.

**Toolchain:** compactc 0.33.0 / language 0.25.0 / compact-runtime 0.18.0-rc.0 /
midnight-js 5.0.0-beta.3 / ledger-v9 1.0.0-rc.3 — local standalone stack
(node 2.0.0-rc.3, contract-events indexer 4.4.0-pre-alpha.16, proof-server 9.0.0-rc.3).

## Methodology

- **Circuit size** = instruction count of the compiled \`zkir\` program (plus
  prover/verifier key byte sizes) read from each contract's \`managed/\` output.
- **Proving time** = wall-clock of each \`/prove\` round-trip to the local proof
  server, measured inside an instrumented midnight-js proof provider. A
  cross-contract call proves once per contract in the call tree; per-callee
  rows are listed separately.
- **Proof size** = exact byte length returned by \`/prove\` for each call proof.
- **callTx** = end-to-end wall time of \`contract.callTx.<circuit>(...)\`:
  state resolution + check + prove + wallet balancing (fee proving) +
  submission + finalization. It includes ~6s block cadence noise; the prove
  column is the clean signal.
- Every circuit repeats ${reps || "N"}× on freshly deployed contracts; all
  variants share an identical base workload (counter + scalar write + map
  insert), so deltas against the control isolate the construct under test.
`);

for (const plan of PLANS) {
  const rows: string[][] = [];
  for (const circuit of plan.circuits) {
    const dynamics = circuitDynamics(plan.experiment, circuit);
    const staticRow = staticFor(plan.contractKey, circuit);
    const proveTotal = totalProveMs(dynamics);
    rows.push([
      `\`${circuit}\``,
      fmtInt(staticRow?.zkirInstructions),
      fmtBytes(staticRow?.proverKeyBytes),
      fmtBytes(staticRow?.verifierKeyBytes),
      fmtMs(proveTotal),
      fmtBytes(totalProofBytes(dynamics)),
      fmtMs(dynamics.checkMs?.mean),
      fmtMs(dynamics.callTx?.mean),
      dynamics.callTx ? String(dynamics.callTx.n) : "—",
    ]);
  }
  const exampleCircuit = plan.circuits[plan.circuits.length - 1];
  sections.push(`## Experiment: ${plan.experiment}

Run it (stack up — \`docker compose up -d\` — and keys compiled):

- compile keys: \`yarn compile:zk:${plan.experiment}\` — per CONTRACT${plan.experiment === "xcall" ? " (compiles both caller and target)" : ""}: a \`.compact\` file compiles as one unit, so there is no per-circuit compile.
- run every circuit: \`yarn bench:${plan.experiment}\`
- run one circuit: \`yarn bench:${plan.experiment}-<circuit>\`, e.g. \`yarn bench:${plan.experiment}-${exampleCircuit}\` — deploys a fresh contract and drives just that circuit. Any subset: \`BENCH_CIRCUITS=${plan.circuits.slice(0, 2).join(",")} yarn bench:${plan.experiment}\`.
- refresh this report: \`yarn report\` (updates only the rows you re-ran).

${table(
    [
      "circuit",
      "zkir instrs",
      "prover key",
      "verifier key",
      "prove (mean, all proofs)",
      "proof bytes (total)",
      "check (mean)",
      "callTx e2e (mean)",
      "n",
    ],
    rows,
  )}`);

  // Per-proof breakdown for circuits that produce more than one proof.
  const breakdownRows: string[][] = [];
  for (const circuit of plan.circuits) {
    const dynamics = circuitDynamics(plan.experiment, circuit);
    if (dynamics.proves.size <= 1) continue;
    for (const [key, prove] of dynamics.proves) {
      breakdownRows.push([
        `\`${circuit}\``,
        `\`${key}\``,
        prove.perCall.toFixed(0),
        fmtMs(prove.ms.mean),
        fmtBytes(prove.proofBytes),
        fmtBytes(prove.preimageBytes),
      ]);
    }
  }
  if (breakdownRows.length > 0) {
    sections.push(`### ${plan.experiment}: per-proof breakdown (multi-proof transactions)

${table(["circuit", "proved circuit", "proofs/call", "prove (mean)", "proof bytes", "preimage bytes"], breakdownRows)}`);
  }
}

// ── computed comparisons ────────────────────────────────────────────────────

interface Comparison {
  label: string;
  experiment: string;
  contractKey: string;
  from: string;
  to: string;
}

const COMPARISONS: Comparison[] = [
  { label: "1 event (256 B)", experiment: "events", contractKey: "events/events", from: "base", to: "emit1" },
  { label: "2 events (512 B)", experiment: "events", contractKey: "events/events", from: "base", to: "emit2" },
  { label: "4 events (1024 B)", experiment: "events", contractKey: "events/events", from: "base", to: "emit4" },
  { label: "1 xcontract call", experiment: "xcall", contractKey: "xcall/caller", from: "localBase", to: "callOnce" },
  { label: "2 xcontract calls", experiment: "xcall", contractKey: "xcall/caller", from: "localBase", to: "callTwice" },
  { label: "xcall w/ 256 B arg", experiment: "xcall", contractKey: "xcall/caller", from: "callOnce", to: "callBig" },
  { label: "xcall + callee event", experiment: "xcall", contractKey: "xcall/caller", from: "callOnce", to: "callEmit" },
  { label: "persistentHash 32 B", experiment: "hashing", contractKey: "hashing/hashing", from: "control32", to: "persistent32" },
  { label: "persistentHash 256 B", experiment: "hashing", contractKey: "hashing/hashing", from: "control256", to: "persistent256" },
  { label: "persistentHash 1024 B", experiment: "hashing", contractKey: "hashing/hashing", from: "control1024", to: "persistent1024" },
  { label: "transientHash 32 B", experiment: "hashing", contractKey: "hashing/hashing", from: "control32", to: "transient32" },
  { label: "transientHash 256 B", experiment: "hashing", contractKey: "hashing/hashing", from: "control256", to: "transient256" },
  { label: "transientHash 1024 B", experiment: "hashing", contractKey: "hashing/hashing", from: "control1024", to: "transient1024" },
  { label: "vector vs flat 256 B", experiment: "hashing", contractKey: "hashing/hashing", from: "persistent256", to: "persistentVec8" },
];

const comparisonRows: string[][] = [];
for (const comparison of COMPARISONS) {
  const fromStatic = staticFor(comparison.contractKey, comparison.from);
  const toStatic = staticFor(comparison.contractKey, comparison.to);
  const fromDynamics = circuitDynamics(comparison.experiment, comparison.from);
  const toDynamics = circuitDynamics(comparison.experiment, comparison.to);
  const fromProve = totalProveMs(fromDynamics);
  const toProve = totalProveMs(toDynamics);
  comparisonRows.push([
    comparison.label,
    `\`${comparison.from}\` → \`${comparison.to}\``,
    fromStatic && toStatic ? `${fmtInt(fromStatic.zkirInstructions)} → ${fmtInt(toStatic.zkirInstructions)} (${fmtRatio(toStatic.zkirInstructions, fromStatic.zkirInstructions)})` : "—",
    fromProve !== undefined && toProve !== undefined ? `${fmtMs(fromProve)} → ${fmtMs(toProve)} (${fmtRatio(toProve, fromProve)})` : "—",
    `${fmtBytes(totalProofBytes(fromDynamics))} → ${fmtBytes(totalProofBytes(toDynamics))}`,
  ]);
}

sections.push(`## Computed comparisons (construct cost = to − from)

${table(["construct", "circuits", "zkir instrs", "prove time", "proof bytes"], comparisonRows)}`);

// ── deploy log ──────────────────────────────────────────────────────────────

// Latest successful deploy per (experiment, contract).
const deploysByKey = new Map<string, BenchRecord>();
for (const record of records) {
  if (record.kind !== "deploy" || record.error !== undefined) continue;
  const key = `${record.experiment}/${record.circuit}`;
  const existing = deploysByKey.get(key);
  if (!existing || record.at > existing.at) deploysByKey.set(key, record);
}
if (deploysByKey.size > 0) {
  sections.push(`## Deploys (most recent per contract)

${table(
    ["experiment", "contract", "time", "address"],
    [...deploysByKey.values()].map((deploy) => [
      deploy.experiment ?? "—",
      deploy.circuit?.replace("deploy:", "") ?? "—",
      fmtMs(deploy.ms),
      `\`${deploy.contractAddress ?? "—"}\``,
    ]),
  )}`);
}

mkdirSync(join(repoRoot, "reports"), { recursive: true });
writeFileSync(reportFile, `${sections.join("\n\n")}\n`);
console.log(`wrote ${reportFile}`);
console.log(`records: ${records.length} total across ${runIds.length} run(s); latest ${runIds.at(-1) ?? "none"}`);
