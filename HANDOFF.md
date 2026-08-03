# Maintainer Handoff — OpenSourcesAI Command Center

You are taking over development of a working, tested tool. **Read this whole file before writing code.** It exists because several of the rules below were learned by shipping bugs, and re-learning them costs more than reading.

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
npm test                   # 143 tests
```

**Status:** Phases 0, 1 and 2 are complete. `npm test` currently runs 143 tests locally, and CI is configured as a 9-way matrix (ubuntu/windows/macos × Node 20/22/24).

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
| `src/derive/bands.js` | `src/lib/hardwareTelemetry.js`, `src/lib/appleMemory.js` | `fixtures/website-bands-parity.json` |
| `src/derive/fit.js` | `lib/checker-engine.js` | `fixtures/website-engine-parity.json` |
| `data/checker-models-snapshot.json` | `src/data/checker-models.json` | (snapshot; shows its own age in the UI) |
| site colours in `src/serve/ui.js` | `src/index.css` | `fixtures/website-design-tokens.json` |
| HUD palette in `src/serve/ui.js` | `docs/social-image-system/social-image-style-guide.md` | `fixtures/website-social-palette.json` |

**Regenerate all of them with:**
```bash
node scripts/sync-from-website.mjs ../opensourcesai.com
```

Fixtures are **generated by executing/parsing the real source**, never transcribed. That is load-bearing: a hand-typed pin looks correct while being wrong. When one of these tests fails, the website changed — **re-run the sync script in a deliberate commit. Never edit the expectations until they pass.**

**`scoreModel` is deliberately NOT copied.** The website's 0–100 ranking stays where the surrounding copy explains its weights. This tool reports what fits and what it costs; ordering is fit-then-size. A test asserts no `score` field is ever emitted.

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
- **Do not add AI attribution or co-author trailers to commits.** This is a deliberate setting.
- Commit messages record **why**, not what. The reasoning behind a decision is the most valuable thing in this repo's history.
- **Do not publish to npm.**
- Verify in a **real browser** for UI changes, not just tests. Two of the most important bugs in this project were caught by looking at the screen.
- Report results honestly: a gate you did not run is **skipped**, never "passed."

---

## 10. What is open, and the evidence that shapes each

Do not start these blind — each has a finding attached that changes the answer.

1. **Deployment-intelligence guidance cards** — the last unbuilt item from the Phase 1 spec. **But all 10 records in the website's `deployment-intel.json` target Linux**, so this panel would render *empty* on Windows and macOS. Building it is cheap; making it valuable requires DI coverage for other platforms first (that is website/research work, under a verified-evidence gate).
2. **Request/activity history** — derivable from Ollama's access log at `%LOCALAPPDATA%\Ollama\server.log` (Gin format: timestamp, status, duration, client IP, endpoint). **But 94% of that log is now the dashboard's own polling** (`/api/ps`, `/api/version`, `/api/tags`) — measured: 153 polls vs 6 real generations. Filter to inference endpoints (`/api/generate`, `/api/chat`) or the chart measures itself. Also needs persistence, which this tool currently has none of.
3. **A proxy for per-request tokens/TTFT** — the only way to get the rich per-request data seen in Ollama Monitor / SigNoz dashboards, because **Ollama does not expose request history**; those tools get it by instrumenting the calling apps or intercepting. **This would put the tool in the user's inference path** — if it stalls, their AI stops working. That is a fundamentally different risk profile and needs an explicit maintainer decision.
4. **Packaging** (Tauri, signing, notarization) — deferred. Budget Windows code signing and Apple notarization when it happens; an unsigned binary triggers SmartScreen/Gatekeeper.
5. **Open maintainer decisions** from the discovery spec §8: **(3)** whether the website publishes a fetchable data manifest (a fetchable endpoint is a de facto public API, which collides with a standing non-goal — hence the committed snapshot today), and **(4)** whether to extract the shared engine into a package now that it has three consumers.

---

## 11. Website Coordination

Strategy and product history are coordinated with the website repository:

- `docs/control-center-discovery-spec-2026-08-02.md` — the governing spec, with supersession banners where reality diverged.
- `docs/roadmap.md` / `docs/roadmap-changelog.md` — currently **rev 97**. Revisions 90–97 cover this tool's entire history with the reasoning behind each decision.
- Private lab access details must stay out of this repository. Public fixtures should include only redacted captures.

**When you change something a doc claims, update the doc in the same PR.** Several revisions in that changelog exist specifically because a doc was left contradicting the code.

## 12. Public History Review

Before changing repository visibility, read
`docs/public-history-review-2026-08-03.md`. It records the full-history review
and the deliberate decision not to rewrite history for accepted non-credential
path and hostname exposure.
