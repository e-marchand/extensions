import { shellQuote } from "./shell-quote.js";

const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Stable id for a launcher; falls back when crypto.randomUUID is unavailable. */
export function newLauncherId() {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    /* ignore — fall through to timestamp id */
  }
  return "l-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

/** Coerce an env map to trimmed string keys/values. Throws on an invalid key. */
export function normalizeEnv(env) {
  const out = {};
  if (env == null) return out;
  if (typeof env !== "object" || Array.isArray(env)) {
    throw new Error("Environment must be a KEY=VALUE map");
  }
  for (const rawKey of Object.keys(env)) {
    const key = String(rawKey).trim();
    if (!key) continue;
    if (!ENV_KEY_RE.test(key)) {
      throw new Error("Invalid environment variable name: " + key);
    }
    out[key] = env[rawKey] == null ? "" : String(env[rawKey]);
  }
  return out;
}

/** Parse a `.env`-style block (one KEY=VALUE per line; # comments) into a map. */
export function parseEnvText(text) {
  const env = {};
  const lines = String(text ?? "").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      throw new Error("Invalid environment line (expected KEY=VALUE): " + trimmed);
    }
    const key = trimmed.slice(0, eq).trim();
    if (!ENV_KEY_RE.test(key)) {
      throw new Error("Invalid environment variable name: " + key);
    }
    env[key] = trimmed.slice(eq + 1);
  }
  return env;
}

/** Render an env map back to editable `.env`-style text. */
export function formatEnvText(env) {
  if (!env) return "";
  return Object.keys(env)
    .map((key) => key + "=" + env[key])
    .join("\n");
}

/** Validate and return a clean launcher. Throws on missing name/command or bad env. */
export function validateLauncher(launcher) {
  if (!launcher || typeof launcher !== "object") {
    throw new Error("Launcher must be an object");
  }
  const name = String(launcher.name ?? "").trim();
  if (!name) throw new Error("Launcher name is required");
  const command = String(launcher.command ?? "").trim();
  if (!command) throw new Error("Launcher command is required");
  const env = normalizeEnv(launcher.env);
  const clean = {
    id: launcher.id ? String(launcher.id) : newLauncherId(),
    name,
    command,
  };
  if (Object.keys(env).length) clean.env = env;
  if (launcher.cli) clean.cli = String(launcher.cli).trim();
  return clean;
}

/**
 * Build the terminal command string. Env vars become a shell-quoted assignment
 * prefix (`KEY='val' …`); the command itself stays raw so flags/options work.
 */
export function buildLauncherCommand(launcher) {
  const clean = validateLauncher(launcher);
  const env = clean.env ?? {};
  const prefix = Object.keys(env)
    .map((key) => key + "=" + shellQuote(env[key]))
    .join(" ");
  return prefix ? prefix + " " + clean.command : clean.command;
}

/** Open a new terminal tab in the active worktree running the launcher. */
export async function openLauncherTerminal(launcher) {
  return muxy.tabs.open({
    kind: "terminal",
    directory: ".",
    command: buildLauncherCommand(launcher),
  });
}
