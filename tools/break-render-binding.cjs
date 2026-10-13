// Deliberately break a built bundle so the render-safety guards can be seen
// failing. tools/mount-smoke.mjs renders every registered slot entry once, and
// verify.mjs checks that each ported section binds the identifiers it uses —
// this script removes the `React` binding the generator injects in front of the
// ported skin-egg section, which is exactly the crash users hit live
// (`React is not defined` in `conversation.input.left` took the composer's input
// area down with it).
//
// Usage:
//   node tools/break-render-binding.cjs dist/dsh-claude-glass/lib/client.js
//   node verify.mjs dist/dsh-claude-glass/lib/client.js     # -> BAD, exit 1
//   node tools/mount-smoke.mjs                              # -> FAIL render …, exit 1
//   node build.mjs --base … --claude …                      # -> rebuilds the good bundle
//
// It edits the file in place: always rebuild afterwards.
const fs = require("node:fs");

const file = process.argv[2] || "dist/dsh-claude-glass/lib/client.js";
const marker = "/* ===== src/port/skin-egg.client.js ===== */\n";
const prologue = 'var React = require("react");\n\t\tvar h = React.createElement;\n';

const source = fs.readFileSync(file, "utf8");
const at = source.indexOf(marker);
if (at < 0) throw new Error(`section marker not found in ${file} — build first`);
// The generator writes the section's provenance header first and the prologue
// after it, so scan forward — but never past the next section marker.
const pro = source.indexOf(prologue, at);
const nextMarker = source.indexOf("/* ===== src/port/", at + marker.length);
if (pro < 0 || (nextMarker >= 0 && pro > nextMarker)) {
  throw new Error("the React prologue is not inside the skin-egg section");
}

fs.writeFileSync(file, source.slice(0, pro) + source.slice(pro + prologue.length));
console.log(`removed the skin-egg React binding from ${file} (rebuild to restore)`);
