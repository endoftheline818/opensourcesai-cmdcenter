#!/usr/bin/env node

// THE EXECUTABLE, AND NOTHING ELSE. It runs the program. It does not ask
// whether it is supposed to.
//
// WHY THIS FILE IS ALMOST EMPTY — a bug worth the paragraphs.
//
// Everything below used to live at the bottom of the implementation file,
// behind a guard that asked "was I run directly, or imported?" by comparing
// `pathToFileURL(process.argv[1]).href` against `import.meta.url`. On Linux
// and macOS, `npm install` publishes a bin by SYMLINKING it —
// node_modules/.bin/osai-cmdcenter points at .../src/cli.js — and Node
// resolves an ESM main through its realpath while leaving `process.argv[1]`
// as the symlink the shell actually invoked. The two strings therefore never
// matched, the guard concluded it was being imported, and the process exited
// 0 having done nothing:
//
//     $ npx @opensourcesai/cmdcenter@0.2.0 --version
//     $                       <- no output, no error, no server, exit 0
//
// That is the worst shape a failure can take. There was nothing to search
// for, and the same package worked perfectly when pointed at the real file,
// which is what made it look like an environment problem rather than a bug.
// Windows was unaffected only by luck: npm writes .cmd/.ps1 shims there that
// name the real path, so argv[1] and import.meta.url agreed.
//
// The guard had ALREADY failed once, on Windows, for an unrelated reason — a
// hand-built "file://" string never matching Node's three-slash form, with
// the identical symptom of a CLI printing nothing at all. Two silent failures
// of one question, on two platforms, for two different reasons, is the
// question's fault and not the implementation's. So the question is gone
// rather than patched a third time: this file is only ever reached by being
// run, so it runs, however it was reached — symlink, shim, realpath, or a
// bare `node src/cli.js` from a checkout. Nothing left to get wrong.
//
// Keep this file trivial. Anything added here is code the test suite reaches
// only by spawning a process; ./program.js is where logic belongs.

import { main } from "./program.js";

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    process.stderr.write(`osai-cmdcenter failed: ${err.stack}\n`);
    process.exitCode = 1;
  },
);
