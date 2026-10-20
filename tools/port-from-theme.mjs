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
 *   the managed row's bind host          (lib/lan-access.js, since 1.2.0)
 *   the icon-style switch's home         (brand.client.js, since 1.2.0)
 *   the egg watcher's draft source       (skin-egg.client.js)
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
 * The third is the one that matters most: upstream's managed row pins
 * `host: '0.0.0.0'`, and dsh-host-webserver 0.2.1-rc.2 refuses a wildcard bind.
 * `webserver` is a required plugin, so a stale row does not break the LAN panel
 * — it stops the whole Harness from starting. Since 1.2.0 the row carries the
 * machine's concrete LAN address instead.
 *
 * The fourth is a port seam, not a bug fix: upstream 1016 put the running-icon
 * switch (Spark / crab / whale) on the skin plugin's Claude-X page, and glass
 * does not port that page. The brand popover carries the row instead, so the
 * preference is not write-only.
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
 * A tree that arrives WITHOUT its `.git` (a release archive, or a checkout
 * rebuilt from the GitHub contents API when git cannot reach github.com) has no
 * HEAD to read, and the manifest would then say `unknown`. `--theme-commit`
 * (or DSH_CLAUDE_THEME_COMMIT) supplies the sha the tree represents, so the
 * provenance survives:
 *
 *   node tools/port-from-theme.mjs --theme ../dsh-claude-theme-1017 \
 *     --theme-commit 8dc9fb4e5d79bf0bfa9b01158d811bfdec21f96e
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

/** A plain string argument — a commit sha, not a path. */
function argValue(flag) {
  const i = process.argv.indexOf("--" + flag);
  if (i < 0) return undefined;
  const v = process.argv[i + 1];
  if (v === undefined || v.startsWith("--")) {
    console.error(`--${flag} needs a value`);
    process.exit(2);
  }
  return v.trim();
}

const THEME = arg("theme") ?? resolve(process.env.DSH_CLAUDE_THEME_ROOT ?? join(ROOT, "..", "dsh-claude-theme"));

/* See the header: a tree without .git still has to record its upstream commit. */
const THEME_COMMIT = argValue("theme-commit") ?? process.env.DSH_CLAUDE_THEME_COMMIT ?? "";
if (THEME_COMMIT !== "" && !/^[0-9a-f]{7,40}$/i.test(THEME_COMMIT)) {
  console.error(`--theme-commit expects a hex sha, got "${THEME_COMMIT}"`);
  process.exit(2);
}

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
  /* An explicit sha wins: it is the only source when the tree has no .git. */
  if (THEME_COMMIT !== "") return THEME_COMMIT.toLowerCase().slice(0, 7);
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

/* ---------------------------------------- brand: the running-icon switch row */

/**
 * Upstream 1016 («初雪霜银» 的前一站 1016『四时良辰』) made the icon beside
 * `深度求索中` a three-way choice — Claude's eight Spark loops, the walking
 * pixel crab, or the shipped whale — stored in `dsh-claude-brand.prefs` as
 * `iconStyle`, and put the switch on the SKIN plugin's Claude-X settings page.
 *
 * glass deliberately does not port that page (it is the other skin's appearance
 * surface, and glass owns its own), so without a row of its own the preference
 * would be write-only: the shipped default `spark` would apply and there would
 * be no way back to the whale. Upstream already reasons exactly this way about
 * `showProfile` in the brand plugin's sidebar-foot popover ("with only the
 * brand plugin installed this popover is the only way back once the row is
 * gone"), so the icon switch lands beside it: same three values, same
 * `writePrefs`, same labels as the Claude-X page. The CSS is a separate block
 * because `.dcb-pop-*` never had a radio row before.
 */
const BRAND_ICON_ANCHOR = [
  "\t\t\t\t\th(",
  '\t\t\t\t\t\t"label",',
  '\t\t\t\t\t\t{ className: "dcb-pop-toggle" },',
  '\t\t\t\t\t\th("input", {',
  '\t\t\t\t\t\t\ttype: "checkbox",',
  "\t\t\t\t\t\t\tchecked: prefs.showProfile !== false,",
  "\t\t\t\t\t\t\tonChange: function (e) { writePrefs({ showProfile: e.target.checked }); },",
  "\t\t\t\t\t\t}),",
  '\t\t\t\t\t\th("span", null, "显示侧栏底部那行"),',
  "\t\t\t\t\t),",
].join("\n");

const BRAND_ICON_FIXED = [
  BRAND_ICON_ANCHOR,
  "",
  "\t\t\t\t\t/* glass: upstream keeps this switch on the skin plugin's",
  "\t\t\t\t\t * Claude-X page, which glass does not port, so the popover",
  "\t\t\t\t\t * carries the row — the same reasoning as the showProfile",
  "\t\t\t\t\t * checkbox above. */",
  "\t\t\t\t\th(",
  '\t\t\t\t\t\t"div",',
  '\t\t\t\t\t\t{ className: "dcb-pop-choices" },',
  '\t\t\t\t\t\th("span", null, "加载动画"),',
  "\t\t\t\t\t\th(",
  '\t\t\t\t\t\t\t"div",',
  '\t\t\t\t\t\t\t{ className: "dcb-pop-choicerow" },',
  "\t\t\t\t\t\t\t[",
  '\t\t\t\t\t\t\t\t{ id: "spark", label: "星芒", hint: "Claude 的八种形态轮播" },',
  '\t\t\t\t\t\t\t\t{ id: "crab", label: "螃蟹", hint: "敲键盘的像素蟹" },',
  '\t\t\t\t\t\t\t\t{ id: "off", label: "默认", hint: "保留原来的蓝色鲸尾" },',
  "\t\t\t\t\t\t\t].map(function (opt) {",
  "\t\t\t\t\t\t\t\treturn h(",
  '\t\t\t\t\t\t\t\t\t"label",',
  "\t\t\t\t\t\t\t\t\t{ className: \"dcb-pop-choice\", key: opt.id, title: opt.hint },",
  '\t\t\t\t\t\t\t\t\th("input", {',
  '\t\t\t\t\t\t\t\t\t\ttype: "radio",',
  '\t\t\t\t\t\t\t\t\t\tname: "dcb-icon-style",',
  '\t\t\t\t\t\t\t\t\t\tchecked: (prefs.iconStyle || "spark") === opt.id,',
  "\t\t\t\t\t\t\t\t\t\tonChange: function () { writePrefs({ iconStyle: opt.id }); },",
  "\t\t\t\t\t\t\t\t\t}),",
  '\t\t\t\t\t\t\t\t\th("span", null, opt.label),',
  "\t\t\t\t\t\t\t\t);",
  "\t\t\t\t\t\t\t}),",
  "\t\t\t\t\t\t),",
  "\t\t\t\t\t),",
].join("\n");

/** The row's stylesheet, kept out of upstream's `CSS` array on purpose. */
const BRAND_ICON_CSS = [
  "\t\t/* glass: the icon-style row added to the sidebar-foot popover (the",
  "\t\t * switch upstream keeps on the skin plugin's Claude-X page). */",
  "\t\tvar GLASS_ICON_CSS = [",
  '\t\t\t".dcb-pop-choices{display:flex;flex-direction:column;gap:6px;margin-top:2px}",',
  '\t\t\t".dcb-pop-choices>span{font-size:12px;color:var(--dsw-alias-label-secondary)}",',
  '\t\t\t".dcb-pop-choicerow{display:flex;flex-wrap:wrap;gap:14px}",',
  '\t\t\t".dcb-pop-choice{display:flex;align-items:center;gap:6px;font-size:13px;",',
  '\t\t\t"color:var(--dsw-alias-label-primary);cursor:pointer}",',
  '\t\t\t".dcb-pop-choice input{accent-color:var(--dsw-alias-brand-primary);cursor:pointer}",',
  '\t\t].join("");',
  "",
  "",
].join("\n");

const BRAND_ICON_NOTE =
  `Rewritten: the icon-style switch (upstream 1016) is added to the sidebar-foot\n` +
  `           popover. Upstream puts it on the skin plugin's Claude-X page, and\n` +
  `           glass does not port that page, so the preference would otherwise\n` +
  `           be write-only: "spark" would apply and there would be no way back\n` +
  `           to the shipped whale.`;

function portBrand() {
  const rel = "brand-plugin/lib/client.js";
  const label = "brand";
  const text = read(rel, label);
  if (text === "") return;
  const body = factoryBody(text, label);
  if (body === "") return;
  const eol = body.includes("\r\n") ? "\r\n" : "\n";
  require1(body, 'ctx.get("slots")', label);
  const iconAnchor = BRAND_ICON_ANCHOR.split("\n").join(eol);
  const iconOk = require1(body, iconAnchor, label);
  const applyAnchor = "\t\tfunction apply(ctx) {";
  const applyOk = require1(body, applyAnchor, label);
  const styleAnchor = "\t\t\tel.textContent = CSS;";
  const styleOk = require1(body, styleAnchor, label);

  let rewritten = body.split('ctx.get("slots")').join("ctx.slots");
  if (iconOk) rewritten = rewritten.replace(iconAnchor, BRAND_ICON_FIXED.split("\n").join(eol));
  if (applyOk) rewritten = rewritten.replace(applyAnchor, BRAND_ICON_CSS.split("\n").join(eol) + applyAnchor);
  if (styleOk) rewritten = rewritten.replace(styleAnchor, "\t\t\tel.textContent = CSS + GLASS_ICON_CSS;");
  requireAny(rewritten, "GLASS_ICON_CSS", label);
  requireAny(rewritten, "dcb-icon-style", label);

  const out =
    HEADER(rel, text, `${REWRITE_NOTE}\n${BRAND_ICON_NOTE}`) +
    `\nconst portBrand = (function () {\n` +
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

/*
 * The panel's switch state, translated to the host's new bind.
 *
 * Upstream decides "LAN access is on" by `info.bindHost === "0.0.0.0"`, and
 * reads the same wildcard out of `pendingBind` for its two restart hints. Once
 * the host half pins a concrete interface address (see LAN_WILDCARD_NOTE) those
 * comparisons are never true again: the switch would read OFF while LAN access
 * is on, and the "restart to apply" hints would never appear. "On" is "the bind
 * is not loopback", and "pending" is "a non-loopback address is recorded".
 */
const LAN_CLIENT_ENABLED_ANCHOR = `\t\t\t\tvar enabled = info.bindHost === "0.0.0.0";`;

const LAN_CLIENT_ENABLED_FIXED = [
  "\t\t\t\t/* glass: the managed row pins a concrete interface address now,",
  "\t\t\t\t * so \"on\" means \"not loopback\" and \"pending\" means \"a",
  "\t\t\t\t * non-loopback address is recorded\". */",
  '\t\t\t\tvar loopback = info.loopback === true || info.bindHost === "127.0.0.1" ||',
  '\t\t\t\t\tinfo.bindHost === "localhost" || info.bindHost === "::1";',
  '\t\t\t\tvar pendingLan = typeof info.pendingBind === "string" && info.pendingBind !== "" &&',
  '\t\t\t\t\tinfo.pendingBind !== "127.0.0.1" && info.pendingBind !== "localhost" &&',
  '\t\t\t\t\tinfo.pendingBind !== "::1";',
  "\t\t\t\tvar enabled = !loopback;",
].join("\n");

const LAN_CLIENT_PENDING_ANCHOR = `\t\t\t\tif (info.loopback && info.pendingBind === "0.0.0.0") {`;
const LAN_CLIENT_PENDING_FIXED = `\t\t\t\tif (loopback && pendingLan) {`;

const LAN_CLIENT_OFF_ANCHOR = `\t\t\t\tif (!info.loopback && info.pendingBind !== "0.0.0.0") {`;
const LAN_CLIENT_OFF_FIXED = `\t\t\t\tif (!loopback && !pendingLan) {`;

const LAN_CLIENT_WARN_ANCHOR = `\t\t\t\tif (enabled || info.pendingBind === "0.0.0.0") {`;
const LAN_CLIENT_WARN_FIXED = `\t\t\t\tif (enabled || pendingLan) {`;

/* glass 1.2.2: the host half refuses to write the managed row (see
 * LAN_BLOCK_WRITE_FIXED), so the switch cannot do anything. Disable it and put
 * the reason where the panel used to promise a QR code. */
const LAN_CLIENT_OFF_LABEL_ANCHOR = `\t\t\t\tbody.push(h("div", { className: "dla-label", key: "l1" }, "还没打开局域网访问"));`;
const LAN_CLIENT_OFF_LABEL_FIXED = `\t\t\t\tbody.push(h("div", { className: "dla-label", key: "l1" }, "局域网访问（当前 DSH 不支持）"));`;

const LAN_CLIENT_N2_ANCHOR = `\t\t\t\t\t\t"下面打开开关并重启 DSH，这里就会出现二维码。"),`;
const LAN_CLIENT_N2_FIXED = `\t\t\t\t\t\t"宿主拒绝通配地址，绑定具体网卡又会让桌面外壳连不上 127.0.0.1、下次启动失败。" +\n\t\t\t\t\t\t"远程访问请用「远程网页」隧道。"),`;

const LAN_CLIENT_DISABLED_ANCHOR = `\t\t\t\t\t\t\t\tdisabled: busy,`;
const LAN_CLIENT_DISABLED_FIXED = `\t\t\t\t\t\t\t\tdisabled: true,`;

const LAN_CLIENT_STATE_NOTE =
  `Rewritten: the panel decides "LAN on" by "the bind is not loopback" and\n` +
  `           "pending" by "a non-loopback address is recorded", instead of\n` +
  `           comparing both against the wildcard 0.0.0.0 -- see LAN_WILDCARD_NOTE\n` +
  `           (the host half no longer writes a wildcard).`;

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

  /* The panel's own wildcard comparisons — see LAN_CLIENT_STATE_NOTE. */
  for (const [anchor, fixed] of [
    [LAN_CLIENT_ENABLED_ANCHOR, LAN_CLIENT_ENABLED_FIXED],
    [LAN_CLIENT_PENDING_ANCHOR, LAN_CLIENT_PENDING_FIXED],
    [LAN_CLIENT_OFF_ANCHOR, LAN_CLIENT_OFF_FIXED],
    [LAN_CLIENT_WARN_ANCHOR, LAN_CLIENT_WARN_FIXED],
    [LAN_CLIENT_OFF_LABEL_ANCHOR, LAN_CLIENT_OFF_LABEL_FIXED],
    [LAN_CLIENT_N2_ANCHOR, LAN_CLIENT_N2_FIXED],
    [LAN_CLIENT_DISABLED_ANCHOR, LAN_CLIENT_DISABLED_FIXED],
  ]) {
    if (require1(rewritten, anchor, label)) {
      rewritten = rewritten.replace(anchor, fixed.split("\n").join(eol));
    }
  }
  requireAny(rewritten, "var pendingLan =", label);
  require1(rewritten, "var enabled = !loopback;", label);
  require1(rewritten, LAN_CLIENT_DISABLED_FIXED, label);

  const out =
    HEADER(rel, text, `${REWRITE_NOTE}\n${LAN_CLIENT_PORTAL_NOTE}\n${LAN_CLIENT_STATE_NOTE}`) +
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
  `           \`props.useInput(...)\` threw on the first render.`;

/**
 * The egg is NOT a working feature here — the slice above is kept for posterity
 * only. Read this note before "fixing" the watcher: the rewrite it describes is
 * already in place and the live client still never fires the egg.
 */
const SKIN_EGG_INERT_NOTE =
  `NOT PORTED in 1.1.0 — the egg never fires in the live client, even with the\n` +
  `           rewrite above: this DSH does not hand this seat the composer draft\n` +
  `           in the shape the facade assumes. The code is kept verbatim for\n` +
  `           whoever wires it up later; the CHANGELOG entry\n` +
  `           "未移植：请求指纹彩蛋（代码保留，等后人实现）" records what was tried,\n` +
  `           what this seat actually gets, and where the real draft state lives\n` +
  `           (the composer's own input view / Lexical layer).\n` +
  `           \`window.__claudeFootprint.show()\` still opens the panel by hand.`;

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
        SKIN_WATCHER_NOTE + "\n" +
        SKIN_EGG_INERT_NOTE,
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

/* -------------------------------------------- lan-access host: no wildcard */
/*
 * Upstream's `writeBind()` pins `host: '0.0.0.0'`. That was legal when 1.1.0
 * shipped, and it is not any more: dsh-host-webserver 0.2.1-rc.2 validates the
 * field and refuses a wildcard ("binding every interface would expose remote
 * code execution to the network"). The failure is far worse than a dead switch
 * — `webserver` is a REQUIRED host plugin, so activation fails and the whole
 * Harness refuses to start with "2 required plugins did not activate", which is
 * exactly the fault the 1.2.0 release exists to fix.
 *
 * A concrete interface address keeps the feature's promise (a phone on the same
 * LAN can reach the port) while never naming a wildcard, so the managed row
 * cannot brick the next boot.
 */
const LAN_HOST_DOC_ANCHOR = ` * @param allInterfaces - true to pin \`0.0.0.0\`, false to remove the block and
 *   fall back to the shipped row.`;

const LAN_HOST_DOC_FIXED = ` * @param allInterfaces - true to pin this machine's LAN address (glass: the
 *   Host refuses a wildcard bind — see \`lanBindHost\`), false to remove the
 *   block and fall back to the shipped row.`;

const LAN_WRITEBIND_ANCHOR = `export function writeBind(allInterfaces, port = DEFAULT_PORT) {`;

const LAN_WRITEBIND_FIXED = `/**
 * glass 1.2.2: the managed webserver row is never written any more.
 *
 * dsh-host-webserver 0.2.1-rc.2 refuses a wildcard bind outright ("binding every
 * interface would expose remote code execution to the network"), and a refused
 * row makes a REQUIRED plugin fail to activate -- the whole host refuses to
 * start, not just this panel (that was 1.1.0). A concrete LAN address is
 * accepted by the host, but the desktop shell still connects to
 * http://127.0.0.1:<port>; binding the LAN address makes that connection fail on
 * the NEXT start with "[TypeError: fetch failed] ... ECONNREFUSED
 * 127.0.0.1:<port>" and the app falls back to a minimal profile (that was
 * 1.2.1, and it is the loop this release ends).
 *
 * The two failures are halves of one incompatibility: on this runtime the web
 * server cannot be reachable from the LAN without losing the shell. Remote
 * access is the remote-web-ui tunnel. writeBind() therefore only ever REMOVES a
 * stale block and refuses to create one.
 */
export function writeBind(allInterfaces, port = DEFAULT_PORT) {`;

/* Upstream's block writer, byte for byte (the panel's switch path). Replaced by
 * a refusal, so no code path can edit the `webserver` row any more. */
const LAN_BLOCK_WRITE_ANCHOR = `  if (allInterfaces) {
    const block = [
      BLOCK_START,
      "# Managed by dsh-lan-access. Removed when the switch is turned off.",
      "#",
      "# This row replaces the shipped \`webserver\` row, so every static field it",
      "# sets has to be repeated here. Reaching this port from another device",
      "# grants full control of this machine's agent: keep it on a network you",
      "# trust, and do not share the pairing URL.",
      "- id: webserver",
      "  name: '@deepseek-ai/dsh-host-webserver'",
      "  inject: [webStartup]",
      "  config:",
      "    host: '0.0.0.0'",
      \`    port: \${port}\`,
      "    compression: gzip",
      "    compressionLevel: 1",
      "    compressionThresholdBytes: 1024",
      BLOCK_END,
      "",
    ].join("\\n");
    text += (text.endsWith("\\n") || text === "" ? "" : "\\n") + block;
  }`;

const LAN_BLOCK_WRITE_FIXED = `  if (allInterfaces) {
    throw new Error(
      "局域网绑定在当前 DSH 上不可用：宿主拒绝通配地址，而桌面外壳只连 127.0.0.1，" +
        "绑定具体网卡会让下次启动报 ECONNREFUSED 并退回最小 profile。远程访问请用「远程网页」隧道。",
    );
  }`;

const LAN_RETURN_ANCHOR = `  return allInterfaces ? "0.0.0.0" : "127.0.0.1";`;
const LAN_RETURN_FIXED = `  return "127.0.0.1";`;

const LAN_REACHABLE_ANCHOR = `  const reachable = host === "0.0.0.0" && addresses.length > 0;`;
const LAN_REACHABLE_FIXED = `  /* glass: the managed row pins a concrete interface address now, so loopback
   * is the only bind the LAN cannot reach. */
  const reachable =
    host !== "127.0.0.1" && host !== "localhost" && host !== "::1" && addresses.length > 0;`;

const LAN_WILDCARD_NOTE =
  `Rewritten: \`writeBind()\` no longer edits the \`webserver\` row at all.\n` +
  `           dsh-host-webserver 0.2.1-rc.2 refuses a wildcard bind (that is a\n` +
  `           1.1.0 boot failure, since \`webserver\` is required), and binding a\n` +
  `           concrete LAN address breaks the desktop shell's own\n` +
  `           http://127.0.0.1:<port> connection on the next start (that is the\n` +
  `           1.2.1 ECONNREFUSED failure). The switch now refuses and points at\n` +
  `           the remote-web-ui tunnel; only removal of a stale block remains.`;

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

  /* The wildcard bind, in the four places it appears (see LAN_WILDCARD_NOTE). */
  const docAnchor = LAN_HOST_DOC_ANCHOR.split("\n").join(eol);
  const docOk = require1(out, docAnchor, label);
  if (docOk) out = out.replace(docAnchor, LAN_HOST_DOC_FIXED.split("\n").join(eol));
  if (require1(out, LAN_WRITEBIND_ANCHOR, label)) {
    out = out.replace(LAN_WRITEBIND_ANCHOR, LAN_WRITEBIND_FIXED.split("\n").join(eol));
  }
  const blockAnchor = LAN_BLOCK_WRITE_ANCHOR.split("\n").join(eol);
  if (require1(out, blockAnchor, label)) {
    out = out.replace(blockAnchor, LAN_BLOCK_WRITE_FIXED.split("\n").join(eol));
  }
  if (require1(out, LAN_RETURN_ANCHOR, label)) {
    out = out.replace(LAN_RETURN_ANCHOR, LAN_RETURN_FIXED);
  }
  if (require1(out, LAN_REACHABLE_ANCHOR, label)) {
    out = out.replace(LAN_REACHABLE_ANCHOR, LAN_REACHABLE_FIXED.split("\n").join(eol));
  }
  /* The wildcard must be gone from the code; the prose that explains WHY may
   * still mention it, so check the value form only. */
  if (/\b0\.0\.0\.0\b/.test(out.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\//g, ""))) {
    problems.push(`${label}: a wildcard bind is still written outside the comments`);
  }
  /* No code path may emit a `webserver` row any more: the refusal has to be
   * present, and nothing in the file may build a host line. */
  require1(out, LAN_BLOCK_WRITE_FIXED.split("\n").join(eol), label);
  if (out.includes(`"    host: '`)) {
    problems.push(`${label}: a webserver host row is still emitted — writeBind() must never write one`);
  }

  const file = "lan-access.js";
  const body = HEADER(rel, text, `${LAN_PATCH_NOTE}\n${LAN_WILDCARD_NOTE}`) + "\n" + out;
  writeFileSync(join(OUT, file), body, "utf8");
  manifest.push([file, rel, text, Buffer.byteLength(body, "utf8")]);
}

/* ------------------------------------------------------------------- run it */

mkdirSync(OUT, { recursive: true });

portBrand();
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
  `subset of \`plugins/skin/lib/client.js\` — see its header. Four rewrites, each\n` +
  `recorded in the header of the file it touches: \`ctx.get("slots") ->\n` +
  `ctx.slots\` in all five client halves; \`lib/lan-access.js\`'s profile\n` +
  `resolution, whose upstream form wrote \`profiles/web\` on the desktop client;\n` +
  `its managed row's bind host, which upstream pinned to \`0.0.0.0\` — refused by\n` +
  `dsh-host-webserver 0.2.1-rc.2, and fatal because \`webserver\` is required;\n` +
  `and \`brand.client.js\`, which carries the 1016 running-icon switch in the\n` +
  `sidebar-foot popover because glass does not port the skin plugin's page.\n\n` +
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
