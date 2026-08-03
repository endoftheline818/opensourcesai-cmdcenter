# OpenSourcesAI Command Center — Project Guide

## What this is

A read-only diagnostic for a local Ollama machine, distributed as the scoped npm
package `@opensourcesai/cmdcenter`. It reads real hardware and runtime state and
turns it into a report that is honest about its own limits.

It supports opensourcesai.com but is **a separate product with a separate
lifecycle**. It is never merged into the website repository, never imports from
it, and the two are joined only by versioned contracts. Same boundary
`opensourcesai-bench` holds.

**This repository is intended to become public.** Assume every commit, comment,
and branch name is publishable. No keys, no internal strategy notes, no
machine-identifying details (IPs, SSH users, absolute home paths).

## The governing document

The scoping decisions live in the website repository at
`docs/control-center-discovery-spec-2026-08-02.md`, with status recorded in its
roadmap revisions. That document is canon for *what this is allowed to become*;
this file is canon for *how to work in here*.

Two of its decisions are already taken and bind current work:

- **Phase 0 is a read-only diagnostic.** Mutating actions are a later phase with
  their own preview/confirm/rollback design.
- **The band vocabulary is a fixture-verified copy**, not an import and not an
  extracted package (§8 decision 4). See "The parity fixture" below.

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
  else, and widening it is a founder decision, not a refactor.
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
  - `POST` is allowed only for paths in `ACTION_PATHS` (an exact-match
    allowlist), always requires the session token even where assets do not, and
    is subject to the same Host and Origin checks.

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

**Raw captures are authoritative; every derived figure is recomputable from
them.** So a change to how VRAM is interpreted re-derives history from the
committed fixtures rather than orphaning it.

**Keep contradictions.** The collect layer must not drop a source for
disagreeing with another. On Windows the disagreement *is* the finding: the most
obvious API saturates at 4 GiB and only a second source reveals it.

## The parity fixture

`src/derive/bands.js` is a deliberate copy of the website's
`src/lib/hardwareTelemetry.js` and `src/lib/appleMemory.js`.
`fixtures/website-bands-parity.json` was **generated by executing those
modules**, not transcribed, and `test/bands.test.js` pins every value against it.

If that test fails, the website changed a band edge or the Apple usable-memory
fraction. **Re-generate the fixture in a deliberate commit that says so.** Never
edit the expectations until they pass — that is the drift the guard exists to
catch.

## Fixtures

`fixtures/*.json` (other than the parity fixture) are **real captures from real
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
  push to `main` and do not force-push. The founder merges.
- Do not add AI attribution or co-author trailers to commits.
- Commit messages record *why*, not just *what*.
- **Do not remove `private: true` from `package.json`.** Publishing is a
  deliberate founder action and is not yet decided; a test asserts the guard.
- Do not publish to npm from a session.
