// Runtime-environment declarations for this machine's measurements.
//
// THE RULES ARE NOT WRITTEN HERE. The variable allowlist, the value-versus-
// presence capture (path-like and address-like values never leave the machine),
// and the comparability verdicts all come from ./bench-environment.generated.js
// — a byte-exact copy of opensourcesai-bench's src/derivation/environment.js,
// written by scripts/sync-from-bench.mjs and pinned by its digest. Those rules
// decide which measurements may ever be shown side by side, and two repos
// re-deriving them independently would eventually disagree about which
// comparisons are honest. This module is only what bench does not own: the
// declaration HASH a stored record carries.
//
// WHAT A DECLARATION IS, RESTATED BECAUSE IT IS EASY TO OVERCLAIM: the client
// process's own environment, not a reading from the Ollama server, which may
// have been started with entirely different values and exposes no endpoint
// reporting its resolved configuration. `authoritative: false` is part of the
// data, and nothing here may feed a measurement — run conditions only.

export {
  ENVIRONMENT_DECLARATION_SOURCE,
  OLLAMA_ENVIRONMENT_VARIABLES,
  compareRuntimeEnvironments,
  deriveRuntimeEnvironment,
} from "./bench-environment.generated.js";

import { createHash } from "node:crypto";

/**
 * Canonical hash of a declaration's `declared` block — the value a stored
 * measurement record carries in its `environmentHash` field.
 *
 * THE PROPERTY THIS IS BUILT AROUND, and the reason it hashes `declared` and
 * nothing else: two declarations receive bench's "comparable" verdict exactly
 * when every declared value matches. Hashing precisely that block makes hash
 * equality mean comparability-as-presumed — one stored string answers "may
 * these two records sit on one chart?" without replaying the full comparison.
 * Hashing the note or source fields would break the equivalence in one
 * direction; hashing less than all of `declared` would break it in the other.
 * test/environment.test.js asserts the equivalence property directly.
 *
 * Keys are serialized in sorted order because object key order is an accident
 * of construction, not part of the declaration's meaning.
 *
 * Returns null for anything that is not a declaration — never a hash of
 * garbage, because a hash that cannot be traced back to a declared block would
 * make two unknown environments look reliably identical.
 *
 * Deterministic (sha256 of a canonical serialization): this module stays as
 * pure as the rest of derive/ — no clock, no randomness, no I/O.
 */
export function environmentDeclarationHash(declaration) {
  const declared = declaration?.declared;
  if (declared === null || typeof declared !== "object" || Array.isArray(declared)) return null;

  const canonical = JSON.stringify(
    Object.fromEntries(Object.keys(declared).sort().map((key) => [key, declared[key]])),
  );
  return createHash("sha256").update(canonical).digest("hex");
}
