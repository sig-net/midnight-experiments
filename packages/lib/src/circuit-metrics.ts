// Static (compile-time) circuit metrics, read straight off a contract's
// compiled `managed/` output:
//
//   - zkir/<circuit>.zkir       — JSON arithmetic-circuit IR: instruction
//     count and per-op histogram are the "circuit size" measure the prover
//     actually pays for.
//   - keys/<circuit>.prover     — prover key bytes: grows with circuit size
//     (structured reference string coverage), a second size proxy.
//   - keys/<circuit>.verifier   — verifier key bytes (what goes on chain).
//   - compiler/contract-info.json — the circuit list with pure/proof flags.
//
// Only `proof: true` circuits have zkir + keys; pure circuits compile to
// plain code and never touch the proof system.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** Compile-time size metrics for one provable circuit. */
export interface CircuitStaticMetrics {
  /** The contract (managed dir name) the circuit belongs to. */
  contract: string;
  circuit: string;
  /** Total instruction count of the zkir program — the primary circuit-size measure. */
  zkirInstructions: number;
  /** Declared number of circuit inputs. */
  zkirNumInputs: number;
  /** Instructions per zkir op name, for attributing growth (e.g. hash ops vs constraints). */
  opHistogram: Record<string, number>;
  /** Byte sizes of the artifacts. */
  zkirBytes: number;
  proverKeyBytes: number;
  verifierKeyBytes: number;
}

interface ZkirProgram {
  num_inputs: number;
  instructions: { op: string }[];
}

/**
 * Collect {@link CircuitStaticMetrics} for every provable circuit of one
 * compiled contract.
 *
 * @param managedPath - Absolute path to the contract's compiler output dir (containing zkir/, keys/).
 * @param contractName - Label for the `contract` field of each row.
 * @returns One metrics row per provable circuit, sorted by circuit name.
 * @throws If the managed dir has no zkir/ output, or keys are missing (run a full `compile:zk`).
 */
export function collectContractStaticMetrics(managedPath: string, contractName: string): CircuitStaticMetrics[] {
  const zkirDir = join(managedPath, "zkir");
  const keysDir = join(managedPath, "keys");

  const rows: CircuitStaticMetrics[] = [];
  for (const file of readdirSync(zkirDir)) {
    if (!file.endsWith(".zkir")) continue;
    const circuit = file.slice(0, -".zkir".length);
    const zkirPath = join(zkirDir, file);
    const zkir = JSON.parse(readFileSync(zkirPath, "utf8")) as ZkirProgram;

    const opHistogram: Record<string, number> = {};
    for (const instruction of zkir.instructions) {
      opHistogram[instruction.op] = (opHistogram[instruction.op] ?? 0) + 1;
    }

    rows.push({
      contract: contractName,
      circuit,
      zkirInstructions: zkir.instructions.length,
      zkirNumInputs: zkir.num_inputs,
      opHistogram,
      zkirBytes: statSync(zkirPath).size,
      proverKeyBytes: statSync(join(keysDir, `${circuit}.prover`)).size,
      verifierKeyBytes: statSync(join(keysDir, `${circuit}.verifier`)).size,
    });
  }
  return rows.sort((a, b) => a.circuit.localeCompare(b.circuit));
}
