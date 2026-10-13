/* ---------------------------------------------------------------------------
 * dsh-claude-glass — the mount point for the ported dsh-claude-theme plugins.
 *
 * NOT a module: this file is a fragment. `build.mjs` concatenates it into the
 * factory body of `lib/client.js`, immediately after the five
 * `src/port/*.client.js` halves whose names it reads, and wires it to glass's
 * own `apply()`.
 *
 * Each of those five was a standalone plugin upstream: each declared its own
 * `inject` and expected to be handed a context. They cannot be installed
 * beside glass — glass is ONE plugin row, and every one of them claims slots
 * and settings pages that glass now owns — so they are mounted here instead,
 * each through its own `inject` list, which is the closest thing to "as if it
 * were still its own plugin".
 *
 * A failure in one half must not take the skin down with it: a ported plugin
 * that throws, or that cannot get the service it declared, is logged and
 * skipped while the other four still mount.
 * ------------------------------------------------------------------------- */

/* Every name below is initialised above this fragment, so building the array
 * here is safe. Theme order is kept: brand, crab, fonts, LAN, the egg. */
const CLG_PORTS = [portBrand, portCrab, portFontSwitcher, portLanAccess, portSkinEgg];

function clgPortWarn(port, error) {
  try {
    console.warn("[dsh-claude-glass] " + port.name + " did not mount: " + String(error));
  } catch (ignored) {
    /* a console that throws is not worth failing the whole bundle over */
  }
}

function clgPortMount(scope, port) {
  try {
    port.apply(scope);
  } catch (error) {
    clgPortWarn(port, error);
  }
}

function clgPortInstall(ctx, port) {
  if (port === undefined || typeof port.apply !== "function") return;
  try {
    if (typeof ctx.inject === "function") {
      ctx.inject(port.inject || [], function (scope) {
        clgPortMount(scope, port);
      });
    } else {
      clgPortMount(ctx, port);
    }
  } catch (error) {
    clgPortWarn(port, error);
  }
}

/** Called once, from glass's own `apply()`, with the plugin context. */
function applyPortedThemePlugins(ctx) {
  for (let i = 0; i < CLG_PORTS.length; i++) clgPortInstall(ctx, CLG_PORTS[i]);
}
