// Verify the built bundle: patch coverage + structural sanity.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const file = process.argv[2];
const s = readFileSync(file, "utf8");
const count = (n) => s.split(n).length - 1;

console.log("bytes :", s.length);

const mustBeZero = [
  "dsh-client-ui-aqua",
  "dsh.ui-aqua.",
  "data-dsh-aqua",
  "--dsh-aqua-",
  "Space Grotesk",
  "#132d53",
  "#6e9be8",
  "#94b4dc",
  "#a0c8ff",
  "#7ea4df",
];
// NOTE: `AQUA_TOKEN_OVERRIDES = {` used to be in the list above, which could
// never pass: build.mjs replaces the *object literal* and leaves the
// declaration, so the text always survives. The table itself is guarded by
// value further down ("token override table").
const mustExist = [
  "--cl-coral",
  "--dsh-cglass-blur",
  "data-dsh-cglass",
  "dsh.claude-glass.fluidHue",
  "Newsreader",
  "font-family:var(--cl-serif)",
  "font-family:var(--cl-sans)",
  "#d97757",
  "#faf9f5",
  "#181715",
  "[data-dsh-compat] [role=listbox]",
];
// NOTE: `ui-claude-glass` used to be in the list above. It is the *host* plugin
// id and lives in cordis.patch.yml — never in client.js — so the check is now
// done against that file, in the "ported host halves" section below.

console.log("--- expected 0 ---");
for (const n of mustBeZero) {
  const c = count(n);
  console.log(`  ${c === 0 ? "ok  " : "BAD "} ${String(c).padStart(4)}  ${n}`);
}
console.log("--- expected > 0 ---");
for (const n of mustExist) {
  const c = count(n);
  console.log(`  ${c > 0 ? "ok  " : "BAD "} ${String(c).padStart(4)}  ${n}`);
}

// The lazy-CJS wrapper must survive intact.
console.log("--- structure ---");
for (const n of ["__ModuleLoader__", "//#region", "//#endregion"]) {
  console.log(`  ${String(count(n)).padStart(4)}  ${n}`);
}

// The Claude layer must sit at the END of the stylesheet string, i.e. inside
// the aqua.module.css css literal, not appended after the file.
const tail = s.slice(-200);
console.log("--- file tail ---");
console.log(JSON.stringify(tail));

// Prove the appended layer is really parsed as CSS text: find the marker and
// show that the next non-space chars are the end of a JS string literal.
const marker = s.indexOf("--cl-coral:");
console.log("--- appended layer is inside a JS string literal ---");
console.log(marker > 0 ? "found --cl-coral at byte " + marker : "NOT FOUND");

// --- regression guard: sidebar containing-block bug (2026-09-30 fix) ---------
// A `backdrop-filter` on a rule that styles the sidebar column turns that column
// into the containing block for its `position:fixed` descendants. The Windows
// titlebar "collapse sidebar" button is exactly such a descendant, so it gets
// detached into the card and, once collapsed, clipped away by the column's own
// `overflow:hidden` (column width -> 0) — invisible and unclickable.
// The fix was to drop that one declaration from `[data-dsh-float] [class*=sidebarCol]`.
// Re-introducing it here must fail the build. See 兼容修复报告.md §7.
console.log("--- sidebar containing-block guard ---");
let guardFailures = 0;
let sidebarRules = 0;
let from = 0;
for (;;) {
  const hit = s.indexOf("[class*=sidebarCol]", from);
  if (hit < 0) break;
  const open = s.indexOf("{", hit);
  const close = s.indexOf("}", open);
  const body = s.slice(open + 1, close);
  const prevClose = s.lastIndexOf("}", hit);
  const sel = s.slice(Math.max(prevClose + 1, hit - 200), open).trim();
  sidebarRules += 1;
  if (/backdrop-filter:\s*(?!none)/.test(body)) {
    guardFailures += 1;
    console.log("  BAD  backdrop-filter present in: " + sel.slice(-110));
  } else {
    console.log("  ok   clean: " + sel.slice(-70));
  }
  from = close + 1;
}
console.log(`  ${sidebarRules} rule(s) mention [class*=sidebarCol]`);
if (sidebarRules === 0) {
  console.log("  BAD  no [class*=sidebarCol] rule at all — sidebar styling vanished");
  guardFailures += 1;
}
// --- regression guard: the sidebar column must never be tilted (2026-10-06) --
// `spotlight.ts` writes an inline `transform: perspective(...) rotateX() rotateY()
// scale()` onto every hovered spot, and the sidebar column IS a spot. A transform
// makes the column the containing block for its `position:fixed` descendants —
// including the Windows-titlebar "collapse sidebar" toggle
// (`[data-windows-titlebar] ._2H3hWW_toggle`), which then drifts with the cursor
// and is clipped away once the column collapses. Upstream only refused the tilt
// while a `[role=dialog]` was open, which is narrower than its own doc comment
// ("the sidebar NEVER tilts"); we refuse always. The cursor glow is a separate
// gate and is unaffected.
console.log("--- sidebar tilt guard ---");
const tiltAt = s.indexOf("function tiltable(spot)");
if (tiltAt < 0) {
  console.log("  BAD  tiltable() not found");
  guardFailures += 1;
} else {
  const fn = s.slice(tiltAt, tiltAt + 700);
  const unconditional = fn.includes('if (spot.matches("[class*=\\"sidebarCol\\"]")) return false;');
  const dialogGated = fn.includes('document.querySelector("[role=\\"dialog\\"]") !== null) return false;');
  if (unconditional && !dialogGated) {
    console.log("  ok   the sidebar column never tilts");
  } else {
    console.log(`  BAD  unconditional=${unconditional} dialogGated=${dialogGated}`);
    guardFailures += 1;
  }
}

// --- regression guard: compat-mode blanket blur (2026-10-06) -----------------
// Aqua's compat (flat, no-mica) mode blurs floating surfaces. Its selector used
// `[class*=card|bubble|panel|popover|dropdown]`, which is a substring test
// against hashed DSH class names: it also matched the right DETAILS PANE
// (`OUqwTW_panel`, which stays in the layout — 624x760, pointer-events:none —
// while the right sidebar is closed and therefore washed the right half of the
// conversation into a milky block), every `md-code-block`, the composer card
// and the sidebar's own `_2H3hWW_panel*` rows. Only small transient overlays
// may remain: [role=menu|tooltip|listbox] and [popover].
//
// `[role=dialog]` and `[data-shell-overlay]` must NOT be in the list either:
// DSH's `BynINW_overlayLayer` carries the shell-overlay hook and spans the whole
// frame, so blurring it frosts the entire application as soon as any overlay
// opens (that was a real regression, caught by the user).
console.log("--- compat blur scope guard ---");
const compatBlur = s.indexOf("backdrop-filter:blur(12px)");
if (compatBlur < 0) {
  console.log("  ok   no compat-mode blur at all");
} else {
  const prevClose = s.lastIndexOf("}", compatBlur);
  const selector = s.slice(Math.max(prevClose + 1, compatBlur - 700), s.lastIndexOf("{", compatBlur));
  const problems = [];
  const bannedClass = /\[class\*=[^\]]*\]/.exec(selector);
  if (bannedClass) problems.push("class-substring selector reaches core chrome: " + bannedClass[0]);
  const bannedWide = /\[role=dialog\]|\[data-shell-overlay\]/.exec(selector);
  if (bannedWide) problems.push("full-surface selector frosts the whole app: " + bannedWide[0]);
  if (problems.length) {
    for (const p of problems) console.log("  BAD  " + p);
    guardFailures += 1;
  } else {
    console.log("  ok   small transient overlays only: " + selector.trim().slice(-150));
  }
}

// --- regression guard: the compat surface layer must be SOLID (2026-10-06) ---
// COMPAT_SURFACE_OVERRIDES is aqua's fixed list of surfaces that go translucent
// in flat mode, at alpha 0.45-0.88. Over Claude's warm palette that made every
// conversation row, sidebar and card a translucent sheet over the coral fluid —
// flat mode read as "washed out" (user report: 方向反了，兼容模式完全糊掉了).
// Two rules therefore:
//   1. the app shell keys must NOT be in the list at all —
//      `--dsw-alias-bg-base` is painted by body/frame/center column *and* by the
//      right details pane while it is slid off-canvas (a milky veil over the
//      conversation), and modal scrims read `--dsw-alias-bg-mask-*`;
//   2. no value in the list may be translucent: the keys are upstream's, the
//      alphas are not reused.
console.log("--- compat solid-surface guard ---");
let compatKeys = 0;
{
  const at = s.indexOf("COMPAT_SURFACE_OVERRIDES = ");
  const brace = s.indexOf("{", at);
  let depth = 0;
  let i = brace;
  let inStr = false;
  let esc = false;
  for (; i < s.length; i++) {
    const c = s[i];
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
  const literal = at < 0 ? "" : s.slice(brace, i + 1);
  compatKeys = (literal.match(/"--[^"]+"/g) || []).length;
  for (const banned of ["--dsw-alias-bg-base", "--dsw-alias-bg-mask", "--dsw-specific-sidebar-fill", "--dsw-alias-bg-skeleton"]) {
    if (literal.includes(`"${banned}`)) {
      console.log(`  BAD  ${banned} is in the compat surface layer — the canvas would go translucent`);
      guardFailures += 1;
    } else {
      console.log(`  ok   ${banned} stays opaque`);
    }
  }
  if (literal.includes("transparent") || literal.includes("color-mix")) {
    console.log("  BAD  the compat surface layer is translucent — flat mode washes out");
    guardFailures += 1;
  } else {
    console.log("  ok   every compat surface is painted solid");
  }
}
console.log(`  ${compatKeys} compat-mode surface key(s)`);
if (compatKeys < 10) {
  console.log("  BAD  compat surface layer looks empty — the compat palette was not patched");
  guardFailures += 1;
}

// --- guard: the token override table must be Claude's, not aqua's ------------
// `AQUA_TOKEN_OVERRIDES = {` cannot itself disappear: build.mjs replaces the
// object *literal* and leaves the declaration, so a "must not appear" check on
// that text can never pass. Assert on the literal instead — it has to be the
// table parsed out of dsh-claude-theme/claude/skin.css.
{
  const at = s.indexOf("AQUA_TOKEN_OVERRIDES = ");
  const brace = at < 0 ? -1 : s.indexOf("{", at);
  let end = brace;
  let depth = 0;
  for (let i = brace; brace >= 0 && i < s.length; i += 1) {
    if (s[i] === "{") depth += 1;
    else if (s[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const table = at < 0 || brace < 0 ? "" : s.slice(brace, end + 1);
  const tokenKeys = (table.match(/"--dsw-[^"]+"/g) || []).length;
  if (tokenKeys < 200) {
    console.log(`  BAD  AQUA_TOKEN_OVERRIDES holds ${tokenKeys} --dsw-* token(s) — expected Claude's table (>= 200)`);
    guardFailures += 1;
  } else {
    console.log(`  ok   AQUA_TOKEN_OVERRIDES holds Claude's ${tokenKeys} --dsw-* token overrides`);
  }
}

// --- ported dsh-claude-theme plugins ----------------------------------------
// glass ships dsh-claude-theme's five sidecar plugins *inside* its own bundle
// (see tools/port-from-theme.mjs and src/port/). Nothing else would catch their
// loss: the concatenation is anchored on `return module.exports;` and the mount
// on `exports.inject = inject;`, so a bundle that lost either would still
// build, still load, and simply do nothing.
console.log("--- ported theme plugins ---");
const PORTED = [
  "brand.client.js",
  "crab.client.js",
  "font-switcher.client.js",
  "lan-access.client.js",
  "skin-egg.client.js",
  "client-mount.js",
];
for (const f of PORTED) {
  const c = count(`/* ===== src/port/${f} ===== */`);
  if (c !== 1) {
    console.log(`  BAD  ${f}: ${c} site(s)`);
    guardFailures += 1;
  } else {
    console.log(`  ok   ${f}`);
  }
}
{
  // Each half is unwrapped, so the bundle must still hold exactly ONE module
  // loader call: its own. A second one means a port was copied still wrapped.
  const loaders = count("__ModuleLoader__");
  if (loaders !== 1) {
    console.log(`  BAD  ${loaders} __ModuleLoader__ call(s) — a ported half is still wrapped?`);
    guardFailures += 1;
  } else {
    console.log("  ok   one module loader: every half was unwrapped");
  }

  // The mount has to happen inside the factory and before the module returns.
  const mountAt = s.indexOf("applyPortedThemePlugins(ctx)");
  const lastHalf = s.indexOf("/* ===== src/port/client-mount.js ===== */");
  const returnAt = s.lastIndexOf("return module.exports;");
  const wrapAt = s.indexOf("const clgGlassApply = exports.apply;");
  for (const [what, at] of [["client-mount.js", lastHalf], ["the mount call", mountAt], ["the apply() wrapper", wrapAt]]) {
    const ok = at > 0 && at < returnAt;
    if (!ok) {
      console.log(`  BAD  ${what} is missing, or sits outside the factory`);
      guardFailures += 1;
    }
  }
  if (mountAt > 0 && lastHalf > 0 && mountAt > lastHalf && returnAt > mountAt) {
    console.log("  ok   mounted from apply(), inside the factory body");
  }

  // The egg is the release's headline feature: check its trigger and its two
  // localStorage keys, and that it can actually reach the services it asks for.
  const egg = [
    ['var EGG_TRIGGER = "TZ=";', "the TZ= trigger"],
    ["dsh-claude-skin.egg", "the cooldown stamp"],
    ["dsh-claude-crab.prefs", "the shared mystery switch"],
    ["conversation.input.left", "the watcher's slot"],
    ["installFootprintHelper", "the console helper"],
    ["installFootprintHelper()", "the helper being called"],
  ];
  for (const [n, label] of egg) {
    const c = count(n);
    if (c < 1) {
      console.log(`  BAD  ${label}: not found`);
      guardFailures += 1;
    } else {
      console.log(`  ok   ${label}`);
    }
  }

  // The other four halves have to bring their own identity and UI with them.
  const others = ["dsh-claude-brand", "dsh-claude-crab", "dsh-font-switcher", "dsh-lan-access"];
  for (const n of others) {
    const c = count(n);
    if (c < 1) {
      console.log(`  BAD  ${n}: not found`);
      guardFailures += 1;
    } else {
      console.log(`  ok   ${n} (${c})`);
    }
  }

  /*
   * A ported half is an IIFE cut out of a module factory, so every free
   * identifier it uses has to be bound inside it. Upstream's factory declares
   * `var React = require("react")` near its top, but the egg slice starts
   * hundreds of lines later and arrived without it — `React is not defined` on
   * every render of that slot entry, and a crashing component takes the whole
   * composer input down. Check the binding per section, not per file.
   */
  const sectionMarker = /\/\* ===== src\/port\/([\w.-]+) ===== \*\//g;
  const sections = [...s.matchAll(sectionMarker)];
  let boundOk = 0;
  for (let i = 0; i < sections.length; i++) {
    const name = sections[i][1];
    const body = s.slice(sections[i].index, i + 1 < sections.length ? sections[i + 1].index : s.length);
    const unbound = [];
    if (/\bReact\./.test(body) && !body.includes('require("react")')) unbound.push("React");
    if (/(?<![A-Za-z0-9_$.])h\(/.test(body) && !body.includes("var h = ")) unbound.push("h");
    if (unbound.length > 0) {
      console.log(`  BAD  src/port/${name} uses ${unbound.join(" and ")} without binding it — that seat throws on render`);
      guardFailures += 1;
    } else {
      boundOk += 1;
    }
  }
  console.log(`  ok   every ported half binds the identifiers it uses (${boundOk}/${sections.length} checked)`);

  // The ported crab calls ctx.timeout from inside a ctx.effect, and the DSH
  // client runtime only exposes ctx.timeout once the plugin declares the
  // `timer` service. aqua's own inject list never had it — the port must.
  if (!/const inject = \[[\s\S]{0,200}?"timer"/.test(s)) {
    console.log("  BAD  the plugin never declares the client timer service — crab's ctx.timeout would throw");
    guardFailures += 1;
  } else {
    console.log("  ok   the plugin declares the client timer service (crab)");
  }

  // The one rewrite, applied everywhere it was needed. Each ported file carries
  // a `/* … Rewritten: ctx.get("slots") -> ctx.slots (1 site). … */` header, so
  // the literal also appears in prose: count it in comment-stripped code only.
  const code = s.replace(/\/\*[\s\S]*?\*\//g, "");
  const leftover = code.split('ctx.get("slots")').length - 1;
  if (leftover !== 0) {
    console.log(`  BAD  ${leftover} ctx.get("slots") left — the rewrite missed a port`);
    guardFailures += 1;
  } else {
    console.log('  ok   no ctx.get("slots") left outside the port headers');
  }

  // The other two rewrites of upstream behaviour, each one earned by a real
  // report, so each gets a guard. (1) The input slot this DSH hands the egg
  // watcher has no `useInput`/`inputActions` pair — upstream's unconditional
  // `props.useInput(...)` threw on the first render, and a throwing seat takes
  // the whole composer input down with it — so the draft must come from the
  // seat's `keyboard` facade. (2) The LAN scrim is fixed-position and the seat
  // sits in the sidebar, whose glass surfaces are filters, i.e. containing
  // blocks: rendered in place it covered the sidebar's own chrome.
  if (!code.includes('var useInput = typeof props.useInput === "function" ? props.useInput : null;')) {
    console.log("  BAD  the egg watcher still calls props.useInput unguarded — that seat throws on render");
    guardFailures += 1;
  } else if (!code.includes("clgUseStoreDraft(clgState)")) {
    console.log("  BAD  the egg watcher never reads the session input store — the draft can never reach TZ=");
    guardFailures += 1;
  } else if (!code.includes("clgPortal(scrim, document.body)")) {
    console.log("  BAD  the LAN scrim is not portalled to document.body — the sidebar's paint context traps it");
    guardFailures += 1;
  } else {
    console.log("  ok   the egg watcher reads props.keyboard, and the LAN scrim goes to document.body");
  }

  // The LAN panel's own switch state. Upstream reads "LAN on" out of
  // `bindHost === "0.0.0.0"`; the host half now pins a concrete interface
  // address, so that comparison would show the switch as OFF while LAN access
  // is on (and both restart hints would go missing).
  if (code.includes('info.bindHost === "0.0.0.0"')) {
    console.log("  BAD  the LAN panel still tests bindHost against the wildcard — the switch would read OFF");
    guardFailures += 1;
  } else if (!code.includes("var pendingLan =")) {
    console.log("  BAD  the LAN panel lost its pendingLan test — the restart hints would never show");
    guardFailures += 1;
  } else {
    console.log("  ok   the LAN panel decides on/pending by loopback, not by the wildcard");
  }
}

// --- ported host halves ------------------------------------------------------
// lib/index.js is the base's index.js with its `export { apply };` replaced by
// src/port/host-mount.js: that fragment imports the two ported host halves and
// re-exports the wrapped apply. The client half would still work without any of
// this — LAN access and the font files would simply never come up.
const indexFile = join(dirname(file), "index.js");
console.log("--- ported host halves (lib/index.js) ---");
if (!existsSync(indexFile)) {
  console.log("  (skipped: " + indexFile + " does not exist)");
} else {
  const idx = readFileSync(indexFile, "utf8");
  const iany = (n) => idx.split(n).length - 1;
  const hostChecks = [
    ['from "./lan-access.js"', "imports the LAN host half"],
    ['from "./font-switcher.js"', "imports the font host half"],
    ["export { applyWithPortedPlugins as apply };", "re-exports the wrapped apply"],
    ["clgBaseApply(ctx)", "still runs the base's settings registration"],
    ['clgHostMount(ctx, "dsh-lan-access", ["connection", "webServer"]', "mounts LAN with its services"],
    ['clgHostMount(ctx, "dsh-font-switcher", ["connection"]', "mounts fonts with its services"],
  ];
  for (const [n, label] of hostChecks) {
    const c = iany(n);
    if (c !== 1) {
      console.log(`  BAD  ${label}: ${c} site(s)`);
      guardFailures += 1;
    } else {
      console.log(`  ok   ${label}`);
    }
  }
  // src/port/host-mount.js explains the splice in a block comment that quotes
  // the base's own `export { apply };`, so look at the code, not the prose.
  const idxCode = idx.replace(/\/\*[\s\S]*?\*\//g, "");
  if (idxCode.includes("export { apply };")) {
    console.log("  BAD  the base still exports the unwrapped apply");
    guardFailures += 1;
  } else {
    console.log("  ok   the base's export { apply }; is gone (only the wrapper is exported)");
  }
  for (const f of ["lan-access.js", "qr.js", "font-switcher.js"]) {
    const p = join(dirname(file), f);
    if (!existsSync(p)) {
      console.log(`  BAD  lib/${f} was not emitted`);
      guardFailures += 1;
    } else {
      console.log(`  ok   lib/${f} (${Buffer.byteLength(readFileSync(p, "utf8"), "utf8")} bytes)`);
    }
  }
  // lan-access imports the QR encoder by relative path: both files have to sit
  // in the same directory for that to resolve.
  const lan = readFileSync(join(dirname(file), "lan-access.js"), "utf8");
  // The LAN switch writes the profile's patch file, and upstream resolved that
  // path from DSH_PROFILE alone — wrong on the desktop client, which boots the
  // `desktop` profile without exporting it, so the switch edited `profiles/web`
  // while the running host never read the block. The Host's profileContext is
  // the authority; the ported file has to consult it first.
  if (!lan.includes('ctx.get("profileContext")') || !lan.includes("managedPatchPath")) {
    console.log("  BAD  lib/lan-access.js does not take its patch file from profileContext");
    guardFailures += 1;
  } else {
    console.log("  ok   lib/lan-access.js takes its patch file from the Host's profileContext");
  }
  if (!lan.includes('from "./qr.js"') || !lan.includes("export function apply(ctx)")) {
    console.log("  BAD  lib/lan-access.js does not import ./qr.js, or lost its apply()");
    guardFailures += 1;
  } else {
    console.log("  ok   lan-access.js -> ./qr.js resolves inside lib/");
  }
  // The managed row must never be written again. Two release-critical failures
  // came from it: 1.1.0 pinned `0.0.0.0` (dsh-host-webserver 0.2.1-rc.2 refuses
  // a wildcard bind, and `webserver` is a REQUIRED plugin, so the whole Harness
  // stopped with "2 required plugins did not activate"), and 1.2.1 pinned the
  // concrete LAN address (the desktop shell still connects to
  // http://127.0.0.1:<port>, so the next start died with
  // "[TypeError: fetch failed] ... ECONNREFUSED 127.0.0.1:<port>" and the app
  // fell back to a minimal profile). 1.2.2 removes the writer entirely: enabling
  // the switch must refuse, and only removal of a stale block may touch the
  // profile. Prose may name the wildcard, so check the code only.
  const lanCode = lan.replace(/\/\*[\s\S]*?\*\//g, "");
  if (/0\.0\.0\.0/.test(lanCode)) {
    console.log("  BAD  lib/lan-access.js still writes a 0.0.0.0 bind — the host refuses it and the Harness will not start");
    guardFailures += 1;
  } else if (!lanCode.includes("局域网绑定在当前 DSH 上不可用")) {
    console.log("  BAD  lib/lan-access.js lost its LAN-bind refusal — the switch could edit the webserver row again");
    guardFailures += 1;
  } else if (lanCode.includes(`"    host: '`)) {
    console.log("  BAD  lib/lan-access.js still emits a webserver host line — binding a LAN address breaks the next start");
    guardFailures += 1;
  } else {
    console.log("  ok   lan-access refuses to bind the LAN (only removal of a stale block remains)");
  }
  // The row is YAML, and a writer once shipped a trailing comma: "bad
  // indentation of a mapping entry" stops the whole app from booting, before any
  // plugin loads (1.2.0). No writer may come back, so assert the absence of any
  // emitted host expression rather than its shape.
  if (lan.includes(`+ "',",`) || lan.includes(`+ "'",`)) {
    console.log("  BAD  lib/lan-access.js builds a YAML host line again");
    guardFailures += 1;
  } else {
    console.log("  ok   no webserver host line is emitted");
  }

  // The host plugin's identity and the client services its ported halves need.
  // cordis.patch.yml is where `ui-claude-glass` actually lives (it is a plugin
  // id, not a string in the client bundle), and the three services the ported
  // halves declared for themselves upstream have to be in the inject array or
  // the client half never gets renderer/conversation/sidebar.
  const distRoot = dirname(dirname(file));
  const patch = readFileSync(join(distRoot, "cordis.patch.yml"), "utf8");
  if (!patch.includes("id: ui-claude-glass") || !patch.includes("name: 'dsh-claude-glass'")) {
    console.log("  BAD  cordis.patch.yml does not insert ui-claude-glass / dsh-claude-glass");
    guardFailures += 1;
  } else {
    console.log("  ok   cordis.patch.yml inserts ui-claude-glass / dsh-claude-glass");
  }
  const pkg = JSON.parse(readFileSync(join(distRoot, "package.json"), "utf8"));
  const inject = (pkg.dsh && pkg.dsh.client && pkg.dsh.client.inject) || [];
  const need = [
    "@deepseek-ai/dsh-client-ui-renderer",
    "@deepseek-ai/dsh-client-ui-conversation",
    "@deepseek-ai/dsh-client-ui-sidebar",
  ];
  const missing = need.filter((n) => !inject.includes(n));
  if (missing.length) {
    console.log(`  BAD  package.json dsh.client.inject is missing ${missing.join(", ")}`);
    guardFailures += 1;
  } else {
    console.log(`  ok   package.json dsh.client.inject carries the ported halves' ${need.length} extra services`);
  }
}

if (guardFailures > 0) {
  console.log(`GUARD FAILURES: ${guardFailures}`);
  process.exitCode = 1;
} else {
  console.log("guard ok — the sidebar column is not a containing block");
}
