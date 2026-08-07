# Contributing to OpenSourcesAI Command Center

## What this is

A local command center for a machine running Ollama, packaged as the unpublished
scoped npm package `@opensourcesai/cmdcenter`. It reads real hardware and
runtime state, serves a local dashboard, inventories local MCP servers, exposes
narrow load/unload actions for installed models, and turns the machine state
into a report that is honest about its own limits.

It supports opensourcesai.com but is **a separate product with a separate
lifecycle**. It is never merged into the website repository, never imports from
it, and the two are joined only by versioned contracts. Same boundary
`opensourcesai-bench` holds.

**This repository is public-facing.** Assume every commit, comment,
and branch name is publishable. No keys, no private strategy notes, no
machine-identifying details (IPs, SSH users, absolute home paths).

## Scope

The scoping decisions for this tool are recorded in an internal planning
document that is not part of this repository. That document governs *what this
is allowed to become*; this file governs *how to work in here*.

These implementation decisions are already taken and bind current work:

- **Phases 0, 1 and 2 are complete.** The shipped boundary is diagnostic core,
  local dashboard, live telemetry, MCP inventory, and exactly two actions: load
  and unload installed Ollama models.
- **The shared website data is fixture-verified copies**, not direct imports. See
  "The parity fixtures" below.

Decisions 3 (a published data manifest vs. the website's "no public API"
non-goal) and 4 (whether to extract the shared engine) are **open**. Do not
implement either without a recorded decision.

## Hard rules

These exist because the tool asks people to run it against their own machine.
Each is a trust property, not a preference, and each is enforced by a test in
`test/package.test.js`:

- **No network access except the local Ollama endpoint.** No telemetry, no
  upload, no update check, no analytics, no crash reporting. Not implemented,
  not stubbed, not behind a disabled flag. An audit must find zero outbound calls.
- **The mutation surface is exactly two actions: load and unload.** Nothing
  else, and widening it is a maintainer decision, not a refactor.
  - **Why these two:** both are small, reversible and self-undoing — a loaded
    model unloads itself when keep-alive expires; an unloaded one reloads on
    next use. They destroy nothing.
  - **Never:** `pull` (gigabytes over someone's connection), `delete`/`rm`
    (irreversible), `push`, `create`, `copy`, or any service control. These are
    named individually in `test/package.test.js` and stay unreachable.
  - **PUT, PATCH and DELETE** have no use here in any phase and are refused for
    every path.
  - All mutation lives in `src/actions/`. A test asserts no `POST` appears
    outside that directory and the browser bundle, so the blast radius of this
    phase is one reviewable folder.
  - The action layer calls exactly one Ollama endpoint — `/api/generate` — with
    an **always-empty prompt**, so it can move models in and out of memory but
    cannot run inference. `keep_alive` comes from a fixed internal set, never
    from the caller, and the model name must exactly match one Ollama reports
    as installed.
  - `POST` is allowed only for paths in `ACTION_PATHS` plus `INSPECT_PATHS`
    (both exact-match allowlists), always requires the session token even where
    assets do not, and is subject to the same Host and Origin checks. The
    inspect paths mutate **nothing** — they exist because a bench-result file's
    content must reach the pure derive layer for validation and a GET cannot
    carry a file; they are kept in a separate set precisely so "the complete
    set of mutating paths" stays a true two-member sentence. Mirror tests force
    both allowlists to agree with the dispatcher.

  > **Phase 1 was absolutely read-only** — the server refused every non-GET verb
  > before routing. That guarantee was replaced deliberately in Phase 2, not
  > eroded: the guard that asserted it was rewritten to state the narrower
  > property rather than deleted, because a guard asserting something no longer
  > true is worse than no guard.
- **No shell.** Every subprocess goes through `src/collect/exec.js`, which uses
  `execFile` with an explicit argv array and a hard timeout. Only that module
  may import `child_process`.
- **The derive layer never reads a clock or a random source.** Timestamps are
  supplied by the caller from the CLI's top level. This is what makes reports
  snapshot-testable and comparable across two runs.
- **The exportable block is closed-vocabulary only.** No function that
  contributes to it may return caller-supplied text. That property is what makes
  a report safe to paste into a public issue.

## Dependency policy

**Zero runtime dependencies, and zero dev dependencies.** Node's built-ins cover
HTTP, filesystem, subprocesses, argument parsing and testing (`node --test`).
A dependency is something a security-conscious user has to audit before trusting
a tool whose entire value is that it can be trusted. Adding one needs a
justification in the commit that adds it — and `test/package.test.js` asserts
there are none, so it is a deliberate act.

## Architecture

| Layer | Rule |
|---|---|
| `src/collect/**` | The only code that performs I/O. Captures raw per-source responses and returns them **unmodified** — including sources known to be wrong. Never reconciles. |
| `src/derive/**` | Pure functions over a capture. Reconciliation, banding, rendering. Data in, data out. |
| `src/actions/**` | The only Ollama mutation surface. It may load or unload installed models, and nothing else. |
| `src/serve/**` | Local HTTP server, security checks, and browser dashboard bundle. |
| `src/storage/**` | The only code that writes or deletes files, confined to the tool's own data directory. Versioned, clock-free, and not yet reachable from any entry point — structural tests assert all three, and MAINTAINING.md §4a carries the rules. |

**Raw captures are authoritative; every derived figure is recomputable from
them.** So a change to how VRAM is interpreted re-derives history from the
committed fixtures rather than orphaning it.

**Keep contradictions.** The collect layer must not drop a source for
disagreeing with another. On Windows the disagreement *is* the finding: the most
obvious API saturates at 4 GiB and only a second source reveals it.

## The parity fixtures

Several things here are deliberate copies of the website's source, and **each
copy is pinned against its own generated fixture**: the memory bands
(`src/derive/bands.js`), the fit engine, the site design tokens, and the HUD
social palette. **MAINTAINING.md §7 carries the complete table** of what is
copied, from where, and which fixture pins it — read it there rather than
trusting a second copy of the list.

Every one of those fixtures was **generated by executing or parsing the real
source**, not transcribed, and a test pins every value against it.

**Several of the copies go further: the files themselves are generated.**
The checker engine (from the website), and bench's environment-declaration
module, bandwidth matcher, and bandwidth table, are byte-exact copies, each
pinned by a **sha256 of its own contents** rather than by sampled behaviour —
so the whole file is verified, not just the values a fixture happened to probe.
Never edit them; change the source repo and re-run the matching sync script
(`sync-from-website.mjs` / `sync-from-bench.mjs`). MAINTAINING.md §7 carries
the complete table. The hand-written layers above them — `src/derive/fit.js`,
`src/derive/environment.js`, `src/derive/bandwidth.js` — are where this
dashboard's own logic belongs. One naming caveat: the bandwidth table lives at
`data/gpu-memory-bandwidth-v1.js` *without* the `.generated.js` suffix, because
the matcher imports it by exactly that name — its header, digest, and an entry
on the announce-guard's list carry the do-not-edit contract instead.

If one of those tests fails, the website changed — a band edge, the Apple
usable-memory fraction, a fit threshold, a colour. **Re-generate the fixtures in
a deliberate commit that says so** (`node scripts/sync-from-website.mjs
../opensourcesai.com`). Never edit the expectations until they pass — that is
the drift the guards exist to catch.

## Fixtures

`fixtures/*.json` (other than the parity fixtures) are **real captures from real
machines**, not synthetic data. They are what lets CI validate Windows, Linux
and macOS reporting on a runner that has none of that hardware.

Before committing a new capture, read it. It is machine state, and a capture
that includes a home directory path or a hostname is not publishable as-is.

## Testing

`npm test` runs `node --test`. Two categories, both load-bearing:

- **Behavioural** — derive-layer output against the committed fixtures.
- **Structural** — the trust properties above, asserted against the source text.

A structural guard must inspect **code, not prose**: use the `codeOnly()` helper
so that documenting *why* there is no telemetry does not trip the guard that
checks there is no telemetry. And a guard that iterates a possibly-empty set
must assert the set is non-empty first — a pass over zero files is not a pass.

## Working conventions

- Branch and open a PR (`feat/`, `fix/`, `docs/`, `chore/` + kebab slug). Do not
  push to `main` and do not force-push. Maintainers merge.
- Commit messages record *why*, not just *what*.
- **Do not remove `private: true` from `package.json`.** Publishing is a
  deliberate maintainer action and is not yet decided; a test asserts the guard.
- Do not publish to npm.
