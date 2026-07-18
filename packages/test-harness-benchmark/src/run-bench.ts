// The generic benchmark driver: join a deployed experiment contract with an
// INSTRUMENTED proof provider (every /check + /prove round-trip timed and
// sized), then drive each circuit of the package's bench plan `reps` times,
// recording the end-to-end callTx wall time and chain tx id alongside the
// proof-server observations.
//
// Loose typing on purpose: this driver is generic over every experiment
// package's generated contract, and midnight-js's findDeployedContract
// generics don't compose across unrelated contracts — the concrete types
// live in each contract package; here calls are dispatched by circuit name.

import { findDeployedContract } from "@midnight-ntwrk/midnight-js/contracts";
import { NodeZkConfigProvider } from "@midnight-ntwrk/midnight-js-node-zk-config-provider";

import {
  buildExperimentProviders,
  createEmptyPrivateState,
  createInstrumentedProofServerProvider,
  type BenchCircuitSpec,
  type Recorder,
} from "@midnight-experiments/lib";

import { BENCH_REPS, type BenchSession } from "./session.ts";

type AnyCallTx = (...args: unknown[]) => Promise<{ public: { txId?: string } }>;

/**
 * Restrict a package's bench plan to the circuits named in the
 * `BENCH_CIRCUITS` env var (comma-separated), enabling single-experiment
 * runs like `yarn bench:hashing-control32`. Unset/empty = the full plan.
 * Tests derive their sanity-assertion expectations from the ACTIVE plan, so
 * filtered runs still assert exactly what ran.
 *
 * @param plan - The package's full bench plan.
 * @returns The circuits to actually drive this run.
 * @throws If a requested name matches no circuit in the plan.
 */
export function activeCircuits(plan: readonly BenchCircuitSpec[]): BenchCircuitSpec[] {
  const only = process.env.BENCH_CIRCUITS?.split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  if (!only || only.length === 0) return [...plan];
  const unknown = only.filter((name) => !plan.some((spec) => spec.circuit === name));
  if (unknown.length > 0) {
    throw new Error(
      `BENCH_CIRCUITS names unknown circuit(s) [${unknown.join(", ")}] — ` +
        `this experiment has: ${plan.map((spec) => spec.circuit).join(", ")}`,
    );
  }
  return plan.filter((spec) => only.includes(spec.circuit));
}

export interface BenchContractOptions {
  session: BenchSession;
  /** Experiment key stamped into every record (e.g. "events"). */
  experiment: string;
  /** Address of the already-deployed ROOT contract the circuits are called on. */
  contractAddress: string;
  /** The root contract's compact-js compiled-contract binding. */
  compiledContract: unknown;
  privateStateId: string;
  /** Namespace for the level-db private-state stores. */
  storePrefix: string;
  /**
   * Compiler output dirs for EVERY contract a call can reach — the root
   * contract first, then each cross-contract callee (the proof provider must
   * span the whole call tree).
   */
  managedPaths: readonly string[];
  plan: readonly BenchCircuitSpec[];
  reps?: number;
}

/**
 * Drive one deployed experiment contract's bench plan, recording everything.
 *
 * @returns The chain tx ids of all finalized calls, in execution order.
 */
export async function benchContract(options: BenchContractOptions): Promise<string[]> {
  const { session, experiment, plan } = options;
  const { config, facade, keys, recorder } = session;
  const reps = options.reps ?? BENCH_REPS;

  const zkConfigProviders = options.managedPaths.map((path) => new NodeZkConfigProvider<string>(path));
  const proofProvider = createInstrumentedProofServerProvider(config.proofServerUrl, zkConfigProviders, recorder);
  const providers = buildExperimentProviders(
    facade,
    keys,
    config,
    options.storePrefix,
    zkConfigProviders[0],
    proofProvider,
  );

  const deployed = (await findDeployedContract(providers as never, {
    contractAddress: options.contractAddress,
    compiledContract: options.compiledContract,
    privateStateId: options.privateStateId,
    initialPrivateState: createEmptyPrivateState(),
  } as never)) as unknown as { callTx: Record<string, AnyCallTx> };

  const txIds: string[] = [];
  for (const spec of plan) {
    const callTx = deployed.callTx[spec.circuit];
    if (typeof callTx !== "function") {
      throw new Error(`circuit '${spec.circuit}' not found on the deployed contract's callTx`);
    }
    for (let rep = 0; rep < reps; rep++) {
      recorder.setContext({ experiment, circuit: spec.circuit, rep });
      const start = performance.now();
      try {
        const result = await callTx(...spec.args());
        const txId = result.public.txId;
        recorder.record({ kind: "callTx", ms: performance.now() - start, txId });
        if (txId) txIds.push(txId);
        console.log(`  ${experiment}.${spec.circuit} rep ${rep + 1}/${reps} → tx ${txId ?? "(unknown)"}`);
      } catch (error) {
        recorder.record({ kind: "callTx", ms: performance.now() - start, error: String(error) });
        throw error;
      }
    }
  }
  recorder.clearContext();
  return txIds;
}

/**
 * Time and record a contract deploy (kind "deploy").
 *
 * @param recorder - The session recorder.
 * @param experiment - Experiment key for the record.
 * @param contract - Which contract of the experiment is being deployed.
 * @param deploy - The deploy thunk (from the contract package).
 * @returns The deployment (address + tx id).
 */
export async function timedDeploy(
  recorder: Recorder,
  experiment: string,
  contract: string,
  deploy: () => Promise<{ contractAddress: string; txId: string }>,
): Promise<{ contractAddress: string; txId: string }> {
  recorder.setContext({ experiment, circuit: `deploy:${contract}`, rep: 0 });
  const start = performance.now();
  try {
    const deployment = await deploy();
    recorder.record({
      kind: "deploy",
      ms: performance.now() - start,
      txId: deployment.txId,
      contractAddress: deployment.contractAddress,
    });
    console.log(`  deployed ${experiment}/${contract} at ${deployment.contractAddress}`);
    return deployment;
  } catch (error) {
    recorder.record({ kind: "deploy", ms: performance.now() - start, error: String(error) });
    throw error;
  } finally {
    recorder.clearContext();
  }
}
