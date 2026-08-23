import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createHostFs } from "../src/lib/host-fs.js";
import { listGrokPaths } from "../src/lib/discover/grok.js";
import { listClaudePaths } from "../src/lib/discover/claude.js";
import { listCodexPaths } from "../src/lib/discover/codex.js";
import { listCopilotPaths } from "../src/lib/discover/copilot.js";
import { listOpenCodePaths } from "../src/lib/discover/opencode.js";
import { collectProjects, filterNew, registeredPathSet } from "../src/lib/discover/index.js";

const SID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const SQLITE = "/usr/bin/sqlite3";

// Strip env vars that would redirect store resolution away from the temp HOME,
// so discovery is deterministic regardless of the host's real config.
const SCRUBBED_ENV = (() => {
  const e = { ...process.env };
  for (const k of [
    "CLAUDE_CONFIG_DIR",
    "CODEX_HOME",
    "COPILOT_HOME",
    "XDG_DATA_HOME",
    "OPENCODE_DB",
  ]) {
    delete e[k];
  }
  return e;
})();

function realExec(argv, opts = {}) {
  const result = spawnSync(argv[0], argv.slice(1), {
    input: opts.stdin,
    encoding: "utf8",
    timeout: opts.timeoutMs ?? 20000,
    env: SCRUBBED_ENV,
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status ?? 1,
  };
}

function sqlite(dbPath, sql) {
  const r = spawnSync(SQLITE, [dbPath], { input: sql, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`sqlite fixture failed: ${r.stderr || r.stdout}`);
}

function urlquote(s) {
  // Python quote(safe="") — encode everything but A-Za-z0-9_.-
  return [...Buffer.from(s, "utf8")]
    .map((b) => {
      const ch = String.fromCharCode(b);
      return /[A-Za-z0-9_.-]/.test(ch)
        ? ch
        : "%" + b.toString(16).toUpperCase().padStart(2, "0");
    })
    .join("");
}

const fs = createHostFs(realExec);
let home;

before(() => {
  home = mkdtempSync(join(tmpdir(), "aish-discover-"));

  // Grok: ~/.grok/sessions/<urlencode(cwd)>/<uuid>/
  const grokCwds = ["/tmp/grok-proj-a", "/tmp/grok proj b"];
  for (const cwd of grokCwds) {
    mkdirSync(join(home, ".grok", "sessions", urlquote(cwd), SID), { recursive: true });
  }

  // Claude: ~/.claude/projects/<slug>/<uuid>.jsonl with recorded cwd
  const claudeDir = join(home, ".claude", "projects", "-tmp-claude-proj");
  mkdirSync(claudeDir, { recursive: true });
  writeFileSync(
    join(claudeDir, `${SID}.jsonl`),
    [
      JSON.stringify({ type: "summary", summary: "x" }),
      JSON.stringify({ type: "user", cwd: "/tmp/claude-real", message: { content: "hi" } }),
    ].join("\n"),
  );

  // Codex: ~/.codex/state_1.sqlite threads table
  mkdirSync(join(home, ".codex"), { recursive: true });
  const codexDb = join(home, ".codex", "state_1.sqlite");
  sqlite(
    codexDb,
    "CREATE TABLE threads(id TEXT, source TEXT, cwd TEXT, updated_at_ms INTEGER, title TEXT);" +
      `INSERT INTO threads VALUES('${SID}','cli','/tmp/codex-a',1,'t');` +
      `INSERT INTO threads VALUES('${SID}','cli','/tmp/codex-a',2,'t2');` +
      `INSERT INTO threads VALUES('${SID}','vscode','/tmp/codex-b',3,'t3');` +
      `INSERT INTO threads VALUES('${SID}','exec','/tmp/codex-hidden',4,'t4');`,
  );

  // Copilot: ~/.copilot/session-store.db (sessions.path + workspaces.cwd)
  mkdirSync(join(home, ".copilot"), { recursive: true });
  const copilotDb = join(home, ".copilot", "session-store.db");
  sqlite(
    copilotDb,
    "CREATE TABLE sessions(id TEXT, path TEXT);" +
      "CREATE TABLE workspaces(session_id TEXT, cwd TEXT);" +
      "INSERT INTO sessions VALUES('s1','/tmp/copilot-a');" +
      "INSERT INTO sessions VALUES('s2','/tmp/copilot-a');" +
      "INSERT INTO workspaces VALUES('s3','/tmp/copilot-b');",
  );

  // OpenCode: ~/.local/share/opencode/opencode.db session table
  const ocDir = join(home, ".local", "share", "opencode");
  mkdirSync(ocDir, { recursive: true });
  const ocDb = join(ocDir, "opencode.db");
  sqlite(
    ocDb,
    "CREATE TABLE session(id TEXT, title TEXT, directory TEXT, time_updated INTEGER, time_archived INTEGER, parent_id TEXT);" +
      "INSERT INTO session VALUES('ses_aaaa','t','/tmp/oc-a',1,NULL,NULL);" +
      "INSERT INTO session VALUES('ses_bbbb','t','/tmp/oc-a',2,NULL,'');" +
      "INSERT INTO session VALUES('ses_cccc','t','/tmp/oc-archived',3,5,NULL);" +
      "INSERT INTO session VALUES('ses_dddd','t','/tmp/oc-child',4,NULL,'ses_aaaa');",
  );
});

after(() => {
  if (home) rmSync(home, { recursive: true, force: true });
});

describe("grok discovery", () => {
  it("decodes every session cwd from dir names", async () => {
    const paths = await listGrokPaths(fs, { home });
    assert.deepEqual(paths.sort(), ["/tmp/grok proj b", "/tmp/grok-proj-a"].sort());
  });
});

describe("claude discovery", () => {
  it("recovers the real cwd from the transcript (not the lossy slug)", async () => {
    const paths = await listClaudePaths(fs, { home });
    assert.deepEqual(paths, ["/tmp/claude-real"]);
  });
});

describe("codex discovery", () => {
  it("returns distinct cli/vscode cwds and hides other sources", async () => {
    const paths = await listCodexPaths(fs, { home, sqliteAvailable: true });
    assert.deepEqual(paths.sort(), ["/tmp/codex-a", "/tmp/codex-b"].sort());
    assert.ok(!paths.includes("/tmp/codex-hidden"));
  });
});

describe("copilot discovery", () => {
  it("unions distinct path columns across sessions + workspaces", async () => {
    const paths = await listCopilotPaths(fs, { home, sqliteAvailable: true });
    assert.deepEqual(paths.sort(), ["/tmp/copilot-a", "/tmp/copilot-b"].sort());
  });
});

describe("opencode discovery", () => {
  it("returns distinct top-level, non-archived directories", async () => {
    const paths = await listOpenCodePaths(fs, { home, sqliteAvailable: true });
    assert.deepEqual(paths, ["/tmp/oc-a"]);
  });
});

describe("collectProjects (aggregate, synchronous)", () => {
  it("merges + dedupes across providers and tags each with its providers", () => {
    const result = collectProjects(fs, { home, sqliteAvailable: true });
    const byPath = Object.fromEntries(result.projects.map((p) => [p.path, p.providers.sort()]));
    assert.deepEqual(byPath["/tmp/codex-a"], ["codex"]);
    assert.deepEqual(byPath["/tmp/oc-a"], ["opencode"]);
    assert.ok(byPath["/tmp/grok-proj-a"]);
    assert.ok(byPath["/tmp/claude-real"]);
    // No duplicate path entries.
    const paths = result.projects.map((p) => p.path);
    assert.equal(new Set(paths).size, paths.length);
  });

  it("returns a plain (non-promise) value under a synchronous exec", () => {
    const result = collectProjects(fs, { home, sqliteAvailable: true });
    assert.equal(typeof result.then, "undefined");
    assert.ok(Array.isArray(result.projects));
  });
});

describe("select", () => {
  it("registeredPathSet normalizes project paths", () => {
    const set = registeredPathSet([{ path: "/x//y/" }, { path: "/z" }, { path: "" }, {}]);
    assert.ok(set.has("/x/y"));
    assert.ok(set.has("/z"));
    assert.equal(set.size, 2);
  });

  it("filterNew drops already-registered paths", () => {
    const discovered = [
      { path: "/a", providers: ["grok"] },
      { path: "/b", providers: ["codex"] },
      { path: "/c//", providers: ["claude"] },
    ];
    const out = filterNew(discovered, new Set(["/b", "/c"]));
    assert.deepEqual(out.map((d) => d.path), ["/a"]);
  });
});
