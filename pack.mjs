#!/usr/bin/env node
/**
 * Pack `dist/dsh-claude-glass` into an npm-installable tarball.
 *
 * A tarball is produced by the package manager that is available (pnpm preferred,
 * npm as a fallback) so the result is exactly what `npm install <tgz>` expects —
 * including the `files[]` whitelist in the generated package.json.
 *
 * usage: node pack.mjs [--dest <dir>]
 *   --dest  also copy the tarball there (e.g. a DSH profile's vendor/ directory,
 *           which is where `"dsh-claude-glass": "file:vendor/…tgz"` resolves)
 *
 * env: DSH_PACK_CMD  explicit packer command, e.g. the full path to pnpm.cjs
 */
import { existsSync, copyFileSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT = join(ROOT, "dist", "dsh-claude-glass");

if (!existsSync(join(OUT, "package.json"))) {
  console.error(`nothing to pack — run "node build.mjs" first (${OUT} is missing)`);
  process.exit(2);
}

const destFlag = process.argv.indexOf("--dest");
const dest = destFlag >= 0 ? process.argv[destFlag + 1] : null;

/** A command is usable when it answers `--version`. */
function usable(cmd, args = []) {
  const r = spawnSync(cmd, [...args, "--version"], { stdio: "ignore", shell: false });
  return r.status === 0;
}

const candidates = [];
if (process.env.DSH_PACK_CMD) candidates.push({ cmd: process.execPath, args: [process.env.DSH_PACK_CMD] });
candidates.push({ cmd: "pnpm", args: [] });
candidates.push({ cmd: "npm", args: [] });

const packer = candidates.find((c) => usable(c.cmd, c.args));
if (!packer) {
  console.error(
    "no usable packer found (tried: " +
    candidates.map((c) => c.cmd).join(", ") +
    ")\n  install pnpm/npm, or point DSH_PACK_CMD at a pnpm.cjs / npm-cli.js",
  );
  process.exit(2);
}

const r = spawnSync(packer.cmd, [...packer.args, "pack"], { cwd: OUT, stdio: "inherit" });
if (r.status !== 0) process.exit(r.status ?? 1);

const { name, version } = JSON.parse(
  (await import("node:fs")).readFileSync(join(OUT, "package.json"), "utf8"),
);
const tgz = join(OUT, `${name}-${version}.tgz`);
if (!existsSync(tgz)) {
  console.error(`packer reported success but ${tgz} is missing`);
  process.exit(1);
}
console.log(`\n${tgz}  (${statSync(tgz).size} bytes)`);

if (dest) {
  const to = join(resolve(dest), `${name}-${version}.tgz`);
  if (!existsSync(resolve(dest))) {
    console.error(`--dest directory does not exist: ${resolve(dest)}`);
    process.exit(2);
  }
  copyFileSync(tgz, to);
  console.log(`copied to ${to}`);
}
