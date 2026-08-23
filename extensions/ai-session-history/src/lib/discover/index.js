import { normPath } from "../sessions/scan/helpers.js";
import { listGrokPaths } from "./grok.js";
import { listClaudePaths } from "./claude.js";
import { listCodexPaths } from "./codex.js";
import { listCopilotPaths } from "./copilot.js";
import { listOpenCodePaths } from "./opencode.js";

/**
 * Providers that can reverse-map a session store to a project directory.
 * Cursor is intentionally absent: its store dir is `md5(cwd)` and no readable
 * field records the original path, so the cwd cannot be recovered.
 */
export const PROVIDERS = [
  { id: "grok", label: "Grok", list: listGrokPaths },
  { id: "claude", label: "Claude Code", list: listClaudePaths },
  { id: "codex", label: "Codex", list: listCodexPaths },
  { id: "copilot", label: "Copilot", list: listCopilotPaths },
  { id: "opencode", label: "OpenCode", list: listOpenCodePaths },
];

/**
 * @typedef {Object} DiscoveredProject
 * @property {string} path            Normalized absolute project path.
 * @property {string[]} providers     Provider ids that reference this path.
 */

/**
 * Scan every supported provider's session store and collect the distinct set of
 * project directories they ran in. **Synchronous**: designed for the `runScript`
 * context where `muxy.exec` (and therefore the whole host-fs layer) is
 * synchronous. A provider that throws is recorded and skipped; the rest still
 * return.
 *
 * @param {*} fs  HostFs backed by a synchronous exec
 * @param {{ home?: string, sqliteAvailable?: boolean }} [opts]
 * @returns {{ projects: DiscoveredProject[], errorsByProvider: Record<string, string> }}
 */
export function collectProjects(fs, opts = {}) {
  const scanOpts = { home: opts.home, sqliteAvailable: opts.sqliteAvailable };
  /** @type {Map<string, Set<string>>} normPath -> provider ids */
  const byPath = new Map();
  /** @type {Record<string, string>} */
  const errorsByProvider = {};

  for (const provider of PROVIDERS) {
    let paths;
    try {
      paths = provider.list(fs, scanOpts);
      if (paths && typeof paths.then === "function") {
        // The synchronous collector requires a synchronous exec.
        throw new Error("provider returned a promise (async exec unsupported)");
      }
    } catch (err) {
      errorsByProvider[provider.id] = err?.message || String(err);
      continue;
    }
    for (const raw of paths || []) {
      const norm = normPath(raw);
      if (!norm || !norm.startsWith("/")) continue;
      let set = byPath.get(norm);
      if (!set) byPath.set(norm, (set = new Set()));
      set.add(provider.id);
    }
  }

  const projects = [...byPath.entries()]
    .map(([path, providers]) => ({ path, providers: [...providers] }))
    .sort((a, b) => b.providers.length - a.providers.length || a.path.localeCompare(b.path));

  return { projects, errorsByProvider };
}

/**
 * Normalized paths of the projects Muxy already knows about.
 * @param {Array<{ path?: string }>} projectsList  from muxy.projects.list()
 * @returns {Set<string>}
 */
export function registeredPathSet(projectsList) {
  const set = new Set();
  for (const p of projectsList || []) {
    const norm = normPath(p?.path);
    if (norm) set.add(norm);
  }
  return set;
}

/**
 * Discovered projects that are not already registered. Pure.
 * @param {Array<{ path: string, providers: string[] }>} discovered
 * @param {Set<string>} registeredSet
 * @returns {Array<{ path: string, providers: string[] }>}
 */
export function filterNew(discovered, registeredSet) {
  return (discovered || []).filter((d) => {
    const norm = normPath(d.path);
    return norm && !registeredSet.has(norm);
  });
}
