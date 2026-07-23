// Curated export surface: the compiled contract module, the TypeScript twin of
// the builtin serialize layout, and the deploy/provider plumbing for the live
// e2e.

export * as SerdeBuiltin from "./managed/serde-builtin/contract/index.js";

export * from "./compact-serde.ts";
export * from "./witnesses.ts";
export * from "./providers.ts";
export * from "./deploy.ts";
