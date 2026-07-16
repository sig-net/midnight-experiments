// Cross-contract shielded-payment experiment surface: TWO contracts. The
// target (B, callee) deploys first with no constructor args; the caller (A)
// seals a reference to the deployed target (constructor arg
// { bytes: Uint8Array(32) } — NOT a hex string). The caller's single circuit
// `callOnce(coin)` forwards the coin to the target's `notify(coin)`, which
// takes custody via `receiveShielded` and records it in its `treasury` ledger
// — i.e. ownership of a shielded coin is passed across a cross-contract call.

import { fileURLToPath } from "node:url";

import type { WalletFacade } from "@midnightntwrk/wallet-sdk-facade";

import {
  createEmptyPrivateState,
  deployWithFacade,
  makeVacantCompiledContract,
  type AccountKeys,
  type EmptyPrivateState,
  type NetworkId,
} from "@midnight-experiments/lib";

import { Contract as CallerContract } from "./managed/caller/contract/index.js";
import { Contract as TargetContract } from "./managed/target/contract/index.js";

export * as Caller from "./managed/caller/contract/index.js";
export * as Target from "./managed/target/contract/index.js";

export type CallerCircuitId = keyof InstanceType<typeof CallerContract>["provableCircuits"] & string;
export type TargetCircuitId = keyof InstanceType<typeof TargetContract>["provableCircuits"] & string;
export const CALLER_PRIVATE_STATE_ID = "exp-xcall-payment-caller";
export type CallerPrivateStateId = typeof CALLER_PRIVATE_STATE_ID;
export const TARGET_PRIVATE_STATE_ID = "exp-xcall-payment-target";
export type TargetPrivateStateId = typeof TARGET_PRIVATE_STATE_ID;

export const callerManagedPath = fileURLToPath(new URL("./managed/caller", import.meta.url));
export const targetManagedPath = fileURLToPath(new URL("./managed/target", import.meta.url));

export const callerCompiledContract = makeVacantCompiledContract<
  CallerContract<EmptyPrivateState>,
  EmptyPrivateState
>("xcall-payment-caller", CallerContract, callerManagedPath);

export const targetCompiledContract = makeVacantCompiledContract<
  TargetContract<EmptyPrivateState>,
  EmptyPrivateState
>("xcall-payment-target", TargetContract, targetManagedPath);

/** A deployed contract's address as the caller constructor wants its `Target` reference. */
export function contractAddressToReference(contractAddress: string): { bytes: Uint8Array } {
  const hex = contractAddress.startsWith("0x") ? contractAddress.slice(2) : contractAddress;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(`expected a 32-byte hex contract address, got '${contractAddress}'`);
  }
  return { bytes: Uint8Array.from(Buffer.from(hex, "hex")) };
}

/** Deploy the target (B, the callee) through an already-open facade. */
export async function deployTarget(facade: WalletFacade, keys: AccountKeys, networkId: NetworkId) {
  return deployWithFacade(facade, keys, networkId, targetCompiledContract, createEmptyPrivateState());
}

/** Deploy the caller (A), sealing a reference to an already-deployed target. */
export async function deployCaller(
  facade: WalletFacade,
  keys: AccountKeys,
  networkId: NetworkId,
  targetContractAddress: string,
) {
  return deployWithFacade(
    facade,
    keys,
    networkId,
    callerCompiledContract,
    createEmptyPrivateState(),
    contractAddressToReference(targetContractAddress),
  );
}

/**
 * The `ShieldedCoinInfo` argument shape of the caller's `callOnce` circuit,
 * exactly as the generated contract binding encodes it (raw 32-byte `nonce`
 * and `color`, NOT the ledger package's hex-string form).
 */
export type PaymentCoin = Parameters<InstanceType<typeof CallerContract>["circuits"]["callOnce"]>[1];

/**
 * The color (raw token type) of the shielded NATIVE token — 32 zero bytes.
 * The local standalone stack's genesis wallet holds a large shielded balance
 * of it, so the deployer wallet can fund `receiveShielded` deposits of this
 * color without a mint step.
 */
export const SHIELDED_NATIVE_TOKEN_COLOR: Uint8Array = new Uint8Array(32);

/** The value deposited per `callOnce` call. */
export const PAYMENT_VALUE = 4242n;

/**
 * A fresh coin to pass to `callOnce`: shielded native token color, the
 * standard payment value, and a random nonce (each deposit must be a unique
 * coin — the nonce is what distinguishes two otherwise-identical deposits).
 */
export function makePaymentCoin(value: bigint = PAYMENT_VALUE): PaymentCoin {
  const nonce = new Uint8Array(32);
  crypto.getRandomValues(nonce);
  return { nonce, color: SHIELDED_NATIVE_TOKEN_COLOR, value };
}
