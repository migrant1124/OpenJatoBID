# AGENTS.md

## 范围

本项目包含三个独立子系统：

| 子系统 | 目录 | 说明 |
| --- | --- | --- |
| 员工用户端 | `client/` | Windows/macOS 桌面 Electron 应用，AI 驱动的标书编写工具 |
| 局域网管理端 | `management/` | Windows 桌面 Electron 应用，负责员工授权审批和运维统计 |
| 埋点服务 | `analytics/` | Cloudflare Workers，客户端在无管理端时降级使用的埋点上报/展示 |

`management/` 与 `client/` 是两个完全独立的软件个体：独立的 appId、安装包、进程和 Electron `userData` 目录。同一公司局域网只部署一个管理端。

## Git 维护与同步保护

- 本项目基于 upstream 源项目持续跟进，`origin` 是用户自己的仓库。源项目更新很快，Git 操作必须保守。
- 除非用户在当前消息中明确要求执行，否则禁止直接执行 `git pull`、`git push`、`git merge`、`git rebase`、`git reset`、删除分支、强制推送等会改变本地或远程状态的操作。
- 每次准备拉取、合并或推送前，必须先向用户报告：当前分支、`git status`、相关 remote 地址、领先/落后提交数、拟执行命令、可能风险、失败后的回滚办法，并等待用户明确确认。
- 同步源仓库时优先使用可检查的两步流程：先 `git fetch upstream --prune`，再根据差异决定是否 `git merge --ff-only upstream/main`；不要直接用默认 `git pull` 把拉取和合并混在一起。
- 如果本地还没有二次开发提交，且 `main` 只落后 `upstream/main`，可以在用户确认后用 `git merge --ff-only upstream/main` 快进；一旦存在本地提交、未提交变更或冲突风险，必须先停止并说明风险。
- 推送到 `origin` 前必须再次确认推送目标、当前分支、将推送的提交列表和远程影响；禁止未经确认执行 `git push`。
- 出现冲突时，先列出冲突文件和冲突原因，不要自动选择 ours/theirs，不要为了构建通过删除业务逻辑。

## Client 开发总则

- 开发项目前，必须先阅读根目录下的 `开发说明.md`，保持框架风格一致性。
- 没有 root `package.json`；客户端命令都先 `cd client`。
- 安装/验证：`npm ci` 后 `npm run build`。`npm run build` 等价 `tsc --noEmit && vite build`，仓库未配置 lint/test 脚本。
- 开发启动：`npm run dev`，固定 Vite `127.0.0.1:5173 --strictPort` 后再启动 Electron。
- 打包：`npm run dist:win` / `npm run dist:mac`，配置在 `client/package.json` 的 `build` 字段，产物在 `client/release/`。
- 若出现 `NODE_MODULE_VERSION` 不匹配或 IPC 大面积未注册，运行 `cd client; npm run postinstall` 重建 native 模块。

### 模块边界

- Electron Main 和 preload 是 CommonJS：`client/electron/**/*.cjs`；Renderer 是 ESM TypeScript：`client/src/**/*.ts(x)`。
- Renderer 不直接访问 Node、`fs`、`path`、`ipcRenderer`，只通过 `window.yibiao`；改 preload API 时同步 `client/src/shared/types/ipc.ts`。
- `electron/ipc/*.cjs` 只注册/转发 IPC，业务逻辑放 `electron/services/*.cjs`。
- 功能代码放 `src/features/<feature>/`；跨功能代码放 `src/shared/`，且 `shared/` 不引用 feature。
- Prompt 统一在 `src/shared/prompts/`；不要在组件内硬编码大段 prompt。
- Main 侧文件读写显式使用 UTF-8，并把 Windows 中文路径当默认场景处理。

### UI 约束

- UI 使用全局 CSS + Radix 基础组件，不使用 Tailwind；用户可见文案用中文。
- 成功、失败、警告提示走 `shared/ui/ToastProvider`，不要用 `alert`。
- 页面根容器保持 `height: 100%` / `min-height: 0`，长内容在页面内部滚动；不要依赖 `body` 全局滚动或为 `FloatingToolbar` 额外留大空白。
- 新增主菜单页面要同时改 `src/shared/types/navigation.ts`、`src/app/menuConfig.ts`、`src/app/AppRouter.tsx`；需要全局工具条再改 `src/app/toolbarConfig.tsx`。

### 数据与流程

- 配置存到 Electron `userData/user_config.json`；业务工作区存到 `userData/workspace/`。
- 结构化业务状态统一进入 `userData/workspace/yibiao.sqlite` 或功能专用 SQLite Store；不再使用 JSON 文件作为权威缓存。
- Renderer 只用 `localStorage` 存轻量 UI 偏好；大文本、草稿、API Key、流程状态都走 Main 侧存储/IPC。
- 技术方案 Step01 只导入/展示 Markdown；Step02/Step03/Step04 的耗时任务都在 Electron Main 后台任务中跑，并持续写入对应 Store。
- 正文展示和导出以 `outlineData.outline[*].content` 为权威来源；目录重新生成、编辑、添加或删除后必须清空旧正文内容和生成缓存。
- Mermaid 图以 Markdown `mermaid` 代码块保存；Renderer 本地渲染预览，Word 导出由 Main 转图片。
- AI 生成 Markdown 默认不启用 `rehypeRaw`；只有明确需要渲染可信 HTML 时才局部开启并说明原因。
- 后台任务不得按 token、chunk 或部分内容落盘；只在阶段开始、单次 AI 请求完整返回、失败、暂停或任务结束时写入 Store。
- 所有 AI 请求必须通过 `electron/services/aiService.cjs` 的全局并发队列；业务代码不要绕过 `aiService` 直接发起 AI HTTP 请求。

## Management 管理端

- `management/` 是与 `client/` 完全独立的 Electron 应用，拥有独立的 `package.json`、appId（`com.jiatu.aibid.management`）、安装包、进程和 `userData` 目录。
- 管理端只有一个管理员账号；首次启动使用随安装包私下交付的初始凭据登录，验证成功后必须立即改密。
- 管理端不提供忘记密码、SMTP、邮箱恢复等自助找回入口；密码和签名密钥只保存在管理端服务器本地。
- 关闭管理窗口只隐藏到系统托盘，授权和统计服务继续运行；托盘"退出服务"才真正停止。
- 局域网 HTTP 服务默认监听 `0.0.0.0:47821`。
- 管理端打包前必须提供 `initial-admin.private.json`（被 Git 忽略），缺失时打包失败。
- 管理端命令都先 `cd management`：`npm ci` → `npm test` → `npm run build`；开发 `npm run dev`（固定 `127.0.0.1:5174`）。
- 详细部署、备份、升级和运维说明见 `management/README.md` 和 `docs/secondary-development/phase2-management-guide.md`。

## 授权与联网

- 员工用户端通过启动页"授权申请"向局域网管理端提交姓名、手机号和设备信息；管理员审批后生成 1 年有效授权。
- 每名员工最多同时绑定 3 台有效设备；管理员可以续期、拒绝或撤销。
- 授权保存在客户端本地，离线可继续使用；但至少每 30 天必须连接一次局域网管理端完成校验。
- 授权申请、登录校验和运维埋点只连接局域网管理端；不再向旧公网 `analytics.agnet.top` 发送授权或埋点请求。
- 公告、资源列表和 GitHub 软件更新仍为独立公共内容能力，不经过管理端。
- 管理端撤销授权后，客户端下次连接管理端时立即暂停使用；超过 30 天未校验也会暂停使用。
- 授权实现位于 `client/electron/services/licenseService.cjs` 和 `lanManagementClient.cjs`；管理端实现位于 `management/electron/services/authorizationService.cjs` 和 `signingService.cjs`。

## OpenCode Agent

- OpenCode Agent 是独立的 agent runtime，通过 `window.yibiao.agent.run(payload)` 调用，不直接启动 OpenCode Server 或访问其 HTTP API。
- Agent 不复用 `aiService` 全局文本队列，使用独立的 OpenCode AI proxy 队列；避免和大批量正文生成等重任务同时运行。
- Agent 第一版只写入自己的临时 workspace，不直接修改现有业务 Store；正式业务接入时应新增业务适配层。
- Agent 运行时由 `electron/services/opencode/` 子模块管理（runtime、server runner、HTTP client、AI proxy、config、self-check、tool environment）。
- 业务层默认不要传 `task_id`，让 `agentService` 自动生成 UUID；如果确需传入，只能使用内部生成的稳定 ID。
- 开发者模式下，Agent proxy 日志写入 `userData/logs/opencode-ai-proxy/*.jsonl`，Token 统计进入共享 `textTokenStatsStore`。

## Analytics 埋点

- 客户端埋点由 Main 侧 `analyticsService.cjs` 统一管理：**优先发送到局域网管理端**，未配置管理端或不可用时降级到 Cloudflare Worker（`analytics/worker/`）。
- 离线时埋点暂存到本地 `analyticsQueueStore.cjs`，联网后按 FIFO 重试。
- 管理端统计 Dashboard 位于 `management/src/features/analytics/AnalyticsPage.tsx`。
- Cloudflare 看板位于 `analytics/dashboard/`。
- 禁止删除、绕过或弱化任何埋点、统计字段、页面映射、模型使用统计和看板展示；如确需调整，必须等价保留统计能力并说明影响。
- 禁止上传 API Key、Base URL、Prompt、AI 响应、文档原文、文件名、本地路径等敏感或大文本数据。
- 新增主菜单页面时，同步更新 `SectionId`、`menuConfig.ts`、`AppRouter.tsx` 和看板中文名映射。
- Worker：`cd analytics\worker; npm install; npm run dev` 或 `npm run deploy`。
- Dashboard：`cd analytics\dashboard; npm install; npm run dev` 或 `npm run deploy`。
- 不把 `ACCOUNT_ID`、`ADMIN_TOKEN`、`ANALYTICS_API_TOKEN` 等密钥写入仓库。

## 发布与打包

- Release workflow（`.github/workflows/release.yml`）只在推送 `v*` tag 或手动输入 `tag_name` 时发布客户端。
- Release CI 使用 Node 22，在 `client/` 下 `npm ci`，从 tag 同步版本，`electron-builder --publish never` 构建，`gh release upload` 上传。
- 官方构建在打包前运行 `npm run generate-build-attestation`，需要 GitHub Actions Secret `YIBIAO_LICENSE_PRIVATE_KEY_JWK`；缺少私钥时 release workflow 直接失败，本地脚本生成未签名开发构建。
- 当前未接入代码签名；Windows/macOS 未签名提示是已知发布约束，不要在普通功能改动里临时绕过。
- 管理端单独打包：`cd management; npm run dist:win`，产物在 `management/release/`。

## 验证标准

Renderer / TypeScript 改动：

```powershell
cd client; npm run build
```

Electron Main / preload 改动：

```powershell
cd client
node --check electron\preload.cjs
node --check electron\services\<file>.cjs
npm run build
```

涉及窗口、IPC、后台任务时额外手动运行 `npm run dev` 验证。

管理端改动：

```powershell
cd management; npm test; npm run build
```

涉及授权和联网时，同时启动管理端和用户端联调。

涉及依赖变更：`npm audit`。
`npm run build` 可能只有既有 chunk 体积警告；不要把它当失败，除非命令退出非 0。

## 二次开发工作流

本项目使用 `docs/secondary-development/openjatobid-secondary-development-skill-guide.md` 中定义的阶段化工作流：

仓库级 Skill 位于 `.agents/skills/openjatobid-secondary-development/SKILL.md`；重要阶段的只读 Reviewer Agent 位于 `.codex/agents/openjatobid-reviewer.toml`。

| 阶段 | 模式 | 是否改源码 |
| --- | --- | --- |
| 需求澄清 | PRD | 否 |
| 架构与任务拆分 | Plan | 否 |
| 实现 | Build | 是 |
| 故障排查 | Debug | 仅在修复时 |
| 中途范围或行为变化 | Change | 否；批准更新后的计划后再实现 |
| 需求、计划、实现与证据一致性审查 | Review | 否 |
| 测试与验收证据 | Verify | 否 |

- 任何好的想法应在 Plan 阶段提出并与用户确认，Build 阶段只按原定方案执行，禁止增加任何多余内容。
- 窄范围 Bug 和环境修复不需要先写 PRD；已有明确任务时不要为了套流程重新生成 PRD。
- `tasks/todo.md` 是唯一执行状态源，不新增并行的 `state.yaml` 或 `audit.jsonl`。
- 本地页面调试优先使用 Chrome DevTools MCP；需要可重复执行的 E2E 回归脚本时使用 Playwright。

## 必须遵守的要求

- 保持整体编码风格统一；前端组件和样式尽量封装和复用。
- 当用户提出功能异常时，不要猜原因，而是真实排查代码、增加调试日志，精准定位后再解决。
- 这是一个本地客户端项目，所有数据传输层都在用户本地；IPC 传递的参数默认视为可信数据，不要在 Main/Renderer 间做多余的数据校验。用户输入层校验即可。
- 我们默认用户不会自己攻击自己、不会恶意使用程序，不需要加过多安全性兜底。
- 严格遵守用户命令；任何超出当前阶段范围的想法必须先在 Plan 阶段与用户确认。
- `开发说明.md` 是技术细节权威参考，每次新对话开始时必须先读取。
