// The contract declares no witnesses (no private state). It still needs an
// (empty) private-state value and witnesses object to bind via
// makeVacantCompiledContract, mirroring the other witness-less experiments.

import type { Witnesses as SerdeWitnesses } from "./managed/serde-builtin/contract/index.js";

/** Private state carried through circuit calls: none. */
export type SerdePrivateState = Record<string, never>;

export const createSerdePrivateState = (): SerdePrivateState => ({});

export const serdeWitnesses: SerdeWitnesses<SerdePrivateState> = {};
