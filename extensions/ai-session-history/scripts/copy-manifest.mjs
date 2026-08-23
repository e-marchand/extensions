import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const root = resolve(import.meta.dirname ?? dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");
const distScripts = resolve(dist, "scripts");
const srcRoot = resolve(root, "src");

await mkdir(dist, { recursive: true });
await mkdir(distScripts, { recursive: true });
await copyFile(resolve(root, "package.json"), resolve(dist, "package.json"));

/**
 * Bundle one runScript entry to a single IIFE (no ESM, no Python) and write it
 * to scripts/<name>.built.js plus dist/scripts/<name>.built.js (+ .js alias).
 * @param {string} name   basename, e.g. "resume-picker"
 * @param {string} entry  path to the entry module
 */
async function bundleScript(name, entry) {
  const out = resolve(root, `scripts/${name}.built.js`);
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    format: "iife",
    platform: "neutral",
    target: ["es2020"],
    outfile: out,
    logLevel: "warning",
    // Resolve @/… the same way Vite does for the panel.
    plugins: [
      {
        name: "alias-at",
        setup(build) {
          build.onResolve({ filter: /^@\// }, (args) => ({
            path: resolve(srcRoot, args.path.slice(2)),
          }));
        },
      },
    ],
  });

  const built = await readFile(out, "utf8");
  // Guard rails: no bare ESM import/export statements, no python3 runtime.
  // Match real statements at line start (ignore comments / string noise).
  // Do NOT short-circuit on `/*` — IIFE output always contains block comments.
  if (/^\s*import\s+/m.test(built)) {
    throw new Error(`${name}.built.js still contains ESM import statements`);
  }
  if (/^\s*export\s+/m.test(built)) {
    throw new Error(`${name}.built.js still contains ESM export statements`);
  }
  if (/\bpython3\b/.test(built)) {
    throw new Error(`${name}.built.js must not reference python3`);
  }

  await writeFile(resolve(distScripts, `${name}.built.js`), built, "utf8");
  await writeFile(resolve(distScripts, `${name}.js`), built, "utf8");
  console.log(`Built scripts/${name}.built.js (IIFE, no Python)`);
}

await bundleScript("resume-picker", resolve(root, "scripts/resume-picker-entry.js"));
await bundleScript("import-projects", resolve(root, "scripts/import-projects-entry.js"));
