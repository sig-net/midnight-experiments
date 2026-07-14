// Benchmark instrumentation: a JSONL recorder plus an instrumented proof
// provider that times every /check and /prove round-trip to the proof server
// and records the exact proof byte sizes.
//
// Why this is the right tap point: midnight-js proves a contract-call
// transaction through the provider set's `proofProvider` — one
// `prove(serializedPreimage, keyLocation)` per contract call in the
// transaction's call tree (a cross-contract call therefore produces one
// record per contract). The wallet facade's own fee/Zswap/dust proving goes
// through its separately-configured proving server connection and never
// passes through here, so these records isolate CIRCUIT proving exactly.
// The `keyLocation` is canonical per call: `contract:<addr>/<circuitId>?vk=…`
// for contract circuits, `midnight/...` for protocol builtins.

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { createProofProvider, type ProofProvider, type ZKConfigProvider } from "@midnight-ntwrk/midnight-js/types";
import type { ProvingProvider } from "@midnightntwrk/ledger-v9";

import { buildProvingProvider } from "./midnight-providers.ts";

/** What the caller is currently benchmarking; merged into every record. */
export interface BenchContext {
  /** Experiment key, e.g. "events". */
  experiment: string;
  /** The exported circuit being driven, e.g. "emit2". */
  circuit: string;
  /** 0-based repetition index of this circuit call. */
  rep: number;
}

/** One benchmark observation, one JSONL line. */
export interface BenchRecord extends Partial<BenchContext> {
  /** What was measured: a proof-server phase, a whole callTx, a deploy, or a free-form note. */
  kind: "check" | "prove" | "callTx" | "deploy" | "note";
  /** ISO timestamp when the observation completed. */
  at: string;
  /** Identifier shared by all records of one benchmark run. */
  runId: string;
  /** Wall-clock duration of the measured operation. */
  ms?: number;
  /** Canonical proving key location (check/prove records). */
  keyLocation?: string;
  /** Bare circuit id parsed out of `keyLocation`, when it is a contract location. */
  keyCircuit?: string;
  /** Byte length of the serialized proof preimage sent to the proof server. */
  preimageBytes?: number;
  /** Byte length of the proof returned by /prove. */
  proofBytes?: number;
  /** Chain transaction id (callTx/deploy records). */
  txId?: string;
  /** Deployed contract address (deploy records). */
  contractAddress?: string;
  /** Free-form extra detail. */
  note?: string;
  /** Error message when the measured operation failed. */
  error?: string;
}

/**
 * One measured circuit in an experiment package's bench plan: which exported
 * circuit to drive and a factory for its call arguments (a factory so each
 * repetition gets fresh values where that matters).
 */
export interface BenchCircuitSpec {
  circuit: string;
  args: () => unknown[];
}

/** Parse the bare circuit id out of a canonical `contract:<addr>/<circuitId>?vk=…` key location. */
export function circuitIdFromKeyLocation(keyLocation: string): string | undefined {
  const match = /^contract:[^/]+\/([^?]+)/.exec(keyLocation);
  return match?.[1];
}

/**
 * Appends {@link BenchRecord}s to a JSONL file. Tests set the current
 * {@link BenchContext} before driving a circuit; the instrumented proof
 * provider then attributes its check/prove observations to that context.
 * Everything in a benchmark run is sequential, so one mutable context is safe.
 */
export class Recorder {
  private context: BenchContext | undefined;

  constructor(
    private readonly filePath: string,
    private readonly runId: string,
  ) {
    mkdirSync(dirname(filePath), { recursive: true });
  }

  setContext(context: BenchContext): void {
    this.context = context;
  }

  clearContext(): void {
    this.context = undefined;
  }

  record(partial: Omit<BenchRecord, "at" | "runId">): void {
    const record: BenchRecord = {
      ...this.context,
      ...partial,
      at: new Date().toISOString(),
      runId: this.runId,
    };
    appendFileSync(this.filePath, `${JSON.stringify(record)}\n`);
  }

  /** Time `fn` and append a record of `kind` with the duration (and rethrow on failure). */
  async timed<T>(
    kind: BenchRecord["kind"],
    detail: Omit<BenchRecord, "at" | "runId" | "kind" | "ms">,
    fn: () => Promise<T>,
  ): Promise<T> {
    const start = performance.now();
    try {
      const result = await fn();
      this.record({ kind, ...detail, ms: performance.now() - start });
      return result;
    } catch (error) {
      this.record({ kind, ...detail, ms: performance.now() - start, error: String(error) });
      throw error;
    }
  }
}

/**
 * Like lib's `createCrossContractProofServerProvider`, but every /check and
 * /prove round-trip is timed and recorded (duration, preimage bytes, and for
 * /prove the returned proof's byte size) against the recorder's current
 * {@link BenchContext}.
 *
 * @param proofServerUrl - The proof server's HTTP endpoint.
 * @param zkConfigProviders - One provider per compiled contract in the call tree.
 * @param recorder - Sink for the timing/size observations.
 * @returns The proof provider to place in a contract's midnight-js provider set.
 */
export function createInstrumentedProofServerProvider(
  proofServerUrl: string,
  zkConfigProviders: readonly ZKConfigProvider<string>[],
  recorder: Recorder,
): ProofProvider {
  const base = buildProvingProvider(proofServerUrl, zkConfigProviders);

  const instrumented: ProvingProvider = {
    async check(serializedPreimage, keyLocation) {
      const start = performance.now();
      try {
        return await base.check(serializedPreimage, keyLocation);
      } finally {
        recorder.record({
          kind: "check",
          keyLocation,
          keyCircuit: circuitIdFromKeyLocation(keyLocation),
          preimageBytes: serializedPreimage.length,
          ms: performance.now() - start,
        });
      }
    },
    async prove(serializedPreimage, keyLocation, overwriteBindingInput) {
      const start = performance.now();
      const proof = await base.prove(serializedPreimage, keyLocation, overwriteBindingInput);
      recorder.record({
        kind: "prove",
        keyLocation,
        keyCircuit: circuitIdFromKeyLocation(keyLocation),
        preimageBytes: serializedPreimage.length,
        proofBytes: proof.length,
        ms: performance.now() - start,
      });
      return proof;
    },
    lookupKey: base.lookupKey,
  };

  return createProofProvider(instrumented);
}
