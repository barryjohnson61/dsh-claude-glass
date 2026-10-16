# Claude Glass 利用 AI Agent 部署至 DeepSeek Harness 的指南

核查日期：2026 年 10 月 16 日。目标仓库：[barryjohnson61/dsh-claude-glass](https://github.com/barryjohnson61/dsh-claude-glass)。核查提交：`78d54646966da77f7135d47d9d6e97177502bbd7`。

本指南介绍两种工作方式：在本机 DeepSeek Harness 会话中让 Agent 准备部署，以及使用本机 Codex、Claude Desktop 或 Claude Code 完成安装。两者最终都把插件装入 **Harness 实际使用的 profile**，不会把它安装成 Codex 或 Claude 的扩展。

**先说结论：该仓库目前不能仅靠克隆后直接安装。** 仓库只提交源码，没有提交 `dist/` 和 `.tgz`；核查时 GitHub Releases 页面也未列出发行版。源码构建依赖一个未随仓库提供的 `dsh-client-ui-aqua@1.3.1-patch.4` 修补基线，以及 Claude 主题资产。已有可靠成品包时可以直接安装；没有时，必须取得该基线，或先完成兼容适配和验证。本指南不会把缺失的基线描述成可直接下载的现成依赖。

## 1 仓库内容与部署边界

Claude Glass 是非官方 Harness 界面插件，整合 Claude 风格的配色、字体和版式，以及 Aqua 的玻璃材质、流体背景和动效。它还包含品牌替换、Clawd 螃蟹、字体切换和手机访问功能。它不会为 Harness 配置 Claude 模型或替换模型 API。

| 项目 | 仓库实际情况 | 部署时的含义 |
| --- | --- | --- |
| 根目录 `package.json` | 私有构建工程，版本 `1.0.0` | 不是最终可安装的插件包 |
| `build.mjs` | 生成插件版本 `1.1.0` | 以生成包的版本为准 |
| 输出目录 | `dist/dsh-claude-glass/` | 安装此目录打出的包，不能安装源码仓库根目录 |
| 目标运行时 | `dshCompatPatch.forRuntime` 为 `0.2.0-rc.2` | 其他版本需要重新验证，不等于自动兼容 |
| Aqua 输入 | `dsh-client-ui-aqua@1.3.1-patch.4` | 需要完整包目录及修补后的预构建 `lib/` |
| Claude 输入 | `dsh-claude-theme/claude/` | 包含 `skin.css` 和四份字体文件 |
| 构建工具 | Node.js ≥ 18，npm 或 pnpm | 这是插件构建要求；Harness 本身可能要求更高版本 |
| 活跃主题 | Glass 与 Aqua 不应同时挂载 | 两者会争用 `aqua` 设置槽，并各自创建流体画布 |
| 请求指纹彩蛋 | `TZ=` 实机触发未实现 | 不作为安装失败依据 |

另一个重要区别：核查时官方 Harness 源码已经是 `0.2.1-alpha.4`，而插件声明的目标是 `0.2.0-rc.2`。不要为安装主题顺手升级或降级现有 Harness，也不要单纯放宽版本检查来宣称兼容。

### 本次试跑发现

为检验公开源码能否直接复现，使用了以下公开检出：

| 仓库 | 提交 | 观察 |
| --- | --- | --- |
| Claude Glass | `78d54646966da77f7135d47d9d6e97177502bbd7` | 本指南依据版本 |
| 公开 Aqua 上游 | `d94431a95bd147c11ef3fe95fa1915d1e96b028b` | 清单是 `@deepseek-ai/dsh-client-ui-aqua@1.3.0`，并非要求的修补包 |
| Claude Theme | `ef194178525bff60d47a91e6c25df8c33f4db68f` | 本次构建资产输入 |

公开 Aqua 上游配合这些主题资产可以让 `build.mjs` 退出码为 0，但 `verify.mjs` 退出码为 1，报告侧栏 `backdrop-filter` 回归；挂载冒烟也退出码为 1，报告模块 id 为 `@deepseek-ai/dsh-claude-glass`，期望值却是 `dsh-claude-glass`。生成包还没有正确基线应提供的 `dsh.bundle.patch` 元数据。

冒烟另有网络接口枚举 `uv_interface_addresses` 错误，属于本次执行环境的限制，需在有正常网卡访问能力的本机复核；不能把它与模块 id、侧栏守卫失败混为一谈。上述结果说明：**构建成功不代表通过部署验收，公开 Aqua 当前版本不能直接替代指定基线。** 本次没有在真实 Harness GUI 中完成安装或验收。

## 2 两种方式如何选择

| 方式 | Agent 所在环境 | 适合情况 | 最后安装由谁执行 |
| --- | --- | --- | --- |
| 方式一 本机 Harness 直接准备部署 | 本机 Harness 的 Agent 会话 | Harness 已能正常工作，想直接在其中发任务 | 若修改当前 profile，退出 Harness 后在外部终端执行准备好的脚本 |
| 方式二 外部 Agent 辅助安装 | 本机 Codex CLI、Claude Code 或 Claude Desktop 的本地代码会话 | 需要持续排错、适配版本，或避免安装时会话断开 | 外部 Agent 在 Harness 停止后继续执行 |

两种方式都应经历：识别环境 → 准备并验证安装包 → 备份 → 停止目标宿主 → 安装并注册 → 重启 → GUI 验收。

**为什么方式一需要最后切换一次终端？** 仓库 README 明确要求不要在宿主运行时修改 profile。若正在协助安装的 Agent 本身就在该宿主中，关闭宿主也会结束它的执行通道。因此它应先把安装脚本、回滚脚本和记录写好，再交给外部终端执行。不要让它关闭自己的宿主后继续等待工具结果。

## 3 两种方式共用的环境准备

### 3.1 确认路径和运行版本

需要记录四个值：

```text
WORK_DIR       用于下载源码、构建和保存部署记录的独立目录
DSH_HOME       当前 Harness 的实际配置根目录
PROFILE        实际启动的 profile 名称，例如 desktop 或 web
PROFILE_DIR    DSH_HOME/profiles/PROFILE
```

默认候选位置如下，但应以启动参数、日志和宿主 `profileContext` 为准：

| 环境 | 默认候选根目录 | profile 示例 |
| --- | --- | --- |
| Windows | `%USERPROFILE%\.dsh` | `%USERPROFILE%\.dsh\profiles\desktop` |
| macOS 或 Linux | `~/.dsh` | `~/.dsh/profiles/web` |
| 自定义根目录 | 环境变量 `DSH_HOME` 指定的位置 | `<DSH_HOME>/profiles/<实际名称>` |

Windows PowerShell 只读检查示例：

```powershell
node --version
git --version
Get-Command dsh -ErrorAction SilentlyContinue
# PATH 中确实有该目标 Harness 的 dsh 时再运行
dsh --version
dsh plugin --help

$DshRoot = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
Get-ChildItem (Join-Path $DshRoot 'profiles') -Directory
```

macOS 或 Linux 的对应检查：

```bash
node --version
git --version
command -v dsh
# 确认这是目标 Harness 的启动器后再运行
dsh --version
dsh plugin --help
dsh_root="${DSH_HOME:-$HOME/.dsh}"
ls "$dsh_root/profiles"
```

桌面应用可能自带 Node、启动器和包管理器，也可能没有向 PATH 暴露 `dsh`。此时让 Agent 从应用启动信息中定位，不要仅因命令不存在就再安装一套 Harness。使用 npx 的环境也应沿用原来的**固定版本**启动方式，不要临时调用最新版本替代。

检查所选 profile 的 `package.json`、锁文件和 `cordis.patch.yml`，识别 Aqua 的依赖名、bundle 和直接注册项。配置中可能出现无作用域的 `dsh-client-ui-aqua`，也可能是 `@deepseek-ai/dsh-client-ui-aqua`，必须按实际内容处理。只展示相关字段，不把模型密钥或完整配置贴进对话。

### 3.2 选择安装包来源

**已有成品包时：** 使用作者或可信来源提供的 `dsh-claude-glass-1.1.0.tgz`，记录来源和 SHA-512。解到临时目录，确认 `package.json.name` 为 `dsh-claude-glass`，包含 `dsh.bundle.patch`、`dsh.client` 以及它们指向的文件。文件名本身不能证明包的内容正确。

**从源码构建时：** 先准备完整 `1.3.1-patch.4` 基线。如果本机已有该包，可复制其实际包目录到工作区，核对清单和补丁来源。需要至少有 `package.json`、`lib/client.js`、`lib/index.js`、`lib/invariant.js`、`lib/types/` 及 bundle 元数据。不要直接在现有 `node_modules` 中修改它。

建议目录：

```text
WORK_DIR/dsh-claude-glass
WORK_DIR/dsh-client-ui-aqua
WORK_DIR/dsh-claude-theme
```

PowerShell 构建步骤如下。每条 Node 命令失败时必须停止，不继续打包或安装：

```powershell
Set-Location 'D:\Work\claude-glass-deploy'  # 换成实际工作目录
git clone https://github.com/barryjohnson61/dsh-claude-glass.git
if ($LASTEXITCODE -ne 0) { throw '克隆 Glass 失败' }
git -C dsh-claude-glass checkout 78d54646966da77f7135d47d9d6e97177502bbd7
if ($LASTEXITCODE -ne 0) { throw '固定 Glass 提交失败' }
git clone https://github.com/aklnaaw/dsh-claude-theme.git
if ($LASTEXITCODE -ne 0) { throw '克隆主题失败' }
git -C dsh-claude-theme rev-parse HEAD  # 记入部署记录；后续复现使用同一提交

# 此前已将完整的 1.3.1-patch.4 基线放到相邻目录 dsh-client-ui-aqua
Set-Location dsh-claude-glass
node build.mjs --base ../dsh-client-ui-aqua --claude ../dsh-claude-theme/claude
if ($LASTEXITCODE -ne 0) { throw '构建失败' }
node verify.mjs dist/dsh-claude-glass/lib/client.js
if ($LASTEXITCODE -ne 0) { throw '静态校验失败' }
node tools/mount-smoke.mjs
if ($LASTEXITCODE -ne 0) { throw '动态挂载校验失败' }
node pack.mjs
if ($LASTEXITCODE -ne 0) { throw '打包失败' }
```

macOS 或 Linux 可执行同样的 Git 和 Node 命令；在脚本开头使用 `set -e`，并将工作目录换为真实路径。也可以先设置 `DSH_AQUA_BASE` 和 `DSH_CLAUDE_THEME`，再运行 `npm run release`，它会依次构建、校验、冒烟和打包。

预期产物是：

```text
dist/dsh-claude-glass/dsh-claude-glass-1.1.0.tgz
```

这些构建脚本使用 Node 内置模块，通常不需要先在 Glass 根目录执行 `npm install`。打包时 `pack.mjs` 优先找 pnpm，再找 npm；`DSH_PACK_CMD` 可指向可用的 `pnpm.cjs` 或 `npm-cli.js`。打包器可用性以实际试跑为准。

如果没有指定基线，也没有可靠成品包，到此转入第 8 节的适配流程。不要把公开 Aqua 仓库克隆后改个文件夹名，就当成已经取得该修补基线。

## 4 方式一 在本机 DeepSeek Harness 中直接部署

### 4.1 操作步骤

1. 在本机 Harness 中建立安装会话，选一个确实具备文件和 shell 工具的模式；若需要检查插件管理能力，可以使用当前版本支持的 Creator 模式。
2. 把工作目录设为独立部署目录，提供已确认的 profile 路径和成品包或 Aqua 基线路径。
3. 粘贴下面的准备提示词。让 Agent 读源码、验证输入、构建和测试，但先不改正在运行的 profile。
4. 检查生成的 `DEPLOY-PLAN.md`，确认写入的是当前目标 profile，包来源、版本和校验结果清楚。
5. 保存会话，退出目标 Harness 桌面应用；Web 版则在原启动终端停止相应服务器。确认该 profile 的宿主已经停止。
6. 在外部终端运行 Agent 已生成的安装脚本。Windows 示例：`pwsh -NoProfile -File 'D:\Work\claude-glass-deploy\apply.ps1'`；macOS 或 Linux 示例：`bash "$HOME/Work/claude-glass-deploy/apply.sh"`。
7. 用原来的快捷方式或固定版本命令启动 Harness，再执行第 7 节验收。失败时先停宿主，再执行生成的回滚脚本。

脚本名是本指南要求 Agent 生成的文件名，**仓库本身没有这些安装脚本**。只有 Agent 已经生成并检查后才能执行。

### 4.2 直接粘贴给 Harness Agent 的准备提示词

```text
请为本机 DeepSeek Harness 部署 Claude Glass。你当前可能运行在要修改的宿主中，因此本轮先完成准备，不修改活跃 profile，也不要停止自己的宿主。

目标仓库：https://github.com/barryjohnson61/dsh-claude-glass
参考提交：78d54646966da77f7135d47d9d6e97177502bbd7
WORK_DIR：<填写独立工作目录绝对路径>
DSH_HOME：<填写已确认的根目录，未知则先探测>
PROFILE：<填写实际 profile，未知则先探测>
已有成品 tgz：<路径或“无”>
Aqua 1.3.1-patch.4 基线：<完整包目录或“无”>

请执行以下工作：
1. 阅读 README.md、CHANGELOG.md、build.mjs、verify.mjs、pack.mjs、tools/mount-smoke.mjs、src/port 的挂载片段和 NOTICE。遵循适用的 AGENTS.md。
2. 识别 OS、Node、目标 Harness 的实际版本、启动方式、DSH_HOME、profileContext 和目标 profile。区分当前 shell 的用户目录与宿主实际根目录，不根据 desktop/web 名字猜测。
3. 只读检查目标 profile 的 package.json、锁文件和 cordis.patch.yml，列出实际启用的 Aqua/Glass、相关独立 Claude 插件及重复注册。不要输出密钥。
4. 根 package.json 是构建工程，不能当插件安装。若有可信 tgz，先在工作区临时解包检查；否则使用明确来源的 1.3.1-patch.4 基线和 claude/ 资产构建。
5. 源码路径依次执行 build、verify、mount-smoke，全部通过才 pack。检查最终包的 name、version、dsh.bundle.patch、dsh.client 和文件白名单。记录提交、SHA-512、命令、退出码。任何失败都不能跳过。
6. 若缺基线或目标运行时与 0.2.0-rc.2 不同，写明缺项和兼容性证据。不要伪造下载地址，不要改版本号或删除守卫冒充兼容。
7. 准备 apply.ps1 与 rollback.ps1；非 Windows 则生成 apply.sh 与 rollback.sh。脚本应使用核实后的绝对路径，安装前验证输入、确认目标宿主已停止、创建备份，并在命令失败时停止。不要宽泛终止所有 Node/Electron 进程。
8. 安装脚本优先沿用目标 Harness 自带且本机帮助确认支持的 dsh plugin 命令。使用带内容哈希的 vendor tgz 文件名，避免同名 file: 依赖完整性缓存。仅停用冲突的 Aqua 及已确认重复的条目，保留全部其他 bundle、配置和数据。没有合适 CLI 时按 README 的 profile 方法生成等价步骤，并处理锁文件一致性。
9. 回滚脚本恢复原 package.json、原锁文件、原 cordis.patch.yml 和旧插件文件/链接状态，处理此前不存在的文件，不覆盖会话和凭据。保存安装前后差异和备份位置。
10. 生成 DEPLOY-PLAN.md，列出原启动命令、离线安装命令、重启命令、GUI 验收清单和回滚命令。缺输入时将脚本设为不可执行安装并输出明确原因。

这轮完成后告知准备状态和我退出 Harness 后该执行的精确命令。不要宣称完成安装或 GUI 验收。
```

### 4.3 重启后的验收提示词

```text
我已执行离线安装并重启目标 Harness。请依据 WORK_DIR 中的部署记录进行验收。
先确认当前宿主使用的是记录中的 profile、根目录和运行时版本，再检查插件加载日志、Glass bundle 选择和 Aqua 是否停用。
如有浏览器工具，请检查输入框可输入并发送、设置页可打开、浅深色切换、侧栏折叠与恢复、右侧栏和兼容模式、字体设置与 Clawd。没有 GUI 工具时输出需要我实际操作的清单，不要假称已验证。
检查手机访问面板能否打开及其路由状态，先保持回环地址，不自动开启 LAN 绑定。TZ= 彩蛋未触发是已知状态。
按“已通过、失败、待人工验证”报告结果。若启动、输入框或侧栏出现严重问题，先生成明确回滚指令，避免继续在活跃 profile 上试改。
```

## 5 方式二 利用 Codex 或 Claude 辅助安装到 Harness

### 5.1 Codex 的具体步骤

1. 安装并登录本机 Codex CLI，或使用具备目标本机文件与 shell 访问能力的本地会话。
2. 打开独立部署目录，在终端进入该目录后执行 `codex`。
3. 粘贴第 5.4 节通用提示词，附上路径和安装包或基线位置。
4. 先让它完成检查、构建和校验；准备好后停止目标 Harness。若已经停止，在提示词中明确写明。
5. 让 Codex 继续安装、检查 profile 差异，并使用原启动方式重启或给出该启动命令。
6. 按第 7 节验收；只有真实操作过的项目才能标记通过。

```bash
cd /实际路径/claude-glass-deploy
codex
```

Codex 官方文档说明 CLI 可以在本机读取文件、编辑并运行工具。关键是选中正确执行环境：仅在云端克隆了 GitHub 仓库的会话，不能据此认定已经访问用户电脑上的 Harness。

### 5.2 Claude Code 的具体步骤

1. 安装并登录本机 Claude Code，在目标部署目录执行 `claude --version` 核对安装。
2. 在该目录启动 `claude`，使用第 5.4 节通用提示词。
3. 按检查、构建验证、停宿主、安装、重启、验收的顺序执行。Claude Code 位于外部进程，因此 Harness 关闭后它仍可继续安装和排错。

```bash
cd /实际路径/claude-glass-deploy
claude --version
claude
```

Windows 原生 Harness 与 WSL 是不同运行环境。若使用 WSL，不能把 WSL 的 `~/.dsh` 当成 Windows 桌面应用的 profile；需要准确映射 Windows 路径，且安装、重启应调用正确一侧的工具链。没有明确需求时，直接使用与 Harness 相同操作系统环境的本地会话。

### 5.3 Claude Desktop 的具体步骤

优先使用 Claude Desktop 中 **Claude Code 的本地代码会话**：

1. 打开桌面应用的代码工作界面，选择部署文件夹。
2. 选择执行环境 `Local`，核对显示的工作目录。该选项是否可用取决于当前版本、账户及组织设置。
3. 粘贴通用提示词，让它先运行 `node --version`、只读访问目标 profile，并证明命令实际在 Harness 所在电脑执行。
4. 本地 Node、Git 或 pnpm 不在 PATH 时，在该本地会话环境中指定路径。桌面应用未必继承终端的全部环境设置。
5. 停止 Harness 后，让该本地会话继续安装并验收。

如果只有普通聊天界面，则必须已有能访问目标路径的本机文件工具和能执行宿主命令的本机工具。**仅有文件读取能力不足以完成 Node 构建和安装。** 无法验证本机执行能力时，让它生成步骤或脚本，再交给本机终端、Codex CLI 或 Claude Code 执行。不要将隔离环境里的成功构建写成“已安装到本机”。

### 5.4 外部 Agent 通用安装提示词

```text
请在本机协助安装 Claude Glass 到现有 DeepSeek Harness，按检查、构建验证、备份、停止宿主、安装、重启和验收完成工作。

仓库：https://github.com/barryjohnson61/dsh-claude-glass
参考提交：78d54646966da77f7135d47d9d6e97177502bbd7
WORK_DIR：<部署工作目录绝对路径>
DSH_HOME：<已确认的配置根目录，未知请先探测>
PROFILE：<目标 profile，未知请先探测>
Harness 启动方式：<快捷方式或固定版本命令>
Harness 当前状态：<正在运行或已停止>
已有成品 tgz：<路径或“无”>
Aqua 1.3.1-patch.4 基线：<完整包目录或“无”>

约束与任务：
1. 先证明你操作的是目标本机而非仅云端容器。核对 OS、工具链、目标运行时版本、实际配置根目录和 profile。阅读仓库 README、CHANGELOG、构建/校验/冒烟/打包脚本及适用的 AGENTS.md。
2. 此仓库根目录是构建工程；安装对象必须是通过检查的 dist/dsh-claude-glass 打包产物或可信成品 tgz。
3. 指定构建基线是 dsh-client-ui-aqua@1.3.1-patch.4，公开 Aqua 当前检出不是它的替代品。缺少基线时先寻找已获授权的本机副本或可靠来源，不能伪造下载地址。目标运行时不是 0.2.0-rc.2 时先列出兼容性差异。
4. 构建路径依次运行 build、verify、mount-smoke，全部通过再 pack。成品包则在临时目录解包检查元数据与必需文件；有对应源码和校验脚本时也对该解包产物运行校验。记录所有来源、提交、哈希、日志和退出码。
5. 准备好包和回滚步骤后，确认目标 Harness 已停止，再修改 profile。你在外部会话中可以继续工作；若无法准确停止目标进程，给出原启动终端的停止步骤，不要终止无关进程。
6. 备份 package.json、锁文件、cordis.patch.yml、旧插件目录/链接和相关 vendor 文件，记录哪些原本不存在。保留会话、模型设置、密钥和无关插件。
7. 优先使用目标 Harness 的启动器及其帮助确认支持的 dsh plugin --profile <实际 profile> add <本地 tgz> 流程。无法使用时按仓库 README 的 profile 方式安装。将 tgz 放进目标 vendor 并采用内容哈希文件名；确保 package.json 依赖、node_modules、锁文件和 dsh.profile.bundles 一致。
8. 停用实际冲突的 Aqua bundle 和直接注册条目，Glass 只注册一次。不要同时加载与 Glass 内联功能重复的独立插件；只修改已确认冲突的条目。保留其他 bundle 的顺序。不要通过删除守卫或绕过兼容性检查解决失败。
9. 使用原启动方式重启 Harness；检查日志及 GUI。验证输入与发送、设置页、浅深色、侧栏、右侧栏、兼容模式、字体与 Clawd。LAN 面板可检查，但不自动开启 0.0.0.0 绑定。TZ= 彩蛋未触发属于已知状态。
10. 生成 DEPLOY-RESULT.md，列出实际变更、版本、SHA-512、校验结果、待人工 GUI 项、备份位置与精确回滚命令。严重回归时停宿主并恢复本次变更。没有 GUI 能力时不要宣称 GUI 已通过。

如果缺输入或需要开发兼容补丁，完成可独立完成的调查和准备，将阻塞原因、已做工作和下一步写清楚；不要把未完成状态称为部署成功。
```

## 6 安装阶段的实际命令与配置

以下是给用户检查 Agent 操作的命令范式。前提是已经取得通过验证的包，且目标 Harness 已停止。Windows 示例以 `desktop` 为例，必须换成已识别的实际 profile。

### 6.1 备份和存放安装包

```powershell
$ErrorActionPreference = 'Stop'
$DshRoot = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$ProfileName = 'desktop'  # 必须核对，不要照抄猜测
$ProfileDir = Join-Path $DshRoot "profiles/$ProfileName"
$SourceTgz = 'D:\Work\claude-glass-deploy\dsh-claude-glass\dist\dsh-claude-glass\dsh-claude-glass-1.1.0.tgz'
if (!(Test-Path (Join-Path $ProfileDir 'package.json'))) { throw '目标 profile 不存在' }
if (!(Test-Path $SourceTgz)) { throw '安装包不存在' }

# 在 profile 外保存原状态，避免把备份嵌进被备份目录
$BackupDir = Join-Path $DshRoot ("deployment-backups/claude-glass-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $BackupDir | Out-Null
foreach ($Name in @('package.json','pnpm-lock.yaml','package-lock.json','cordis.patch.yml')) {
    $Original = Join-Path $ProfileDir $Name
    if (Test-Path $Original) { Copy-Item $Original $BackupDir }
}
# Agent 还应记录原文件是否存在，并备份将被修改的旧插件目录/链接及 vendor 项

$VendorDir = Join-Path $ProfileDir 'vendor'
New-Item -ItemType Directory -Force -Path $VendorDir | Out-Null
$Digest = (Get-FileHash $SourceTgz -Algorithm SHA512).Hash.ToLower()
$VendorName = "dsh-claude-glass-1.1.0-$($Digest.Substring(0,12)).tgz"
$VendorTgz = Join-Path $VendorDir $VendorName
Copy-Item $SourceTgz $VendorTgz
Write-Output "备份目录：$BackupDir"
Write-Output "包 SHA512：$Digest"
```

同一 `1.1.0` 包重新打包后，内容可能变化。采用哈希文件名可以让 `file:` 依赖的路径随内容变化，避免 README 提到的同名 tarball 被锁文件当成已安装。这个命名策略是本指南的操作建议，仓库默认产物名仍然不带哈希。

### 6.2 本机启动器支持插件管理时

沿用目标 Harness 的 `dsh` 可执行程序或固定版本启动命令：

```powershell
# 先读取 package.json 和 patch，确认原 Aqua 的准确依赖名称。
# 仅在存在对应依赖时二选一执行；不要两行盲跑。
# dsh plugin --profile $ProfileName remove dsh-client-ui-aqua
# dsh plugin --profile $ProfileName remove '@deepseek-ai/dsh-client-ui-aqua'

dsh plugin --profile $ProfileName add "$VendorTgz"
if ($LASTEXITCODE -ne 0) { throw '插件安装失败，检查日志并按部署记录恢复' }
```

之后检查 `dependencies` 和 `dsh.profile.bundles`。当前官方插件管理流程可以根据包的 bundle 声明注册它；旧版本行为以本机帮助和结果为准。若此前 Aqua 通过 `cordis.patch.yml` 直接插入，还必须停用那一条，单纯移除依赖或 bundle 不一定足够。

### 6.3 按 README 手工处理 profile 时

让 Agent 合并以下内容，**不要用此片段覆盖整个文件**。保留原有核心 bundle 和其他依赖，仅将活跃 Aqua 替换为 Glass。JSON 路径使用 `/` 可以减少转义错误。

```jsonc
{
  "dependencies": {
    "dsh-claude-glass": "file:vendor/dsh-claude-glass-1.1.0-<实际哈希前缀>.tgz"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "<原有其他 bundle 保持原顺序>",
        "dsh-claude-glass"
      ]
    }
  }
}
```

这是示意片段，注释和尖括号占位符不能直接写入最终 `package.json`。停用相关 Aqua 注册后，使用目标 profile 原来的包管理器和版本安装依赖并更新锁文件。若确实使用 pnpm：

```powershell
pnpm --dir "$ProfileDir" install
if ($LASTEXITCODE -ne 0) { throw 'profile 依赖安装失败' }
```

README 也提供直接解包到 `node_modules/dsh-claude-glass` 的方法。使用这条路径时，先保存旧目录或链接，不要沿 pnpm 符号链接写进共享存储；目标解包目录需先创建：

```powershell
# 此前已备份并移走旧目录/链接；仅在目标不存在时执行
$PluginDir = Join-Path $ProfileDir 'node_modules/dsh-claude-glass'
if (Test-Path $PluginDir) { throw '目标已存在，先按计划处理旧目录或链接' }
New-Item -ItemType Directory -Path $PluginDir -Force | Out-Null
tar -xzf "$VendorTgz" -C "$PluginDir" --strip-components=1
if ($LASTEXITCODE -ne 0) { throw '解包失败' }
```

直接解包只解决文件落盘。依赖声明、bundle 选择和锁文件也必须完成一致性处理。不要因为界面暂时可用，就把“下次执行包管理器可能失效”的状态记为可复现部署。更换为新的哈希文件名后用原包管理器重新解析，通常比手工修改锁文件的 integrity 更容易核查；严格使用旧同名包时，则需要按 README 同步完整性并确认安装结果。

### 6.4 重启前检查

至少确认以下包内文件存在，并与元数据相符：

```text
package.json
cordis.patch.yml
lib/client.js
lib/index.js
lib/invariant.js
lib/types/
lib/lan-access.js
lib/qr.js
lib/font-switcher.js
LICENSE
NOTICE
licenses/
```

生成包的 patch 应注册 `ui-claude-glass`，模块名为 `dsh-claude-glass`。若已通过 bundle 自动应用该 patch，不再在 profile patch 里追加同一份 `insert`。

检查完成后，桌面版用原快捷方式启动；Web 版沿用原启动命令。只有原环境本来就使用该 `dsh` 启动器时，才使用类似 `dsh --profile web` 的命令。

## 7 验收与回滚

### 7.1 验收清单

| 检查项 | 通过标准 |
| --- | --- |
| 宿主和 profile | 根目录、profile、运行时与部署记录一致 |
| 加载 | 没有 Glass 模块导入失败、关键服务缺失或版本跳过错误 |
| 基本对话 | 输入框可聚焦、输入和发送消息，工具输出与思考文本不被裁切 |
| 主题设置 | 通用设置中出现 Claude 玻璃控件，浅深色和材质切换正常 |
| 侧栏 | 收起后仍能展开；悬停不会把按钮推离原位，Windows 标题栏模式尤其要检查 |
| 兼容模式 | 没有遮住正文的白块，没有整屏模糊；打开和关闭右侧栏均正常 |
| 品牌和 Clawd | 品牌位、标题及 favicon 按设置更新；螃蟹在输入卡片处显示 |
| 字体 | 设置中出现字体段，角色切换生效，刷新后保留；自定义字体需有可用字体文件 |
| 手机访问 | 面板覆盖整个应用，二维码可显示；实际扫码验证单独记录 |
| 持久性 | 重启后 Glass 仍生效，没有同时恢复 Aqua |

LAN 可选验收：需要手机连接时再启用绑定，确认写入的确实是当前 profile 的 `cordis.patch.yml`，按提示重启后再扫码。`0.0.0.0` 会扩大监听范围，因此不作为基础主题安装的默认动作。

`TZ=` 彩蛋在该版本真实输入框中不触发是仓库已知状态，不能据此判为部署失败。Glass 也没有移植原皮肤商店的 `Claude-X` 设置段。

### 7.2 回滚步骤

1. 停止目标 Harness，记录错误日志。
2. 恢复本次修改前的 `package.json`、原锁文件和 `cordis.patch.yml`；原本不存在的文件按清单恢复为不存在。
3. 恢复旧插件目录或链接。若采用包管理安装且依赖树发生变化，使用同一包管理器按原锁文件恢复，并确认原本地 tarball 仍然可访问；不要只恢复清单就假定实际模块已经回滚。
4. 清理本次新建且不再被引用的 Glass 文件，保留部署日志和安装包用于排查。不要删除整个 `~/.dsh` 或用户会话数据。
5. 按原方式启动，验证原主题和基本对话恢复。浏览器 localStorage 中的主题偏好与 profile 文件分开管理；没有需要时不清空整个站点存储。

## 8 缺少基线或需要兼容新 Harness 时

这属于适配开发，推荐由方式二的外部 Agent 在独立副本中完成。不能仅将清单版本改成 `1.3.1-patch.4`，也不能因为构建脚本能找到字符串锚点，就认为补丁已齐全。

以下是可追加给 Codex 或 Claude Code 的提示词，**仅在确实希望 Agent 开发兼容补丁时使用**：

```text
现有输入无法直接通过 Claude Glass 验证。我授权你在独立工作副本中调查并开发最小兼容补丁，但暂不修改活跃 Harness profile。

请先列出目标运行时的真实客户端 API、服务名、模块 id 规则、bundle 声明及导出格式，与仓库要求的 0.2.0-rc.2 和 Aqua 1.3.1-patch.4 对比。
若使用公开 Aqua 1.3.0，明确标记为自行适配输入，不冒充作者的 patch.4。优先修复侧栏包含块、模块 id、dsh.bundle.patch 和运行期 API 的实际差异，保持构建步骤可复现，不直接手改 dist。
保留 verify 和 mount-smoke 的有效守卫。测试环境缺陷与产品缺陷分别记录，不通过删断言、修改退出码或伪造版本让测试变绿。
不要顺手重新移植 src/port；现有移植代码已经提交，更新它需要单独说明上游变化和回归范围。
完成后运行构建、静态验证、动态冒烟、最终 tarball 元数据及文件检查，并在匹配目标运行时的隔离测试 profile 中进行真实 GUI 验收。测试 profile 必须保留原核心 bundle，并显式选择该 profile 启动。
记录上游提交、全部补丁、包哈希、目标运行时和已测项目。与原作者基线结果区分，不能将自行适配包称为原作者正式发行。
只有上述工作有明确结果后，再准备正常安装和回滚步骤。未能证明兼容时输出失败原因和可复现命令。
```

## 9 常见故障及判断

| 现象 | 优先检查 | 处理 |
| --- | --- | --- |
| `missing dsh-client-ui-aqua base` | `--base` 路径及 `lib/client.js` | 取得完整修补基线；退出码 2 是输入缺失 |
| 主题输入缺失或字体读取失败 | `--claude` 是否指向 `claude/`，四份 woff2 是否完整 | 构建参数不是主题仓库根目录 |
| `BUILD PROBLEMS` | 锚点、出现次数、换行符与基线版本 | 保留 LF；检查基线或在源码中适配，不编辑 dist 绕过 |
| 构建成功但 `GUARD FAILURES` | 侧栏包含块、倾斜、兼容模式守卫 | 不安装；修复输入基线或适配逻辑后重跑 |
| 冒烟模块 id 带 `@deepseek-ai/` | 使用了公开上游而非修补基线 | 检查模块 id、元数据和运行时规则，不能只改包名 |
| 包已安装但没有界面变化 | bundle 未选中、缺少 `dsh.bundle.patch`、profile 错误或兼容性拒绝 | 查看真实加载日志及注册状态 |
| 两层画布、设置重复 | Aqua 与 Glass 同时挂载，或独立 Claude 插件重复 | 检查 bundle 和直接 patch 条目，只停用冲突项 |
| `Already up to date` 但仍是旧文件 | 同名 `.tgz` 与锁文件完整性缓存 | 改用内容哈希文件名并让原包管理器更新依赖 |
| 输入框消失或 `React is not defined` | 移植片段或包文件被破坏 | 停止使用该包，回滚；重新验证渲染守卫和冒烟 |
| 手机访问写入错误 profile | 宿主是否发布 `profileContext`，是否加载旧版本 | 检查实际 patch 路径，不硬编码 desktop 或 web |
| `TZ=` 没反应 | 已知未实现的触发链路 | 不需要为此重装 |
| 设置按钮点不到 | 其他桌宠覆盖层，例如仓库提及的小克插件 | 暂停相关覆盖层验证；不要直接判定为 Glass 故障 |

## 10 依据与阅读入口

仓库结论依据固定提交的实际文件，并对构建脚本进行了本地试跑；GUI 项目仍需在用户真实环境验证。

- [Claude Glass README](https://github.com/barryjohnson61/dsh-claude-glass/blob/78d54646966da77f7135d47d9d6e97177502bbd7/README.md)：安装、输入依赖、验收和仓库布局。
- [CHANGELOG](https://github.com/barryjohnson61/dsh-claude-glass/blob/78d54646966da77f7135d47d9d6e97177502bbd7/CHANGELOG.md)：运行时目标、peer 依赖和已知问题。
- [build.mjs](https://github.com/barryjohnson61/dsh-claude-glass/blob/78d54646966da77f7135d47d9d6e97177502bbd7/build.mjs)、[verify.mjs](https://github.com/barryjohnson61/dsh-claude-glass/blob/78d54646966da77f7135d47d9d6e97177502bbd7/verify.mjs)、[mount-smoke.mjs](https://github.com/barryjohnson61/dsh-claude-glass/blob/78d54646966da77f7135d47d9d6e97177502bbd7/tools/mount-smoke.mjs)、[pack.mjs](https://github.com/barryjohnson61/dsh-claude-glass/blob/78d54646966da77f7135d47d9d6e97177502bbd7/pack.mjs)：真实执行流程。
- [GitHub Releases](https://github.com/barryjohnson61/dsh-claude-glass/releases)：核查时未列出发行版；日后若新增，应重新核验资产与版本。
- [官方 Harness 仓库](https://github.com/deepseek-ai/deepseek-harness)、[CLI 帮助](https://github.com/deepseek-ai/deepseek-harness/blob/86a402200d95fecef4529d969836f1fe13c6cb0d/docs/cli-help.zh.md)、[插件管理说明](https://github.com/deepseek-ai/deepseek-harness/blob/86a402200d95fecef4529d969836f1fe13c6cb0d/packages/boot/plugin-manager/README.zh.md)：profile 和插件管理流程，旧运行时以本机帮助为准。
- [Codex CLI 官方文档](https://learn.chatgpt.com/docs/codex/cli)：本机目录中的读取、编辑和执行。
- [Claude Code 快速开始](https://code.claude.com/docs/en/quickstart)、[Claude Code Desktop 文档](https://code.claude.com/docs/en/desktop)：CLI 启动与 Desktop Local 执行环境。

再分发构建产物时应保留仓库附带的 `LICENSE`、`NOTICE` 和 `licenses/`。本项目声明整合包为 AGPL-3.0-only，并附主题和字体的第三方声明；本指南不替代这些文件。
