import { joinPath, chain } from "../host-fs.js";
import { tryChain } from "../sessions/scan/helpers.js";
import { decodeGrokDir, dedupePaths } from "./helpers.js";

/**
 * Discover every project cwd Grok has sessions for.
 *
 * Grok stores sessions under `~/.grok/sessions/<urlencode(cwd)>/<uuid>/`, so the
 * project path is fully recoverable from each top-level dir name — no file reads.
 *
 * @param {*} fs  HostFs
 * @param {{ home?: string }} [opts]
 * @returns {string[] | Promise<string[]>}
 */
export function listGrokPaths(fs, opts = {}) {
  const homeP = opts.home != null ? opts.home : fs.homeDir();
  return chain(homeP, (home) => {
    const root = joinPath(home, ".grok", "sessions");
    return chain(tryChain(() => fs.listDirDetailed(root), []), (entries) => {
      const paths = [];
      for (const e of entries || []) {
        if (e.kind !== "dir") continue;
        const decoded = decodeGrokDir(e.name);
        if (decoded) paths.push(decoded);
      }
      return dedupePaths(paths);
    });
  });
}
