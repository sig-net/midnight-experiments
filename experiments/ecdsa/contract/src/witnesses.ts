// The contract declares no witnesses (no private state): every input to the
// attestation flow is public by construction. It still needs an (empty)
// private-state value + a witnesses object to bind via
// makeVacantCompiledContract, mirroring signet-contract's witness-less setup.

import type { Witnesses as EcdsaWitnesses } from "./managed/ecdsa/contract/index.js";

/** Private state carried through ecdsa circuit calls: none. */
export type EcdsaPrivateState = Record<string, never>;

/**
 * Build the (empty) private state handed to deploy and circuit calls.
 *
 * @returns A fresh empty private-state value.
 */
export const createEcdsaPrivateState = (): EcdsaPrivateState => ({});

/** The (empty) witnesses object for the witness-less contract. */
export const ecdsaWitnesses: EcdsaWitnesses<EcdsaPrivateState> = {};
