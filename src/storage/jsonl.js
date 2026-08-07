// Append-only JSONL — the store's one write mechanism and its recovery rules.
//
// WHY JSONL AND NOT A DATABASE
// The zero-dependency rule holds for storage too. One JSON object per line,
// appended atomically enough for this workload (a single local process writing
// one short line at a time), readable with any text tool, and diffable when a
// user wants to see exactly what this tool remembers about their machine.
//
// THE CRASH CONTRACT
// An append is a single appendFile of `JSON.stringify(record) + "\n"`. If the
// process dies mid-write, the file ends in a torn partial line. The reader's
// job is to RECOVER THE TRUTH, not to pretend: every complete line parses, the
// torn tail is reported as `tornTail: true` rather than silently dropped, and a
// corrupt line in the MIDDLE of the file — which a crash cannot produce — is
// counted separately, because it means something other than a crash edited the
// file and the reader must not paper over that.

import fsp from "node:fs/promises";

/** Append one record as one line. The caller has already validated it. */
export async function appendRecord(file, record) {
  await fsp.appendFile(file, `${JSON.stringify(record)}\n`, "utf8");
}

/**
 * Parse JSONL text into records plus an honest account of what did not parse.
 *
 * PURE and exported, so the recovery rules are testable without a filesystem:
 * a torn tail is only a torn tail when it is the FINAL segment and the file
 * does not end in a newline — the exact shape an interrupted append leaves.
 */
export function parseJsonlText(text) {
  const out = { records: [], invalidLines: 0, tornTail: false };
  if (text === "") return out;

  const endsWithNewline = text.endsWith("\n");
  const lines = text.split("\n");
  if (endsWithNewline) lines.pop();

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === "") continue;
    try {
      out.records.push(JSON.parse(line));
    } catch {
      const isFinalSegment = index === lines.length - 1;
      if (isFinalSegment && !endsWithNewline) out.tornTail = true;
      else out.invalidLines += 1;
    }
  }
  return out;
}

/**
 * Read a JSONL file. An absent file is an ordinary result — a store nobody has
 * written to yet — not an error, same convention as collect/exec.js.
 */
export async function readRecords(file) {
  let text;
  try {
    text = await fsp.readFile(file, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") {
      return { exists: false, records: [], invalidLines: 0, tornTail: false };
    }
    // Anything else (permissions, I/O) is reported, never thrown: a dashboard
    // must degrade to "history unavailable", not crash while drawing a page.
    return {
      exists: true,
      records: [],
      invalidLines: 0,
      tornTail: false,
      error: String(err.message).slice(0, 160),
    };
  }
  return { exists: true, ...parseJsonlText(text) };
}
