/**
 * Palette command entry: pick a saved custom launcher and start it in a new
 * terminal tab. Built to a single IIFE via esbuild (see copy-manifest.mjs).
 *
 * runScript context — muxy.* is synchronous (no await). muxy.storage.get returns
 * the stored value directly here, unlike the Promise-based webview API.
 */

import { buildLauncherCommand } from "../src/lib/launchers.js";

function notify(body) {
  try {
    muxy.notifications.notify({ title: "AI Sessions", body: body });
  } catch (e) {
    /* ignore */
  }
}

function loadLaunchers() {
  try {
    const value = muxy.storage.get("customLaunchers");
    return Array.isArray(value) ? value : [];
  } catch (e) {
    return [];
  }
}

function preview(launcher) {
  try {
    return buildLauncherCommand(launcher);
  } catch (e) {
    return String((launcher && launcher.command) || "");
  }
}

function main() {
  const launchers = loadLaunchers().filter(function (l) {
    return l && l.name && l.command;
  });
  if (!launchers.length) {
    notify("No custom launchers yet — add one from the AI Sessions panel");
    return;
  }

  muxy.modal.open({
    placeholder: "Launch custom AI session…",
    emptyLabel: "No custom launchers",
    noMatchLabel: "No matches",
    items: launchers.map(function (l) {
      return {
        id: String(l.id || l.name),
        title: String(l.name).slice(0, 120),
        subtitle: preview(l).slice(0, 160),
      };
    }),
    onSelect: function (choice) {
      if (!choice) return;
      const launcher = launchers.find(function (l) {
        return String(l.id || l.name) === choice.id;
      });
      if (!launcher) return;
      let command;
      try {
        command = buildLauncherCommand(launcher);
      } catch (e) {
        notify(e && e.message ? e.message : String(e));
        return;
      }
      muxy.tabs.open({ kind: "terminal", directory: ".", command: command });
    },
  });
}

try {
  main();
} catch (e) {
  notify(e && e.message ? e.message : String(e));
}
