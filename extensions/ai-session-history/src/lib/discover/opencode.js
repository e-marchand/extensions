import { joinPath, chain, expandUserPath } from "../host-fs.js";
import { tryChain } from "../sessions/scan/helpers.js";
import { dedupePaths } from "./helpers.js";

/**
 * Resolve the OpenCode data dir (XDG_DATA_HOME/opencode or ~/.local/share/opencode).
 * @param {*} fs
 * @param {{ home?: string, dataDir?: string }} opts
 */
function resolveDataDir(fs, opts) {
  if (opts.dataDir) return opts.dataDir;
  return chain(fs.env("XDG_DATA_HOME"), (xdg) => {
    const homeP = opts.home != null ? opts.home : fs.homeDir();
    if (xdg) {
      return chain(homeP, (home) => joinPath(expandUserPath(xdg, home) || xdg, "opencode"));
    }
    return chain(homeP, (home) => joinPath(home, ".local", "share", "opencode"));
  });
}

/**
 * Pick the channel DB under the data dir (prefer opencode.db).
 * @param {*} fs
 * @param {string} dataDir
 * @param {string | null} dbEnv
 */
function resolveDbPath(fs, dataDir, dbEnv) {
  if (dbEnv) {
    if (dbEnv === ":memory:") return null;
    return dbEnv.startsWith("/") ? dbEnv : joinPath(dataDir, dbEnv);
  }
  const primary = joinPath(dataDir, "opencode.db");
  return chain(fs.isFile(primary), (ok) => {
    if (ok) return primary;
    return chain(tryChain(() => fs.listDir(dataDir), []), (names) => {
      const match = (names || []).find((n) => /^opencode(-[A-Za-z0-9._-]+)?\.db$/.test(n));
      return match ? joinPath(dataDir, match) : null;
    });
  });
}

/**
 * Discover every project directory OpenCode has sessions for.
 * @param {*} fs  HostFs
 * @param {{ home?: string, dataDir?: string, dbPath?: string, sqliteAvailable?: boolean }} [opts]
 * @returns {string[] | Promise<string[]>}
 */
export function listOpenCodePaths(fs, opts = {}) {
  if (opts.sqliteAvailable === false) return [];
  return chain(resolveDataDir(fs, opts), (dataDir) => {
    const dbP =
      opts.dbPath != null
        ? opts.dbPath
        : chain(fs.env("OPENCODE_DB"), (env) => resolveDbPath(fs, dataDir, env));
    return chain(dbP, (dbPath) => {
      if (!dbPath) return [];
      const sql =
        `SELECT DISTINCT directory FROM session ` +
        `WHERE (parent_id IS NULL OR parent_id = '') ` +
        `AND time_archived IS NULL ` +
        `AND directory IS NOT NULL AND directory <> ''`;
      return chain(tryChain(() => fs.sqliteQuery(dbPath, sql), []), (rows) => {
        return dedupePaths((rows || []).map((r) => r.directory));
      });
    });
  });
}
