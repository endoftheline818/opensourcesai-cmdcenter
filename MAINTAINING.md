# Maintainer Guide — OpenSourcesAI Command Center

Working notes for anyone maintaining this tool. **Read this before making a substantial change.** Several of the rules below were learned by shipping bugs, and re-learning them costs more than reading.

---

## 1. What this is

`opensourcesai-cmdcenter` — a local command center for a machine running [Ollama](https://ollama.com). It reads the real hardware, tells you which models actually fit, shows live system gauges, inspects osai-bench results, inventories MCP servers, and can load/unload models. It talks only to AI runtimes on this machine — never to the internet.

- **Repo:** `endoftheline818/opensourcesai-cmdcenter`
- **Package:** `@opensourcesai/cmdcenter`, published to npm with provenance (decision recorded 2026-08-10; releases are CI-only by construction — see §4 rule 6)
- **Node:** ≥20. **Zero dependencies, zero devDependencies.** Tests are `node --test`.

```bash
node src/cli.js            # text diagnostic report
node src/cli.js serve      # the dashboard at http://127.0.0.1:7717
node src/cli.js --json     # full report as JSON
node src/cli.js --capture  # raw capture (for bug reports)
npm test                   # runs the suite and prints its own test count
```

**Status:** Phases 0–3 are complete, 3d included. The chat relay measures every generation against two local runtimes (Ollama, and optionally an OpenAI-compatible server via `--llamacpp-port`), and the conveniences arrived measurement-first: a recorded `num_ctx` control (measurement schema v3's `requested` block), start-fixed system prompts (conversation schema v2), search, and a markdown export that carries each reply's measurements — an explicit user action with no server-side export path. `npm test` prints the current test count; it is deliberately not restated here, because a hand-copied total is stale the next time a PR adds a test — which is exactly what happened across #19–#24 while this line stood still. CI is configured as a 9-way matrix (ubuntu/windows/macos × Node 20/22/24).

---

## 2. Architecture — and why it is shaped this way

| Layer | Rule |
|---|---|
| `src/collect/**` | The **only** code that performs probe I/O. Captures raw per-source responses **unmodified** — including sources known to be wrong. It never reconciles. |
| `src/derive/**` | **Pure** functions over a capture. No I/O, no clock, no randomness. |
| `src/actions/**` | The **only** Ollama mutation surface. Two actions, nothing else (§4). |
| `src/serve/**` | HTTP server, security, and the browser bundle. |
| `src/storage/**` | The **only** code that writes or deletes files, confined to the tool's own data directory. Versioned (`STORAGE_SCHEMA_VERSION`), clock-free like derive, and reachable **only from the chat surface and the CLI wiring seam** — guard-asserted with a positive control (§4a). |
| `src/chat/**` | The inference surface (§4b): the streaming relays to the loopback runtimes (Ollama; optionally an OpenAI-compatible server via `--llamacpp-port`), and the only consumer of storage. Prompts carry text HERE and nowhere else. |
| `src/program.js` | The command line's implementation — argument parsing, the commands, and the dashboard wiring seam. Imports with **no side effects**, which is what lets the suite call `main()` directly. |
| `src/cli.js` | The executable npm installs, and nothing else: it imports `main` and calls it, unconditionally. **Keep it trivial** — a guard in `test/package.test.js` holds it to one import and no inspection of `process.argv`. |

**Why those last two are separate files** (0.2.1, and the reason 0.2.0 was
unusable for every `npx` user on Linux and macOS): they used to be one, ending
in a guard that compared `pathToFileURL(process.argv[1]).href` against
`import.meta.url` to decide whether it had been run or imported. npm links a
POSIX bin by **symlink**, and Node resolves an ESM main through its realpath
while `process.argv[1]` keeps the link path — so the two never matched, the
guard concluded "imported", and `npx @opensourcesai/cmdcenter serve` exited 0
having printed nothing at all. The same guard had already been wrong once on
Windows, for a different reason, with the identical no-output symptom. Two
silent failures of one question is the question's fault, so the question is
gone rather than fixed a third time. Do not reintroduce an is-this-the-entry-
point check in either file; if the CLI needs to be importable, import
`src/program.js`.

This split is not stylistic. It is why `fixtures/*.json` — **real captures from real machines** (RTX 4070 Ti/Windows, RTX 3080/Linux, M1 MacBook Air) — let CI validate all three platforms' reporting on runners with no GPU and no Ollama.

**Keep contradictions.** The collect layer must not drop a source for disagreeing with another. On Windows the disagreement *is* the finding (§5).

---

## 3. Hard rules — these are trust properties, not preferences

Every one is enforced by a test in `test/package.test.js` or `test/actions.test.js`.

1. **It talks only to AI runtimes on this machine — never to the internet.** (Successor to "no network access except the local Ollama endpoint", widened deliberately on 2026-08-07 by recorded decision; see §4b.) No telemetry, no upload, no update check, no analytics, and **no cloud model endpoints, permanently** — an API-key field for a hosted model would end the guarantee, and it is this tool's identity, not a missing feature. A test asserts **every absolute URL in `src/` is loopback**.
2. **The mutation surface is exactly two actions: load and unload.** Never `pull`, `delete`/`rm`, `push`, `create`, `copy`, or service control. These are named individually in tests.
3. **No shell.** Every subprocess goes through `src/collect/exec.js` — `execFile` with an explicit argv array and a hard timeout. Only that module may import `child_process`.
4. **The derive layer never reads a clock or a random source.** Timestamps are caller-supplied from the CLI's top level. This is what makes reports snapshot-testable.
5. **The exportable block is closed-vocabulary only.** No function contributing to it may return caller-supplied text. This is what makes a report safe to paste in public.
6. **Releases are CI-only, with provenance.** (Successor to "never remove `private: true`" — the publish decision was recorded 2026-08-10, and the guard was rewritten, not deleted.) `publishConfig.provenance` makes npm refuse any publish that cannot present a CI-issued attestation, so a laptop cannot release even with a valid token; the only publish path is the tag-triggered `release.yml`, which runs the full suite first and refuses a tag that disagrees with `package.json`'s version. A test asserts all of it.

---

## 4. The mutation boundary (Phase 2)

Opened deliberately as a product decision. **Widening it is a maintainer decision, not a refactor.**

- **Why load/unload only:** both are small, reversible and self-undoing. A loaded model unloads itself when keep-alive expires. They destroy nothing. `pull` downloads gigabytes; `delete` is irreversible.
- **How narrowness is enforced:**
  - Exactly one Ollama endpoint is called — `/api/generate` — with an **always-empty prompt**, so the action layer *structurally cannot run inference*.
  - `keep_alive` comes from a fixed internal set, never the caller.
  - The model name must match Ollama's own installed list **before any request** — so an unknown name cannot provoke a pull.
  - `POST` is allowed only for the exact-match `ACTION_PATHS` allowlist — plus `INSPECT_PATHS`, two pure bench-result inspection routes that mutate nothing (POST as transport for a file's content; separate set, so "the complete set of mutating paths" stays a true sentence). Both always require the session token and keep Host/Origin checks; mirror tests force each allowlist to agree with the dispatcher.
  - `PUT`/`PATCH`/`DELETE` refused everywhere.

---

## 4a. The storage layer — what this tool may remember, and the rules that bind it

Added 2026-08-07; **wired 2026-08-08**, exactly the package deal this section
demanded: the chat surface that writes it arrived together with the UI that
shows retained data, the delete-with-confirm control, and the rewritten claims
— and the unreachability guard was rewritten (not deleted) to the narrower
property that replaced it: **only `src/chat/` and the CLI wiring seam may
reach storage**, asserted with a positive control. `src/storage/**` is a
versioned local store (platform data dir: `%LOCALAPPDATA%\osai-cmdcenter`,
`~/Library/Application Support/…`, `$XDG_DATA_HOME/…`) holding append-only
JSONL: `measurements.jsonl` (counters, NO prose — its closed schema is the
enforcement) and `conversations/<id>.jsonl` (the prose, deletable through the
UI's confirm; measurement history deliberately survives a deleted
conversation, joined only by an opaque id) — plus one non-JSONL file,
`manual-bandwidth.json` (2026-08-10): the single recorded setting, a
user-entered bandwidth figure for a GPU the sourced table does not list. It
is validated by the same closed-allowlist discipline, tied to the exact GPU
name it was entered for (a different primary GPU means ignored-with-reason,
never borrowed), labelled `source: "manual"` everywhere it travels, and
managed by the `SETTINGS_PATHS` pair under the same mirror-tested allowlist
discipline as every other POST surface.

Rules, each enforced by a test:

1. **File writes and deletions exist only in `src/storage`** — a structural
   guard with a positive control. Before this layer, the package wrote nothing
   to disk; the property narrowed, it did not vanish.
2. **The measurement log's schema is a closed allowlist with no prose-capable
   field.** Unknown keys are refused at every nesting level, every permitted
   string is shape- or length-capped, and refusal happens at append — a value
   never written cannot leak (the same ordering §8 uses for MCP secrets).
   Sentinel-tested against message-shaped field names from day one.
3. **Deletion is contained by construction.** `clearMeasurements` takes no
   path, no id, no pattern — the one deletable thing is the one file the module
   itself writes. It cannot name a model, a config, or anything this tool did
   not create.
4. **Version discipline from day one.** `meta.json` carries
   `STORAGE_SCHEMA_VERSION`; opening a store written by a newer version refuses
   rather than guesses, corrupt meta is preserved as evidence and never
   overwritten, and records from a future `MEASUREMENT_SCHEMA_VERSION` are
   counted as uninterpreted rather than silently dropped.
5. **No clock, no randomness** — same discipline as derive, same test.
   Timestamps are caller-supplied so what lands on disk is traceable to the
   code path that produced it.
6. **Crash honesty.** A torn tail from an interrupted append is recovered and
   *reported* (`tornTail: true`), never silently dropped — and corruption
   mid-file is counted separately, because a crash cannot produce it.

---

## 4b. The inference boundary (Phase 3b) — opened by decision, before code

Recorded 2026-08-07, the same way Phase 2's boundary was crossed: deliberately,
with every surface that stated the old guarantee rewritten in one commit —
badge, trust rail, HUD mode line, CLI help, serve banner, package description,
README trust properties, and this file — **before any inference code existed**.
The claims chosen were true both before and after that code landed, which is
what let the amendment precede it. **The code landed 2026-08-08**: `src/chat/`
(streaming relay + service), the `CHAT_PATHS` allowlist under the same mirror
discipline as actions and inspection, the storage wiring of §4a, and the chat
view — every rule below held by construction. **2026-08-09: a second local
runtime** (any OpenAI-compatible server — llama.cpp first) joined under the
same rules, and its endpoint is loopback *by construction*: the CLI accepts
`--llamacpp-port` and no host flag, so there is no address input that could
name another machine. Fields that protocol does not report (load/total
durations, residency, a version string) stay null on its records — never
borrowed from Ollama's, never estimated. The measurement schema bumped to v2
for the widened runtime enum; v1 records stay readable, appends stamp v2.

The rules that govern the work when it arrives:

1. **The successor guarantee is the load-bearing line:** *talks only to AI
   runtimes on this machine — never to the internet.* The loopback-URL
   structural test enforces it; cloud endpoints are permanently out.
2. **Inference lives in its own module class** (a chat surface under `src/`),
   never in `src/actions/` — the action layer's always-empty-prompt property is
   permanent and stays independently tested.
3. **The action count stays two.** A chat surface is not an "action" in that
   sense; the mutating-path allowlist discipline (§4) extends to any new POST
   routes exactly as it did for the inspect paths.
4. **Storage wiring arrives with that surface** (§4a): the UI that shows
   retained history, the control that deletes it, and the rewritten
   reachability guard, together.
5. **Measurement first.** Every generation is a measurement opportunity; the
   response strip renders under derive/measurements.js's rules — unavailable is
   never zero, ceilings are never guessed, in-situ figures are never presented
   as protocol-grade.

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

## 6. Test-quality rules — learned the hard way, six times

These are the highest-value lessons in this document.

- **A guard must inspect CODE, not prose.** This trap was hit **five separate times**: a regex matched `regex.exec()` while hunting shell execs; a coupling check matched a URL in a *comment*; a "no telemetry" check matched the comment explaining why there is no telemetry; a CSS parser matched `@media (prefers-color-scheme: dark)` inside a header comment and pinned the wrong palette; a destructive-endpoint check matched the comment *listing the endpoints that must never be called*. Use `withoutComments()` / `codeOnly()` in `test/package.test.js` — and note they differ deliberately: a URL guard must still see string literals, because those ship.
- **Mutation-test every guard.** A guard you have never seen fail is not known to work. Inject the violation, confirm it fails *and* that the message names the problem.
- **A guard over a possibly-empty set must assert non-emptiness first.** A "no credentials in workflows" test passed vacuously over an empty directory.
- **`fetch()` silently strips forbidden headers** (`Host`, etc.). A DNS-rebinding test passed while never sending the attack. Use `node:http` when you must control those headers, and include a **positive control** so a blanket-reject bug can't masquerade as a pass.
- **The browser bundle is inside a template literal.** A nested backtick closes it early; a nested interpolation is evaluated at module scope. `node --check` on the server file will not catch either. Use string concatenation in `src/serve/ui.js`'s `JS` export. A test parses the served payload.
- **A test can only protect a property someone remembered to restate when it changed.** The `READ-ONLY` badge stayed false through an entire phase *with two tests enforcing it*. It was caught by looking at the screen. When you change a boundary, **audit every surface that ever stated it** — it was in five places.
- **Calling `main()` is not running the program.** 0.2.0 shipped a binary that printed nothing and exited 0 on every Linux and macOS install, behind a green suite on nine CI jobs, because every test reached the code by `import`. Nothing was wrong with `main()`; *getting to* `main()` was broken, and no import-based test can see that. `test/executable.test.js` now packs the real tarball, installs it, and spawns the bin npm generates — and asserts the POSIX bin is a **symlink**, because that shape is the whole bug and a test that stopped exercising it would keep passing. The general rule: **whatever the distribution mechanism is, one test must go through it**, however slow and awkward that is.

---

## 7. Cross-repo pinning — this package copies, never imports

There is a **hard boundary** with both companion repos (`opensourcesai.com` and `opensourcesai-bench`). This package never imports across either. Instead it copies, and **every copy is pinned against a generated fixture** — one sync script per source repo, and a parity fixture's filename prefix names the repo it pins (`website-*`, `bench-*`; the fixture tests key on those prefixes):

| Copy here | From | Pinned by |
|---|---|---|
| `src/derive/checker-engine.generated.js` | website `lib/checker-engine.js` | its **sha256**, in `fixtures/website-engine-parity.json` |
| `src/derive/bench-environment.generated.js` | bench `src/derivation/environment.js` | its **sha256**, in `fixtures/bench-environment-parity.json` |
| `src/derive/bench-gpu-bandwidth.generated.js` | bench `src/derivation/gpu-bandwidth.js` | its **sha256**, in `fixtures/bench-gpu-bandwidth-parity.json` |
| `data/gpu-memory-bandwidth-v1.js` | bench `data/gpu-memory-bandwidth-v1.js` | its **sha256**, same fixture — **the filename is load-bearing**: the matcher imports it by exactly this name, which is what lets the pair stay byte-exact with no import rewriting; a structural test asserts the resolution |
| `data/bench-roofline-limits.json` | bench `src/protocol.js` `ROOFLINE_LIMITS` | (executed snapshot; any surface rendering a utilization figure renders these caveats) |
| `src/derive/bands.js` | website `src/lib/hardwareTelemetry.js`, `src/lib/appleMemory.js` | `fixtures/website-bands-parity.json` |
| `data/checker-models-snapshot.json` | website `src/data/checker-models.json` | (snapshot; shows its own age in the UI) |
| site colours in `src/serve/ui.js` | website `src/index.css` | `fixtures/website-design-tokens.json` |
| HUD palette in `src/serve/ui.js` | website `docs/social-image-system/social-image-style-guide.md` | `fixtures/website-social-palette.json` |

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

**The same mechanism covers bench's environment-declaration module, from day one rather than after its own incident.** `src/derive/environment.js` is the thin layer over `src/derive/bench-environment.generated.js` — the variable allowlist, value-versus-presence capture, and comparability verdicts that decide which measurements may ever sit side by side. The façade adds only what bench does not own: the declaration hash stored measurement records carry, built so that **hash equality is exactly bench's "comparable" verdict** (a property test asserts the equivalence in both directions).

**And the bandwidth pair.** `src/derive/bandwidth.js` is the thin layer over the copied matcher+table: it joins bench's resolution rules to this package's capture shape (`selectPrimaryGpu` → raw VRAM bytes, because the tolerance windows are stated against what vendor tools actually report). The table's citation URLs are provenance data, never fetched — the table lives under `data/`, and the no-transmission guards police `src/`. A manual bandwidth figure wins over the table and is labelled `source: "manual"` by the copied resolver itself; where that figure persists, and the UI that collects it, arrive with the surface that consumes it.

**Regenerate all of them with:**
```bash
node scripts/sync-from-website.mjs ../opensourcesai.com
```
```bash
node scripts/sync-from-bench.mjs ../opensourcesai-bench
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
