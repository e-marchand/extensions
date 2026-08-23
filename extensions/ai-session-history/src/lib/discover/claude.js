import { joinPath, chain, expandUserPath } from "../host-fs.js";
import { mapSeq, tryChain } from "../sessions/scan/helpers.js";
import { claudeCwdFromJsonl, dedupePaths } from "./helpers.js";

/**
 * Resolve the Claude config dir (CLAUDE_CONFIG_DIR or ~/.claude).
 * @param {*} fs
 * @param {{ home?: string, claudeConfigDir?: string | null }} opts
 */
function resolveClaudeBase(fs, opts) {
  if (opts.claudeConfigDir) return opts.claudeConfigDir;
  return chain(fs.env("CLAUDE_CONFIG_DIR"), (envDir) => {
    const homeP = opts.home != null ? opts.home : fs.homeDir();
    if (envDir) {
      return chain(homeP, (home) => expandUserPath(envDir, home) || envDir);
    }
    return chain(homeP, (home) => joinPath(home, ".claude"));
  });
}

/**
 * Discover every project cwd Claude Code has sessions for.
 *
 * Claude's project dir name is a lossy `slugify(cwd)` (not reversible), so the
 * real path is read from the newest `.jsonl` transcript head in each project dir.
 * One `listDirDetailed` + one `readHead` per project directory.
 *
 * @param {*} fs  HostFs
 * @param {{ home?: string, claudeConfigDir?: string | null }} [opts]
 * @returns {string[] | Promise<string[]>}
 */
export function listClaudePaths(fs, opts = {}) {
  return chain(resolveClaudeBase(fs, opts), (base) => {
    const projects = joinPath(base, "projects");
    return chain(tryChain(() => fs.listDirDetailed(projects), []), (dirs) => {
      const projectDirs = (dirs || [])
        .filter((e) => e.kind === "dir")
        .map((e) => joinPath(projects, e.name));

      return chain(
        mapSeq(projectDirs, (dir) => cwdFromProjectDir(fs, dir)),
        (paths) => dedupePaths(paths),
      );
    });
  });
}

/**
 * Read the cwd from the newest transcript in one Claude project dir.
 * @param {*} fs
 * @param {string} dir
 * @returns {(string | null) | Promise<string | null>}
 */
function cwdFromProjectDir(fs, dir) {
  return chain(tryChain(() => fs.listDirDetailed(dir), []), (files) => {
    const jsonl = (files || [])
      .filter((f) => f.kind === "file" && f.name.endsWith(".jsonl"))
      .sort((a, b) => (b.mtimeMs || 0) - (a.mtimeMs || 0));
    if (!jsonl.length) return null;
    const path = joinPath(dir, jsonl[0].name);
    return chain(
      tryChain(() => fs.readHead(path, { maxBytes: 256_000 }), null),
      (head) => (head == null ? null : claudeCwdFromJsonl(head)),
    );
  });
}
