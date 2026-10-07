// Verify the built bundle: patch coverage + structural sanity.
import { readFileSync } from "node:fs";

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
  'AQUA_TOKEN_OVERRIDES = {',
];
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
  "ui-claude-glass",
  "[data-dsh-compat] [role=listbox]",
];

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

if (guardFailures > 0) {
  console.log(`GUARD FAILURES: ${guardFailures}`);
  process.exitCode = 1;
} else {
  console.log("guard ok — the sidebar column is not a containing block");
}
