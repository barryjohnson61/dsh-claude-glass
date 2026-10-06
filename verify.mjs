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

if (guardFailures > 0) {
  console.log(`GUARD FAILURES: ${guardFailures}`);
  process.exitCode = 1;
} else {
  console.log("guard ok — the sidebar column is not a containing block");
}
