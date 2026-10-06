/**
 * Empirical check of the sidebar-toggle containing-block bug, using the REAL
 * core CSS (extracted from dsh-client-ui-layout / dsh-client-ui-sidebar) and the
 * REAL theme rules that mention [class*=sidebarCol] (extracted from the two
 * bundle files given on the command line).
 *
 * Run — it MUST be real Electron, not ELECTRON_RUN_AS_NODE, and Electron is a GUI
 * subsystem binary so its console.log does not come back to the terminal:
 *
 *   Remove-Item Env:ELECTRON_RUN_AS_NODE
 *   Start-Process -FilePath "<profile>\node_modules\electron\dist\electron.exe" `
 *     -ArgumentList "tools\toggle-repro\main.js","<A>\lib\client.js","<B>\lib\client.js" `
 *     -Wait -NoNewWindow -RedirectStandardOutput out.json
 *
 * Usage: electron main.js <bundleA> <bundleB>
 *   A is reported as `before_aqua_src`, B as `after_aqua_patched`.
 *   Pass the upstream aqua bundle as A to see the bug (which proves the harness
 *   is sensitive); pass a converted dsh-claude-glass bundle as B to see it fixed.
 */
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

if (!process.argv[2] || !process.argv[3]) {
  console.error('usage: electron main.js <bundleA/lib/client.js> <bundleB/lib/client.js>');
  process.exit(2);
}

const AQUA_SRC = process.argv[2];
const AQUA_PATCHED = process.argv[3];

const layoutCss = fs.readFileSync(path.join(__dirname, 'core-layout-css.txt'), 'utf8');
const sidebarCss = fs.readFileSync(path.join(__dirname, 'core-sidebar-css.txt'), 'utf8');

/** pull every rule whose selector mentions class*=sidebarCol out of an aqua bundle */
function aquaSidebarRules(file) {
  const text = fs.readFileSync(file, 'utf8');
  const out = [];
  let from = 0;
  while (true) {
    const hit = text.indexOf('[class*=sidebarCol]', from);
    if (hit < 0) break;
    const open = text.indexOf('{', hit);
    const close = text.indexOf('}', open);
    // selector start: walk back to the previous '}' (or 400 chars)
    const prevClose = text.lastIndexOf('}', hit);
    const selStart = Math.max(prevClose + 1, hit - 260);
    out.push(text.slice(selStart, close + 1).trim());
    from = close + 1;
  }
  return out;
}

const page = (aquaCss, collapsed) => `<!doctype html><html data-windows-titlebar data-dsh-float style="--dsh-windows-titlebar-height:40px">
<head><meta charset="utf-8"><style>
*{box-sizing:border-box}
html,body{margin:0;height:100%;background:#9aa7b6}
.BynINW_frame{height:100%}
${layoutCss}
${sidebarCss}
/* ---- aqua (theme plugin) rules that touch the sidebar column ---- */
${aquaCss.join('\n')}
</style></head>
<body>
<div class="BynINW_frame" id="frame" ${collapsed ? 'data-sidebar-collapsed=""' : ''}
     style="grid-template-columns:${collapsed ? '0px' : '280px'} minmax(0,1fr) 0px">
  <div class="BynINW_sidebarCol" id="col">
    <div class="_2H3hWW_root ${collapsed ? '_2H3hWW_collapsed' : ''}" id="root">
      <div class="_2H3hWW_logoRow" id="logoRow">
        <button class="_2H3hWW_iconButton _2H3hWW_toggle" id="toggle" style="width:28px;height:28px">T</button>
      </div>
    </div>
  </div>
  <div class="BynINW_centerCol"></div>
  <div class="BynINW_rightbarCol"></div>
</div>
</body></html>`;

const probe = `(() => {
  const t = document.getElementById('toggle');
  const col = document.getElementById('col');
  const r = t.getBoundingClientRect();
  const hit = document.elementFromPoint(26, 20);
  const hitSelf = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
  const cs = getComputedStyle(t);
  return {
    rect: { left: +r.left.toFixed(1), top: +r.top.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) },
    position: cs.position, top: cs.top, left: cs.left,
    colRect: (() => { const c = col.getBoundingClientRect(); return { left: +c.left.toFixed(1), top: +c.top.toFixed(1), w: +c.width.toFixed(1) }; })(),
    colOverflow: getComputedStyle(col).overflow,
    colBackdrop: getComputedStyle(col).backdropFilter || getComputedStyle(col).webkitBackdropFilter,
    visibleAtCaptionSpot_26_20: hit ? (hit.id || hit.className || hit.tagName) : null,
    visibleAtOwnCentre: hitSelf ? (hitSelf.id || hitSelf.className || hitSelf.tagName) : null,
  };
})()`;

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1280, height: 800, webPreferences: { offscreen: false } });
  const results = {};
  for (const [label, aquaFile] of [['before_aqua_src', AQUA_SRC], ['after_aqua_patched', AQUA_PATCHED]]) {
    const rules = aquaSidebarRules(aquaFile);
    // ASCII only: this JSON goes through a console redirect, so a non-ASCII
    // ellipsis here would come back mojibake'd and break ConvertFrom-Json.
    results[label] = { rules: rules.map((r) => r.slice(0, 90) + (r.length > 90 ? '...' : '')), states: {} };
    for (const collapsed of [false, true]) {
      const html = page(rules, collapsed);
      await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
      results[label].states[collapsed ? 'collapsed' : 'expanded'] = await win.webContents.executeJavaScript(probe);
    }
  }
  console.log(JSON.stringify(results, null, 2));
  app.quit();
});
