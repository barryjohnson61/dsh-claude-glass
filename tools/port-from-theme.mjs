#!/usr/bin/env node
/**
 * dsh-claude-glass — re-port dsh-claude-theme's sidecar plugins into `src/port/`.
 *
 * dsh-claude-glass is a fused build: dsh-claude-theme's colour and typography
 * driving dsh-client-ui-aqua's glass material and motion. The theme repository
 * ALSO ships five sidecar plugins, and a glass install would otherwise never
 * see them:
 *
 *   plugins/skin/lib/client.js   the `TZ=` request-fingerprint easter egg
 *   plugins/lan-access/          LAN access: host routes + client panel + QR
 *   brand-plugin/                the Claude brand chrome (marks, title, favicon)
 *   crab-plugin/                 the Clawd pixel crab
 *   plugins/font-switcher/       the three family slots (serif / sans / mono)
 *
 * They cannot be installed beside glass as separate packages. glass installs as
 * ONE plugin row, and every one of these plugins claims slots and settings
 * pages that glass now owns (`settings.section`, `sidebar.footer.action`, the
 * brand marks); side by side they would fight or double up. So their client
 * halves are lifted into `src/port/*.client.js`, each wrapped in an IIFE so a
 * top-level name cannot collide with aqua's bundle, and the two host halves
 * that own routes — lan-access and font-switcher — are lifted verbatim into
 * `src/port/<published-name>.js` to be copied into `lib/`.
 *
 * "Verbatim" means verbatim, with exactly one rewrite, recorded in every file
 * it touches:
 *
 *   ctx.get("slots") -> ctx.slots
 *
 * glass's client context injects `slots` directly — aqua's bundle has always
 * read it as `ctx.slots` — so the theme's defensive `ctx.get` lookup is
 * unnecessary here, and its behaviour on a context that never declared the
 * lookup is not something worth depending on.
 *
 * Only `plugins/skin` is a subset: its client half is a skin loader plus the
 * easter egg, and glass already owns its stylesheet and its appearance
 * section, so just the egg is taken (everything from `EGG_STORE` down to
 * `FootprintWatcher`, plus glass's own restatement of the three wiring steps —
 * see SKIN_EGG_APPLY below).
 *
 * The generated files are committed, which makes an upstream bump a re-run
 * plus `git diff`, rather than a manual re-read of 200 KB:
 *
 *   node tools/port-from-theme.mjs --theme ../dsh-claude-theme
 *
 * Exit codes: 0 written, 1 an anchor moved or a source is missing, 2 bad usage.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "src", "port");

/* --------------------------------------------------------------- the input */

function arg(flag) {
  const i = process.argv.indexOf("--" + flag);
  if (i < 0) return undefined;
  const v = process.argv[i + 1];
  if (v === undefined || v.startsWith("--")) {
    console.error(`--${flag} needs a path`);
    process.exit(2);
  }
  return resolve(v);
}

const THEME = arg("theme") ?? resolve(process.env.DSH_CLAUDE_THEME_ROOT ?? join(ROOT, "..", "dsh-claude-theme"));

if (!existsSync(join(THEME, "plugins", "skin", "lib", "client.js"))) {
  console.error(
    "the theme repository was not found.\n" +
      `  looked in : ${THEME}\n` +
      "  expected  : <theme>/plugins/skin/lib/client.js\n" +
      "pass --theme <path>, or set DSH_CLAUDE_THEME_ROOT.",
  );
  process.exit(2);
}

const problems = [];
const manifest = [];

function read(rel, label) {
  const p = join(THEME, rel);
  if (!existsSync(p)) {
    problems.push(`${label}: missing ${rel}`);
    return "";
  }
  return readFileSync(p, "utf8");
}

/** `sha256:xxxxxxxx…` — the upstream bytes, so a re-port can be diffed. */
function sha(text) {
  return "sha256:" + createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16);
}

/** The upstream commit, if the input happens to be a git checkout. */
function upstreamCommit() {
  try {
    /* A linked worktree (`git worktree add`) keeps .git as a file pointing at
     * the real gitdir, so follow that first. */
    let gitDir = join(THEME, ".git");
    try {
      const dotGit = readFileSync(gitDir, "utf8").trim();
      if (dotGit.startsWith("gitdir:")) gitDir = resolve(THEME, dotGit.slice(7).trim());
    } catch (error) {
      /* .git is a directory: the common case, nothing to follow. */
    }
    const head = readFileSync(join(gitDir, "HEAD"), "utf8").trim();
    if (head.startsWith("ref: ")) {
      const ref = join(gitDir, head.slice(5).trim());
      if (existsSync(ref)) return readFileSync(ref, "utf8").trim().slice(0, 7);
    }
    return head.slice(0, 7);
  } catch (error) {
    return "unknown";
  }
}

const COMMIT = upstreamCommit();

const HEADER = (rel, text, extra) =>
  `/**\n` +
  ` * Ported from dsh-claude-theme ${COMMIT} — ${rel}\n` +
  ` * MIT © aklnaaw. See NOTICE and licenses/dsh-claude-theme.txt.\n` +
  ` *\n` +
  ` * Generated by tools/port-from-theme.mjs — do not edit by hand.\n` +
  ` * Upstream ${sha(text)}, ${Buffer.byteLength(text, "utf8")} bytes.\n` +
  (extra ? ` *\n${extra.split("\n").map((l) => ` * ${l}`.trimEnd()).join("\n")}\n` : "") +
  ` */\n`;

/** Fail loudly when upstream drifts, instead of generating a broken port. */
function require1(text, needle, label) {
  const n = text.split(needle).length - 1;
  if (n !== 1) problems.push(`${label}: expected 1 "${needle.slice(0, 60)}", found ${n}`);
  return n === 1;
}

/** For anchors that are copied whole: present is enough, count is not a fact. */
function requireAny(text, needle, label) {
  if (!text.includes(needle)) {
    problems.push(`${label}: missing "${needle.slice(0, 60)}"`);
    return false;
  }
  return true;
}

/* ------------------------------------------------- factory halves -> src/port */

/**
 * Everything between `factory: (require) => {` and the end of `return
 * module.exports;` — i.e. the whole plugin body, its own export statements
 * included. Nothing is renamed because nothing is unwrapped twice.
 */
function factoryBody(text, label) {
  const open = "factory: (require) => {";
  const at = text.indexOf(open);
  if (at < 0) {
    problems.push(`${label}: no "${open}"`);
    return "";
  }
  const start = at + open.length;
  const ret = text.indexOf("return module.exports;", start);
  if (ret < 0) {
    problems.push(`${label}: no "return module.exports;"`);
    return "";
  }
  const end = text.indexOf("\n", ret);
  return text.slice(start, end < 0 ? undefined : end).replace(/^\n/, "");
}

const REWRITE_NOTE = `Rewritten: ctx.get("slots") -> ctx.slots (1 site).`;

function portClient(rel, label, varName) {
  const text = read(rel, label);
  if (text === "") return;
  const body = factoryBody(text, label);
  if (body === "") return;
  require1(body, 'ctx.get("slots")', label);
  const rewritten = body.split('ctx.get("slots")').join("ctx.slots");
  const out =
    HEADER(rel, text, REWRITE_NOTE) +
    `\nconst ${varName} = (function () {\n` +
    rewritten.replace(/\s*$/, "\n") +
    `})();\n`;
  writeFileSync(join(OUT, `${label}.client.js`), out, "utf8");
  manifest.push([`${label}.client.js`, rel, text, Buffer.byteLength(out, "utf8")]);
}

/* ------------------------------------------------------ skin: the egg subset */

/**
 * Upstream's three wiring steps, restated because glass has no `apply` of its
 * own to fold them into. The rest of upstream's apply — the skin stylesheet and
 * the "Claude-X" settings page — is deliberately not ported: glass already owns
 * its stylesheet and its appearance section, and a second skin would repaint
 * the app twice.
 */
const SKIN_EGG_APPLY = `
		/* Glass's own glue. Upstream wires these three steps into the skin
		 * plugin's apply(); glass has no apply() of its own to reuse, so they
		 * are restated here, step for step:
		 *   1. the panel's own stylesheet, kept separate from the skin's so a
		 *      failure to inject it cannot take the skin down with it;
		 *   2. the console helper;
		 *   3. the watcher, as an invisible \`conversation.input.left\` occupant.
		 */
		function apply(ctx) {
			ctx.effect(function () {
				var el = document.createElement("style");
				el.id = "dsh-claude-skin:fingerprint";
				el.textContent = EGG_CSS;
				document.head.appendChild(el);
				return function () {
					if (el.parentNode) el.parentNode.removeChild(el);
					fpClose();
				};
			}, "dsh-claude-skin:fingerprint-styles");

			installFootprintHelper();

			var slots = ctx.slots;
			if (slots === undefined) return;

			/* The watcher is a list-slot entry that renders nothing: it takes
			 * the session's input actions and draft, and no visible seat. */
			slots.inject("conversation.input.left", function () {
				try {
					return slots.register(
						{ name: "conversation.input.left", id: "claude-fingerprint" },
						FootprintWatcher,
					);
				} catch (e) {
					return function () {};
				}
			});
		}

		exports.name = "dsh-claude-skin";
		exports.inject = ["slots"];
		exports.apply = apply;
		return module.exports;
`;

function portSkinEgg() {
  const rel = "plugins/skin/lib/client.js";
  const label = "skin-egg";
  const text = read(rel, label);
  if (text === "") return;
  const body = factoryBody(text, label);
  if (body === "") return;

  /* Upstream drift checks: the slice anchors and the two strings the glue
   * depends on. If any of these moved, the port must be re-read by hand. */
  require1(body, 'var EGG_STORE = "dsh-claude-skin.egg";', label);
  require1(body, "function apply(ctx) {", label);
  require1(body, '"dsh-claude-skin:fingerprint"', label);
  require1(body, '"conversation.input.left", id: "claude-fingerprint"', label);
  require1(body, "function FootprintWatcher(props) {", label);
  require1(body, 'ctx.get("slots")', label);

  const from = body.indexOf('var EGG_STORE = "dsh-claude-skin.egg";');
  const to = body.indexOf("function apply(ctx) {");
  if (from < 0 || to < 0 || to <= from) {
    problems.push(`${label}: could not slice the egg out of the skin plugin`);
    return;
  }
  /* The slice starts mid-line, so the first line arrives unindented; give it
   * the two tabs the rest of the body carries and keep the diff honest. */
  const subset = ("\t\t" + body.slice(from, to)).replace(/\s*$/, "\n");

  const out =
    HEADER(
      rel,
      text,
      `Subset: ${label === "skin-egg" ? "the egg only" : label}.\n` +
        `Taken  : var EGG_STORE … FootprintWatcher (one contiguous run).\n` +
        `Dropped: the skin stylesheet (STYLE_ID/CSS) and the "Claude-X" settings\n` +
        `         page — glass owns both. Glass's own apply() is appended below.\n` +
        REWRITE_NOTE,
    ) +
    `\nconst portSkinEgg = (function () {\n` +
    `\t\tvar module = { exports: {} };\n` +
    `\t\tvar exports = module.exports;\n\n` +
    subset +
    SKIN_EGG_APPLY +
    `})();\n`;
  writeFileSync(join(OUT, `${label}.client.js`), out, "utf8");
  manifest.push([`${label}.client.js`, rel, text, Buffer.byteLength(out, "utf8")]);
}

/* ------------------------------------------- host halves -> published modules */

/*
 * These are copied byte for byte under the name they will carry in `lib/`, so
 * their relative imports (`./qr.js`) resolve identically in `src/port/` and in
 * the built `dist/dsh-claude-glass/lib/`. Nothing here is spliced.
 */
function portHost(rel, label, distName, markers) {
  const text = read(rel, label);
  if (text === "") return;
  for (const m of markers) requireAny(text, m, label);
  const file = `${distName}.js`;
  const out = HEADER(rel, text, `Published verbatim as lib/${file}.`) + "\n" + text;
  writeFileSync(join(OUT, file), out, "utf8");
  manifest.push([file, rel, text, Buffer.byteLength(out, "utf8")]);
}

function portPlain(rel, label, distName, markers) {
  const text = read(rel, label);
  if (text === "") return;
  for (const m of markers) requireAny(text, m, label);
  const file = `${distName}.js`;
  const out = HEADER(rel, text, `Published verbatim as lib/${file}.`) + "\n" + text;
  writeFileSync(join(OUT, file), out, "utf8");
  manifest.push([file, rel, text, Buffer.byteLength(out, "utf8")]);
}

/* ------------------------------------------------------------------- run it */

mkdirSync(OUT, { recursive: true });

portClient("brand-plugin/lib/client.js", "brand", "portBrand");
portClient("crab-plugin/lib/client.js", "crab", "portCrab");
portClient("plugins/font-switcher/lib/client.js", "font-switcher", "portFontSwitcher");
portClient("plugins/lan-access/lib/client.js", "lan-access", "portLanAccess");
portSkinEgg();

portHost("plugins/lan-access/lib/index.js", "lan-access", "lan-access", [
  'export const name = "dsh-lan-access"',
  'export const inject = ["connection", "webServer"]',
  'import { encode } from "./qr.js"',
  'export function apply(ctx)',
  'requestBody: "buffered"',
]);
portPlain("plugins/lan-access/lib/qr.js", "qr", "qr", ["export function encode("]);
portHost("plugins/font-switcher/lib/index.js", "font-switcher", "font-switcher", [
  'export const name = "dsh-font-switcher"',
  'export const inject = ["connection"]',
  'export function apply(ctx)',
  'requestBody: "buffered"',
]);

const MANIFEST =
  `# Ported sources\n\n` +
  `Generated by \`tools/port-from-theme.mjs\`. Do not edit these files by hand:\n` +
  `re-run the script against a newer theme checkout and review the diff.\n\n` +
  `- upstream: \`dsh-claude-theme\` @ \`${COMMIT}\`\n` +
  `- source  : \`${THEME}\`\n\n` +
  `| file | upstream | upstream hash | bytes out |\n` +
  `| --- | --- | --- | --- |\n` +
  manifest.map(([f, rel, text, size]) => `| \`${f}\` | \`${rel}\` | \`${sha(text)}\` | ${size} |`).join("\n") +
  `\n\n` +
  `\`brand.client.js\`, \`crab.client.js\`, \`font-switcher.client.js\` and\n` +
  `\`lan-access.client.js\` are whole factory bodies. \`skin-egg.client.js\` is a\n` +
  `subset of \`plugins/skin/lib/client.js\` — see its header. The one rewrite is\n` +
  `\`ctx.get("slots") -> ctx.slots\` in all five.\n\n` +
  `\`client-mount.js\` and \`host-mount.js\` are NOT generated, and they are not\n` +
  `modules either: they are the two fragments glass splices into the built\n` +
  `bundle, and they are what actually mounts these halves.\n`;
writeFileSync(join(OUT, "PORT-MANIFEST.md"), MANIFEST, "utf8");

if (problems.length > 0) {
  console.error("PORT PROBLEMS:\n" + problems.map((p) => "  - " + p).join("\n"));
  process.exit(1);
}

console.log(`ported dsh-claude-theme @ ${COMMIT}`);
console.log(`  from: ${THEME}`);
console.log(`  into: ${OUT}`);
for (const [file, rel, text, size] of manifest) {
  console.log(`  ${file.padEnd(28)} <- ${rel.padEnd(38)} ${sha(text)} ${String(size).padStart(7)} B`);
}
