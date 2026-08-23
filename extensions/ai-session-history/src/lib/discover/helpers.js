/**
 * Pure helpers for reverse-mapping AI session stores to project directories.
 * No host I/O. Shares regexes / normPath / mapSeq / tryChain with the session
 * scanners (../sessions/scan/helpers.js); only the path-recovery bits that the
 * scanners don't already have live here.
 */

import { normPath } from "../sessions/scan/helpers.js";

/**
 * Reverse Grok's session dir name (Python `urllib.parse.quote(cwd, safe="")`)
 * back to an absolute path. Returns null when the name is not valid encoding.
 * @param {string} name
 * @returns {string | null}
 */
export function decodeGrokDir(name) {
  if (!name || typeof name !== "string") return null;
  try {
    const decoded = decodeURIComponent(name);
    // A real cwd is absolute; ignore stray non-path dirs.
    return decoded.startsWith("/") ? normPath(decoded) : null;
  } catch {
    return null;
  }
}

/**
 * Extract the recorded cwd from a Claude Code session JSONL head.
 * Scans the first records for the first `cwd` string.
 * @param {string} text
 * @returns {string | null}
 */
export function claudeCwdFromJsonl(text) {
  const lines = String(text || "").split("\n");
  for (let i = 0; i < lines.length && i <= 200; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    if (rec && typeof rec === "object" && typeof rec.cwd === "string" && rec.cwd) {
      return rec.cwd;
    }
  }
  return null;
}

/**
 * Extract the session_meta payload cwd from a Codex rollout JSONL head.
 * @param {string} text
 * @returns {string | null}
 */
export function codexCwdFromRollout(text) {
  const lines = String(text || "").split("\n");
  for (let i = 0; i < lines.length && i < 20; i++) {
    let rec;
    try {
      rec = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (
      rec &&
      typeof rec === "object" &&
      rec.type === "session_meta" &&
      rec.payload &&
      typeof rec.payload === "object" &&
      typeof rec.payload.cwd === "string"
    ) {
      const src = rec.payload.source;
      if (src != null && src !== "cli" && src !== "vscode") return null;
      return rec.payload.cwd || null;
    }
  }
  return null;
}

/**
 * Flatten a thenable-or-array of raw paths into a de-duped, normalized set of
 * absolute paths.
 * @param {Iterable<string | null | undefined>} paths
 * @returns {string[]}
 */
export function dedupePaths(paths) {
  const seen = new Set();
  const out = [];
  for (const p of paths || []) {
    const norm = normPath(p);
    if (!norm || !norm.startsWith("/") || seen.has(norm)) continue;
    seen.add(norm);
    out.push(norm);
  }
  return out;
}
