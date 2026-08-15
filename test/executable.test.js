// THE ONLY TESTS THAT RUN THIS TOOL THE WAY A USER RUNS IT.
//
// Every other test in this suite imports `main()` and calls it. That is fast
// and it is worth having, and it is also exactly why a total failure of the
// published binary — `npx @opensourcesai/cmdcenter serve` printing nothing and
// exiting 0 on every Linux and macOS install of 0.2.0 — sat behind a green
// suite on nine CI jobs. `main()` was never broken. Getting to `main()` was.
//
// So these tests do the slow, awkward thing: pack the real tarball, install it
// into a throwaway project, and execute the binary npm generates — a symlink on
// Linux and macOS, a .cmd shim on Windows. Both shapes, on their own platforms,
// through a spawned process, with the output read off a pipe.
//
// They are slower than the rest of the file combined. Keep them anyway.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { lstat, mkdtemp, mkdir, readdir, rm, symlink, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CLIENT_VERSION } from "../src/version.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const isWindows = process.platform === "win32";

// Generous, because these spawn real processes that probe real hardware:
// `serve` runs a full capture before it prints anything, and a Windows runner
// walking WMI is measured in tens of seconds, not milliseconds.
const PACK_TIMEOUT = 300_000;
const BOOT_TIMEOUT = 180_000;

const temporaryDirectories = [];
after(async () => {
  for (const dir of temporaryDirectories) await rm(dir, { recursive: true, force: true });
});

async function temporaryDirectory(prefix) {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(dir);
  return dir;
}

/**
 * Run an executable to completion, collecting both streams.
 *
 * `command` must be an ABSOLUTE path. A bare name on Windows goes through
 * cmd.exe's own search, and a .cmd shim found that way expands `%~dp0` to the
 * CURRENT directory rather than its own — which is how the first draft of this
 * file got npm looking for npm-cli.js inside the package under test.
 */
function run(command, args, options = {}) {
  const child = isWindows ? spawn(quoted(command, args), [], { shell: true, ...options }) : spawn(command, args, options);
  return collect(child);
}

/**
 * A cmd.exe command line. Windows needs the shell for a .cmd shim — Node has
 * refused to spawn one directly since the 2024 argument-injection fix — so
 * everything is quoted, including the temp paths that deliberately contain
 * spaces. TEST-ONLY: `src/` still spawns exclusively through collect/exec.js's
 * argv array, and package.test.js still asserts it does.
 */
function quoted(command, args) {
  return [command, ...args].map((part) => `"${part}"`).join(" ");
}

/**
 * npm, as a path this process can execute without a shell.
 *
 * Not the `npm` / `npm.cmd` wrapper: those are a shell script and a batch file
 * whose behaviour depends on how they were named. npm's real entry point is a
 * plain .js file, so it runs under the same Node that is running these tests.
 * `npm_execpath` is set when the suite runs through `npm test` (CI always
 * does); the two directory layouts cover a contributor invoking `node --test`
 * straight from a checkout.
 */
function npmCli() {
  const beside = path.dirname(process.execPath);
  const candidates = [
    process.env.npm_execpath,
    path.join(beside, "node_modules", "npm", "bin", "npm-cli.js"),
    path.resolve(beside, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ];
  for (const candidate of candidates) {
    if (candidate && candidate.endsWith(".js") && existsSync(candidate)) return candidate;
  }
  // Deliberately fatal rather than skipped. These are the only tests covering
  // the packaged binary; quietly not running them is the state this file was
  // written to end.
  assert.fail(`npm's CLI could not be located. Tried:\n${candidates.filter(Boolean).join("\n")}`);
}

function collect(child) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

/**
 * Pack and install the package exactly as npm would, then hand back the
 * generated bin.
 *
 * `--ignore-scripts` on the pack is not a shortcut: `prepack` runs
 * `npm run check`, which runs `node --test`, which runs THIS FILE. Without it
 * the first assertion here would recurse until something ran out of memory.
 *
 * Memoised — one pack and one install serve every test below.
 */
let installation = null;
function installPackedArtifact() {
  installation ??= (async () => {
    const packDir = await temporaryDirectory("cmdcenter-pack-");
    // THE SPACE IN THIS NAME IS THE TEST. `packageRoot` used to be derived by
    // string-editing `new URL(import.meta.url).pathname`, which never
    // percent-decoded — so an install under `C:\Users\First Last\` or any
    // other ordinary path with a space resolved the catalog snapshot to a
    // directory that does not exist. Installing somewhere with a space is what
    // makes the serve test below prove the fix instead of assuming it.
    const projectDir = await temporaryDirectory("cmdcenter install ");

    const npm = npmCli();
    const packed = await run(
      process.execPath,
      [npm, "pack", "--ignore-scripts", "--pack-destination", packDir],
      { cwd: root },
    );
    assert.equal(packed.code, 0, `npm pack failed:\n${packed.stdout}\n${packed.stderr}`);

    const tarballs = (await readdir(packDir)).filter((name) => name.endsWith(".tgz"));
    assert.equal(tarballs.length, 1, `expected exactly one tarball, got ${JSON.stringify(tarballs)}`);
    const tarball = path.join(packDir, tarballs[0]);

    // A host package.json, so npm installs into a project rather than walking
    // up the temp directory looking for one.
    await writeFile(
      path.join(projectDir, "package.json"),
      `${JSON.stringify({ name: "cmdcenter-executable-test", version: "1.0.0", private: true }, null, 2)}\n`,
    );

    const installed = await run(
      process.execPath,
      [npm, "install", tarball, "--no-audit", "--no-fund", "--ignore-scripts", "--loglevel", "error"],
      { cwd: projectDir },
    );
    assert.equal(installed.code, 0, `npm install failed:\n${installed.stdout}\n${installed.stderr}`);

    const binDirectory = path.join(projectDir, "node_modules", ".bin");
    const bin = path.join(binDirectory, isWindows ? "osai-cmdcenter.cmd" : "osai-cmdcenter");
    const entries = await readdir(binDirectory);
    assert.ok(
      entries.includes(path.basename(bin)),
      `npm did not generate the expected bin; .bin contains ${JSON.stringify(entries)}`,
    );
    return { bin, projectDir };
  })();
  return installation;
}

test("the packed artifact's generated bin prints the version", { timeout: PACK_TIMEOUT }, async (t) => {
  const { bin } = await installPackedArtifact();

  // THE POSITIVE CONTROL FOR THIS WHOLE FILE. On Linux and macOS the bug was
  // reachable only because npm links a bin by SYMLINK — argv[1] keeps the link
  // path while Node realpaths the ESM main. If npm ever stopped symlinking,
  // every test here would keep passing while covering nothing, so the shape
  // that made the bug possible is asserted rather than assumed.
  if (!isWindows) {
    assert.ok((await lstat(bin)).isSymbolicLink(), "npm's POSIX bin must be a symlink — the regression needs that shape");
  } else {
    t.diagnostic("Windows: npm generates a .cmd shim naming the real path, which is why this platform never broke");
  }

  const result = await run(bin, ["--version"]);
  assert.equal(result.stdout.trim(), CLIENT_VERSION, `expected the version on stdout, got: ${JSON.stringify(result)}`);
  assert.equal(result.code, 0, `expected a clean exit, got ${result.code}: ${result.stderr}`);
});

test("the packed artifact's generated bin refuses a bad port", { timeout: PACK_TIMEOUT }, async () => {
  const { bin } = await installPackedArtifact();
  const result = await run(bin, ["serve", "--port", "99999"]);
  // Validation is reached through the binary, not just through main() — the
  // whole point being that reaching main() at all is the thing that broke.
  assert.match(result.stdout, /Invalid --port/);
  assert.equal(result.code, 1);
});

test(
  "the generated bin serves on the requested port, binds loopback only, and stops cleanly",
  { timeout: PACK_TIMEOUT },
  async (t) => {
    const { bin } = await installPackedArtifact();
    const port = await freePort();

    const serveArgs = ["serve", "--port", String(port)];
    const child = isWindows
      ? spawn(quoted(bin, serveArgs), [], { shell: true })
      : spawn(bin, serveArgs);

    let stdout = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk));
    const exited = new Promise((resolve) => child.once("close", (code, signal) => resolve({ code, signal })));

    try {
      // 1. IT STARTS, AND SAYS SO. The published 0.2.0 never got this far: it
      //    exited 0 with an empty stdout, which is why "nothing printed" is
      //    asserted against here rather than merely "the port answers".
      await waitFor(() => /Press Ctrl\+C to stop\./.test(stdout), BOOT_TIMEOUT, () => `banner never appeared. stdout: ${JSON.stringify(stdout)} stderr: ${JSON.stringify(stderr)}`);
      assert.match(stdout, new RegExp(`http://127\\.0\\.0\\.1:${port}/`), "the banner must advertise the requested port");

      // The catalog line proves `packageRoot` resolved a real directory. The
      // install path above contains a space on purpose, and the old
      // string-edited pathname would have failed to read data/ from it.
      assert.match(stdout, /Catalog snapshot: .+ \(\d+ models\)/, "the snapshot must load from an install path with a space");

      // 2. IT STAYS ALIVE. `serve` returning would be the old failure wearing
      //    a banner.
      assert.equal(child.exitCode, null, "serve must keep running");

      // 3. IT ANSWERS THERE. The root document is served without the session
      //    token on purpose — it is what delivers the token to the page.
      const response = await fetch(`http://127.0.0.1:${port}/`);
      assert.equal(response.status, 200);
      assert.match(await response.text(), /<html/i);

      // 4. AND NOWHERE ELSE. The security invariant, checked against the
      //    running process rather than against the source constant: from this
      //    machine's own routable address, the port must be closed.
      const external = nonLoopbackAddress();
      if (external === null) {
        t.diagnostic("no non-loopback IPv4 on this host, so the external-refusal check could not run here");
      } else {
        const reachable = await canConnect(external, port);
        assert.equal(reachable, false, `the dashboard answered on ${external}:${port} — it must bind 127.0.0.1 only`);
      }

      // Control for step 4: a socket that CAN connect proves the probe above
      // is capable of returning true, so its `false` means "refused" and not
      // "this probe never works".
      assert.equal(await canConnect("127.0.0.1", port), true, "the loopback probe must be able to connect");
    } finally {
      await terminate(child);
    }

    // 5. IT STOPS, AND LETS GO OF THE PORT. An orphaned server would poison
    //    every later run on this machine.
    const result = await Promise.race([
      exited,
      new Promise((resolve) => setTimeout(() => resolve(null), 30_000)),
    ]);
    assert.ok(result !== null, "the server did not exit after being terminated");
    assert.equal(await canConnect("127.0.0.1", port), false, "the port must be released on exit");
  },
);

// THE MECHANISM, ISOLATED — and deliberately not dependent on npm.
//
// The tests above are the real thing but they need a working `npm pack` and
// half a minute. This one reproduces the exact condition that broke the
// release, in about a second, with two filesystem calls: run the entry point
// through a symlink and require that it still does its job.
test("the entry point runs when reached through a symlink", { timeout: 60_000 }, async (t) => {
  const dir = await temporaryDirectory("cmdcenter-symlink-");
  const link = path.join(dir, "osai-cmdcenter");

  try {
    await symlink(path.join(root, "src", "cli.js"), link);
  } catch (err) {
    // Creating a symlink on Windows needs a privilege an ordinary CI account
    // does not have. That is acceptable HERE and only here: Windows never had
    // this bug, because npm writes .cmd shims naming the real path — and the
    // packed-artifact tests above still cover the real Windows bin. Skipping
    // is reported, never silent.
    if (isWindows && (err.code === "EPERM" || err.code === "UNKNOWN")) {
      t.skip(`symlink creation is not permitted for this account (${err.code}); the .cmd shim is covered above`);
      return;
    }
    throw err;
  }

  const result = await run(process.execPath, [link, "--version"]);
  assert.equal(
    result.stdout.trim(),
    CLIENT_VERSION,
    `a symlinked entry point printed nothing — this is the 0.2.0 regression. ${JSON.stringify(result)}`,
  );
  assert.equal(result.code, 0);
});

// The path README.md gives people for headless servers, and the one
// MAINTAINING.md gives contributors. It worked before the entry-point split
// and has to keep working after it — the split moved the implementation out of
// this file, so a mistake there would break exactly this invocation.
test("node src/cli.js still runs from a checkout", { timeout: 60_000 }, async () => {
  const result = await run(process.execPath, [path.join(root, "src", "cli.js"), "--version"]);
  assert.equal(result.stdout.trim(), CLIENT_VERSION, JSON.stringify(result));
  assert.equal(result.code, 0);
});

// Importing the implementation must stay free of side effects — that property
// is what the whole split rests on, and it is cheap to state.
test("importing the program neither runs it nor prints anything", { timeout: 60_000 }, async () => {
  const dir = await temporaryDirectory("cmdcenter-import-");
  const probe = path.join(dir, "probe.mjs");
  const programUrl = new URL("../src/program.js", import.meta.url).href;
  await mkdir(dir, { recursive: true });
  await writeFile(probe, `await import(${JSON.stringify(programUrl)});\nprocess.stdout.write("imported-cleanly");\n`);

  const result = await run(process.execPath, [probe]);
  assert.equal(result.stdout, "imported-cleanly", `importing produced output: ${JSON.stringify(result)}`);
  assert.equal(result.code, 0);
});

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function canConnect(host, port, timeout = 3000) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const finish = (value) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeout, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

function nonLoopbackAddress() {
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal) return address.address;
    }
  }
  return null;
}

/**
 * Kill the server and everything it spawned.
 *
 * On Windows the process being held is cmd.exe, not node — shell:true is
 * required to run a .cmd shim at all — so `child.kill()` would reap the shell
 * and leave the dashboard running on the test port forever. taskkill /T is the
 * only way to take the tree.
 */
function terminate(child) {
  if (!isWindows) {
    child.kill("SIGTERM");
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    killer.once("close", resolve);
    killer.once("error", () => {
      child.kill("SIGKILL");
      resolve();
    });
  });
}

async function waitFor(condition, timeoutMs, describeFailure) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail(describeFailure());
}
