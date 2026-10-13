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
 * that own routes — lan-access and font-switcher — are lifted into
 * `src/port/<published-name>.js` to be copied into `lib/`.
 *
 * "Verbatim" means verbatim, with every rewrite listed here and recorded in the
 * header of each file it touches:
 *
 *   ctx.get("slots") -> ctx.slots        (all five client halves)
 *   the managed patch file's resolution  (lib/lan-access.js)
 *
 * glass's client context injects `slots` directly — aqua's bundle has always
 * read it as `ctx.slots` — so the theme's defensive `ctx.get` lookup is
 * unnecessary here, and its behaviour on a context that never declared the
 * lookup is not something worth depending on.
 *
 * The second rewrite is a bug fix rather than a translation. Upstream resolves
 * the profile whose `cordis.patch.yml` it edits from `DSH_PROFILE` alone, and
 * the DSH desktop client boots the `desktop` profile without exporting it: the
 * switch therefore wrote `profiles/web` — a profile that does not exist, so the
 * panel reported `ENOENT` — while the running host never read the block. The
 * Host publishes the launched profile on its `profileContext` service, so the
 * rewrite consults that first and keeps the environment as the fallback.
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

/* ------------------------------------- lan-access client: the dialog portal */

/**
 * `.dla-scrim` is `position:fixed`, and the panel is registered on
 * `sidebar.footer.action` — so it renders inside the sidebar column. Glass
 * gives its surfaces a `backdrop-filter`, and a filtered ancestor is the
 * containing block for its fixed-position descendants: the dialog was then laid
 * out inside the sidebar card, on top of the navigation (it looked as if the
 * sidebar had fallen apart) instead of over the viewport. Glass neutralises the
 * column itself while a dialog sits in it, but the surface in between is still
 * glassy, so the panel has to leave that paint context altogether.
 *
 * The shell renders its own dialogs as children of `document.body` (that is
 * where glass styles `[role=dialog]`), so the scrim goes out through
 * `react-dom`'s portal. A runtime that cannot resolve react-dom still renders
 * the panel in place.
 */
const LAN_CLIENT_BIND_ANCHOR = "\t\tvar h = React.createElement;";

const LAN_CLIENT_BIND_FIXED = [
  "\t\tvar h = React.createElement;",
  "",
  "\t\t/* react-dom is part of the client runtime (other installed plugins",
  "\t\t * require it). The portal it provides is what carries the dialog out of",
  "\t\t * the sidebar's paint context; a runtime without it renders in place. */",
  "\t\tvar clgReactDOM = null;",
  "\t\ttry { clgReactDOM = require(\"react-dom\"); } catch (e) { clgReactDOM = null; }",
  "\t\tvar clgPortal = clgReactDOM && typeof clgReactDOM.createPortal === \"function\"",
  "\t\t\t? clgReactDOM.createPortal : null;",
].join("\n");

const LAN_CLIENT_PORTAL_ANCHOR = [
  "\t\t\treturn h(",
  "\t\t\t\t\"div\",",
  "\t\t\t\t{",
  "\t\t\t\t\tclassName: \"dla-scrim\",",
  "\t\t\t\t\trole: \"dialog\",",
  "\t\t\t\t\t\"aria-modal\": \"true\",",
  "\t\t\t\t\t\"aria-label\": \"手机访问\",",
  "\t\t\t\t\tonClick: function (e) { if (e.target === e.currentTarget) props.onClose(); },",
  "\t\t\t\t},",
  "\t\t\t\tcard,",
  "\t\t\t);",
  "\t\t}",
].join("\n");

const LAN_CLIENT_PORTAL_FIXED = [
  "\t\t\tvar scrim = h(",
  "\t\t\t\t\"div\",",
  "\t\t\t\t{",
  "\t\t\t\t\tclassName: \"dla-scrim\",",
  "\t\t\t\t\trole: \"dialog\",",
  "\t\t\t\t\t\"aria-modal\": \"true\",",
  "\t\t\t\t\t\"aria-label\": \"手机访问\",",
  "\t\t\t\t\tonClick: function (e) { if (e.target === e.currentTarget) props.onClose(); },",
  "\t\t\t\t},",
  "\t\t\t\tcard,",
  "\t\t\t);",
  "\t\t\t/* Glass painting note (a rewrite, not upstream's code): the scrim is",
  "\t\t\t * fixed-position, and this seat lives inside the sidebar, whose glass",
  "\t\t\t * surfaces are filters — i.e. containing blocks. Hand it to the shell's",
  "\t\t\t * own dialog layer instead. */",
  "\t\t\tif (clgPortal !== null && typeof document !== \"undefined\" && document.body) {",
  "\t\t\t\treturn clgPortal(scrim, document.body);",
  "\t\t\t}",
  "\t\t\treturn scrim;",
  "\t\t}",
].join("\n");

const LAN_CLIENT_PORTAL_NOTE =
  `Rewritten: LanPanel's scrim is portalled to document.body through\n` +
  `           react-dom. It renders inside the sidebar column, and glass's\n` +
  `           filtered surfaces inside that column are containing blocks, so a\n` +
  `           fixed-position scrim covered the sidebar's own chrome instead of\n` +
  `           the viewport.`;

function portLanAccessClient() {
  const rel = "plugins/lan-access/lib/client.js";
  const label = "lan-access";
  const text = read(rel, label);
  if (text === "") return;
  const body = factoryBody(text, label);
  if (body === "") return;
  require1(body, 'ctx.get("slots")', label);
  const eol = body.includes("\r\n") ? "\r\n" : "\n";
  const portalAnchor = LAN_CLIENT_PORTAL_ANCHOR.split("\n").join(eol);
  const bindOk = require1(body, LAN_CLIENT_BIND_ANCHOR, label);
  const portalOk = require1(body, portalAnchor, label);
  let rewritten = body.split('ctx.get("slots")').join("ctx.slots");
  if (bindOk) rewritten = rewritten.replace(LAN_CLIENT_BIND_ANCHOR, LAN_CLIENT_BIND_FIXED.split("\n").join(eol));
  if (portalOk) rewritten = rewritten.replace(portalAnchor, LAN_CLIENT_PORTAL_FIXED.split("\n").join(eol));
  require1(rewritten, "clgPortal(scrim, document.body)", label);
  const out =
    HEADER(rel, text, `${REWRITE_NOTE}\n${LAN_CLIENT_PORTAL_NOTE}`) +
    `\nconst portLanAccess = (function () {\n` +
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

/**
 * The watcher's source of truth for the composer draft.
 *
 * `conversation.input.left` is rendered with the props of the seat's registry
 * `inject`, and on this DSH the composer's registry returns
 * `keyboard / addFiles / removeAttachment / resolveDraftAttachments /
 * retryFileUpload / toggleCommandMenu / stop / hooks` — the `useInput` +
 * `inputActions` pair upstream reads is handed to the composer's own *view*,
 * not to input slots. Upstream's `props.useInput(...)` therefore threw on the
 * first render and the egg never fired (in the real client that error also
 * blanked the composer's input area).
 *
 * `props.keyboard` is the session's live input facade (`SessionInputShell`):
 * `.state` is its published input store (`getSnapshot()` carries `draft`) and
 * `.actions.setDraft` is its public write. The upstream pair is still honoured
 * first, should a shell hand one over.
 */
const SKIN_WATCHER_ANCHOR = [
  "\t\t\t/* `conversation.input.left` is a session-scope slot, so the renderer",
  "\t\t\t * always hands it SessionStandardProps -- `useInput` and",
  "\t\t\t * `inputActions` are part of the contract, not optional extras.",
  "\t\t\t * They are called unconditionally because a hook behind a",
  "\t\t\t * conditional changes the call order between renders, and React",
  "\t\t\t * throws when that happens. */",
  "\t\t\tvar draft = props.useInput(function (s) { return s.draft; });",
  "\t\t\tvar actions = props.inputActions;",
].join("\n");

const SKIN_WATCHER_FIXED = [
  "\t\t\t/* `conversation.input.left` renders INSIDE the composer bar, so the",
  "\t\t\t * props it is handed are that bar's. This DSH hands input slots no",
  "\t\t\t * `useInput` / `inputActions` pair (only the composer's own view gets",
  "\t\t\t * the pair, and upstream's `props.useInput(...)` threw here on the",
  "\t\t\t * first render), but it does hand over `props.keyboard` — the",
  "\t\t\t * session's live input facade: subscribe to its published input state",
  "\t\t\t * for the draft, write through its action face. Upstream's pair still",
  "\t\t\t * wins when a shell provides one; every branch is decided by what the",
  "\t\t\t * seat passes, which is constant for the life of the app, so the hook",
  "\t\t\t * order never changes between renders. */",
  "\t\t\tvar useInput = typeof props.useInput === \"function\" ? props.useInput : null;",
  "\t\t\tvar shell = props.keyboard;",
  "\t\t\tvar clgState = clgInputStore(shell);",
  "\t\t\tvar viaHook = useInput === null ? null : useInput(function (s) { return s.draft; });",
  "\t\t\tvar viaStore = clgUseStoreDraft(clgState);",
  "\t\t\tvar draft = typeof viaHook === \"string\" ? viaHook",
  "\t\t\t\t: (typeof viaStore === \"string\" ? viaStore : clgShellDraft(shell));",
  "\t\t\tvar actions = props.inputActions;",
  "\t\t\tif (!actions && shell) {",
  "\t\t\t\tif (shell.actions && typeof shell.actions.setDraft === \"function\") actions = shell.actions;",
  "\t\t\t\telse if (typeof shell.setDraft === \"function\") actions = shell;",
  "\t\t\t}",
].join("\n");

const SKIN_WATCHER_CALL = "\t\tfunction FootprintWatcher(props) {";

const SKIN_WATCHER_HELPERS = [
  "\t\t/* ---- glass: reading the composer draft (see FootprintWatcher) ---- */",
  "",
  "\t\t/** The shell's published input-state store, when it publishes one. */",
  "\t\tfunction clgInputStore(shell) {",
  "\t\t\treturn shell && shell.state && typeof shell.state.getSnapshot === \"function\" &&",
  "\t\t\t\ttypeof shell.state.subscribe === \"function\" ? shell.state : null;",
  "\t\t}",
  "",
  "\t\t/** The draft straight off that store, or undefined. */",
  "\t\tfunction clgStoreDraft(store) {",
  "\t\t\tif (store === null) return undefined;",
  "\t\t\tvar snap = store.getSnapshot();",
  "\t\t\treturn snap && typeof snap.draft === \"string\" ? snap.draft : undefined;",
  "\t\t}",
  "",
  "\t\t/**",
  "\t\t * The draft as React must read it.",
  "\t\t *",
  "\t\t * The composer types into its editor and publishes the result to this",
  "\t\t * store; nothing re-renders a seat on a keystroke, so a plain render-time",
  "\t\t * read would only ever see the value the seat mounted with. This is",
  "\t\t * React's supported way to subscribe to an external store.",
  "\t\t */",
  "\t\tfunction clgUseStoreDraft(store) {",
  "\t\t\tif (typeof React.useSyncExternalStore !== \"function\") return clgStoreDraft(store);",
  "\t\t\treturn React.useSyncExternalStore(",
  "\t\t\t\tfunction (onChange) {",
  "\t\t\t\t\treturn store === null ? function () {} : store.subscribe(onChange);",
  "\t\t\t\t},",
  "\t\t\t\tfunction () { return clgStoreDraft(store); },",
  "\t\t\t);",
  "\t\t}",
  "",
  "\t\t/** Last resort: the shell's own render-time snapshot. */",
  "\t\tfunction clgShellDraft(shell) {",
  "\t\t\tvar snap = shell && shell.snapshot;",
  "\t\t\treturn snap && typeof snap.draft === \"string\" ? snap.draft : undefined;",
  "\t\t}",
  "",
  "",
].join("\n");

const SKIN_WATCHER_NOTE =
  `Rewritten: the watcher sources the composer draft from the seat's own props\n` +
  `           (\`props.keyboard\`, the session input facade: subscribe to its\n` +
  `           published input state, write through \`actions.setDraft\`). This DSH\n` +
  `           hands input slots no \`useInput\`/\`inputActions\` pair, so upstream's\n` +
  `           \`props.useInput(...)\` threw on the first render and the egg never\n` +
  `           fired.`;

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
  /* The watcher's props handling is rewritten — see SKIN_WATCHER_FIXED. Its
   * anchor spans lines, so it has to speak the checkout's own line endings. */
  const weol = body.includes("\r\n") ? "\r\n" : "\n";
  const watcherAnchor = SKIN_WATCHER_ANCHOR.split("\n").join(weol);
  require1(body, watcherAnchor, label);

  const from = body.indexOf('var EGG_STORE = "dsh-claude-skin.egg";');
  const to = body.indexOf("function apply(ctx) {");
  if (from < 0 || to < 0 || to <= from) {
    problems.push(`${label}: could not slice the egg out of the skin plugin`);
    return;
  }
  /* The slice starts mid-line, so the first line arrives unindented; give it
   * the two tabs the rest of the body carries and keep the diff honest. */
  let subset = ("\t\t" + body.slice(from, to)).replace(/\s*$/, "\n");
  /* Two rewrites inside the subset: the draft source, and the helpers it needs
   * right above the component. Both are asserted, so upstream drift cannot
   * quietly drop them. */
  subset = subset.split(watcherAnchor).join(SKIN_WATCHER_FIXED.split("\n").join(weol));
  subset = subset.split(SKIN_WATCHER_CALL).join(
    SKIN_WATCHER_HELPERS.split("\n").join(weol) + SKIN_WATCHER_CALL,
  );
  require1(subset, "clgUseStoreDraft(clgState)", label);
  require1(subset, "var clgState = clgInputStore(shell);", label);

  const out =
    HEADER(
      rel,
      text,
      `Subset: ${label === "skin-egg" ? "the egg only" : label}.\n` +
        `Taken  : var EGG_STORE … FootprintWatcher (one contiguous run).\n` +
        `Dropped: the skin stylesheet (STYLE_ID/CSS) and the "Claude-X" settings\n` +
        `         page — glass owns both. Glass's own apply() is appended below.\n` +
        REWRITE_NOTE + "\n" +
        SKIN_WATCHER_NOTE,
    ) +
    `\nconst portSkinEgg = (function () {\n` +
    `\t\tvar module = { exports: {} };\n` +
    `\t\tvar exports = module.exports;\n\n` +
    /* Upstream's factory body declares React near its top; the slice below
     * starts hundreds of lines later, so the subset arrives without it. Bind it
     * here: `FootprintWatcher` renders `React.useRef`/`React.useEffect`, and an
     * unbound React makes the slot entry throw on every render — which in the
     * real client knocks out the composer's input area, not just the egg. */
    `\t\tvar React = require("react");\n` +
    `\t\tvar h = React.createElement;\n\n` +
    subset +
    SKIN_EGG_APPLY +
    `})();\n`;
  if (/\bReact\./.test(subset) && !out.includes('require("react")')) {
    problems.push(`${label}: the subset uses React but nothing binds it`);
  }
  writeFileSync(join(OUT, `${label}.client.js`), out, "utf8");
  manifest.push([`${label}.client.js`, rel, text, Buffer.byteLength(out, "utf8")]);
}

/* ------------------------------------------- host halves -> published modules */

/*
 * These are copied under the name they will carry in `lib/`, so their relative
 * imports (`./qr.js`) resolve identically in `src/port/` and in the built
 * `dist/dsh-claude-glass/lib/`. Nothing here is spliced into the client bundle;
 * `lan-access` carries one rewrite of its own — see portLanAccessHost above.
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

/* ------------------------------------------- lan-access host: the one fix */

/**
 * The upstream host half resolves the profile it writes to from the
 * environment alone (`process.env.DSH_PROFILE || "web"`). The DSH desktop
 * client boots the `desktop` profile without exporting that variable, so the
 * LAN switch edited `profiles/web` — no such directory, hence `ENOENT` in the
 * panel — and the running host never saw the block. The Host publishes the
 * launched profile on `profileContext` (`{ name, dir, patchPath, … }`), which
 * is the authoritative fact; this rewrite puts it first and keeps the
 * environment as the fallback.
 *
 * The path is recorded in `apply()` because the exported helpers are called
 * from route handlers and have no context of their own.
 */
const LAN_PATCH_ANCHOR = `function patchFile() {
  return join(profileDir(), "cordis.patch.yml");
}`;

const LAN_PATCH_FIXED = `/**
 * The patch file this plugin manages.
 *
 * \`apply()\` records the launched profile the Host publishes on its
 * \`profileContext\` service (\`{ name, dir, patchPath, ... }\`), and that fact is
 * authoritative: the DSH desktop client boots the \`desktop\` profile WITHOUT
 * exporting \`DSH_PROFILE\`, so resolving from the environment alone edits
 * \`profiles/web\` while the running host never reads the block -- the switch
 * then looks applied and silently does nothing. The environment stays as the
 * fallback for a host that publishes no profile fact.
 *
 * Recorded once at apply time because the exported helpers below are called
 * from route handlers, which have no context of their own.
 */
let managedPatchPath = null;

function patchFile() {
  return managedPatchPath || join(profileDir(), "cordis.patch.yml");
}

/** Record the launched profile's patch file, when the Host publishes one. */
function learnProfile(ctx) {
  try {
    const fact = ctx.get("profileContext");
    if (fact && typeof fact.patchPath === "string" && fact.patchPath.length > 0) {
      managedPatchPath = fact.patchPath;
    } else if (fact && typeof fact.dir === "string" && fact.dir.length > 0) {
      managedPatchPath = join(fact.dir, "cordis.patch.yml");
    }
  } catch {
    /* no profile fact on this host: try the command line below */
  }
  if (managedPatchPath === null) managedPatchPath = launchedProfilePatch();
  if (managedPatchPath === null) {
    console.warn(
      "[dsh-lan-access] the Host published no profileContext fact and no profile " +
        "directory is on the command line; falling back to " + patchFile(),
    );
  }
}

/**
 * The desktop host is handed its profile directory as a command-line argument
 * (\`…/dsh-desktop-host/lib/index.js <asar> <profile> …\`). That is the last resort
 * for a host that publishes no \`profileContext\`; without it the switch would
 * edit \`profiles/web\`, a directory that need not exist -- which is exactly the
 * failure this whole rewrite exists to prevent. Only paths that already sit
 * under \`$DSH_HOME/profiles/\` and already hold a patch file are accepted.
 */
function launchedProfilePatch() {
  const root = join(dshHome(), "profiles").replace(/[\\\\/]+$/, "").toLowerCase();
  for (const arg of process.argv) {
    if (typeof arg !== "string") continue;
    const dir = arg.replace(/[\\\\/]+$/, "");
    const lower = dir.toLowerCase();
    if (lower.indexOf(root + "\\\\") !== 0 && lower.indexOf(root + "/") !== 0) continue;
    const candidate = join(dir, "cordis.patch.yml");
    if (existsSync(candidate)) return candidate;
  }
  return null;
}`;

const LAN_APPLY_ANCHOR = `export function apply(ctx) {`;

const LAN_PATCH_NOTE =
  `Rewritten: the managed patch file is taken from the Host's \`profileContext\`\n` +
  `(name/dir/patchPath) instead of \`DSH_PROFILE\` alone, and \`apply()\` calls\n` +
  `\`learnProfile(ctx)\` first. Upstream's environment-only lookup wrote\n` +
  `\`profiles/web\` on the DSH desktop client, which boots the \`desktop\`\n` +
  `profile without exporting that variable; the switch then reported ENOENT\n` +
  `and the running host never read the block.`;

function portLanAccessHost() {
  const rel = "plugins/lan-access/lib/index.js";
  const label = "lan-access";
  const text = read(rel, label);
  if (text === "") return;
  for (const m of [
    'export const name = "dsh-lan-access"',
    'export const inject = ["connection", "webServer"]',
    'import { encode } from "./qr.js"',
    'export function apply(ctx)',
    'requestBody: "buffered"',
  ]) {
    requireAny(text, m, label);
  }
  /* The upstream sources are checked out with CRLF on Windows, so the
   * multi-line anchor and its replacement have to speak the file's own line
   * endings; a single-line anchor is unaffected. */
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const patchAnchor = LAN_PATCH_ANCHOR.split("\n").join(eol);
  const patchOk = require1(text, patchAnchor, label);
  const applyOk = require1(text, LAN_APPLY_ANCHOR, label);
  let out = text;
  if (patchOk) out = out.replace(patchAnchor, LAN_PATCH_FIXED.split("\n").join(eol));
  if (applyOk) out = out.replace(LAN_APPLY_ANCHOR, `${LAN_APPLY_ANCHOR}${eol}  learnProfile(ctx);`);
  const file = "lan-access.js";
  const body = HEADER(rel, text, LAN_PATCH_NOTE) + "\n" + out;
  writeFileSync(join(OUT, file), body, "utf8");
  manifest.push([file, rel, text, Buffer.byteLength(body, "utf8")]);
}

/* ------------------------------------------------------------------- run it */

mkdirSync(OUT, { recursive: true });

portClient("brand-plugin/lib/client.js", "brand", "portBrand");
portClient("crab-plugin/lib/client.js", "crab", "portCrab");
portClient("plugins/font-switcher/lib/client.js", "font-switcher", "portFontSwitcher");
portLanAccessClient();
portSkinEgg();

portLanAccessHost();
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
  `subset of \`plugins/skin/lib/client.js\` — see its header. Two rewrites, each\n` +
  `recorded in the header of the file it touches: \`ctx.get("slots") ->\n` +
  `ctx.slots\` in all five client halves, and \`lib/lan-access.js\`'s profile\n` +
  `resolution, whose upstream form wrote \`profiles/web\` on the desktop client.\n\n` +
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
