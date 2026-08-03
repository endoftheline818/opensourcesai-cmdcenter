# Public History Review - 2026-08-03

## Decision

The repository history was reviewed on 2026-08-03 before making the repository
public. The reviewed historical exposure is accepted deliberately. Do not
rewrite history, force-push, or publish from a fresh mirror solely because the
accepted strings below are visible in old commits.

This decision does not permit accepting credentials, private keys, committed
`.env` files, real MCP config files, or other secret material. If any of those
are later found, treat that as a new incident and revisit the launch path.

## Review Scope

The review covered all commits reachable from local and remote refs after
`git fetch --all --prune`, all files present in those commits, deleted
pathnames, branch and remote-tracking ref names, commit subjects, and
author/committer metadata.

Remote-tracking refs after pruning were `origin/HEAD` and `origin/main`.
Local branches were also scanned so local-only reachable commits did not hide a
surprise.

This file intentionally repeats the accepted strings so later repository
searches land on the decision record. Those new occurrences are part of this
record, not a request to rewrite history.

## Real Exposure, Accepted

| Exposure | Commit(s) and file | Classification |
|---|---|---|
| Windows local home/checkout path: `C:\Users\cj\Documents\opensourcesai-cmdcenter`; website checkout path: `C:\Users\cj\Documents\opensourcesai.com` | `5349d1287e109a93f0d8fa8597163e79d4d03a8d:HANDOFF.md`; `7a7dc5a93937c23c0dc3b371f53056f1aea4ab57:HANDOFF.md`; `9649c2b954a8ea6aca912f1db28667ee90f02851:HANDOFF.md`; `2774759980c18774ccfed03bd87048ba84c46fa1:HANDOFF.md`; `41260c372a8b05a7388652785d993c8f1e6a0667:HANDOFF.md`; `132902d268b6d5e20026c6fd83f8c884be2f782f:HANDOFF.md`; `0c294f2c50c62c39925ec40154b2fc6c2cbc27e0:HANDOFF.md`; `37c0baa70ed560dc6da4a6132d65ade43a8d338c:HANDOFF.md`; `629622fe9ef748a1df78e23a6c16884c90982967:HANDOFF.md`; `0a6fdbe5953b058dc968423c63a2e5508aee32a0:HANDOFF.md`; `85bf7df6e435bbcf5983e58e0df9608849f50f2c:HANDOFF.md`; `577147ced3c53ed91fa06ad85e5761ab031e239d:HANDOFF.md`; `d4d5fa4dbec5185f57976d83ccf06aba1ba25080:HANDOFF.md`; `09234a2afc0666aec7a4d26ee77135cf311db77f:HANDOFF.md`. The path hits are on historical lines 12, 98, and 156. | Real exposure of local Windows paths. Accepted because these are not credentials and do not provide external access. Removed from the current tree by PR #16. |
| Lab document names and LAN/SSH aliases: `docs/lab/2570server-test-rig.md`, `docs/lab/macbook-air-m1-test-rig.md`, `2570server`, `macbook-air`, and "reachable over SSH" wording | Same `HANDOFF.md` commit/file list as the path exposure above. The lab-host hits are on historical line 160. | Real exposure of non-routable lab names and SSH aliases. Accepted because these are not credentials and do not provide external access. Removed from the current tree by PR #16. |
| Commit identity metadata: `cj zwart <cjzwart@yahoo.com>` and `GitHub <noreply@github.com>` | Present in commit metadata across the 35 reviewed commits | Real public identity metadata. Accepted as normal Git history. No `Claude`, `Anthropic`, or `noreply@anthropic.com` author, committer, or co-author trailer was found. |

## False Positives Reviewed

| Hit | Commit(s) and file(s) | Classification |
|---|---|---|
| `GITHUB_TOKEN`, `DATABASE_PASSWORD`, `API_KEY`, `SENTINEL_SECRET_VALUE_ZZZ`, and `https://user:` plus the sentinel in MCP tests | `8b78f7ad6c6ea4ed1a4cb700b857ed22cef0daae:test/tools.test.js` and descendant commits through `381837cbd62ab26f54672595f291a5d5daedf436:test/tools.test.js` | False positive. Synthetic redaction fixture and negative-control data; no real credential value is present. |
| `GITHUB_TOKEN` in collector comments and env-var-name handling | `8b78f7ad6c6ea4ed1a4cb700b857ed22cef0daae:src/collect/tools.js` and descendant commits through `381837cbd62ab26f54672595f291a5d5daedf436:src/collect/tools.js` | False positive. The collector keeps env var names and drops values; the string is an example name and test target. |
| `NPM_TOKEN`, `NODE_AUTH_TOKEN`, and `npm-token` in workflow guard tests | `59e6b6e5fe9fba9feb47ae5b69761f0758a67e99:test/package.test.js` and descendant commits through `381837cbd62ab26f54672595f291a5d5daedf436:test/package.test.js` | False positive. Negative-control regex that asserts CI workflows do not contain registry credentials. |
| `127.0.0.1`, `0.0.0.0`, `::1`, `[::1]`, and `localhost` | README, HANDOFF, fixtures, `src/collect/ollama.js`, `src/serve/security.js`, `src/serve/server.js`, and HTTP/security tests across history | False positive. These are loopback/wildcard literals used by the local-only server, Ollama host resolution, fixtures, and security tests. |
| `192.168.1.50` | `test/ollama-host.test.js` and `test/security.test.js` in commits containing those tests | False positive. Synthetic private-IP test data used to prove connect-target handling and host rejection. |
| `evil.com`, `attacker.test`, `127.0.0.1.evil.com`, and `mcp.example.com` | Security and MCP redaction tests in commits containing those tests | False positive. Reserved/example hostile-host and redaction-test domains. |
| `C:\Users\<name>`, `C:\Users\someone`, `C:\Users\wintel`, `/Users/<USER>`, `/Users/someone`, `/Users/t`, `/home/somebody`, `/home/someone`, `/home/nixuser`, and `/home/testuser` | `scripts/redact-fixture.mjs`, `fixtures/macos-m1-8gb.json`, `src/collect/tools.js`, and `test/tools.test.js` across history | False positive. Redacted placeholders and synthetic path data used to prove user-path removal. |
| `fixtures/website-design-tokens.json` | Historical path scan | False positive. "Token" refers to visual design tokens, not authentication credentials. |
| `Claude`, `CLAUDE.md`, and token-related wording in commit messages | `8b78f7ad6c6ea4ed1a4cb700b857ed22cef0daae` mentions Claude Desktop/Claude Code MCP config support and `GITHUB_TOKEN` as an env-var name; `7d997e05c344f329d382b78a1b14213ce0be0efb` and `05771302d20271f2582610ea7b619f0c274eedab` mention `CLAUDE.md` and session-token behavior; `4bf49ee07dd754bf47d510fbdd794e1c4af4df06`, `9624338f24f4ab071029cd984deca597e9b49cb1`, and `50d583c96aa5630e971f0d74f9abd5cb749044db` mention design tokens or session-token behavior. | False positive. These are product/config/test descriptions and security-boundary prose, not credentials and not AI authorship. |

## Negative Findings

- No actual `sk-`, `github_pat_`, `ghp_`, `gho_`, `AIza`, `xox[baprs]-`, private-key block, `SERVICE_ROLE`, or credential value was found.
- No `.env`, real MCP config, credential file, key file, certificate, or deleted high-risk credential path was found.
- `git log --all --diff-filter=D --name-status` produced no deleted file entries.
- Branch names and commit subjects did not contain the accepted path/hostname exposure, secret-shaped patterns, or Claude/Anthropic attribution.
- Commit author/committer metadata contained only `cj zwart <cjzwart@yahoo.com>` and `GitHub <noreply@github.com>`.

## Standing Rule

If future maintainers find the accepted historical `C:\Users\cj`, `2570server`,
or `macbook-air` strings in old commits, do not rewrite repository history on
that basis. The exposure was reviewed and accepted deliberately on 2026-08-03.
