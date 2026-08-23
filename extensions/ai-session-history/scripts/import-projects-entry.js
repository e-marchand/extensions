/**
 * Palette command entry — "AI Sessions: Import Projects…".
 *
 * The inverse of the resume picker: instead of listing sessions for the active
 * project, it scans every provider's session store, recovers the distinct
 * project directories those sessions ran in, and registers the ones you pick as
 * Muxy projects (skipping anything already registered).
 *
 * Runs in Muxy's synchronous runScript (JavaScriptCore) context, which is
 * independent of the per-project extension-panel lifecycle. That matters:
 * `muxy.projects.add` makes each new project the active one, and switching the
 * active project tears down live extension panels — so the add loop can only
 * complete reliably here, not in a panel webview.
 *
 * Built to a single IIFE via esbuild (see scripts/copy-manifest.mjs).
 */
import { createHostFs, ensureHostTools, hasSqlite3 } from "../src/lib/host-fs.js";
import {
  collectProjects,
  filterNew,
  registeredPathSet,
  PROVIDERS,
} from "../src/lib/discover/index.js";

const PROVIDER_LABELS = Object.fromEntries(PROVIDERS.map((p) => [p.id, p.label]));

function basename(path) {
  const parts = String(path).replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || path;
}

function alert(message) {
  try {
    muxy.dialog.alert({ title: "AI Sessions", message });
  } catch {
    /* dialog unavailable — nothing else to do */
  }
}

(function main() {
  const exec = (argv, options) => muxy.exec(argv, options);

  let hasTools = false;
  try {
    hasTools = ensureHostTools(exec);
  } catch {
    hasTools = false;
  }
  if (!hasTools) {
    alert(
      "Host tools (ls, stat, cat, sqlite3, …) are required to read AI session stores. Install coreutils / Xcode CLT and try again.",
    );
    return;
  }

  const fs = createHostFs(exec);

  let home;
  try {
    home = fs.homeDir();
  } catch {
    home = undefined;
  }
  if (home != null && typeof home.then === "function") {
    alert("Host filesystem is async in runScript; cannot discover projects.");
    return;
  }

  let sqliteAvailable = true;
  try {
    sqliteAvailable = hasSqlite3(exec);
  } catch {
    sqliteAvailable = false;
  }
  if (sqliteAvailable != null && typeof sqliteAvailable.then === "function") {
    sqliteAvailable = true;
  }

  const { projects } = collectProjects(fs, { home, sqliteAvailable: Boolean(sqliteAvailable) });

  // Existing projects (to skip) + where the user started (to return to).
  let registered = new Set();
  let originalActiveId = null;
  try {
    const list = muxy.projects.list() || [];
    registered = registeredPathSet(list);
    originalActiveId = list.find((p) => p && p.isActive)?.id ?? null;
  } catch {
    /* projects.list unavailable — treat as none registered */
  }

  // Not already registered, and the directory still exists (`add` rejects
  // missing dirs).
  const fresh = filterNew(projects, registered).filter((c) => {
    try {
      return fs.isDir(c.path);
    } catch {
      return false;
    }
  });

  if (!fresh.length) {
    alert(
      registered.size
        ? "No new projects found — every project your AI sessions ran in is already registered in Muxy."
        : "No AI sessions with a recoverable project path were found.\n\n(Cursor sessions can't be reverse-mapped to a path.)",
    );
    return;
  }

  const remaining = fresh.slice();
  const added = [];
  const failed = [];

  function addPath(path) {
    try {
      muxy.projects.add(path);
      added.push(path);
    } catch (err) {
      failed.push({ path, error: err?.message || String(err) });
    }
  }

  function finish() {
    // Land the user back on the project they started from (each add switched it).
    if (originalActiveId) {
      try {
        muxy.projects.switchTo(originalActiveId);
      } catch {
        /* ignore */
      }
    }
    const n = added.length;
    const parts = [];
    if (n) parts.push(`Added ${n} project${n === 1 ? "" : "s"} from your AI session history.`);
    if (failed.length) parts.push(`${failed.length} could not be added.`);
    try {
      muxy.notifications.notify({
        title: n ? `Added ${n} project${n === 1 ? "" : "s"}` : "AI Sessions",
        body: parts.join(" ") || "No projects were added.",
      });
    } catch {
      /* ignore */
    }
  }

  function items() {
    const rows = [
      {
        id: "__all__",
        title: `Add all ${remaining.length} project${remaining.length === 1 ? "" : "s"}`,
        subtitle: "Register every discovered project below",
      },
    ];
    for (const c of remaining) {
      rows.push({
        id: c.path,
        title: basename(c.path),
        subtitle: `${c.path}   ·   ${c.providers.map((id) => PROVIDER_LABELS[id] || id).join(", ")}`,
      });
    }
    return rows;
  }

  function openPicker() {
    muxy.modal.open({
      placeholder: `Add a project from AI sessions (${remaining.length} left)…`,
      emptyLabel: "No more projects to add",
      items: items(),
      onSelect(choice) {
        if (!choice) {
          finish();
          return;
        }
        if (choice.id === "__all__") {
          for (const c of remaining.slice()) addPath(c.path);
          remaining.length = 0;
          finish();
          return;
        }
        addPath(choice.id);
        const idx = remaining.findIndex((c) => c.path === choice.id);
        if (idx >= 0) remaining.splice(idx, 1);
        if (remaining.length) openPicker();
        else finish();
      },
    });
  }

  openPicker();
})();
