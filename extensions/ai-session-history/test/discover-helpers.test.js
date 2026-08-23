import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  claudeCwdFromJsonl,
  codexCwdFromRollout,
  decodeGrokDir,
  dedupePaths,
} from "../src/lib/discover/helpers.js";

describe("decodeGrokDir", () => {
  it("reverses url-encoded cwd dir names", () => {
    assert.equal(decodeGrokDir("%2Ftmp%2Ffoo%20bar"), "/tmp/foo bar");
    assert.equal(decodeGrokDir("%2FUsers%2Fme%2Fdev%2Fmy-repo"), "/Users/me/dev/my-repo");
  });
  it("rejects non-absolute or invalid encodings", () => {
    assert.equal(decodeGrokDir("relative%2Fpath"), null);
    assert.equal(decodeGrokDir("%zz"), null);
    assert.equal(decodeGrokDir(""), null);
  });
});

describe("claudeCwdFromJsonl", () => {
  it("recovers the first recorded cwd from a transcript head", () => {
    const head = [
      JSON.stringify({ type: "summary", summary: "hi" }),
      JSON.stringify({ type: "user", cwd: "/Users/me/dev/proj", message: { content: "x" } }),
    ].join("\n");
    assert.equal(claudeCwdFromJsonl(head), "/Users/me/dev/proj");
  });
  it("returns null when no cwd is present", () => {
    assert.equal(claudeCwdFromJsonl('{"type":"user"}\n{bad json'), null);
    assert.equal(claudeCwdFromJsonl(""), null);
  });
});

describe("codexCwdFromRollout", () => {
  it("reads session_meta payload cwd for cli/vscode sources", () => {
    const head = JSON.stringify({
      type: "session_meta",
      payload: { id: "x", cwd: "/tmp/codexproj", source: "cli" },
    });
    assert.equal(codexCwdFromRollout(head), "/tmp/codexproj");
  });
  it("skips non-cli/vscode sources", () => {
    const head = JSON.stringify({
      type: "session_meta",
      payload: { cwd: "/tmp/x", source: "exec" },
    });
    assert.equal(codexCwdFromRollout(head), null);
  });
});

describe("dedupePaths", () => {
  it("normalizes, dedupes, and drops non-absolute", () => {
    const out = dedupePaths(["/a//b/", "/a/b", "relative", "", null, "/c"]);
    assert.deepEqual(out, ["/a/b", "/c"]);
  });
});
