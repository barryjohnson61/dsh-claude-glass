/* ---------------------------------------------------------------------------
 * dsh-claude-glass — host-side mounts for the ported dsh-claude-theme plugins.
 *
 * NOT a module: `build.mjs` splices this text into `lib/index.js` in place of
 * aqua's `export { apply };`. It therefore sits mid-file, which is legal for
 * ESM — import declarations are hoisted and may appear at any top level — and
 * it relies on the base's `apply` still being in scope, which is exactly why
 * the base's `export { apply };` is the anchor it is spliced at.
 *
 * lan-access owns HTTP routes on the profile's connection, so it has to run on
 * the host; font-switcher serves the font files that the client's three family
 * slots point at. Both were standalone host plugins upstream and each declared
 * its own `inject`, reused here.
 * ------------------------------------------------------------------------- */

import { apply as clgLanAccessApply } from "./lan-access.js";
import { apply as clgFontSwitcherApply } from "./font-switcher.js";

function clgHostMount(ctx, label, deps, mount) {
  try {
    if (typeof ctx.inject !== "function") return;
    ctx.inject(deps, (scope) => {
      try {
        mount(scope);
      } catch (error) {
        console.error(`[claude-glass] ${label} skipped: ${String(error)}`);
      }
    });
  } catch (error) {
    console.error(`[claude-glass] ${label} skipped: ${String(error)}`);
  }
}

/* The base half registers the pass-through settings namespace the appearance
 * card dispatches on. It keeps its own behaviour; only its failure is
 * contained, so that a broken settings seam cannot also cost the LAN routes. */
const clgBaseApply = apply;

function applyWithPortedPlugins(ctx) {
  try {
    clgBaseApply(ctx);
  } catch (error) {
    console.error(`[claude-glass] settings namespace skipped: ${String(error)}`);
  }
  clgHostMount(ctx, "dsh-lan-access", ["connection", "webServer"], clgLanAccessApply);
  clgHostMount(ctx, "dsh-font-switcher", ["connection"], clgFontSwitcherApply);
}

export { applyWithPortedPlugins as apply };
