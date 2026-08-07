# OpenSourcesAI Command Center

A local command center for a machine running Ollama. It reports what your
hardware **actually is** — not what a browser can guess — what Ollama is
actually running, shows live system pressure, inspects osai-bench results under
the bench protocol's own rules, inventories local MCP servers, and can load or
unload already-installed models within a narrow action boundary. It talks only
to AI runtimes on this machine — never to the internet.

> **Status: Phases 0–3d complete.** Shipped: the diagnostic core, local
> dashboard, live telemetry, model catalog, MCP inventory with static config
> verdicts, the load/unload action surface, the measurement layer (bench-result
> inspection, a provenance-pinned bandwidth ceiling, vendor-verdict throttle
> reporting), and the measured chat surface against two local runtimes with
> machine baselines from retained history. Published to npm as
> [`@opensourcesai/cmdcenter`](https://www.npmjs.com/package/@opensourcesai/cmdcenter),
> with provenance — every release is built by CI from a public commit, and
> npm's attestation proves it. See [Roadmap](#roadmap).

```bash
npx @opensourcesai/cmdcenter          # human-readable report
npx @opensourcesai/cmdcenter serve    # local dashboard at http://127.0.0.1:7717
npx @opensourcesai/cmdcenter --json   # the full report as JSON
npx @opensourcesai/cmdcenter --capture # raw machine capture, for bug reports
```

From a clone, the same commands are `node src/cli.js …` — there is no build
step and there are no dependencies to install.

## Why this exists

opensourcesai.com can help you *discover* and *decide*, but it stops at the
browser boundary. There is no web API that can read your VRAM, so the site has
to ask you — and a checker is only as good as what you type into it. Deploying
and verifying happen on hardware a browser cannot see.

This tool closes that gap by reading the machine directly.

## What it reports

- **GPU and memory** from every source the platform offers, with contradictions
  shown rather than resolved silently.
- **Apple Silicon unified memory**, including the usable-for-models figure —
  which is materially lower than the sticker RAM.
- **Ollama**: version, reachability, installed models, loaded models and how
  much of each is actually resident in VRAM rather than spilled to CPU.
- **Live pressure**: CPU, system memory, GPU, VRAM, GPU temperature, power,
  GPU clock, and model-disk gauges where the platform can measure them. The
  clock gauge carries the **vendor's own throttle verdicts** — thermal slowdown
  escalates it, running at the power limit is named but never shouted about
  (that is how GPU Boost is designed to run), and an idle card's low clocks
  read as the health they are. When the throttle probe does not answer, the
  gauge makes no claim in either direction.
- **Local tools**: MCP server inventory with secret values and local paths
  removed during collection, plus a static verdict per server — the command
  located (never executed) and the config judged well-formed or broken, with
  "unchecked" stated outright where no check ran.
- **A shareable summary** — coarse bands only, safe to paste into a public issue.
- **Chat with every reply measured.** A minimal chat surface against this
  machine's AI runtimes — Ollama, and optionally an OpenAI-compatible server
  such as llama.cpp via `--llamacpp-port` — where each response arrives with
  its own figures: tokens per second against this machine's bandwidth ceiling
  (manufacturer-sourced, or your own manual figure labelled as exactly that),
  first-token time (thinking-aware), cold loads annotated rather than
  averaged away, residency at generation time, and this machine's own standing
  best for the model, compared only across replies made under the same declared
  run conditions. The model picker shows each model's fit grade and live
  residency before you commit to it. What a runtime does not report stays
  unavailable with its reason — llama.cpp's protocol has no residency probe,
  so its replies say so instead of borrowing Ollama's.
- **osai-bench results, inspected honestly.** Results from
  [`@opensourcesai/bench`](https://github.com/endoftheline818/opensourcesai-bench)
  are found automatically — bench 0.12+ writes into `~/.osai/bench-results/`
  by default, and the Bench view scans exactly that one directory, read-only,
  with files openable only by bare name behind a pattern-and-containment
  gate — or drop a result file from anywhere: medians with their variation
  and sample counts, the
  roofline with its caveats attached, every diagnostic including the ones that
  say "unavailable", and quality-override marks rendered loudly. Two results
  compare side by side only when they earn it — same machine (you attest it),
  same model and weights, and run conditions the bench protocol itself calls
  comparable.
- **What it does not claim.** Every report ends with its own limitations.

## Running it on a headless machine

Ollama often runs on a box with no desktop — a home server, a spare tower, a
rented GPU host. The dashboard binds to `127.0.0.1` and nothing else, so
opening it from your laptop takes one extra step.

**That bind address is not configurable, on purpose.** `BIND_ADDRESS` is a
constant in `src/serve/server.js`, a test asserts it is loopback, and `--port`
is the only flag `serve` accepts. There is no `--host`, no environment
variable, and no config file — so this dashboard cannot be exposed to a network
by accident, or by following bad advice. Reaching it remotely is therefore a
deliberate act on your side, not a setting you can leave switched on.

Use SSH port forwarding. It keeps every guarantee intact: the server still
binds loopback, still requires its per-session token, and still enforces its
Host and Origin checks.

**On the server**, start it in the background:

```bash
cd opensourcesai-cmdcenter
nohup node src/cli.js serve --port 7717 < /dev/null > /tmp/cmdcenter.log 2>&1 & disown
```

`< /dev/null` is required, not decoration. Without it the SSH channel stays
open waiting on stdin even with `nohup` and `disown`, which looks exactly like
a server that failed to start — while it is in fact running fine. Confirm with:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:7717/
```

**On your laptop**, open the tunnel and leave it running:

```bash
ssh -N -L 7717:127.0.0.1:7717 your-server
```

Then visit `http://127.0.0.1:7717/`. There is no token to copy — the page is
served with its own. `Ctrl+C` closes the tunnel; the server keeps running until
you stop it.

### When it does not work

- **`channel N: open failed: connect failed: Connection refused`, repeating.**
  The tunnel is fine. Nothing is listening on the far end — the server is not
  running, or is on a different port.
- **`Permission denied` binding the local port.** Usually not a permission
  problem: something on *your* machine already holds `127.0.0.1:7717`. An
  earlier tunnel or an earlier `serve` is the usual culprit.
- **A host-key prompt for a host you are already on.** The `ssh -L` command was
  run *inside* the session it was meant to create, so it is connecting to the
  machine from itself. Run it in a fresh local terminal instead.
- **"Ollama not detected" while Ollama is clearly running.** `OLLAMA_HOST` is
  dual-purpose — a *bind address* to the server, a *connect target* to a
  client — and headless setups often set it to `0.0.0.0` so other machines can
  reach Ollama. Taken literally as a connect target that address is not
  useful, so this tool falls back to loopback when it sees a wildcard. If
  another Ollama client on the same box reports the same thing, this is why.

## Trust boundaries

These are trust properties, enforced by tests in `test/package.test.js`, not
preferences:

1. **It talks only to AI runtimes on this machine — never to the internet.**
   Every network call in the package targets loopback (today: Ollama on
   `127.0.0.1`, and optionally an OpenAI-compatible server on a loopback port
   you name with `--llamacpp-port` — a port, never a host, so it cannot point
   off this machine); a structural test asserts every absolute URL in the
   source is loopback, so an outbound call cannot appear without failing the
   build.
   **Cloud endpoints are permanently out of scope** — an API-key field for a
   hosted model would end this guarantee, and it is this tool's identity, not
   a missing feature.
2. **It has exactly two actions: load and unload.** No model pulls, no
   deletions, no starting or stopping services. Both actions only target models
   Ollama already reports as installed, and the action layer is structurally
   incapable of running inference — its one request carries an always-empty
   prompt, permanently. (Inference belongs to a separate, deliberately-opened
   surface; see the roadmap. The package also contains a storage layer that can
   delete only its own data files — never models, never configs, never anything
   it did not create — and no command reaches it yet; tests assert both the
   containment and the unreachability.)
3. **It never runs a shell.** Every subprocess goes through one `execFile`
   wrapper with an explicit argument array, so there is no command-injection
   surface to reason about — it is absent by construction.

## Design: collection is impure, everything else is not

| Layer | Rule |
|---|---|
| `src/collect/**` | The only code that performs I/O. Captures raw responses and returns them unmodified — including ones known to be wrong. |
| `src/derive/**` | Pure functions over a capture. No I/O, no clock, no randomness. |
| `src/actions/**` | The only Ollama mutation surface: load and unload installed models. |
| `src/serve/**` | Local HTTP server, security checks, and the browser dashboard bundle. |
| `src/storage/**` | The only code that writes or deletes files, confined to this tool's own data directory. Not yet invoked by any command; tests assert both. |

That split is what lets the entire reporting layer be tested against committed
captures from real machines, on a CI runner with no GPU and no Ollama installed.
`fixtures/` holds real captures from an RTX 4070 Ti (Windows), an RTX 3080
(Linux), and an M1 MacBook Air — the three machines Phase 0 was validated on.

## Two findings worth knowing

**Windows' obvious VRAM API is wrong.** `Win32_VideoController.AdapterRAM` is a
32-bit field that saturates: a 12 GB card reports ~4 GB. This tool captures it
anyway, flags it as known-unreliable, and prefers a corroborated source — but it
shows you the disagreement rather than quietly picking a winner.

**Vendors report *below* nameplate, and it changes the answer.** An RTX 4070 Ti
reports 12282 MiB, not 12288, because part of the framebuffer is reserved. Taken
literally that is 11.99 GiB, which falls below a 12 GB tier boundary and would
tell a 12 GB card it belongs in the 8–11 GB tier. Capacity is therefore banded
from a nameplate-rounded figure. This only affects cards whose nameplate sits
exactly on a tier edge — 12/16/24/32/48 GB — which is most of the enthusiast
tier, and is why a mid-band card alone would never have surfaced it.

## Relationship to opensourcesai.com

A separate product with a separate lifecycle. It is never merged into the
website repository and never imports from it — asserted by a test. The two are
joined only by versioned contracts and committed generated fixtures. The band
vocabulary, catalog snapshot, design tokens, and HUD palette are copied from the
website and pinned here by fixtures.

The **fit engine** — which decides what runs on your machine — is copied
verbatim by a script rather than by hand, and pinned by a digest of the file
itself. So the grades shown here are produced by the same code as the website's
compatibility checker, byte for byte, and the two cannot quietly disagree.

The same arrangement joins this tool to `opensourcesai-bench`: the module
defining which Ollama settings change what a measurement means — and whether two
measurements may honestly be compared at all — is copied verbatim from bench and
digest-pinned, so the two tools can never disagree about which comparisons are
valid. So is the manufacturer-sourced GPU memory-bandwidth table and its
matcher, meaning both tools resolve the same GPU to the same ceiling — and where
no sourced figure exists, both say "unavailable" rather than guessing.

## Roadmap

- **Phase 0:** diagnostic core, validated on Windows, Linux, and macOS captures.
- **Phase 1:** local dashboard over the same core, with live telemetry, model
  catalog, and public-safe report views.
- **Phase 2:** narrow load/unload actions for already-installed Ollama models.
- **Phase 3 (complete):** the measurement layer — bench-result inspection
  under the bench protocol's own comparability rules, a provenance-pinned
  memory-bandwidth ceiling, vendor-verdict throttle reporting, and a versioned
  local store built for measurement history (no-prose schema, tested from day
  one, now written only by the chat surface).
- **Phase 3b (complete): the chat surface, built measurement-first.** Every
  generation this machine performs is a measurement opportunity, and the
  instrument came before the conveniences: each reply carries its own honest
  figures under the same rules as everything above (unavailable is never zero;
  ceilings are never guessed), plus a verdict on whether the machine kept the
  fit engine's promise — a model predicted to fit that spills renders as a
  broken prediction, in red, with both figures named. Conversations carry
  their own trend line, with a slowdown attributed to context physics only
  when residency stayed put; if residency fell, it says spill instead.
  Inference lives in its own module, never in the action layer, and only ever
  against AI runtimes on this machine.
- **Phase 3c (complete): the instrument widened.** A second local runtime
  (any OpenAI-compatible server, llama.cpp first) under the same measurement
  rules and the same loopback-by-construction boundary; machine baselines from
  retained history, so each reply is compared against this machine's own
  standing best under matching run conditions — the comparison this tool was
  founded on; and static MCP config verdicts, with the runtime tiers
  deliberately unbuilt until they can be honest.
- **Phase 3d (complete): the conveniences, measurement-first to the end.**
  They waited until every measurement item shipped, then arrived carrying the
  discipline: a `num_ctx` control whose value is **recorded into the reply's
  measurement record** the moment it became settable (a reply run under a
  non-default window says so in its own strip; the OpenAI-compatible runtime
  refuses the request honestly, since its window is fixed at server launch);
  per-conversation system prompts, set at start and fixed for life; plain-text
  search over your own conversations; and export to markdown **with each
  reply's measurements attached** — a file on your own disk, produced only by
  your click.
- **Next:** nothing is scheduled. Deliberately not planned, ever: cloud
  endpoints, accounts, or anything that leaves the machine.

## What it remembers

With the chat surface came this tool's first persistent data, in its own
platform data directory (`%LOCALAPPDATA%\osai-cmdcenter` on Windows,
`~/Library/Application Support/osai-cmdcenter` on macOS,
`~/.local/share/osai-cmdcenter` on Linux) — never inside this checkout:

- **Conversations** — your words and the model's, one file each, deletable
  from the Chat view behind a confirm. Deletion is contained by construction:
  the store cannot name a path outside its own directory.
- **Measurement history** — counters and metadata only, with **no field that
  can carry prose** (the schema refuses unknown fields at every level, and a
  test smuggles message-shaped fields at it to prove it). It deliberately
  survives deleted conversations, joined only by an opaque id.
- **One setting: a manual bandwidth figure** — for GPUs the sourced table
  does not list, entered in the Hardware view. It is tied to the exact GPU it
  was entered for (a replacement card never inherits it), labelled `manual`
  everywhere it is used so it can never pass as manufacturer-sourced, and
  removable with one click.

Nothing in this directory is ever transmitted or read into a diagnostic
capture — the same structural guards that keep this tool off the internet
keep its memory out of everything that leaves the machine. A conversation
leaves the directory exactly one way: the Chat view's Export button, which
**you** click, producing a markdown file on your own disk with each reply's
measurements attached. There is no server-side export path, and nothing
exports itself.

## Requirements

Node.js 20 or newer. No dependencies, and none are planned.

## License

MIT
