# Maintainer Guide — OpenSourcesAI Command Center

Working notes for anyone maintaining this tool. **Read this before making a substantial change.** Several of the rules below were learned by shipping bugs, and re-learning them costs more than reading.

---

## 1. What this is

`opensourcesai-cmdcenter` — a local dashboard for a machine running [Ollama](https://ollama.com). It reads the real hardware, tells you which models actually fit, shows live system gauges, inventories MCP servers, and can load/unload models.

- **Repo:** `endoftheline818/opensourcesai-cmdcenter`
- **Package:** `@opensourcesai/cmdcenter`, `"private": true`, not published to npm
- **Node:** ≥20. **Zero dependencies, zero devDependencies.** Tests are `node --test`.

```bash
node src/cli.js            # text diagnostic report
node src/cli.js serve      # the dashboard at http://127.0.0.1:7717
node src/cli.js --json     # full report as JSON
node src/cli.js --capture  # raw capture (for bug reports)
npm test                   # runs the suite and prints its own test count
```

**Status:** Phases 0, 1 and 2 are complete. `npm test` prints the current test count; it is deliberately not restated here, because a hand-copied total is stale the next time a PR adds a test — which is exactly what happened across #19–#24 while this line stood still. CI is configured as a 9-way matrix (ubuntu/windows/macos × Node 20/22/24).

---

## 2. Architecture — and why it is shaped this way

| Layer | Rule |
|---|---|
| `src/collect/**` | The **only** code that performs I/O. Captures raw per-source responses **unmodified** — including sources known to be wrong. It never reconciles. |
| `src/derive/**` | **Pure** functions over a capture. No I/O, no clock, no randomness. |
| `src/actions/**` | The **only** mutation surface. Two actions, nothing else (§4). |
| `src/serve/**` | HTTP server, security, and the browser bundle. |

This split is not stylistic. It is why `fixtures/*.json` — **real captures from real machines** (RTX 4070 Ti/Windows, RTX 3080/Linux, M1 MacBook Air) — let CI validate all three platforms' reporting on runners with no GPU and no Ollama.

**Keep contradictions.** The collect layer must not drop a source for disagreeing with another. On Windows the disagreement *is* the finding (§5).

---

## 3. Hard rules — these are trust properties, not preferences

Every one is enforced by a test in `test/package.test.js` or `test/actions.test.js`.

1. **No network access except the local Ollama endpoint.** No telemetry, no upload, no update check, no analytics. A test asserts **every absolute URL in `src/` is loopback**.
2. **The mutation surface is exactly two actions: load and unload.** Never `pull`, `delete`/`rm`, `push`, `create`, `copy`, or service control. These are named individually in tests.
3. **No shell.** Every subprocess goes through `src/collect/exec.js` — `execFile` with an explicit argv array and a hard timeout. Only that module may import `child_process`.
4. **The derive layer never reads a clock or a random source.** Timestamps are caller-supplied from the CLI's top level. This is what makes reports snapshot-testable.
5. **The exportable block is closed-vocabulary only.** No function contributing to it may return caller-supplied text. This is what makes a report safe to paste in public.
6. **Never remove `"private": true`** from `package.json`. Publishing is a maintainer decision. A test asserts the guard.

---

## 4. The mutation boundary (Phase 2)

Opened deliberately as a product decision. **Widening it is a maintainer decision, not a refactor.**

- **Why load/unload only:** both are small, reversible and self-undoing. A loaded model unloads itself when keep-alive expires. They destroy nothing. `pull` downloads gigabytes; `delete` is irreversible.
- **How narrowness is enforced:**
  - Exactly one Ollama endpoint is called — `/api/generate` — with an **always-empty prompt**, so the action layer *structurally cannot run inference*.
  - `keep_alive` comes from a fixed internal set, never the caller.
  - The model name must match Ollama's own installed list **before any request** — so an unknown name cannot provoke a pull.
  - `POST` is allowed only for an exact-match `ACTION_PATHS` allowlist, always requires the session token, and keeps Host/Origin checks.
  - `PUT`/`PATCH`/`DELETE` refused everywhere.

---

## 5. Findings encoded as regression tests — do not "simplify" these away

Each cost real debugging. The tests exist so you don't repeat them.

1. **Windows `Win32_VideoController.AdapterRAM` saturates at 4 GiB.** It reports ~4 GB for a 12 GB card. It is captured anyway, flagged `knownUnreliable`, and never selected — and the disagreement is shown to the user rather than silently resolved.
2. **Vendors report *below* nameplate.** An RTX 4070 Ti reports 12282 MiB, not 12288. Raw GiB (11.99) trips a `< 12` tier boundary and grades a 12 GB card into the 8–11 GB tier. **Always band from a nameplate-rounded figure.** This only bites cards whose nameplate is a tier edge (12/16/24/32/48 GB) — a 10 GB card does not reproduce it, which is why one mid-band test machine would have shipped the bug.
3. **Apple Silicon has no discrete VRAM.** `sysctl hw.memsize` is ground truth; band from the **usable 75%**, not the sticker total. An 8 GB Mac bands `lt-8`, not `8-11`.
4. **`OLLAMA_HOST` is dual-purpose** — a *bind address* to the server, a *connect target* to a client. The Ollama Windows app sets it to `0.0.0.0`; trusting it verbatim reports "Ollama not detected" on a working machine. Wildcards fall back to loopback.
5. **Reasoning models break naive time-to-first-token.** Qwen3 streams into a `thinking` field while `response` stays empty; with a small budget an answer token never arrives. Track both, and report first-thinking and first-response separately. A `null` TTFT has two different causes.
6. **`path.basename` is platform-dependent.** On POSIX it does not treat `\` as a separator, so a Windows path read on macOS/Linux returns whole — **with the username intact**. Use the separator-agnostic `safeBasename` in `src/collect/tools.js`. This was a real privacy bug caught by CI while Windows passed.

---

## 6. Test-quality rules — learned the hard way, five times

These are the highest-value lessons in this document.

- **A guard must inspect CODE, not prose.** This trap was hit **five separate times**: a regex matched `regex.exec()` while hunting shell execs; a coupling check matched a URL in a *comment*; a "no telemetry" check matched the comment explaining why there is no telemetry; a CSS parser matched `@media (prefers-color-scheme: dark)` inside a header comment and pinned the wrong palette; a destructive-endpoint check matched the comment *listing the endpoints that must never be called*. Use `withoutComments()` / `codeOnly()` in `test/package.test.js` — and note they differ deliberately: a URL guard must still see string literals, because those ship.
- **Mutation-test every guard.** A guard you have never seen fail is not known to work. Inject the violation, confirm it fails *and* that the message names the problem.
- **A guard over a possibly-empty set must assert non-emptiness first.** A "no credentials in workflows" test passed vacuously over an empty directory.
- **`fetch()` silently strips forbidden headers** (`Host`, etc.). A DNS-rebinding test passed while never sending the attack. Use `node:http` when you must control those headers, and include a **positive control** so a blanket-reject bug can't masquerade as a pass.
- **The browser bundle is inside a template literal.** A nested backtick closes it early; a nested interpolation is evaluated at module scope. `node --check` on the server file will not catch either. Use string concatenation in `src/serve/ui.js`'s `JS` export. A test parses the served payload.
- **A test can only protect a property someone remembered to restate when it changed.** The `READ-ONLY` badge stayed false through an entire phase *with two tests enforcing it*. It was caught by looking at the screen. When you change a boundary, **audit every surface that ever stated it** — it was in five places.

---

## 7. Cross-repo pinning — this package copies, never imports

There is a **hard boundary** with the website repo (`opensourcesai.com`). This package never imports across it. Instead it copies, and **every copy is pinned against a generated fixture**:

| Copy here | From | Pinned by |
|---|---|---|
| `src/derive/checker-engine.generated.js` | `lib/checker-engine.js` | its **sha256**, in `fixtures/website-engine-parity.json` |
| `src/derive/bands.js` | `src/lib/hardwareTelemetry.js`, `src/lib/appleMemory.js` | `fixtures/website-bands-parity.json` |
| `data/checker-models-snapshot.json` | `src/data/checker-models.json` | (snapshot; shows its own age in the UI) |
| site colours in `src/serve/ui.js` | `src/index.css` | `fixtures/website-design-tokens.json` |
| HUD palette in `src/serve/ui.js` | `docs/social-image-system/social-image-style-guide.md` | `fixtures/website-social-palette.json` |

**The fit engine is generated, not hand-written — do not edit it.** `src/derive/fit.js`
is a thin layer over `src/derive/checker-engine.generated.js`, which is a byte-exact
copy of the website's engine written by the sync script. Change the website, re-run
the script; never type into the generated file. A test recomputes its digest, so a
hand-edit fails the suite.

**Why generated rather than hand-ported, since 2026-08-06.** Hand-porting is where it
broke. Website #520 changed fit grading to charge weights **plus** runtime overhead;
the parity fixture was re-pinned that same morning, but carrying the change into
`fit.js` was a separate human act, and for six hours this package graded with the
pre-fix rule while the whole suite stayed green. `opensourcesai-mobile`, pinned by
hash rather than by behaviour, shipped it longer. **A parity fixture proves a copy is
identical wherever it samples; it cannot prove that anyone remembered to copy.** The
digest now proves the whole file, and the fixture's remaining job is the seam above it
— that `fit.js` delegates to the engine instead of quietly reimplementing part of it.

**Regenerate all of them with:**
```bash
node scripts/sync-from-website.mjs ../opensourcesai.com
```

Fixtures are **generated by executing/parsing the real source**, never transcribed. That is load-bearing: a hand-typed pin looks correct while being wrong. When one of these tests fails, the website changed — **re-run the sync script in a deliberate commit. Never edit the expectations until they pass.**

**`scoreModel` is copied but unreachable — the guarantee changed shape on 2026-08-06, and the guarantee that matters did not.** The website's 0–100 ranking, and its `buildRationale` prose, now sit in the generated copy, because copying the file *whole* is what lets a reviewer verify it with `diff` instead of judgement. Neither is re-exported by `src/derive/fit.js`, and a code-scanning guard in `test/package.test.js` (with a positive control) asserts nothing here reaches for them. The product rule is unchanged: this tool reports what fits and what it costs, ordering fit-then-size, and a test still asserts no `score` field is ever emitted. A composite score stays an opinion dressed as a measurement, defensible only where the copy explains its weights.

---

## 8. Privacy rules for the MCP/tools inventory

MCP config files **routinely hold live credentials**.

- **Redaction happens at COLLECTION, not display.** `--capture` writes the collected object straight to disk for bug reports, so anything a collector *returns* can end up in a file pasted into an issue. A value never read cannot leak.
- **Kept:** server name, transport, command basename, package specifier, env var **names** (a name is not a secret).
- **Dropped before returning:** every env value, raw argv (flags carry tokens), remote URLs (credentials in userinfo), full command paths (they contain the username).
- **The shareable block is stricter than the screen:** counts only.
- Redaction is tested against a **synthetic config with sentinel values** — never real credentials.

---

## 9. Working conventions

- **Branch and open a PR** (`feat/`, `fix/`, `docs/`, `chore/` + kebab slug). **Do not push to `main`. Do not force-push.** Maintainers merge.
- Commit messages record **why**, not what. The reasoning behind a decision is the most valuable thing in this repo's history.
- **Do not publish to npm.**
- Verify in a **real browser** for UI changes, not just tests. Two of the most important bugs in this project were caught by looking at the screen.
- Report results honestly: a gate you did not run is **skipped**, never "passed."

---

## 10. Deferred and open work

The absence of a feature here is a decision, not an oversight. What comes next — and the
maintainer decisions gating it — is tracked in the internal planning documents alongside
opensourcesai.com (§11), deliberately not in this public repository. Before building anything
beyond maintenance of what already exists, open an issue and wait for a recorded maintainer
decision; a PR that starts a new surface without one will not be merged, however good it is.

---

## 11. Website Coordination

Strategy and product history for this tool are tracked alongside opensourcesai.com in internal planning documents that are not part of this repository. Two rules follow from that split:

- Private lab and environment details must stay out of this repository. Committed fixtures may contain only redacted captures.
- **When you change something a doc in this repository claims, update that doc in the same PR.** Past revisions exist specifically because a doc was left contradicting the code.
