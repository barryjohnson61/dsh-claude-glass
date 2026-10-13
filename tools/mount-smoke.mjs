#!/usr/bin/env node
/**
 * Dynamic mount smoke test for the built bundle.
 *
 * `verify.mjs` is static: it proves text is present. This one actually *loads*
 * `lib/client.js` (through a stand-in `window.__ModuleLoader__` and `require`),
 * calls `apply(ctx)` on a recording fake context, and does the same for the host
 * half (`lib/index.js`). It answers what a text check cannot:
 *
 *   - does the factory evaluate, and what does the module export?
 *   - does apply() reach each of the five ported plugins, and do they register
 *     their slots / settings sections?
 *   - do the six host routes register?
 *
 * It is NOT a substitute for looking at the GUI. There is no real DOM here, only
 * a small stand-in, so an effect that still needs a real browser is reported as
 * `dom` instead of failing. usage: node tools/mount-smoke.mjs [bundleDir]
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = process.argv[2] ?? join(ROOT, "dist", "dsh-claude-glass");
const report = [];
const problems = [];
const say = (s) => report.push(s);
const fail = (s) => {
  problems.push(s);
  report.push(`FAIL ${s}`);
};

/* ------------------------------------------------------------- DOM stand-in */
// The bundle does `instanceof HTMLElement` checks on nodes it built, so every
// stand-in element is a real instance of this little class chain.
class DomNode {}
class DomElement extends DomNode {}
class DomHTMLElement extends DomElement {}
const DOM_CTORS = {
  Node: DomNode, Element: DomElement, HTMLElement: DomHTMLElement, DocumentFragment: DomElement,
  ShadowRoot: DomElement, Text: DomNode, Comment: DomNode, SVGElement: DomElement, Range: DomNode,
  HTMLStyleElement: DomHTMLElement, HTMLDivElement: DomHTMLElement, HTMLInputElement: DomHTMLElement,
  HTMLButtonElement: DomHTMLElement, Event: DomNode, CustomEvent: DomNode, MouseEvent: DomNode,
  PointerEvent: DomNode, KeyboardEvent: DomNode, FocusEvent: DomNode, InputEvent: DomNode,
  DOMRect: DomNode, DOMRectReadOnly: DomNode, CSSStyleSheet: DomNode, CSSRule: DomNode,
  MediaQueryList: DomNode, Animation: DomNode, XMLHttpRequest: DomNode, ClipboardItem: DomNode,
  File: DomNode, FileList: DomNode, Blob: DomNode, Image: DomHTMLElement, Audio: DomHTMLElement,
  Worker: DomNode,
};
const styleStub = () => ({
  cssText: "", setProperty() {}, removeProperty: () => "", getPropertyValue: () => "",
  getPropertyPriority: () => "", item: () => "",
});
const el = () => Object.setPrototypeOf({
  style: styleStub(), dataset: {}, className: "", textContent: "", innerHTML: "", outerHTML: "", id: "",
  children: [], childNodes: [], firstChild: null, lastChild: null, parentNode: null, parentElement: null,
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  setAttribute() {}, removeAttribute() {}, getAttribute: () => null, hasAttribute: () => false,
  appendChild(c) { return c; }, append() {}, prepend() {}, removeChild(c) { return c; }, insertBefore(c) { return c; },
  remove() {}, replaceChildren() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true,
  querySelector: () => null, querySelectorAll: () => [], closest: () => null, contains: () => false,
  // innerHTML parsing: the skin builds markup with innerHTML and then reads
  // firstElementChild, so hand back a lazy child instead of null.
  get firstElementChild() { return el(); },
  get lastElementChild() { return el(); },
  get nextElementSibling() { return el(); },
  get previousElementSibling() { return el(); },
  getBoundingClientRect: () => ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 }),
  getClientRects: () => [], focus() {}, blur() {}, click() {}, scrollIntoView() {},
  matches: () => false, toggleAttribute() {}, insertAdjacentHTML() {}, insertAdjacentElement: () => el(),
  replaceWith() {}, before() {}, after() {}, getAnimations: () => [],
  attachShadow: () => el(), animate: () => ({ finished: Promise.resolve(), cancel() {}, finish() {} }),
}, DomHTMLElement.prototype);
const store = () => {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
    key: (i) => [...map.keys()][i] ?? null,
    get length() { return map.size; },
  };
};
const doc = Object.assign(el(), {
  head: el(), body: el(), documentElement: el(), title: "", cookie: "", readyState: "complete",
  visibilityState: "visible", createElement: el, createElementNS: el, createTextNode: el,
  createDocumentFragment: el, getElementById: () => null, getElementsByTagName: () => [],
  getElementsByClassName: () => [], fonts: { ready: Promise.resolve(), add() {} },
});
const win = {
  __ModuleLoader__: null,
  document: doc, localStorage: store(), sessionStorage: store(),
  addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true,
  matchMedia: () => ({ matches: false, media: "", addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
  getComputedStyle: () => ({ getPropertyValue: () => "", getPropertyPriority: () => "" }),
  requestAnimationFrame: () => 0, cancelAnimationFrame() {}, setTimeout, clearTimeout, setInterval, clearInterval,
  location: { href: "http://127.0.0.1:19387/", origin: "http://127.0.0.1:19387", protocol: "http:", search: "" },
  navigator: { userAgent: "mount-smoke", language: "zh-CN", clipboard: { writeText: async () => {} } },
  innerWidth: 1440, innerHeight: 900, devicePixelRatio: 1,
};
// Node 24 has getter-only globals (navigator, fetch, …), so define each with a
// soft failure instead of Object.assign.
for (const [key, value] of Object.entries({
  window: win, document: doc, localStorage: win.localStorage, sessionStorage: win.sessionStorage,
  matchMedia: win.matchMedia, getComputedStyle: win.getComputedStyle, navigator: win.navigator,
  requestAnimationFrame: win.requestAnimationFrame, cancelAnimationFrame: win.cancelAnimationFrame,
  MutationObserver: class { observe() {} disconnect() {} takeRecords() { return []; } },
  ResizeObserver: class { observe() {} disconnect() {} unobserve() {} },
  IntersectionObserver: class { observe() {} disconnect() {} unobserve() {} takeRecords() { return []; } },
  fetch: async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => "" }),
})) {
  try {
    Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
  } catch {
    /* a getter-only global this runtime will not let us shadow stays as is */
  }
}

// DOM constructor globals: the bundle does `instanceof HTMLElement` style checks.
for (const [name, ctor] of Object.entries(DOM_CTORS)) {
  if (!(name in globalThis)) {
    try {
      Object.defineProperty(globalThis, name, { value: ctor, writable: true, configurable: true });
    } catch {
      /* ignore */
    }
  }
}

/* ------------------------------------------------------------ react stand-in */
const react = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
  createContext: (value) => ({ Provider: ({ children }) => children, Consumer: () => null, _value: value }),
  useState: (v) => [typeof v === "function" ? v() : v, () => {}],
  useRef: (v) => ({ current: v ?? null }),
  useEffect: () => {}, useLayoutEffect: () => {}, useInsertionEffect: () => {},
  useMemo: (fn) => (typeof fn === "function" ? fn() : undefined),
  useCallback: (fn) => fn, useContext: () => ({}), useReducer: (r, i) => [i, () => {}],
  useSyncExternalStore: (s) => (typeof s === "function" ? s() : undefined),
  useTransition: () => [false, (f) => f && f()], useDeferredValue: (v) => v, useId: () => "test-id",
  useImperativeHandle: () => {}, useDebugValue: () => {},
  forwardRef: (f) => f, memo: (f) => f, Fragment: "Fragment", StrictMode: "StrictMode",
  Children: { map: (c, f) => (Array.isArray(c) ? c.map(f) : []) },
  cloneElement: (e) => e, isValidElement: () => true, Component: class {}, PureComponent: class {},
  version: "18.2.0-test",
};
react.default = react;
const reactDom = { createPortal: (n) => n, render: () => {}, flushSync: (f) => f && f(), version: "18.2.0-test" };
reactDom.default = reactDom;

// Any @deepseek-ai/* client package (primitives, settings, theme, …) resolves at
// runtime from the app's module registry; there is none here, so hand back a
// permissive stub — enough for module-level destructuring, never rendered.
const anyStub = new Proxy(function () {}, {
  get(_t, key) {
    if (typeof key === "symbol") return key === Symbol.iterator ? () => [] : undefined;
    if (key === "__esModule") return true;
    if (key === "default") return anyStub;
    if (key === "toString") return () => "";
    return anyStub;
  },
  apply: () => anyStub,
  construct: () => anyStub,
});
const requiredDshPackages = new Set();
const requireShim = (name) => {
  if (name === "react" || name === "react/jsx-runtime" || name === "react/jsx-dev-runtime") return react;
  if (name === "react-dom" || name === "react-dom/client") return reactDom;
  if (name.startsWith("@deepseek-ai/")) {
    requiredDshPackages.add(name);
    return anyStub;
  }
  throw new Error(`unexpected require(${JSON.stringify(name)})`);
};

/* ------------------------------------------------------------ the client half */
say("== client half ==");
const code = readFileSync(join(OUT, "lib", "client.js"), "utf8");
let spec = null;
win.__ModuleLoader__ = { load: (s) => (spec = s) };
try {
  new Function("window", "require", code)(win, requireShim);
} catch (error) {
  fail(`the bundle threw while evaluating: ${error.message}`);
}
if (spec === null) fail("the bundle never called window.__ModuleLoader__.load()");
else {
  say(`  loader id             : ${spec.id}`);
  if (spec.id !== "dsh-claude-glass") fail(`the plugin row id is ${spec.id}, expected dsh-claude-glass`);
}

const seen = { effects: [], injects: [], slots: [], registrations: [], timeouts: 0, notes: [] };
const note = (kind, label, error) => {
  const line = `${kind}: "${label ?? "?"}" -> ${String(error.message).split("\n")[0].slice(0, 90)}`;
  if (kind === "effect") seen.notes.push(line);
  else fail(line);
};
const slots = {
  inject(name, a) {
    seen.slots.push(`inject:${name}`);
    if (typeof a === "function") a();
    else if (a && typeof a === "object") seen.registrations.push(`${a.name ?? name}${a.id ? "#" + a.id : ""}`);
  },
  register(a) {
    if (a && typeof a === "object") seen.registrations.push(`${a.name}${a.id ? "#" + a.id : ""}`);
    else if (typeof a === "string") seen.registrations.push(a);
    return () => {};
  },
  get: () => undefined, list: () => [], unregister: () => {},
};
// Client-service names the bundle may touch directly (`ctx.theme.overrideTokens`,
// …). They are all permissive stubs here: this test proves the wiring, not the
// services themselves.
const KNOWN_SERVICES = [
  "theme", "locale", "store", "settings", "renderer", "conversation", "sidebar", "slots", "timer",
  "connection", "commands", "dialogs", "toast", "notifications", "i18n", "invariants", "primitives",
  "appearance", "layout", "workspace",
];
const makeCtx = (deps = []) => {
  const services = {};
  for (const dep of [...KNOWN_SERVICES, ...deps]) services[dep] = dep === "slots" ? slots : anyStub;
  const ctx = {
    ...services,
    effect(fn, label) {
      seen.effects.push(label ?? "effect");
      try {
        const off = typeof fn === "function" ? fn() : undefined;
        return typeof off === "function" ? off : () => {};
      } catch (error) {
        note("effect", label, error);
        return () => {};
      }
    },
    inject(d, cb) {
      const list = Array.isArray(d) ? d : [d];
      seen.injects.push(list.join("+"));
      try {
        if (typeof cb === "function") cb(makeCtx(list));
      } catch (error) {
        note("inject", list.join("+"), error);
      }
      return () => {};
    },
    timeout: () => (seen.timeouts += 1, () => {}),
    interval: () => (seen.timeouts += 1, () => {}),
    on: () => {}, off: () => {}, emit: () => {},
    get(name) {
      return name === "slots" ? slots : anyStub;
    },
    slots,
    logger: { debug() {}, info() {}, warn() {}, error() {} },
  };
  return ctx;
};

let exports$ = null;
try {
  exports$ = spec.factory(requireShim);
} catch (error) {
  fail(`the factory threw: ${error.message}`);
}
if (exports$ && typeof exports$ === "object") {
  // The loader row id carries the plugin name; the aqua base never exported one.
  say(`  exports.name          : ${String(exports$.name)}`);
  say(`  exports.inject        : ${JSON.stringify(exports$.inject)}`);
  if (typeof exports$.apply !== "function") fail("exports.apply is not a function");
  if (!Array.isArray(exports$.inject) || !exports$.inject.includes("timer")) fail('exports.inject does not include "timer"');
  try {
    exports$.apply(makeCtx([]));
  } catch (error) {
    fail(`apply(ctx) threw: ${error.message}`);
  }
  say(`  ctx.effect calls      : ${seen.effects.length} (${[...new Set(seen.effects)].join(" | ")})`);
  say(`  ctx.inject deps seen  : ${[...new Set(seen.injects)].join(" | ") || "(none)"}`);
  say(`  slot injects          : ${[...new Set(seen.slots)].join(" | ") || "(none)"}`);
  say(`  slot registrations    : ${[...new Set(seen.registrations)].join(" | ") || "(none)"}`);
  say(`  ctx.timeout calls     : ${seen.timeouts}`);
  say(`  app-registry requires : ${[...requiredDshPackages].join(" | ") || "(none)"}`);
  for (const line of [...new Set(seen.notes)]) say(`  (needs a real browser) ${line}`);

  for (const want of [
    "settings.section#clawd",
    "settings.section#fonts",
    "sidebar.footer.action#lan-access",
    "sidebar.footer.action#claude-profile",
    "conversation.input.left#claude-fingerprint",
    "sidebar.brand.mark",
    "sidebar.brand.name",
    "conversation.hero.brand.mark",
  ]) {
    if (!seen.registrations.includes(want)) fail(`nothing registered ${want} — that ported plugin did not mount`);
  }
  if (seen.effects.length === 0) fail("apply(ctx) registered no effects at all");
}

/* -------------------------------------------------------------- the host half */
say("");
say("== host half ==");
const routes = [];
const hostCtx = {
  inject(d, cb) {
    const list = Array.isArray(d) ? d : [d];
    say(`  ctx.inject(${JSON.stringify(list)})`);
    const scope = {
      ...hostCtx,
      settings: { register: () => () => {} },
      connection: {
        fetch: { register: (route) => (routes.push(route.path), () => {}) },
        authenticatedUrl: (url) => `${url}?token=stub`,
      },
      webServer: { host: "127.0.0.1", port: 19387, register: () => () => {}, registerUpgrade: () => () => {} },
    };
    if (typeof cb === "function") cb(scope);
  },
  effect(fn, label) {
    try {
      const off = typeof fn === "function" ? fn() : undefined;
      return typeof off === "function" ? off : () => {};
    } catch (error) {
      say(`  (effect "${label ?? "?"}" threw: ${String(error.message).split("\n")[0].slice(0, 80)})`);
      return () => {};
    }
  },
  on: () => {}, off: () => {}, emit: () => {},
  logger: { debug() {}, info() {}, warn() {}, error() {} },
};
try {
  const host = await import(pathToFileURL(join(OUT, "lib", "index.js")).href);
  say(`  exports: ${Object.keys(host).join(", ")}`);
  // The aqua base ships only `apply`, so name/inject are reported, never required.
  for (const key of ["name", "inject"]) if (key in host) say(`  exports.${key}: ${JSON.stringify(host[key])}`);
  if (!("apply" in host)) fail("lib/index.js does not export apply");
  else if (typeof host.apply !== "function") fail("lib/index.js apply is not a function");
  else host.apply(hostCtx);
} catch (error) {
  fail(`importing/applying lib/index.js threw: ${error.message}`);
}
say(`  routes registered: ${routes.length ? routes.join(" , ") : "(none)"}`);
for (const want of ["/api/dsh-lan-access/status", "/api/dsh-lan-access/bind", "/api/dsh-lan-access/qr"]) {
  if (!routes.includes(want)) fail(`lan-access did not register ${want}`);
}
if (!routes.some((r) => r.startsWith("/api/dsh-font-switcher/"))) fail("font-switcher registered no /api/dsh-font-switcher/* route");

console.log(report.join("\n"));
if (problems.length) {
  console.log(`\nMOUNT PROBLEMS (${problems.length}):`);
  for (const p of problems) console.log(`  - ${p}`);
  process.exit(1);
}
console.log("\nmount smoke ok");
