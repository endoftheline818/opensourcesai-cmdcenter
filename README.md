# OpenSourcesAI Command Center

A read-only diagnostic for a local Ollama machine. It reports what your hardware
**actually is** — not what a browser can guess — what Ollama is actually running,
and a shareable summary that carries no exact specs.

> **Status: Phase 0.** This is the diagnostic core, not yet the dashboard. It is
> unpublished (`private: true` in `package.json`) and installed by clone, not by
> `npx`. See [Roadmap](#roadmap).

```bash
node src/cli.js            # human-readable report
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
- **A shareable summary** — coarse bands only, safe to paste into a public issue.
- **What it does not claim.** Every report ends with its own limitations.

## Three things it will not do

These are trust properties, enforced by tests in `test/package.test.js`, not
preferences:

1. **It never transmits anything.** The only network call in the package is to
   Ollama on `127.0.0.1`. An audit must find zero outbound calls, and a test
   fails the build if one appears.
2. **It never changes your machine.** No model pulls, no deletions, no starting
   or stopping services. Read-only is the release boundary for this phase, not a
   per-feature judgement call.
3. **It never runs a shell.** Every subprocess goes through one `execFile`
   wrapper with an explicit argument array, so there is no command-injection
   surface to reason about — it is absent by construction.

## Design: collection is impure, everything else is not

| Layer | Rule |
|---|---|
| `src/collect/**` | The only code that performs I/O. Captures raw responses and returns them unmodified — including ones known to be wrong. |
| `src/derive/**` | Pure functions over a capture. No I/O, no clock, no randomness. |

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
joined only by versioned contracts, and by
`fixtures/website-bands-parity.json`, which pins this package's copy of the
band vocabulary to what the website's own modules produce.

## Roadmap

- **Phase 0 (here):** the diagnostic core, validated on three real machines.
- **Phase 1:** a local read-only dashboard over the same core.
- **Later:** controlled actions with preview and rollback; benchmark
  integration via `@opensourcesai/bench`; packaging.

## Requirements

Node.js 20 or newer. No dependencies, and none are planned.

## License

MIT
