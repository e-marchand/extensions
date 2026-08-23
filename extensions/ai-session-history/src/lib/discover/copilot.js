import { joinPath, chain, expandUserPath } from "../host-fs.js";
import {
  COPILOT_MAX_STATE_DIRS,
  mapSeq,
  parseSimpleYaml,
  tryChain,
} from "../sessions/scan/helpers.js";
import { dedupePaths } from "./helpers.js";

/** Path-like columns allowed after PRAGMA discovery (never free-form SQL). */
const PATH_COL_CANDIDATES = [
  "cwd",
  "path",
  "workspace_path",
  "workspacePath",
  "directory",
  "workspace",
];

const DB_NAMES = ["session-store.db", "data.db"];
const PATH_TABLES = ["sessions", "workspaces"];

/**
 * Resolve the Copilot home (COPILOT_HOME or ~/.copilot).
 * @param {*} fs
 * @param {{ home?: string, copilotHome?: string | null }} opts
 */
function resolveCopilotHome(fs, opts) {
  if (opts.copilotHome) return opts.copilotHome;
  return chain(fs.env("COPILOT_HOME"), (envHome) => {
    const homeP = opts.home != null ? opts.home : fs.homeDir();
    if (envHome) {
      return chain(homeP, (home) => expandUserPath(envHome, home) || envHome);
    }
    return chain(homeP, (home) => joinPath(home, ".copilot"));
  });
}

/**
 * Distinct workspace paths from allowlisted path columns in the Copilot DBs.
 * @param {*} fs
 * @param {string} home
 * @returns {string[] | Promise<string[]>}
 */
function copilotPathsFromDb(fs, home) {
  /** @type {string[]} */
  const found = [];
  return chain(
    mapSeq(DB_NAMES, (dbName) => {
      const dbPath = joinPath(home, dbName);
      return chain(fs.isFile(dbPath), (isFile) => {
        if (!isFile) return null;
        return chain(tryChain(() => fs.sqliteTables(dbPath), null), (tables) => {
          if (!tables) return null;
          return mapSeq(PATH_TABLES, (table) => {
            if (!tables.has(table)) return null;
            return chain(
              tryChain(() => fs.sqliteTableColumns(dbPath, table), null),
              (cols) => {
                if (!cols) return null;
                const pathCol = PATH_COL_CANDIDATES.find((c) => cols.has(c));
                if (!pathCol) return null;
                const sql =
                  `SELECT DISTINCT ${pathCol} AS p FROM ${table} ` +
                  `WHERE ${pathCol} IS NOT NULL AND ${pathCol} <> ''`;
                return chain(tryChain(() => fs.sqliteQuery(dbPath, sql), []), (rows) => {
                  for (const r of rows || []) {
                    if (typeof r.p === "string" && r.p) found.push(r.p);
                  }
                  return null;
                });
              },
            );
          });
        });
      });
    }),
    () => found,
  );
}

/**
 * Bounded FS fallback: read `session-state/<id>/workspace.yaml` for cwd/path.
 * @param {*} fs
 * @param {string} home
 * @returns {string[] | Promise<string[]>}
 */
function copilotPathsFromState(fs, home) {
  const state = joinPath(home, "session-state");
  return chain(tryChain(() => fs.listDirDetailed(state), []), (entries) => {
    const dirs = (entries || [])
      .filter((e) => e.kind === "dir")
      .sort((a, b) => (b.mtimeMs || 0) - (a.mtimeMs || 0))
      .slice(0, COPILOT_MAX_STATE_DIRS);
    return chain(
      mapSeq(dirs, (e) => {
        const yaml = joinPath(state, e.name, "workspace.yaml");
        return chain(tryChain(() => fs.readHead(yaml, { maxBytes: 64_000 }), null), (text) => {
          if (!text) return null;
          const data = parseSimpleYaml(text);
          return data.cwd || data.path || null;
        });
      }),
      (paths) => paths,
    );
  });
}

/**
 * Discover every project cwd GitHub Copilot CLI has sessions for.
 * @param {*} fs  HostFs
 * @param {{ home?: string, copilotHome?: string | null, sqliteAvailable?: boolean }} [opts]
 * @returns {string[] | Promise<string[]>}
 */
export function listCopilotPaths(fs, opts = {}) {
  return chain(resolveCopilotHome(fs, opts), (home) => {
    const dbP =
      opts.sqliteAvailable === false ? [] : tryChain(() => copilotPathsFromDb(fs, home), []);
    return chain(dbP, (dbPaths) => {
      return chain(tryChain(() => copilotPathsFromState(fs, home), []), (statePaths) => {
        return dedupePaths([...(dbPaths || []), ...(statePaths || [])]);
      });
    });
  });
}
