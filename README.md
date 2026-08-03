# OpenSourcesAI Command Center

A local command center for a machine running Ollama. It reports what your
hardware **actually is** — not what a browser can guess — what Ollama is
actually running, shows live system pressure, inventories local MCP servers, and
can load or unload already-installed models within a narrow action boundary.

> **Status: Phases 0, 1, and 2 complete.** This is the diagnostic core, local
> dashboard, live telemetry view, model catalog, MCP inventory, and load/unload
> action surface. It remains unpublished (`private: true` in `package.json`) and
> installed by clone, not by `npx`. See [Roadmap](#roadmap).

```bash
node src/cli.js            # human-readable report
node src/cli.js serve      # local dashboard at http://127.0.0.1:7717
node src/cli.js --json     # the full report as JSON
node src/cli.js --capture  # raw machine capture, for bug reports and fixtures
```

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
- **Live pressure**: CPU, system memory, GPU, VRAM, GPU temperature, power, and
  model-disk gauges where the platform can measure them.
- **Local tools**: MCP server inventory with secret values and local paths
  removed during collection.
- **A shareable summary** — coarse bands only, safe to paste into a public issue.
- **What it does not claim.** Every report ends with its own limitations.

## Trust boundaries

These are trust properties, enforced by tests in `test/package.test.js`, not
preferences:

1. **It never transmits anything.** The only network call in the package is to
   Ollama on `127.0.0.1`. An audit must find zero outbound calls, and a test
   fails the build if one appears.
2. **It has exactly two actions: load and unload.** No model pulls, no
   deletions, no starting or stopping services. Both actions only target models
   Ollama already reports as installed.
3. **It never runs a shell.** Every subprocess goes through one `execFile`
   wrapper with an explicit argument array, so there is no command-injection
   surface to reason about — it is absent by construction.

## Design: collection is impure, everything else is not

| Layer | Rule |
|---|---|
| `src/collect/**` | The only code that performs I/O. Captures raw responses and returns them unmodified — including ones known to be wrong. |
| `src/derive/**` | Pure functions over a capture. No I/O, no clock, no randomness. |
| `src/actions/**` | The only mutation surface: load and unload installed Ollama models. |
| `src/serve/**` | Local HTTP server, security checks, and the browser dashboard bundle. |

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
vocabulary, fit engine, catalog snapshot, design tokens, and HUD palette are
copied from the website and pinned here by fixtures.

## Roadmap

- **Phase 0:** diagnostic core, validated on Windows, Linux, and macOS captures.
- **Phase 1:** local dashboard over the same core, with live telemetry, model
  catalog, and public-safe report views.
- **Phase 2:** narrow load/unload actions for already-installed Ollama models.
- **Next:** request/activity history after filtering out the dashboard's own
  polling, plus deferred deployment-intelligence and packaging work when their
  inputs and maintainer decisions are ready.

## Requirements

Node.js 20 or newer. No dependencies, and none are planned.

## License

MIT
