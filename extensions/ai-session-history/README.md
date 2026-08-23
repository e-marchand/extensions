# AI Session History (Muxy extension)

Browse and resume AI coding-agent sessions for the **active worktree**, grouped by provider.

Supports **Grok**, **Claude Code**, **Codex**, **GitHub Copilot CLI**, **Cursor Agent**, and **OpenCode** when those binaries are on `PATH`.

## Features

- **Multi-provider list** — detects installed CLIs; default **All** view groups sessions by tool
- **Filter chips** — Muxy provider icons + labels; narrow to one provider
- **Readable titles** — Copilot uses `data.db` / `workspace.yaml` / first user message (never bare UUID alone)
- **Rename / delete** — capability-gated per CLI; rename and delete confirm are **inline in the panel** (no host prompt/confirm UI)
- **Resume** — opens a new terminal in the active worktree and runs the CLI’s resume command
- **Start new** — split button: primary starts the last-chosen / first-available CLI; chevron picks which CLI (stored in extension storage)
- **Palette** — **AI Sessions: Resume…** searchable modal across all installed providers
- **Import projects** — **AI Sessions: Import Projects…** scans every provider's session store, recovers the distinct project folders those sessions ran in, and registers the ones you pick as Muxy projects (the inverse of the panel; see below)

## Requirements

- **POSIX host tools** on the machine where sessions live (local or SSH remote), used via `muxy.exec` with fixed absolute paths:
  - `/bin/cat`, `/bin/ls`, `/bin/mv`, `/bin/rm`, `/bin/mkdir`
  - `/usr/bin/tee`, `/usr/bin/env`, `/usr/bin/printenv`, `/usr/bin/head`, `/usr/bin/stat`
- **`/usr/bin/sqlite3`** for **Codex**, **Copilot**, and **OpenCode** session stores (soft-fails those providers if missing; other CLIs still work)
- macOS ships these with the base system / Xcode CLT; Linux remotes need equivalent coreutils + `sqlite3`

`muxy.files` is worktree-sandboxed and **cannot** read `~/.grok`, `~/.claude`, etc. — home session stores are always reached through `commands:exec`.

## Install (dev)

```bash
cd /path/to/ai-session-history
npm install
npm run build
```

In Muxy: **Extensions → Load Unpacked** → select this folder (or `dist/` after publish-style install). Grant permissions when prompted (`commands:exec`, `tabs:write`, etc.).

### First-open exec consent

Session listing uses `muxy.exec` against home-directory stores (not the worktree sandbox). Muxy prompts for **runtime consent** per base binary (`argvPrefix`). On first open you may see prompts for:

- `/bin/bash` — CLI detection (`command -v`)
- `/bin/ls`, `/usr/bin/stat`, `/usr/bin/head`, `/usr/bin/printenv` — directory listing and session metadata
- `/usr/bin/sqlite3` — Codex / Copilot / OpenCode stores
- `/bin/cat`, `/usr/bin/tee`, `/bin/mv`, … — rename/delete

Choose **Allow & remember** for each (or the scan will re-prompt on every call if you only tap **Allow**). After grants, scanners batch directory metadata and cap how many session files are opened.

Toggle the panel with the topbar clock icon or **⌘⇧H**.

## How history is resolved

Sessions are **not** from `muxy.agents.list()` (live status only). The extension runs **pure JavaScript** scanners over host tools against each CLI’s on-disk store under your home directory, scoped to the active worktree path:

| CLI | Store (typical) | Resume command |
| --- | --- | --- |
| Grok | `~/.grok/sessions/<urlencode(cwd)>/` | `grok --resume <id>` |
| Claude | `~/.claude/projects/<slug>/` | `claude --resume <id>` |
| Codex | `~/.codex/` (SQLite / rollouts) | `codex resume <id>` |
| Copilot | `~/.copilot/session-state/`, `session-store.db` / `data.db` | `copilot --resume=<id>` |
| Cursor | `~/.cursor/chats/<md5(cwd)>/` | `cursor-agent --resume <id>` |
| OpenCode | `~/.local/share/opencode/opencode.db` | `opencode --session <id>` |

### Capabilities

| CLI | Rename | Delete |
| --- | --- | --- |
| Grok | yes | yes |
| Claude | no | yes |
| Codex | yes (`threads.title`) | no |
| Copilot | yes (db + workspace.yaml + meta) | no |
| Cursor | yes | yes |
| OpenCode | yes (`session.title`) | yes (DB row) |

Only **installed** binaries appear as chips. Empty providers are omitted. If one adapter fails, others still show.

### Copilot discovery (project-complete)

Copilot session dirs live in a **global** `~/.copilot/session-state/` tree (not one folder per project). Listing for the active worktree:

1. **Index (preferred):** when `sqlite3` is available, query allowlisted path columns on `session-store.db` / `data.db` (`sessions` and `workspaces`) for the active cwd. DB rows are an index only.
2. **FS evidence:** for each candidate id that still has a `session-state/<id>/` directory, re-read `workspace.yaml` / `meta.json`, require `pathMatchesCwd`, and require resume evidence (non-empty `events.jsonl` and/or `turns` rows).
3. **Residual budget:** dirs not already selected via the DB are considered in mtime order up to `COPILOT_MAX_STATE_DIRS` (100) expensive probes — so incomplete DBs still find recent sessions without scanning every foreign dir forever.
4. **No silent 25-cap:** all resumable sessions for the worktree are returned (newest first). The panel keeps a soft cap of 80 for *other* providers by recency, independent of Copilot size, and **never drops** the cwd-complete Copilot list (filter chip or All).

Without sqlite (or without path columns), only the residual mtime wave runs — large multi-project homes may underfill older sessions for the active cwd until the DB index is available.

## Import projects from sessions (reverse mapping)

**AI Sessions: Import Projects…** (palette or the topbar `folder.badge.plus` icon)
is the **inverse** of the panel: instead of listing sessions for the active
project, it scans **every** provider's session store, collects the distinct
project directories those sessions ran in, and lets you register the ones you
pick as Muxy projects — skipping anything already registered.

A native picker lists the discovered folders that aren't registered yet. Pick
**Add all N projects**, or add them one at a time (the picker reopens with the
rest; press **Esc** when done). Each row shows which providers have sessions
there. Folders that no longer exist on disk are skipped, and you're returned to
the project you started from.

It reuses the same host-fs and pure-JS scan helpers as the panel, so path
recovery per provider is:

| CLI | Path recovery |
| --- | --- |
| Grok | Decode the `urlencode(cwd)` dir name — no file reads |
| Claude | Read the newest transcript head for the recorded `cwd` |
| Codex | `SELECT DISTINCT cwd` from the newest `state_*.sqlite` (JSONL rollout fallback) |
| Copilot | Distinct path columns in the DBs + `session-state/*/workspace.yaml` |
| OpenCode | `SELECT DISTINCT directory` from `opencode.db` |

**Cursor is not supported** for this reverse-mapping: its store directory is an
`md5(cwd)` hash and no readable field records the original path, so the project
directory cannot be recovered. It runs as a
[`runScript`](https://muxy.app/docs/extensions/scripts) command (not a panel)
because `muxy.projects.add` switches the active project — which would tear down a
live panel mid-batch — so the whole batch registers reliably in one synchronous
pass. Requires the `projects:write` permission.

## Remote workspaces

On SSH / remote Muxy workspaces, `muxy.exec` runs on the **remote** host. You see remote session stores, not Mac-local history from a local-only CLI. Remotes need the same host tools (and `sqlite3` for Codex/Copilot).

## Security

- Titles are sanitized for display (transcripts are untrusted).
- Resume commands use **session ids only** (validated), never free-text titles.
- First terminal auto-run requires Muxy’s **tabs.runCommand** consent (Allow & remember recommended per CLI).

## Development

```bash
npm run build   # required for Muxy Reload to pick up changes
npm test        # Bun unit + fixture tests (no Muxy runtime)
```

Build copies `package.json` into `dist/` and bundles the resume-picker IIFE from shared scan modules (publish pipeline ships only `dist/`).

## Layout

```
src/panel/app.js                 # panel UI (chips, groups, rows)
src/lib/host-fs.js               # createHostFs(exec) over fixed host binaries
src/lib/sessions/                # detection, grouping, manage/scan façade
src/lib/sessions/scan/*          # per-provider pure JS scanners
src/lib/sessions/manage/*        # rename / delete via host-fs
src/lib/discover/*               # per-provider "distinct project paths" (reverse of scan)
src/lib/discover/index.js        # collectProjects + registered-set diff (synchronous)
src/lib/provider-icons.js        # vendored monochrome Muxy ProviderIcons
src/assets/provider-icons/       # SVG sources (re-copy from muxy core if needed)
scripts/resume-picker-entry.js   # Resume… palette entry (bundled to IIFE)
scripts/import-projects-entry.js # Import Projects… palette entry (bundled to IIFE)
scripts/*.built.js               # built IIFEs for runScript
test/                            # Bun tests (host-fs, scan, manage, discover, helpers)
```
