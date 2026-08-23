import { joinPath, chain, expandUserPath } from "../host-fs.js";
import {
  CODEX_MAX_DIRS_WALKED,
  CODEX_ROLLOUT_RE,
  mapSeq,
  tryChain,
} from "../sessions/scan/helpers.js";
import { codexCwdFromRollout, dedupePaths } from "./helpers.js";

/**
 * Resolve the Codex home (CODEX_HOME or ~/.codex).
 * @param {*} fs
 * @param {{ home?: string, codexHome?: string | null }} opts
 */
function resolveCodexHome(fs, opts) {
  if (opts.codexHome) return opts.codexHome;
  return chain(fs.env("CODEX_HOME"), (envHome) => {
    const homeP = opts.home != null ? opts.home : fs.homeDir();
    if (envHome) {
      return chain(homeP, (home) => expandUserPath(envHome, home) || envHome);
    }
    return chain(homeP, (home) => joinPath(home, ".codex"));
  });
}

/**
 * Distinct cwds from the newest `state_<N>.sqlite` threads table.
 * @param {*} fs
 * @param {string} home
 * @returns {(string[] | null) | Promise<string[] | null>}  null = no usable DB
 */
function codexPathsFromDb(fs, home) {
  return chain(tryChain(() => fs.listDirDetailed(home), null), (entries) => {
    if (!entries) return null;
    const dbs = [];
    for (const e of entries) {
      if (e.kind !== "file") continue;
      const m = /^state_(\d+)\.sqlite$/.exec(e.name);
      if (m) dbs.push({ n: Number(m[1]), path: joinPath(home, e.name) });
    }
    if (!dbs.length) return null;
    dbs.sort((a, b) => b.n - a.n);
    const dbPath = dbs[0].path;

    return chain(tryChain(() => fs.sqliteTableColumns(dbPath, "threads"), null), (cols) => {
      if (!cols || !cols.has("cwd")) return null;
      const sourcePred = cols.has("source")
        ? " AND source IN ('cli', 'vscode')"
        : "";
      const sql =
        `SELECT DISTINCT cwd FROM threads ` +
        `WHERE cwd IS NOT NULL AND cwd <> ''${sourcePred}`;
      return chain(tryChain(() => fs.sqliteQuery(dbPath, sql), null), (rows) => {
        if (!rows) return null;
        return rows.map((r) => r.cwd).filter((c) => typeof c === "string");
      });
    });
  });
}

/**
 * Bounded fallback: walk `~/.codex/sessions` rollout JSONLs for session_meta cwd.
 * @param {*} fs
 * @param {string} home
 * @returns {string[] | Promise<string[]>}
 */
function codexPathsFromRollouts(fs, home) {
  const root = joinPath(home, "sessions");
  return chain(fs.isDir(root), (ok) => {
    if (!ok) return [];
    /** @type {Array<{ path: string, mtimeMs: number }>} */
    const files = [];
    const stack = [root];
    let dirsWalked = 0;

    const walk = () => {
      if (!stack.length || dirsWalked >= CODEX_MAX_DIRS_WALKED) {
        files.sort((a, b) => (b.mtimeMs || 0) - (a.mtimeMs || 0));
        return chain(
          mapSeq(files, (f) =>
            chain(tryChain(() => fs.readHead(f.path, { maxBytes: 64_000 }), null), (head) =>
              head == null ? null : codexCwdFromRollout(head),
            ),
          ),
          (paths) => paths,
        );
      }
      const dir = stack.pop();
      dirsWalked++;
      return chain(tryChain(() => fs.listDirDetailed(dir), []), (entries) => {
        for (const e of entries || []) {
          const path = joinPath(dir, e.name);
          if (e.kind === "dir") {
            stack.push(path);
            continue;
          }
          if (e.kind !== "file" || e.name.endsWith(".zst")) continue;
          if (!CODEX_ROLLOUT_RE.test(e.name)) continue;
          files.push({ path, mtimeMs: e.mtimeMs || 0 });
        }
        return walk();
      });
    };
    return walk();
  });
}

/**
 * Discover every project cwd Codex has sessions for.
 * @param {*} fs  HostFs
 * @param {{ home?: string, codexHome?: string | null, sqliteAvailable?: boolean }} [opts]
 * @returns {string[] | Promise<string[]>}
 */
export function listCodexPaths(fs, opts = {}) {
  return chain(resolveCodexHome(fs, opts), (home) => {
    if (opts.sqliteAvailable === false) {
      return chain(codexPathsFromRollouts(fs, home), dedupePaths);
    }
    return chain(codexPathsFromDb(fs, home), (dbPaths) => {
      if (dbPaths == null) {
        return chain(codexPathsFromRollouts(fs, home), dedupePaths);
      }
      return dedupePaths(dbPaths);
    });
  });
}
