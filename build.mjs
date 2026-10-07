#!/usr/bin/env node
/**
 * dsh-claude-glass — build.
 *
 * Fuses the two upstream projects into one self-contained DSH client plugin:
 *
 *   colour + layout base : dsh-claude-theme  (aklnaaw, MIT — claude/skin.css,
 *                          claude/patches.css, claude/assets/fonts/*.woff2)
 *   glass + motion engine: dsh-client-ui-aqua 1.3.1-patch.4 (AGPL-3.0-only)
 *
 * Aqua ships only a prebuilt `lib/client.js` (no TypeScript sources), so the
 * integration is a *reproducible patch* of that bundle rather than a rebuild.
 * Every edit is a targeted literal replacement and each one is verified; the
 * build fails loudly if an anchor stops matching (i.e. the aqua base moved).
 *
 * What it changes
 *   1. AQUA_TOKEN_OVERRIDES  -> Claude's 278 `--dsw-*` tokens, parsed out of
 *      claude/skin.css (light `:root` + the `body[data-ds-dark-theme]` block).
 *      Aqua therefore no longer imposes its deep-sea palette: it pushes Claude's.
 *      COMPAT_SURFACE_OVERRIDES keeps aqua's own key list but paints it solid.
 *   2. Every hard-coded cool-blue literal in aqua.module.css -> its Claude
 *      counterpart (hairlines, glass fills, glow accent, ambient wash, critters,
 *      placeholder/stat text, video tint, scroll fade).
 *   3. Aqua's radius ladder -> Claude's (8 / 12 / 16 / 26 composer pill).
 *   4. Space Grotesk -> Claude's three stacks (Inter chrome / Newsreader reading
 *      / JetBrains Mono code), and the two font-family overrides in the sheet.
 *   5. fonts.module.css -> Claude's four self-hosted woff2 faces, base64-inlined
 *      (a DSH client plugin has no static-asset route — this is how aqua ships
 *      its own font too).
 *   6. claude-layer.css appended to the same stylesheet: Claude's editorial
 *      typography, surface/hairline language, tool-call cards, control radii,
 *      coral focus ring.
 *   7. Namespacing so the fork can never collide with an installed aqua:
 *      plugin id/package name, `dsh.ui-aqua.*` localStorage keys, `data-dsh-aqua*`
 *      attributes, `--dsh-aqua-*` custom properties and keyframe names.
 *   8. Fresh defaults: fluidHue 320 (teal) -> 158, which aqua's
 *      `glowHue = (hue + 217) % 360` maps to 15deg — Claude coral.
 *   9. Three compatibility-mode (flat, no-mica) defects of the aqua base:
 *      a. the sidebar column is never tilted by the spotlight engine;
 *      b. the blanket `backdrop-filter:blur(12px)` is restricted to genuinely
 *         floating overlays, because `[class*=panel|card|bubble]` also matched
 *         core shell containers (the details pane, `md-code-block`, the
 *         composer card, every `_2H3hWW_panel*` row) and washed the UI out;
 *      c. the compat surface layer is painted solid: at aqua's 0.45-0.60 alpha
 *         every layered surface becomes a translucent sheet over the coral
 *         fluid, and flat mode reads as washed out.
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PKG = "dsh-claude-glass";
const OLD_PKG = "dsh-client-ui-aqua";
const VERSION = "1.0.0";

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT = join(ROOT, "dist", PKG);

/**
 * The two upstream inputs are *not* vendored in this repository:
 *   BASE   — dsh-client-ui-aqua 1.3.1-patch.4 (AGPL-3.0-only, prebuilt lib/)
 *   CLAUDE — dsh-claude-theme's `claude/` skin directory (MIT + OFL fonts)
 * Point at them with a flag, an env var, or the default sibling layout.
 * See README §5.
 */
function input(flag, envName, fallback) {
  const i = process.argv.indexOf("--" + flag);
  if (i >= 0) {
    const v = process.argv[i + 1];
    if (v === undefined || v.startsWith("--")) {
      console.error(`--${flag} needs a path`);
      process.exit(2);
    }
    return resolve(v);
  }
  return resolve(process.env[envName] ?? fallback);
}

const BASE = input("base", "DSH_AQUA_BASE", join(ROOT, "..", "dsh-client-ui-aqua"));
const CLAUDE = input("claude", "DSH_CLAUDE_THEME", join(ROOT, "..", "dsh-claude-theme", "claude"));

for (const [label, flag, envName, probe] of [
  ["dsh-client-ui-aqua base", "base", "DSH_AQUA_BASE", join(BASE, "lib", "client.js")],
  ["dsh-claude-theme skin", "claude", "DSH_CLAUDE_THEME", join(CLAUDE, "skin.css")],
]) {
  if (existsSync(probe)) continue;
  console.error(
    `missing ${label}\n` +
    `  looked for: ${probe}\n` +
    `  set it with: node build.mjs --${flag} <dir>   or   $env:${envName} = "<dir>"\n` +
    `  see README §5 "从源码重新构建" for how to fetch the two upstream inputs.`,
  );
  process.exit(2);
}

const log = [];
const problems = [];
let hits = 0;

/* ------------------------------------------------------------------ helpers */

/** Read a double-quoted JS string literal starting at `quotePos`. */
function readStringLiteral(text, quotePos) {
  if (text[quotePos] !== '"') throw new Error(`expected " at ${quotePos}`);
  let i = quotePos + 1;
  let raw = "";
  while (i < text.length) {
    const c = text[i];
    if (c === "\\") { raw += c + text[i + 1]; i += 2; continue; }
    if (c === '"') return { raw, end: i };
    raw += c;
    i++;
  }
  throw new Error("unterminated string literal");
}

function unescape(raw) {
  try { return JSON.parse('"' + raw + '"'); }
  catch { return raw.replace(/\\(.)/g, "$1"); }
}

/** Locate `const <name> = "…"` and hand the *decoded* value to fn. */
function patchStringLiteral(src, constName, fn, label) {
  const key = `const ${constName} = `;
  const at = src.indexOf(key);
  if (at < 0) { problems.push(`${label}: anchor "${key}" not found`); return src; }
  const { raw, end } = readStringLiteral(src, at + key.length);
  const before = unescape(raw);
  const after = fn(before);
  hits++;
  if (after === before) problems.push(`${label}: no change`);
  return src.slice(0, at + key.length) + JSON.stringify(after) + src.slice(end + 1);
}

/** Replace `const <name> = { … }` with `replacement` (the object literal text). */
function patchObjectLiteral(src, constName, replacement, label) {
  const key = `const ${constName} = `;
  const at = src.indexOf(key);
  if (at < 0) { problems.push(`${label}: anchor "${key}" not found`); return src; }
  const start = at + key.length;
  if (src[start] !== "{") { problems.push(`${label}: not an object literal`); return src; }
  let depth = 0;
  let i = start;
  let str = null;
  let esc = false;
  for (; i < src.length; i++) {
    const c = src[i];
    if (str !== null) {
      if (esc) { esc = false; continue; }
      if (c === "\\") { esc = true; continue; }
      if (c === str) str = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { str = c; continue; }
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) { i++; break; } }
  }
  if (depth !== 0) { problems.push(`${label}: unbalanced braces`); return src; }
  hits++;
  return src.slice(0, start) + replacement + src.slice(i);
}

/** Assert-then-replace: counts every site, records a miss instead of failing silently. */
function substitute(src, from, to, label, expect) {
  const n = src.split(from).length - 1;
  if (n === 0) { problems.push(`${label}: anchor ${JSON.stringify(from)} not found`); return src; }
  if (expect !== undefined && n !== expect) problems.push(`${label}: expected ${expect} sites, found ${n}`);
  hits += n;
  log.push(`  ${label}: ${n} site(s)`);
  return src.split(from).join(to);
}

/* ------------------------------------------------- Claude token extraction */

function parseSkinTokens(css) {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const light = {};
  const dark = {};
  for (const m of stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = m[1].trim();
    if (sel.startsWith("@")) continue;
    const isDark = /data-ds-dark-theme/.test(sel);
    const isRoot = /(^|,)\s*:root\s*($|,)/.test(sel);
    const target = isDark ? dark : isRoot ? light : null;
    if (target === null) continue;
    for (const d of m[2].matchAll(/(--[A-Za-z0-9_-]+)\s*:\s*([^;]+);/g)) {
      target[d[1]] = d[2].trim();
    }
  }
  return { light, dark };
}

function tokenPairs(light, dark) {
  const names = [...new Set([...Object.keys(light), ...Object.keys(dark)])].sort();
  return names.map((n) => [n, light[n] ?? dark[n], dark[n] ?? light[n]]);
}

function toLiteral(pairs) {
  return "{\n\t" + pairs
    .map(([n, l, d]) => `${JSON.stringify(n)}: {\n\t\tlight: ${JSON.stringify(l)},\n\t\tdark: ${JSON.stringify(d)}\n\t}`)
    .join(",\n\t") + "\n}";
}

/* ------------------------------------------------------- colour + geometry */

/** Aqua's hard-coded cool-blue glass, restated in Claude's warm palette. */
const COLOR_MAP = [
  // ambient wash (light)
  ["#a0c8ff42", "#d9775730"],
  ["#9cc1e738", "#e8dfcd3d"],
  ["#9cc1e700", "#e8dfcd00"],
  ["#9cc1e724", "#d977571f"],
  // ambient wash (dark)
  ["#6ea5ff21", "#e08a6a1f"],
  ["#5e8fe021", "#2b292533"],
  ["#5e8fe000", "#2b292500"],
  ["#5e8fe017", "#e08a6a15"],
  // critters
  ["#7ea4df", "#d9a68a"],
  ["#a9c6ef", "#e6c9b4"],
  // dark glass bodies
  ["#22262f", "#252320"],   // --dsh-aqua-glass-card-dark
  ["#2a2e38", "#2b2925"],   // dark surface / add-button fill
  ["#363a46", "#332f29"],   // dark hover fill
  ["#1c202a", "#1f1e1b"],   // dark menu fill
  ["#111a27", "#1f1e1b"],   // dark dialog body
  ["#02060e", "#0a0908"],   // dark drop shadow
  // hairlines
  ["#132d53", "#141413"],   // light hairline ink
  ["#94b4dc", "#faf9f5"],   // dark hairline ink
  ["#96bef5", "#d97757"],   // sidebar outer edge
  // glow / accent
  ["#6e9be8", "#d97757"],
  // text
  ["#262e3e", "#6c6a64"],   // light stats text
  ["#e4ecf8", "#a09d96"],   // dark stats text
  ["#374054", "#8e8b82"],   // light placeholder
  ["#cdd8ea", "#a09d96"],   // dark placeholder
  // glass fills / washes
  ["#ffffff73", "#faf9f5d9"],
  ["rgb(12 18 27/", "rgb(24 23 21/"],
  ["rgb(8 12 20/", "rgb(20 19 17/"],
  ["srgb, #fff ", "srgb, #faf9f5 "],
  ["srgb, #000 ", "srgb, #181715 "],
];

/** Claude's radius ladder replaces aqua's floating-panel 14/20/24 ladder. */
const RADIUS_MAP = [
  // must run before the generic `border-radius:14px}` rule, which would otherwise
  // consume this rule's tail first and leave the six --dsl-* radius vars behind.
  [
    "--dsl-code-block-border-radius:14px;--dsl-diff-radius:14px;--dsl-read-radius:14px;"
    + "--dsl-terminal-radius:14px;--dsl-web-radius:14px;--dsl-search-radius:14px;border-radius:14px}",
    "--dsl-code-block-border-radius:12px;--dsl-diff-radius:12px;--dsl-read-radius:12px;"
    + "--dsl-terminal-radius:12px;--dsl-web-radius:12px;--dsl-search-radius:12px;border-radius:12px}",
  ],
  ["border-radius:14px}", "border-radius:12px}"],
  ["border-radius:20px", "border-radius:16px"],
  ["border-radius:24px", "border-radius:26px"],
  ["border-radius:0 0 24px 24px", "border-radius:0 0 26px 26px"],
  ["rx='24'", "rx='26'"],
  ["border-radius:10px", "border-radius:8px"],
];

const CLAUDE_SANS = "'Inter', 'Noto Sans CJK SC', 'PingFang SC', 'Microsoft YaHei', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

/* ------------------------------------------------------------------- fonts */

const FONTS = [
  ["Newsreader", "normal", "200 800", "newsreader-normal.woff2"],
  ["Newsreader", "italic", "200 800", "newsreader-italic.woff2"],
  ["Inter", "normal", "100 900", "inter-normal.woff2"],
  ["JetBrains Mono", "normal", "100 800", "jetbrains-mono-normal.woff2"],
];

function fontFaceCss() {
  return FONTS.map(([family, style, weight, file]) => {
    const b64 = readFileSync(join(CLAUDE, "assets", "fonts", file)).toString("base64");
    return `@font-face{font-family:'${family}';font-style:${style};font-display:swap;`
      + `font-weight:${weight};src:url(data:font/woff2;base64,${b64}) format('woff2')}`;
  }).join("\n");
}

/**
 * Read the *key list* of aqua's own COMPAT_SURFACE_OVERRIDES out of the base
 * bundle. Only the names are taken: upstream's per-surface alphas are tuned for
 * its desaturated teal fluid and are deliberately NOT reused (see the long
 * comment at the call site). The literal is JS, so the inner `light:` / `dark:`
 * keys are unquoted; a plain JSON.parse would not do.
 */
function readCompatSurfaceKeys(source) {
  const at = source.indexOf("COMPAT_SURFACE_OVERRIDES = ");
  if (at < 0) {
    problems.push("COMPAT_SURFACE_OVERRIDES not found in the aqua base");
    return new Map();
  }
  const brace = source.indexOf("{", at);
  let depth = 0;
  let i = brace;
  let inStr = false;
  let esc = false;
  for (; i < source.length; i++) {
    const c = source[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  const text = source.slice(brace, i + 1);
  const out = new Set();
  const re = /"(--[^"]+)"\s*:\s*\{\s*light:\s*"[^"]+",\s*dark:\s*"[^"]+"\s*\}/g;
  let m;
  while ((m = re.exec(text)) !== null) out.add(m[1]);
  return out;
}

/* -------------------------------------------------------------------- main */

const src0 = readFileSync(join(BASE, "lib", "client.js"), "utf8");
let src = src0;

const skin = parseSkinTokens(readFileSync(join(CLAUDE, "skin.css"), "utf8"));
const pairs = tokenPairs(skin.light, skin.dark);
if (pairs.length < 200) problems.push(`token parse looks short: ${pairs.length} tokens`);

/* Compat-mode surface layer.
 *
 * Aqua ships COMPAT_SURFACE_OVERRIDES for flat ("compatibility") mode, where the
 * mica backdrop is unavailable: a *fixed list* of layered surfaces is painted
 * with a translucent version of the palette instead (alpha 0.45-0.88).
 *
 * That list is the right *key* set — it is a design decision, not something to
 * re-derive from token-name patterns. Two things about it matter:
 *
 *   - it deliberately leaves out
 *       --dsw-alias-bg-base            the canvas: the app shell (body, frame,
 *                                      center column) reads it, and the right
 *                                      details pane paints it while it is slid
 *                                      off-canvas, so making it translucent
 *                                      turns that pane into a milky veil over
 *                                      the conversation;
 *       --dsw-alias-bg-mask-*          modal scrims would stop masking;
 *       --dsw-specific-sidebar-fill
 *       --dsw-alias-bg-skeleton
 *   - it deliberately includes the markdown / menu / tooltip / toast / input
 *     surfaces.
 *
 * But the *values* must not be copied. Aqua's alphas (0.45-0.88) are tuned for a
 * desaturated teal fluid; over Claude's warm palette and its coral fluid every
 * layered surface at 45-60% alpha turns into a pink wash — `--dsw-alias-bg-layer-1`
 * at 55% alone repaints every conversation row, the sidebar and every card, and
 * the whole UI reads as "washed out" (实测反馈). Compatibility mode exists to be
 * the *safe, flat* mode, so here it is painted SOLID: same key list, opaque
 * Claude colour, no `color-mix(..., transparent)` anywhere.
 *
 * Everything the base list does not mention keeps Claude's opaque value.
 */
const baseCompat = readCompatSurfaceKeys(src0);
if (baseCompat.size < 10) problems.push(`base COMPAT_SURFACE_OVERRIDES looks short: ${baseCompat.size} keys`);
const tokenMap = new Map(pairs.map(([n, l, d]) => [n, [l, d]]));
const compatPairs = [];
for (const name of baseCompat) {
  const pair = tokenMap.get(name);
  if (!pair) {
    problems.push(`compat surface ${name} is not a Claude token`);
    continue;
  }
  // Solid, not translucent -- see the comment above.
  compatPairs.push([name, pair[0], pair[1]]);
}

log.push(`Claude tokens: ${pairs.length}; compat-mode surfaces: aqua's ${compatPairs.length} keys painted solid`);

/* 1. token layers ---------------------------------------------------------- */
const tokenLiteral = toLiteral(pairs);
const compatLiteral = toLiteral(compatPairs);
src = patchObjectLiteral(src, "AQUA_TOKEN_OVERRIDES", tokenLiteral, "AQUA_TOKEN_OVERRIDES");
src = patchObjectLiteral(src, "COMPAT_SURFACE_OVERRIDES", compatLiteral, "COMPAT_SURFACE_OVERRIDES");

/* 2-7. bundle-wide textual edits ------------------------------------------- */
// Fresh palette defaults: 158 -> glowHue (158 + 217) % 360 = 15 = Claude coral.
src = substitute(src, "fluidHue: 320", "fluidHue: 158", "default fluidHue -> coral", 2);

// Claude's chrome stack replaces Space Grotesk as the token-level UI font.
src = patchStringLiteral(src, "FONT_STACK", () => CLAUDE_SANS, "FONT_STACK");

// aqua.module.css: recolour, re-radius, and restore Claude's two font overrides.
const AQ = "\\0dsh-css:D:\\Hermes Work\\deepseek-harness\\packages\\client\\ui-aqua\\src\\client\\aqua.module.css.mjs";
const aqRegionAt = src.indexOf("//#region " + AQ);
if (aqRegionAt < 0) problems.push("aqua.module.css region not found");
else {
  const aqEnd = src.indexOf("//#endregion", aqRegionAt);
  let region = src.slice(aqRegionAt, aqEnd);
  for (const [from, to] of COLOR_MAP) region = substitute(region, from, to, `colour ${from}`);
  for (const [from, to] of RADIUS_MAP) region = substitute(region, from, to, `radius ${from}`);
  // the sheet's two Space Grotesk overrides: dialog h2 -> serif, treeitem -> sans
  const GROTESK = "font-family:Space Grotesk Variable,Noto Serif SC,Songti SC,STSong,SimSun,serif";
  const first = region.indexOf(GROTESK);
  if (first < 0) problems.push("aqua font overrides not found");
  else {
    const second = region.indexOf(GROTESK, first + 1);
    if (second < 0) problems.push("treeitem font override not found");
    else region = region.slice(0, second) + "font-family:var(--cl-sans)"
      + region.slice(second + GROTESK.length);
    region = region.slice(0, first) + "font-family:var(--cl-serif)"
      + region.slice(first + GROTESK.length);
    hits += 2;
    log.push("  aqua font overrides: 2 site(s)");
  }
  src = src.slice(0, aqRegionAt) + region + src.slice(aqEnd);
}

// fonts.module.css -> Claude's four faces.
const FN = "\\0dsh-css:D:\\Hermes Work\\deepseek-harness\\packages\\client\\ui-aqua\\src\\client\\fonts.module.css.mjs";
const fnRegionAt = src.indexOf("//#region " + FN);
if (fnRegionAt < 0) problems.push("fonts.module.css region not found");
else {
  const fnEnd = src.indexOf("//#endregion", fnRegionAt);
  let region = src.slice(fnRegionAt, fnEnd);
  const at = region.indexOf("const css");
  const q = region.indexOf('"', at);
  const { end } = readStringLiteral(region, q);
  region = region.slice(0, q) + JSON.stringify(fontFaceCss()) + region.slice(end + 1);
  src = src.slice(0, fnRegionAt) + region + src.slice(fnEnd);
  hits++;
  log.push("  fonts.module.css -> 4 Claude woff2 faces (base64)");
}

/* 8. namespacing ----------------------------------------------------------- */
src = substitute(src, "dsh.ui-aqua.", "dsh.claude-glass.", "localStorage prefix");
src = substitute(src, "dsh-aqua", "dsh-cglass", "attribute / custom-property namespace");
src = substitute(src, OLD_PKG, PKG, "plugin id");
src = substitute(src, '"玻璃主题"', '"Claude 玻璃"', "locale title (zh)");
src = substitute(src, '"Glass theme"', '"Claude Glass"', "locale title (en)");

/* 9. compat fix: the sidebar column must never tilt ------------------------- */
// spotlight.ts documents "the sidebar NEVER tilts (its settings overlay renders
// inside the column and a running transform would re-anchor it)", but tiltable()
// only bailed out while a [role=dialog] was open — a far narrower condition than
// its own doc comment. Any transform on the column makes it the containing block
// for position:fixed descendants, and the core's Windows-titlebar collapse toggle
// (`[data-windows-titlebar] ._2H3hWW_toggle` { position:fixed; left:12px;
// top:calc((var(--dsh-windows-titlebar-height) - 28px)/2) }) is one of them: the
// button drifts with the cursor and is clipped away when the column collapses.
// The cursor glow is a separate gate and is unaffected by this change.
const TILTABLE_OLD = `function tiltable(spot) {
			if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
			if (spot.matches("[class*=\\"sidebarCol\\"]") && document.querySelector("[role=\\"dialog\\"]") !== null) return false;
			return true;
		}`;
const TILTABLE_NEW = `function tiltable(spot) {
			if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
			// dsh-claude-glass: never tilt the sidebar column. A transform here makes the
			// column the containing block for position:fixed descendants, which would
			// re-anchor the core's Windows-titlebar collapse toggle into the column.
			if (spot.matches("[class*=\\"sidebarCol\\"]")) return false;
			return true;
		}`;
src = substitute(src, TILTABLE_OLD, TILTABLE_NEW, "sidebar column never tilts", 1);

/* 10. compat fix: the blanket blur must not hit core shell containers -------- */
// Aqua gives floating surfaces a light blur in compat mode:
//
//   [data-dsh-compat] [role=menu],[data-dsh-compat] [role=tooltip],
//   [data-dsh-compat] [class*=card],[data-dsh-compat] [class*=bubble],
//   [data-dsh-compat] [class*=panel],[data-dsh-compat] [class*=popover],
//   [data-dsh-compat] [class*=dropdown]{backdrop-filter:blur(12px)}
//
// `[class*=…]` is a substring test against *hashed* DSH class names, and DSH
// uses those words for ordinary shell chrome. Measured on 0.2.0-rc.2 the three
// class selectors matched 42 core elements, among them
//   OUqwTW_panel / OUqwTW_panelBody   the RIGHT DETAILS PANE. It stays in the
//                                    layout (position:absolute, 624x760,
//                                    pointer-events:none) while the right
//                                    sidebar is closed, so it blurs -- and thus
//                                    flattens to a milky wash -- the entire
//                                    right half of the conversation;
//   _block_7gxqk_4 md-code-block      every code block (15 of them);
//   RlGAzG_card                       the composer card;
//   _2H3hWW_panelList/Row/Glyph/Icon/Title   the sidebar's own nav rows, one of
//                                    which is a plain <span> of text.
// That is the "UI and rendering error" users see in 兼容模式. Restrict the rule
// to *small transient* floating overlays, identified by ARIA role / the popover
// attribute instead of by a class-name substring.
//
// Scope note (learned the hard way): `[role=dialog]` and `[data-shell-overlay]`
// must NOT be in this list. DSH's `BynINW_overlayLayer` carries the shell overlay
// hook and spans the whole frame, so blurring it frosts the entire application
// the moment any overlay opens. The settings dialog is a full-size surface too
// and already paints its own opaque background. Only menus, tooltips, listboxes
// and native popovers belong here.
const COMPAT_BLUR_OLD = `[data-dsh-compat] [role=menu],[data-dsh-compat] [role=tooltip],[data-dsh-compat] [class*=card],[data-dsh-compat] [class*=bubble],[data-dsh-compat] [class*=panel],[data-dsh-compat] [class*=popover],[data-dsh-compat] [class*=dropdown]{backdrop-filter:blur(12px)}`;
const COMPAT_BLUR_NEW = `[data-dsh-compat] [role=menu],[data-dsh-compat] [role=tooltip],[data-dsh-compat] [role=listbox],[data-dsh-compat] [popover]{backdrop-filter:blur(12px)}`;
src = substitute(src, COMPAT_BLUR_OLD, COMPAT_BLUR_NEW, "compat blur limited to floating overlays", 1);

/* ------------------------------------------------------------ append layer */
const layerCss = readFileSync(join(ROOT, "src", "claude-layer.css"), "utf8");
{
  const at = src.indexOf("const css");
  const region = src.slice(src.indexOf("//#region " + AQ), src.indexOf("//#endregion", src.indexOf("//#region " + AQ)));
  const q = region.indexOf('"', region.indexOf("const css"));
  const { raw, end } = readStringLiteral(region, q);
  const merged = unescape(raw) + "\n" + layerCss;
  const regionAt = src.indexOf("//#region " + AQ);
  const regionEnd = src.indexOf("//#endregion", regionAt);
  src = src.slice(0, regionAt)
    + region.slice(0, q) + JSON.stringify(merged) + region.slice(end + 1)
    + src.slice(regionEnd);
  hits++;
  log.push("  claude-layer.css appended to the main stylesheet");
  void at;
}

/* ------------------------------------------------------------------- write */

if (problems.length > 0) {
  console.error("BUILD PROBLEMS:\n" + problems.map((p) => "  - " + p).join("\n"));
  process.exit(1);
}

rmSync(join(ROOT, "dist"), { recursive: true, force: true });
mkdirSync(join(OUT, "lib"), { recursive: true });
writeFileSync(join(OUT, "lib", "client.js"), src, "utf8");
cpSync(join(BASE, "lib", "invariant.js"), join(OUT, "lib", "invariant.js"));
cpSync(join(BASE, "lib", "types"), join(OUT, "lib", "types"), { recursive: true });

// host half: same pass-through settings namespace ("aqua"), relabelled.
writeFileSync(
  join(OUT, "lib", "index.js"),
  readFileSync(join(BASE, "lib", "index.js"), "utf8")
    .replace(/\[ui-aqua\]/g, "[claude-glass]")
    .replace(/Aqua theme-layer plugin/, "Claude Glass theme-layer plugin (fork of dsh-client-ui-aqua)"),
  "utf8",
);

writeFileSync(join(OUT, "cordis.patch.yml"), `# npm distribution patch layer: registers the Claude Glass client plugin into the
# profile's browser roster. The plugin is a fusion of dsh-claude-theme (colour,
# typography, layout) and dsh-client-ui-aqua (glass material, motion).
- insert:
    - id: ui-claude-glass
      name: '${PKG}'
`, "utf8");

const basePkg = JSON.parse(readFileSync(join(BASE, "package.json"), "utf8"));
writeFileSync(join(OUT, "package.json"), JSON.stringify({
  ...basePkg,
  name: PKG,
  version: VERSION,
  description: "Claude Glass — dsh-claude-theme's warm editorial palette and typography driving dsh-client-ui-aqua's glass material and motion (unofficial integration build)",
  keywords: ["dsh", "dsh-plugin", "dsh-plugins", "deepseek-harness", "cordis", "theme", "glassmorphism", "claude", "aqua"],
  repository: { type: "git", url: "git+https://github.com/barryjohnson61/dsh-claude-glass.git" },
  dshCompatPatch: {
    by: "dsh-claude-glass build.mjs",
    forRuntime: "0.2.0-rc.2",
    base: `${OLD_PKG}@${basePkg.version}`,
    changes: [
      `AQUA_TOKEN_OVERRIDES -> ${pairs.length} Claude --dsw-* tokens parsed from dsh-claude-theme/claude/skin.css`,
      `COMPAT_SURFACE_OVERRIDES -> aqua's ${compatPairs.length} compat-mode surface keys, painted SOLID in Claude's colour (the key list is upstream's, the 0.45-0.88 alphas are not reused: over Claude's warm palette a translucent --dsw-alias-bg-layer-1 repaints every conversation row, sidebar and card and the whole flat mode reads as a wash). The opaque canvas --dsw-alias-bg-base, the modal scrims --dsw-alias-bg-mask-*, --dsw-specific-sidebar-fill and --dsw-alias-bg-skeleton are deliberately NOT in that list`,
      "aqua.module.css: cool-blue literals recoloured to the Claude palette",
      "aqua.module.css: radius ladder 14/20/24/10 -> 12/16/26/8 (Claude)",
      "aqua.module.css: Space Grotesk overrides -> var(--cl-serif) / var(--cl-sans)",
      "fonts.module.css: Space Grotesk -> Newsreader + Inter + JetBrains Mono (base64 woff2)",
      "claude-layer.css appended (typography, surfaces, tool cards, focus ring, scrollbars)",
      "namespace: dsh-aqua* -> dsh-cglass*, dsh.ui-aqua.* -> dsh.claude-glass.*",
      "default fluidHue 320 (teal) -> 158 (Claude coral)",
      "spotlight.ts tiltable(): the sidebar column never tilts (upstream only skipped it while a [role=dialog] was open, which re-anchored the Windows-titlebar sidebar toggle via the transform containing block)",
      "compat mode: the blanket [class*=card|bubble|panel|popover|dropdown] backdrop-filter is restricted to small transient overlays ([role=menu|tooltip|listbox], [popover]) -- the class substrings also matched the right details pane, md-code-block, the composer card and the sidebar's _2H3hWW_panel* rows. [role=dialog] and [data-shell-overlay] are deliberately excluded: DSH's full-frame overlay layer carries the shell-overlay hook and would frost the whole app",
      "compat mode: COMPAT_SURFACE_OVERRIDES mirrored from aqua's key list instead of a token-name pattern, so the canvas (--dsw-alias-bg-base), the modal scrims (--dsw-alias-bg-mask-*), --dsw-specific-sidebar-fill and --dsw-alias-bg-skeleton stay opaque",
    ],
  },
  // npm auto-includes LICENSE and README.md but NOT NOTICE, so list it explicitly.
  files: [...(basePkg.files ?? []), "NOTICE", "CHANGELOG.md", "licenses"],
  ...(basePkg.dsh ? { dsh: basePkg.dsh } : {}),
}, null, 2) + "\n", "utf8");

cpSync(join(ROOT, "LICENSE"), join(OUT, "LICENSE"));
cpSync(join(ROOT, "README.md"), join(OUT, "README.md"));
cpSync(join(ROOT, "CHANGELOG.md"), join(OUT, "CHANGELOG.md"));
cpSync(join(ROOT, "licenses"), join(OUT, "licenses"), { recursive: true });
// The notice lives in the repository root so that it is browsable on GitHub;
// dist/ simply receives a copy. Same for the licence text above.
cpSync(join(ROOT, "NOTICE"), join(OUT, "NOTICE"));

// Reference export of the parsed token map, written next to the sources (ignored
// by git — it is a pure function of claude/skin.css).
mkdirSync(join(ROOT, "assets"), { recursive: true });
writeFileSync(join(ROOT, "assets", "claude-tokens.json"), JSON.stringify(
  Object.fromEntries(pairs.map(([n, l, d]) => [n, { light: l, dark: d }])), null, 2) + "\n", "utf8");

console.log(`built ${OUT}`);
console.log(`  client.js : ${src0.length} -> ${src.length} bytes (+${src.length - src0.length})`);
console.log(`  edits     : ${hits}`);
console.log(log.join("\n"));
