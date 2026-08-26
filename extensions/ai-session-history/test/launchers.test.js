import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildLauncherCommand,
  formatEnvText,
  normalizeEnv,
  parseEnvText,
  validateLauncher,
} from "../src/lib/launchers.js";

describe("validateLauncher", () => {
  it("accepts a name + command and assigns an id", () => {
    const clean = validateLauncher({ name: "  Opus  ", command: "  claude --model opus  " });
    assert.equal(clean.name, "Opus");
    assert.equal(clean.command, "claude --model opus");
    assert.ok(clean.id);
    assert.equal("env" in clean, false);
  });

  it("preserves an existing id", () => {
    const clean = validateLauncher({ id: "abc", name: "x", command: "y" });
    assert.equal(clean.id, "abc");
  });

  it("rejects a missing name", () => {
    assert.throws(() => validateLauncher({ command: "claude" }), /name is required/);
  });

  it("rejects a missing command", () => {
    assert.throws(() => validateLauncher({ name: "x" }), /command is required/);
  });

  it("rejects an invalid env variable name", () => {
    assert.throws(() => validateLauncher({ name: "x", command: "y", env: { "1BAD": "v" } }), /Invalid environment variable name/);
    assert.throws(() => validateLauncher({ name: "x", command: "y", env: { "A B": "v" } }), /Invalid environment variable name/);
  });
});

describe("normalizeEnv", () => {
  it("drops empty keys and coerces values to strings", () => {
    assert.deepEqual(normalizeEnv({ A: 1, "": "skip", B: null }), { A: "1", B: "" });
  });
});

describe("buildLauncherCommand", () => {
  it("returns the raw command when no env is set", () => {
    assert.equal(buildLauncherCommand({ name: "x", command: "claude --model opus" }), "claude --model opus");
  });

  it("prefixes shell-quoted env assignments before the command", () => {
    const cmd = buildLauncherCommand({
      name: "x",
      command: "claude --model opus",
      env: { MODEL: "opus", NOTE: "a b" },
    });
    assert.equal(cmd, "MODEL='opus' NOTE='a b' claude --model opus");
  });

  it("keeps env key insertion order deterministic", () => {
    const cmd = buildLauncherCommand({ name: "x", command: "run", env: { Z: "1", A: "2" } });
    assert.equal(cmd, "Z='1' A='2' run");
  });

  it("escapes single quotes in env values", () => {
    const cmd = buildLauncherCommand({ name: "x", command: "run", env: { K: "a'b" } });
    assert.equal(cmd, "K='a'\\''b' run");
  });
});

describe("parseEnvText / formatEnvText", () => {
  it("parses KEY=VALUE lines, ignoring blanks and comments", () => {
    const env = parseEnvText("A=1\n\n# comment\nB=two words\n");
    assert.deepEqual(env, { A: "1", B: "two words" });
  });

  it("keeps '=' inside the value", () => {
    assert.deepEqual(parseEnvText("URL=https://x/?a=b"), { URL: "https://x/?a=b" });
  });

  it("rejects a line without '='", () => {
    assert.throws(() => parseEnvText("NOEQUALS"), /expected KEY=VALUE/);
  });

  it("rejects an invalid key", () => {
    assert.throws(() => parseEnvText("1BAD=v"), /Invalid environment variable name/);
  });

  it("round-trips through formatEnvText", () => {
    const text = "A=1\nB=two words";
    assert.equal(formatEnvText(parseEnvText(text)), text);
  });
});
