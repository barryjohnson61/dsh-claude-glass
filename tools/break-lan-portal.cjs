// Deliberately break a built bundle so the LAN-panel guard can be seen failing.
// The panel's scrim is `position: fixed` and the seat renders inside the
// sidebar, whose glass surfaces are `backdrop-filter` — i.e. containing blocks.
// Rendered in place (upstream's code), the scrim is laid out against the
// sidebar column and covers the sidebar's own chrome; that is the live report
// ("the GUI falls apart when I click the checkbox repeatedly"). This script puts
// that in-place render back, so both guards must object.
//
// Usage:
//   node tools/break-lan-portal.cjs dist/dsh-claude-glass/lib/client.js
//   node verify.mjs dist/dsh-claude-glass/lib/client.js     # -> BAD, exit 1
//   node tools/mount-smoke.mjs                              # -> FAIL, exit 1
//   node build.mjs --base … --claude …                      # -> rebuilds the good bundle
//
// It edits the file in place: always rebuild afterwards.
const fs = require("node:fs");

const file = process.argv[2] || "dist/dsh-claude-glass/lib/client.js";
const portal = "return clgPortal(scrim, document.body);";
const inPlace = "return scrim;";

const source = fs.readFileSync(file, "utf8");
if (!source.includes(portal)) throw new Error(`the portal call is not in ${file} — build first`);
fs.writeFileSync(file, source.split(portal).join(inPlace));
console.log(`removed the LAN scrim portal from ${file} (rebuild to restore)`);
