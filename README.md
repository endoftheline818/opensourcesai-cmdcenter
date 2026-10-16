# OpenSourcesAI Command Center

A dashboard for people running local AI models with Ollama. It shows what your
computer is actually doing while a model runs: GPU, VRAM, RAM, temperature,
power, and whether your model is sitting fully on the GPU or spilling over to
the CPU.

Everything runs on your own machine. The dashboard listens on `127.0.0.1` and
talks only to AI runtimes on this machine, never to the internet.

## Try it

You need Node.js 20 or newer and Ollama running.

```bash
npx @opensourcesai/cmdcenter serve
```

Then open http://127.0.0.1:7717 in your browser.

Other commands:

```bash
npx @opensourcesai/cmdcenter            # a plain-text report in the terminal
npx @opensourcesai/cmdcenter --json     # the same report as JSON
npx @opensourcesai/cmdcenter --capture  # raw machine data, handy for bug reports
```

## What you get

- **Live stats.** CPU, GPU, VRAM, RAM, temperatures, fan, power, and disk
  activity, on the platforms that can report them. If your system can't measure
  something, the dashboard says so instead of showing a zero.
- **Your Ollama models.** Which ones are installed, which are loaded, and how
  much of each is really in VRAM versus pushed out to the CPU.
- **Fit grades.** Which models should run well on your hardware, using the same
  logic as the compatibility checker on [opensourcesai.com](https://opensourcesai.com).
- **Load and unload.** You can load or unload models Ollama already has. That's
  all it can do. It can't download, delete, or start or stop anything.
- **Chat with numbers.** A simple chat window that shows tokens per second and
  time to first token for every reply. It works with Ollama, and with
  llama.cpp or any other OpenAI-compatible server on your machine
  (`--llamacpp-port`).
- **Benchmark results.** Open results from
  [`@opensourcesai/bench`](https://github.com/endoftheline818/opensourcesai-bench)
  and compare two runs side by side, as long as they were run under the same
  conditions. If they weren't, it tells you why the comparison would mislead.
- **MCP servers.** A list of the MCP servers configured on your machine, with a
  check on whether each command exists and each config is well formed.

## Hardware detection is messy

Different parts of an operating system can report different amounts of VRAM.
On Windows, one common API caps out at 4 GB, so a 12 GB card looks like a 4 GB
card. Command Center collects every source, marks the ones it knows are
unreliable, and shows you where they disagree so you can see what your system
is really saying.

## What it will never do

- **Expose itself to your network.** The server only binds to loopback, and
  there's no option to change that.
- **Call the internet.** Every network call in the code goes to `127.0.0.1`,
  and a test fails the build if one doesn't. Cloud endpoints are
  permanently out of scope. The moment you could paste in an API key for a
  hosted model, that promise would be gone, so that field will never exist.
- **Run a shell.** Every subprocess gets an explicit argument list, so there's
  no command string for anything to sneak into.
- **Send your data anywhere.** Conversations and speed history are saved in a
  local data folder
  (`%LOCALAPPDATA%\osai-cmdcenter` on Windows,
  `~/Library/Application Support/osai-cmdcenter` on macOS,
  `~/.local/share/osai-cmdcenter` on Linux) and stay there. You can delete a
  conversation from the Chat view, or export one to a markdown file if you
  want to keep it.

## Ollama on another machine (headless)

If Ollama runs on a server with no screen, run Command Center on the server and
reach it through an SSH tunnel. The dashboard can't be exposed to your network,
which is on purpose.

On the server:

```bash
nohup npx @opensourcesai/cmdcenter serve --port 7717 < /dev/null > /tmp/cmdcenter.log 2>&1 & disown
```

The `< /dev/null` matters. Without it the SSH session hangs waiting for input,
which looks exactly like the server failed to start.

On your laptop, in a fresh terminal:

```bash
ssh -N -L 7717:127.0.0.1:7717 your-server
```

Then open http://127.0.0.1:7717.

If it doesn't work:

- **`connect failed: Connection refused`:** the tunnel is fine, but nothing is
  listening on the server. Check that it actually started, and that both ends
  use the same port.
- **"Ollama not detected" but Ollama is running:** if `OLLAMA_HOST` is set to
  `0.0.0.0`, Command Center falls back to `127.0.0.1`. That's normal.
- **Nothing happens when you run it:** version `0.2.0` exited silently on
  Linux and macOS, and npx keeps reusing whichever version it cached first.
  Run `rm -rf ~/.npm/_npx`, then `npx @opensourcesai/cmdcenter@latest serve`.

## Feedback

I'd like to hear how it does on hardware I can't test: AMD, Intel, Apple
Silicon, multi-GPU boxes, and home servers. If something looks wrong, run
`npx @opensourcesai/cmdcenter --capture` and attach the output to an
[issue](https://github.com/endoftheline818/opensourcesai-cmdcenter/issues).

Working on the code? Start with [CONTRIBUTING.md](CONTRIBUTING.md). The
architecture and the reasons behind the rules are in [MAINTAINING.md](MAINTAINING.md).

## License

MIT
