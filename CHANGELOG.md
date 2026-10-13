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
@deepseek-ai/dsh-client-ui-renderer        ← 1.1.0 移植插件需要
@deepseek-ai/dsh-client-ui-conversation    ← 1.1.0 移植插件需要
@deepseek-ai/dsh-client-ui-sidebar         ← 1.1.0 移植插件需要
@deepseek-ai/dsh-invariants
@deepseek-ai/cordis                    ^4.0.1
react                                  ^18.2.0
```

针对的 DSH 运行时：**0.2.0-rc.2**（`dshCompatPatch.forRuntime`）。

---

## [1.1.0] — 2026-10-13

把 `dsh-claude-theme` **发行版 1007『火山晨曦』**（commit `20bfe79`，2026-10-07）相对
1.0.0 所用 HEAD（`104f105`）的全部新功能，整体移植进本插件。

上游那次发行只动了 `plugins/`：新增 `plugins/lan-access/` 全套，`plugins/skin/lib/client.js`
+458 行（请求指纹彩蛋），`plugins/skin/package.json` 的 inject 多一项。
`claude/`（skin.css / patches.css / skin.json / 四份 woff2）**一行没改** ——
所以 1.1.0 的令牌表、圆角阶梯、字体与 1.0.0 完全一致，只是把插件套件补齐。

### 新增的能力（5 项，全部来自上游同一发行版）

其中 **4 项实机可用**；**请求指纹彩蛋只入库、未生效**，按「未移植」处理（见下文
「未移植：请求指纹彩蛋（代码保留，等后人实现）」）。

| 功能 | 上游出处 | 在 glass 里的形态 |
| --- | --- | --- |
| **请求指纹彩蛋** ⚠️ **未生效（按未移植处理）** | `plugins/skin/lib/client.js` L427-L823 + apply 接线 | 代码一字不少地入库（含移植期为它做的两处改写），但**实机在输入框里打裸 `TZ=` 不触发**：这一版 DSH 不把这个座位的草稿交给它。`window.__claudeFootprint` 仍然装着，可手动 `.record()/.stop()/.reset()/.show()` 调试 |
| **局域网访问** | `plugins/lan-access/` | 侧栏底部「手机访问」入口 + 状态/绑定/二维码三张 host 路由（`/api/dsh-lan-access/{status,bind,qr}`）；二维码是自带的手写 byte-mode QR（versions 1-6, L/M），内联 SVG，无第三方依赖 |
| **品牌替换** | `brand-plugin/lib/client.js` | 星形标记 + 文字标识替换官方品牌位（`sidebar.brand.mark` / `sidebar.brand.name` / `conversation.hero.brand.mark`，以 `priority: -10` 遮蔽官方注册）+ `document.title` 与 favicon；`localStorage: dsh-claude-brand.prefs` |
| **Clawd 螃蟹挂件** | `crab-plugin/lib/client.js` | 直接挂在 `[data-composer-card]` 上的像素螃蟹（可选跟随主题、多行台词），7 天冷却的稀有变体；`localStorage: dsh-claude-crab.prefs`，设置页 id `clawd` |
| **字体切换** | `plugins/font-switcher/` | 设置页「字体」段（id `fonts`）：衬线/无衬线/等宽三个角色各选一组；实现手法是**同名 family 再声明一遍 `@font-face`**，而不是改令牌，所以皮肤里 181 处字面量 token 自动跟着走；host 半边提供 `/api/dsh-font-switcher/{manifest,file,reveal}` |

### 移植方式（可重跑，不是手抄）

- **`tools/port-from-theme.mjs`**：从上游仓库读 5 个 client 半边 + 2 个 host 半边，剥掉
  `window.__ModuleLoader__.load({…})` 外壳，落成 `src/port/*.js`（vendored），并生成
  `src/port/PORT-MANIFEST.md`（上游 commit + 每文件 sha256 前 16 位 + 字节数）。
  重跑一次 + `git diff` 就能跟进上游更新。
- **为什么 vendoring 而不是构建时 splice**：构建输入保持只有两个（aqua 基线 + `claude/`），
  上游重构不会静默改坏 glass 的构建，且移植内容留在 git 里可审查。
- **四处改写，都写进文件头注释**：① 每个 client 半边里的 `ctx.get("slots")` → `ctx.slots`；
  ② `lib/lan-access.js` 的 profile 解析改用宿主发布的 `profileContext`；③ 彩蛋 watcher 的草稿来源
  改用输入区自己的 facade（`props.keyboard` 发布的输入状态）；④ `LanPanel` 的遮罩改成 portal 到
  `document.body`。②③④ 都是实机跑出来的，见下方三个「修复」小节。
- **客户端**：5 个 client 半边内联进**同一个** `lib/client.js`，各自包在 IIFE 里
  （`const portBrand = (function () { var module = { exports: {} }; … })()`），
  所以它们自己的 `exports.name = "dsh-claude-brand"` 之类不会污染 glass 的 `exports`；
  在 glass 自己 `apply()` 之后由 `applyPortedThemePlugins(ctx)` 用 `ctx.inject(deps, …)`
  逐个挂载，每个都单独 try/catch —— 单个失败只降级那一个功能。
- **`inject` 扩了 `"timer"`**：crab 在 `ctx.effect` 里调 `ctx.timeout`，而 DSH 客户端运行时
  只在插件声明 `inject: ['timer']` 时才给 `ctx.timeout`（browser timer 全局被禁用）。
  aqua 原本没有这一项，`verify.mjs` 为此加了守卫。**不要**把 crab/skin 的 slot 注册
  写进 glass 的 `inject` 数组：`timer` 缺失会让**整个插件**加载失败，而 `ctx.inject` 只让它降级。
- **宿主**：两个需要注册路由的半边作为 `dist/lib/lan-access.js` + `lib/qr.js` +
  `lib/font-switcher.js` 单独发布（`lan-access` 内部 `import { encode } from "./qr.js"`，
  同目录才解析得到）；`lib/index.js` 由 `applyWithPortedPlugins` 用
  `ctx.inject(["connection","webServer"])` / `ctx.inject(["connection"])` 挂载
  ——这两个依赖直接沿用上游各自的 `export const inject`，不是猜的。
- 宿主的 `files:` 白名单同步加了这三个模块（`files` 是绝对白名单，漏了就打成断链包）。

### 校验

- `verify.mjs` 新增：客户端 `timer` 声明、6 个移植插件身份（`dsh-claude-brand|glass|crab|font-switcher|lan-access|skin`）、
  `ctx.get("slots")` 残留为 0、宿主导出形状、`lib/` 三个模块齐全。
- 新增 `tools/mount-smoke.mjs`（`npm run smoke`，也进了 `npm run release`）：这是**动态**校验，
  用替身 `window.__ModuleLoader__` / `require` / `ctx` / DOM 真执行构建产物，断言 5 个移植半边
  确实挂上（`settings.section#clawd`、`settings.section#fonts`、`sidebar.footer.action#lan-access`、
  `sidebar.footer.action#claude-profile`、`conversation.input.left#claude-fingerprint`、品牌三处 slot）、
  crab 确实调用 `ctx.timeout`，以及宿主六条路由确实注册。它在 CI 里能在没有 GUI 的情况下抓到
  「半边没挂上」这类回归。
- 宿主那部分还**真的调用**路由（在 `mkdtemp` 出来的沙箱 `DSH_HOME` 里，不碰真实 profile）：
  状态查询返回绑定与地址；打开开关后 patch 文件里出现托管块、`host: '0.0.0.0'`；**关掉后块被清掉、
  文件里的无关内容原封不动**；并断言 `$DSH_HOME/profiles/web`（即上游会写错的那个目录）**从未被创建**
  ——这就是上面那条实机 bug 的回归守卫。
- 动态校验也**不能**证明彩蛋在真实输入框里触发、二维码能扫、螃蟹能挂上；替身环境里没有真
  输入法、没有真布局引擎，这些仍要在 GUI 里实机确认（见 README §2.1 的验收清单）。
- `verify.mjs` 与 `tools/mount-smoke.mjs` 各自增加了一条“渲染安全”守卫（移植段必须自带 `React`
  绑定；每个注册的组件都要能渲染一次），两条都用“故意破坏的构建产物”验证过确实会失败（见下）。
- 冒烟还**驱动两个真交互**（不是只渲染一次）：① 把 `TZ=` 发布给彩蛋 watcher 的**替身** session 输入
  facade，断言草稿被改写成 `TZ=Asia/Shanghai`、且遮罩真的挂到 `document.body` —— 这条只证明**接线
  没断**（座位会沿发布进来的草稿走到面板），**不**证明实机触发；② 点一下
  「手机访问」按钮，断言 `LanPanel` 的遮罩经 `createPortal` 落到 `document.body`、且**不在**
  侧栏自己的子树里。两条同样用“故意破坏的产物”（`tools/break-lan-portal.cjs`）验证过会失败。
- `verify.mjs` 另有两条静态守卫：彩蛋 watcher 必须先 `typeof props.useInput === "function"` 再调用、
  且必须真的订阅输入状态（`clgUseStoreDraft(clgState)`）；遮罩必须是 `clgPortal(scrim, document.body)`。

### 修复：局域网开关写错 profile（实机发现）

上游 `plugins/lan-access/lib/index.js` 只从环境变量解析它要改写的 profile：

```js
function profileDir() {
  var profile = process.env.DSH_PROFILE || "web";
  return join(dshHome(), "profiles", profile);
}
```

DSH 桌面端启动的是 `desktop` profile，但**不导出** `DSH_PROFILE`，于是开关去写
`%USERPROFILE%\.dsh\profiles\web\cordis.patch.yml`：这个 profile 目录不存在，面板直接报
`写入失败： could not write … ENOENT: no such file or directory`，而正在运行的宿主也永远不会
读到那个块。（同一台机器上的 `@linxin666/dsh-remote-web-ui` 为同一个坑写了
`resolveManagedProfile()`，注释里把原因写得很清楚。）

修复：宿主会把启动的 profile 发布在 `profileContext` 服务上（`{ name, dir, patchPath, … }`），
移植版优先取其 `patchPath`（退化用 `dir` + `cordis.patch.yml`）；若连这个服务也拿不到
（`ctx.get("profileContext")` 返回假值），回退到**启动参数**里那个 `…/profiles/<名字>` 目录
（栈里只有 `$DSH_HOME/profiles/` 下、且带 `cordis.patch.yml` 的路径才会被采纳，避免写错 profile）；
环境变量 `DSH_PROFILE` 只作为最后的回退，且回退发生时会在控制台留下一条
`[dsh-lan-access] the Host published no profileContext fact…` 警告。路径在 `apply()` 开头由
`learnProfile(ctx)` 记一次 —— 导出的辅助函数是从路由回调里调的，拿不到 `ctx`。这是移植时的
**有意偏离**，写在 `src/port/lan-access.js` 文件头与 `PORT-MANIFEST.md` 里；生成器的漂移断言会让
上游一旦改动这段代码就报错，而不是静默失效。

### 修复：彩蛋半边缺 `React` 绑定（实机发现，致命）

上游 `plugins/skin/lib/client.js` 里，`var React = require("react"); var h = React.createElement;`
在模块工厂的顶部，而彩蛋的实现段（`var EGG_STORE = …` 到 `function apply(ctx)`）在几百行之后。
移植只切了彩蛋那一连续段，于是这段代码**没有任何绑定**：

```
ReferenceError: React is not defined
    at FootprintWatcher (…/lib/client.js:8667:…)
```

后果不是“彩蛋失效”，而是**输入框整块消失**：`conversation.input.left` 是在输入区内部渲染的，
条目渲染时抛错会把整棵 composer 子树带走（用户实机报告：“输入框完全没反应”）。

修复两层：

- `tools/port-from-theme.mjs` 在拼 `skin-egg.client.js` 时补上工厂顶部那两行 `React` / `h` 绑定，
  并断言这一节里一旦出现 `React.` 就必须有 `require("react")`。
- `verify.mjs` 增加**按节**的绑定检查：把 bundle 按 `/* ===== src/port/<文件> ===== */` 切开，
  每一节若用到 `React.` 或 `h(` 就必须自己绑定（6/6 通过）。
- `tools/mount-smoke.mjs` 增加**渲染**检查：记录每次 `slots.register(descriptor, Component)` 的组件，
  再用宽松的 props/服务替身把每一个都渲染一次 —— 这是唯一能抓到“条目一渲染就抛”的静态手段。
  它同时被验证过：故意从构建产物里删掉那段 `React` 绑定时，verify 报
  `BAD src/port/skin-egg.client.js uses React without binding it`，冒烟报
  `FAIL render "conversation.input.left#claude-fingerprint" threw on first render: React is not defined`
  （两者都以 1 退出），随后重建即恢复全绿。

### 未移植：请求指纹彩蛋（代码保留，等后人实现）

**结论：这个彩蛋在本版 DSH 里触发不了，1.1.0 起按「未移植」处理 —— 代码一字不删地留在 bundle
里，留给后来者接上触发链路。**

实机取证（两轮）：`typeof window.__claudeFootprint === "function"`（说明 `apply()` 跑过、helper 装上了、
`dsh-claude-skin.egg` 冷却戳是 `null`、开关也没关），但输入框里打 `TZ=` 始终毫无反应。根因在**槽位的
props 契约**：上游假设 `conversation.input.left` 拿得到 `useInput(s => s.draft)` 与 `inputActions`
（注释里写着「这是契约，不是可选附加项」），而这一版 DSH 只把这对 facade 交给 composer 自己的
视图 —— 座位拿到的是输入区那一层的 props，里面只有 `props.keyboard`（session 的输入门面）。
上游那句 `props.useInput(...)` 在这里就是「拿 `undefined` 当函数调」，而它在 hook 里无条件调用，
所以条目一渲染就抛（这也是「输入框没反应」的另一半原因，与上一条 `React` 缺失叠加）。

移植期为它做了两处改写（都已入库）：① 补上 `React` 绑定，否则整个输入框会消失；
② 草稿改从 `props.keyboard` 的**已发布输入状态**读 —— `shell.state` 同时有 `getSnapshot` 与
`subscribe` 时用 `React.useSyncExternalStore` 订阅（键击不会 re-render 这个座位，只在渲染时读一次的话
永远只会看到挂载那一刻的值），写回走 `shell.actions.setDraft`；`props.useInput` / `props.inputActions`
仍在时优先用它们（上游路径不丢）。每个分支由“座位传了什么”决定，对同一个 app 是常量，所以 hook
调用顺序不会在两次渲染之间变化。**改完实机复测仍然不触发**，说明草稿并不是以这套门面所假设的形状
出现在这个座位上 —— 到此停止追这条链路，改记为未移植。

留给后人（这就是本条目存在的意义）：
- 这个外侧座位能拿到的只有 `props.keyboard`；真正的草稿状态在 composer 自己的输入层里
  （bundle `dsh-client-ui-conversation` 的输入视图 / Lexical 层），要么找到它对外发布的那个订阅口，
  要么把 watcher 挂到 composer 内部的注入点，而不是 `conversation.input.left`。
- 面板本身是好的：`window.__claudeFootprint.show()` 能手动把它叫出来，先确认这一点再怀疑 UI。
- 冷却戳在 `localStorage: dsh-claude-skin.egg`；`apply()` 里的注册 id 是 `claude-fingerprint`。
- 冒烟测试仍会驱动它（发布 `TZ=` → 断言草稿变成 `TZ=Asia/Shanghai`、`role="dialog"` 的遮罩出现在
  `document.body`），但那只保证**接线没断**，不代表实机触发。

### 修复：局域网面板糊在侧栏里（实机发现）

用户报告「反复点击复选框时图形界面崩溃」。取证结论是渲染器其实没崩（没有 Crashpad 报告，
宿主也没重启）：是 `LanPanel` 的 `.dla-scrim`（`position: fixed`）**在侧栏内部渲染**，而侧栏里的
玻璃表面是 `backdrop-filter` —— 按 CSS 规范，filter/backdrop-filter 会形成**包含块**，于是这个
「fixed」遮罩被按侧栏那一列定位、并盖住侧栏自己的导航，看起来就像侧栏塌了；反复点开关只是反复
重渲染它。glass 其实已经为**官方**对话框处理过同一个坑
（`[data-dsh-cglass] body [role=dialog] { backdrop-filter: blur(50px) }` 加上
`… [class*=sidebarCol]:has([role=dialog]) { backdrop-filter: none }`），但那个选择器只认官方对话框
所在的那一列。

修复（第四处改写）：遮罩经 `react-dom` 的 `createPortal` 交给 `document.body`
（`document` 不可用或运行时没有 `react-dom` 时原地渲染，功能不丢）。DSH 自己的对话框就挂在 body 下
（glass 那条 `body [role=dialog]` 规则正是为它们写的），所以这条路径和 glass 的观感一致。

顺带说明一件容易被当成 bug 的事：开关以 `info.bindHost === "0.0.0.0"` 判定，绑定生效后宿主返回的
就是 `0.0.0.0`，所以点完开关、面板重新拉取状态时复选框会**回到勾选态** —— 那是已生效，不是点击无效。

### 打包

`dist/dsh-claude-glass/dsh-claude-glass-1.1.0.tgz`（26 个条目，约 549 KB；`tools/` 不进包，
它们只在源码仓库里）。

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
