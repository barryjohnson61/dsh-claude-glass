# Changelog

本文件记录三件事，按用户要求「写明之前的依赖与修复」：

1. **依赖清单**——构建这个插件需要什么、运行它需要什么；
2. **继承了哪些既有修复**——基线包里已经带着的、不是本插件做的兼容修复；
3. **本插件做了哪些改动**——每一次改动的可复现清单。

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)；
版本号对应生成的 `dsh-claude-glass` 包，不是本构建仓库自己的版本。

---

## 依赖

### 构建输入（必需，不随本仓库分发）

| 名字 | 版本 | 用途 | 许可 |
| --- | --- | --- | --- |
| `dsh-client-ui-aqua` | `1.3.1-patch.4` | 玻璃材质 / 动效引擎 / 设置界面 / 运行期代码（**预构建 bundle，无 TS 源码**） | AGPL-3.0-only |
| `dsh-claude-theme` 的 `claude/` | 随上游 HEAD | 278 个 `--dsw-*` 令牌、排版阶梯、版式语言、四份 woff2 | MIT + SIL OFL 1.1 |

用 `--base` / `--claude`，或 `DSH_AQUA_BASE` / `DSH_CLAUDE_THEME` 指定；详见 README §5。

### 构建工具

- **Node.js ≥ 18**（用到 `node:fs` / `node:url` 的 ESM、`structuredClone` 级别特性）。
  本机实测：`v24.21.0`。
- 打包器：`pnpm` 或 `npm` 任一（`pack.mjs` 自动探测）。
  本机实测：`pnpm 11.7.0`。
- 无第三方 npm 依赖——`build.mjs` / `verify.mjs` / `pack.mjs` 全部只用 Node 内置模块。

### 运行期 peer 依赖（由 DSH 宿主提供，不随包分发）

```
@deepseek-ai/dsh-client-store          ^0.1.2-rc.1 || ^0.2.0-rc.2
@deepseek-ai/dsh-client-locale
@deepseek-ai/dsh-client-ui-theme
@deepseek-ai/dsh-client-ui-settings
@deepseek-ai/dsh-client-ui-settings-plugins
@deepseek-ai/dsh-client-ui-slots
@deepseek-ai/dsh-client-ui-primitives
@deepseek-ai/dsh-invariants
@deepseek-ai/cordis                    ^4.0.1
react                                  ^18.2.0
```

针对的 DSH 运行时：**0.2.0-rc.2**（`dshCompatPatch.forRuntime`）。

---

## [1.0.0] — 2026-10-06

首个整合版本。基线 `dsh-client-ui-aqua@1.3.1-patch.4` + `dsh-claude-theme` 当前 HEAD。

### 继承自基线的既有修复（**不是**本插件做的）

`1.3.1-patch.4` 这个补丁版本身是「DSHConfig migration」为适配 DSH 0.2.0-rc.2 做的，
本插件直接继承，不再重复处理：

- `version 1.3.1-patch.1 → 1.3.1-patch.4`；
- 8 条 `peerDependencies` 从 `^0.1.0-rc.5` 放宽到 `^0.1.0-rc.5 || ^0.2.0-rc.2`；
- 移除 `devDependencies`（预构建分发的包不需要）；
- `lib/client.js`：`IconCheckOutline16 → IconCheckOutlineRegular`，6 处；
- **`lib/client.js`：`[data-dsh-float] [class*=sidebarCol]` 不再设置 `backdrop-filter`**，1 处。

最后那条是本插件**必须继承且不得回退**的修复：`backdrop-filter` 会让侧栏列成为其后代
`position:fixed` 元素的**包含块**，而 DSH 0.2.0-rc.2 在 Windows 标题栏模式下正是把
「收起/展开侧边栏」按钮钉成 `position:fixed`。包含块一变，按钮落进侧栏卡片内部；
一旦收起，列宽归零、该列又自带 `overflow:hidden`，按钮被裁掉，完全不可见不可点。
`verify.mjs` 为此加了守卫：任何给 `[class*=sidebarCol]` 加回非 `none` 的
`backdrop-filter` 的构建都会以 `GUARD FAILURES` + 退出码 1 失败。

### 本插件做的改动（359 处字面量替换，全部可复现）

1. **调色板**：`AQUA_TOKEN_OVERRIDES` 整体替换为从 `claude/skin.css` 解析出的 278 个
   Claude `--dsw-*` 令牌；`COMPAT_SURFACE_OVERRIDES` 保留上游的 **21 个键名**，
   值改成**实心**的对应 Claude 色（见第 9 条 (c)：上游的 0.45–0.88 alpha 不照抄）。
2. **冷蓝硬编码 → 暖色**：`aqua.module.css` 中写死的描边、辉光、文字、环境渐变、玻璃填充，
   逐条映射到 Claude 色板。计数：`#132d53`(19)、`#94b4dc`(18)、`#02060e`(6)、
   `srgb, #fff `(7)、`#6e9be8`(4) 等。
3. **圆角阶梯**：`14 / 20 / 24 / 10` → Claude 的 `12 / 16 / 26 / 8`
   （含 composer 虚线 mask 的 `rx='24'→'26'`，以及 6 条 `--dsl-*-radius` 令牌）。
   *规则顺序不可换*：通用规则会先吃掉 dsl 规则的尾巴。
4. **排版**：aqua 自带的 `Space Grotesk Variable,Noto Serif SC,…` 两处 → `var(--cl-serif)`
   （对话框标题）与 `var(--cl-sans)`（列表项）；`fonts.module.css` 整块换成
   Newsreader(normal/italic) + Inter + JetBrains Mono 的 base64 woff2。
5. **追加 `src/claude-layer.css`**（203 行）：衬线阅读列、标题 weight 400、
   dialog/tooltip 表面、composer 26px 药丸 + 珊瑚 focus ring、工具调用卡片、
   `:focus-visible` 珊瑚环、滚动条、`prefers-reduced-motion`。
   *刻意不加* `overflow:hidden` 到 `tool-call` / `turn-process` / `workflow-run`
   ——这些节点承载工具输出与思考文本，裁切只会丢信息。
   同一决策下，`data-dsh-part` / `data-pane` / `data-dsh-surface="sidebar"` 这些
   在本版构建里已不存在的钩子被移除，改用真实钩子
   （`[data-dsh-sidebar-root]`、`[data-dsh-compat]`、`[data-chat-flow-kind]`）。
6. **命名空间隔离**：`dsh-aqua` → `dsh-cglass`（217 处，
   含 `data-dsh-aqua*` 属性、`--dsh-aqua-*` 变量、`qRUgUq_dsh-aqua-*` 关键帧）、
   `dsh.ui-aqua.` → `dsh.claude-glass.`（23 处 localStorage 前缀）、
   `dsh-client-ui-aqua` → `dsh-claude-glass`（10 处）、locale 标题
   「玻璃主题 / Glass theme」→「Claude 玻璃 / Claude Glass」（2 处）。
   → 因此它可以和原版 aqua 并存而不打架；但**不要同时挂载**（两块流体画布 +
   同一个 `settings.plugin.item` 槽 key `aqua`）。
7. **默认色调**：`fluidHue` `320`（青绿）→ `158`，2 处（`settings-store.ts` 的 init
   与 `theme-layer.ts` 的 `SETTINGS_DEFAULTS`）。理由：aqua 的辉光色是
   `(fluidHue + 217) % 360`，158 正好落在 15° = Claude 珊瑚
   （实测 `--dsh-cglass-spot-color: hsla(15, 90%, 45%, 0.16)`）。
8. **`spotlight.ts` 的 `tiltable()`：侧栏列永不下压**，1 处。
   *第二条*运行期路径能让侧栏列变成包含块：aqua 的「悬停下压」（设置里的**按压泡泡**，
   `data-dsh-cglass-press`）会给指针下的每个 spot 现写 inline transform，而侧栏列本身
   就是个 spot（`data-dsh-cglass-spot`）。上游的判据只在**有 `[role=dialog]` 打开**时
   才拒绝侧栏，比它自己注释里写的 *"the sidebar NEVER tilts"* 窄得多；而 Windows 标题栏
   模式下被重新锚定的是「收起侧边栏」按钮，与对话框无关。
   修法：对侧栏列**无条件**返回 `false`。**只去倾斜、保留辉光**（辉光走另一道闸门
   `data-dsh-cglass-spotlight`）。
9. **兼容模式的三条根治**（2026-10-06 第三组修复，1 处字面量替换 + 表面层重建）。
   报告现象：兼容模式下对话区右半边被乳白色「白块」盖住、正文被硬切，打开右侧栏则正常；
   随后追加实测反馈：**「方向反了，现在兼容模式完全糊掉了」**。

   **(a) 键表照抄上游、面积令牌不进表面层。** 上游 `COMPAT_SURFACE_OVERRIDES` 只有 **21 个键**，
   全部是「浮层 / 行内」表面（`--dsw-alias-menu*` / `-selector-*` / `-tip-*` / `-bubble*` /
   `-input-major` / `-login-input` / `-bg-layer-1..3` / `-bg-overlay` / `-bg-module-platform` /
   `-bg-multi-select` / `-toast-bg` / `-tooltip-bg` 与 markdown 的
   `-code-block-*` / `-banner-*` / `-inline-code-*` / `-citation-*` / `-tag-*` / `-placeholder`），
   第一版 alpha 0.45–0.88，**刻意不含** `--dsw-alias-bg-base` / `--dsw-alias-bg-mask-*` /
   `--dsw-specific-sidebar-fill` / `--dsw-alias-bg-skeleton`。
   上一版是我用宽泛正则自己拼的 **24 个键**：多了上述四个大面积令牌，少了 markdown / tooltip 一组。
   根因：DSH 核心把**已关闭**的右侧栏面板以 `position:absolute; inset:0 0 0 -624px` 滑出到画面右半
   （父容器 `BynINW_rightbarCol` 宽 0、`overflow:visible`，照样绘制），面板内 dockkit pane
   （`_tabHost_6nhg2 … _pane_6nhg2`）的背景正是 `var(--dsw-alias-bg-base)`；
   浮层模式该令牌不透明（`#faf9f5`）→ 只是一块实心空白；兼容模式被做成 72% 半透明 →
   面板变成一层薄纱、正文从底下透出来 = 白块。
   修法：新增 `readCompatSurfaceKeys()` 从上游 bundle 抄出这 21 个键，逐个换成对应 Claude 色
   （21 个键在 `claude/skin.css` 里全部存在）。
   **(b) 兼容模式通配 blur 收敛。** 上游
   `[data-dsh-compat] [role=menu],[role=tooltip],[class*=card],[class*=bubble],[class*=panel],[class*=popover],[class*=dropdown]{backdrop-filter:blur(12px)}`
   实测 `[class*=card]` 命中 16、`[class*=bubble]` 命中 4、`[class*=panel]` 命中 **22**
   （连 `svg._2H3hWW_panelIcon` / `NAV._2H3hWW_panelList` / `SPAN._2H3hWW_panelTitle` 都中），
   其中就有那块滑出的右侧栏面板。改为
   `[role=menu],[role=tooltip],[role=listbox],[popover]`。
   **注意**：**不能**把 `[role=dialog]` 或 `[data-shell-overlay]` 放进这个列表——
   DSH 的 `BynINW_overlayLayer` 带 shell-overlay 钩子且铺满整个 frame，
   任何浮层一打开它就会被 `blur(12px)`，整个应用发糊（第一版收敛时踩过这个坑，
   由用户实测发现）；设置对话框本身也已是全尺寸表面且自带不透明底色。
   `verify.mjs` 的守卫同时拦 `[class*=…]`、`[role=dialog]`、`[data-shell-overlay]`。
   **(c) 表面层一律实心。** 上游这 21 个键配的是 0.45–0.88 的 alpha（为去饱和的青色流体调的）；
   换到 Claude 暖色 + 珊瑚流体后，每一层表面都成了盖在流体上的薄纱，**整个界面发糊**。
   实测 `getComputedStyle(document.body)`：本插件的 21 个兼容表面令牌全部是 `color-mix(...)` ——
   `--dsw-alias-bg-layer-1: #f5f0e8 55%`、`-bg-layer-2: #efe9de 50%`、`-bg-layer-3: #e8e0d2 45%`、
   `-bg-overlay: #faf9f5f7 60%`、`-markdown-code-block: #f5f0e8 50%`、`-specific-bubble: #faf9f5 55%`、
   `-specific-menu: #ffffff 60%`、`-toast-bg: #252320 85%`、`-tooltip-bg: #141413 88%`。
   其中 `--dsw-alias-bg-layer-1`（55%）被**每一条对话行**共用
   （实测 `DIV.xz4KEq_flowItem` 的 `background = color(srgb 0.960784 0.941176 0.909804 / 0.55)`），
   侧栏与卡片也读它 ⇒ 珊瑚流体从每层表面下透出来。
   页面内对照（注入 `body{--x:#hex;}` 把这 21 个令牌改成纯色）：面板 / 侧栏 / 对话行立刻实心清爽。
   修法：仍取上游的 21 个键名，值直接写 Claude 纯色，不再产生任何 `color-mix(..., transparent)`；
   `pct()` / `alphaOf()` 一并删除（不再需要 alpha）。`verify.mjs` 新增
   **compat solid-surface guard**：表面层里出现 `color-mix` 或 `transparent` 即失败。

### 兼容模式回归验证（第三组修复）

- 页面内实测（`http://127.0.0.1:19387`，兼容模式，强加 `data-windows-titlebar` 模拟桌面）：
  旧选择器命中的 42 个元素在注入 `backdrop-filter:none` 覆盖后 `stillBlurred: 0`，
  但白块**仍在** ⇒ blur 只是加重因素。
- 决定性对照：给 `.OUqwTW_panel` + `[class*=rightbarCol]` 设 `visibility:hidden !important`
  后白块**完全消失**、正文清晰铺满全宽 ⇒ 元凶是那块滑出的右侧栏面板。
- 面板身份：`class=OUqwTW_panel`、`data-sidebar-right-panel="push"`、
  `data-sidebar-right-session="session-…"`、`aria-hidden="true"`、
  `style="width: 624px; --dsh-sidebar-width: 624px;"`、
  computed `position:absolute; inset:0 0 0 -624px; display:flex`、rect `762,40 624x760`；
  子树普查 673 个元素 / 73 个「有背景或滤镜」，最外层元凶是
  `SECTION._tabHost_6nhg2_162 _pane_6nhg2 [762,40 624x760] bg=color(srgb 0.980392 0.976471 0.960784 / 0.72)`。
- 插件样式表（25150 字节）里 `rightbar` / `OUqwTW` / `sidebar-right` / `aria-hidden` **0 命中**
  ⇒ 本插件从不给右侧栏写样式，问题完全来自令牌覆盖 + 那条通配 blur。
- 表面层实心化对照：注入 `body{--x:#hex;}`（21 个键）前后各截图一次，
  改后对话行 / 侧栏 / 卡片全部实心、珊瑚流体只留在画布自身；
  改前 `--dsw-alias-bg-layer-1` 让每条对话行都是 55% 的薄纱。
- 满屏发糊的独立根因：第一版把 `[role=dialog]` / `[data-shell-overlay]` 放进 blur 清单后，
  `BynINW_overlayLayer`（rect `[0,0,1386,800]`）被 `blur(12px)` 罩住整个 frame；
  实测 `blur12: ["DIV.BynINW_overlayLayer"]`。移除后全文档只剩 2 个 blur 元素
  （上下各一条 13px 的 `blur(5px)` 边缘带）。

### 侧栏回归验证（两处修复各跑一遍）

**静态包含块**——真 Electron + 真核心 CSS 台架（本仓库 `tools/toggle-repro/`，
`<html data-windows-titlebar data-dsh-float>`）：

| 被检包 | 展开 rect | 收起 rect | 标题栏位 (26,20) 命中 | 收起时自身中心命中 | `colBackdrop` |
| --- | --- | --- | --- | --- | --- |
| 上游 aqua（对照，有 bug） | (24.7, 58.7) | (24.7, 58.7) | `BynINW_frame` ✗ | `BynINW_centerCol` ✗ | `blur(14px)` |
| patch.4 基线 | (12, 6) | (12, 6) | `toggle` ✓ | `toggle` ✓ | `none` |
| **Claude Glass** | **(12, 6)** | **(12, 6)** | **`toggle` ✓** | **`toggle` ✓** | **`none`** |

另有运行期全 DOM 复核：float 模式与 `data-dsh-compat` 兼容模式下，分别对 39 个
`position:fixed` 元素回溯祖先链，**没有任何一个祖先带非 `none` 的 `backdrop-filter`**。

**运行期倾斜**——在 `http://127.0.0.1:19387` 里强加 `data-windows-titlebar` 模拟桌面，
向侧栏内的行派发 `pointerover`/`pointermove`，等 400 ms：

| 被检包 | 侧栏列 `style` 属性 | computed `transform` | 按钮 rect | 悬停后 |
| --- | --- | --- | --- | --- |
| 修复前 | `transform-origin: 128px 368px; transform: perspective(800px) rotateX(-0.00175951rad) rotateY(-0.0120313rad) scale(1.01);` | `matrix3d(1.00993, …, 1.01, …)` | (12,6) → **(24,55)** | ✗ 跟着鼠标跑 |
| **Claude Glass** | `null`（未写任何 inline 属性） | `none` | (12,6) → **(12,6)** | ✓ |

未误伤：侧栏列的 `data-dsh-cglass-glow` 仍拿到
`radial-gradient(180px at 128px 37px, …)`；非侧栏 spot（`Dc7zOa_header`）悬停后仍写出
`perspective(800px) rotateX(6.9e-05rad) rotateY(0.00876629rad) scale(1.01)`，
离开 500 ms 后 inline style 归空；收起/展开一轮 `0px 1386px 0px` ↔ `280px 1106px 0px`，
按钮始终在视口内、中心命中自身。

> 为什么网页端看着没事：只有 `[data-windows-titlebar]` 下核心才会把该按钮钉成
> `position:fixed`；网页态按钮是侧栏内的行内元素，包含块换了位置也不动。
> 这也解释了用户报告的「只能在桌面端复现」。

### 打包

- 生成包 `files[]` = aqua 基线的 `files[]` + `NOTICE` + `CHANGELOG.md` + `licenses`
  （npm 自动带 `LICENSE` 与 `README.md`，但**不会**带 `NOTICE`）。
- 产物：`dist/dsh-claude-glass/dsh-claude-glass-1.0.0.tgz`，441490 字节。
- `lib/client.js`：231570 → 693485 字节（+461915）。
- 随包分发 `NOTICE`（四段式第三方声明）、`LICENSE`（AGPL-3.0-only 全文）与
  `licenses/dsh-claude-theme.txt`（MIT + SIL OFL 1.1 全文 + 四款字体署名）。
- `LICENSE` 与 `NOTICE` 的**权威副本在仓库根**，`build.mjs` 只是把它们拷进 `dist/`
  ——语料只在仓库里维护一份，不再由构建脚本内联生成。
  `LICENSE` 放仓库根还有一个作用：GitHub 靠它识别仓库许可（原先只有
  `licenses/*.txt`，仓库页显示为「无许可」）。

### 已知问题（**不在本插件内**）

- **`dsh-xiaoke-widget`（小克桌宠）会吞掉左下角「设置」按钮的点击。**
  该插件的 `.dshxkv-root` 是 `position:fixed; z-index:9999` 的覆盖层，
  `.dshxkv-img` 是 `pointer-events:auto` 的贴图，覆盖范围正好压住设置按钮；
  命中测试用的是透明区的**凸包** `clip-path`，凸包把按钮所在的透明区也包了进去。
  `pointer-events:auto` 本身是它 v757 为 issue #147 故意改的（指针落在 iframe 上时
  小克会失联），所以**不能**简单地改回 `none`；
  正确修法在 `setupHitTest()` 里（凸包 → 真实 alpha 轮廓，或对左下角挖空）。
  在页面内临时加 `pointer-events:none !important` 可立即验证设置按钮恢复可点。
