#!/usr/bin/env node
/**
 * Low-memory build for Render (replaces tsc).
 * Uses esbuild to bundle the server; all node_modules stay external.
 */
import * as esbuild from "esbuild";
import { mkdirSync, existsSync } from "fs";
import { dirname } from "path";
import { fileURLToPath } from "url";

const outfile = "dist/index.js";
if (!existsSync("dist")) mkdirSync(dirname(outfile), { recursive: true });

await esbuild.build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  outfile,
  packages: "external",
  format: "cjs",
  sourcemap: true,
});

console.log("Build done:", outfile);
