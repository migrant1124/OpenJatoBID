# OpenJatoBID 第一阶段品牌重塑测试报告

版本：1.0  
测试日期：2026-07-10  
测试分支：`main`  
对应 PRD：`docs/secondary-development/prd/openjatobid-phase1-branding-prd.md` 1.0.1

## 1. 测试结论

第一阶段品牌重塑在 Windows 开发与打包环境中**条件通过**。

已完成客户端构建、开发模式启动、页面品牌与菜单检查、Windows NSIS 打包、解包客户端启动、图标格式检查、更新源扫描和受保护路径审计。未发现阻断性代码问题，也未发现对技术文件生成、Word 导出、Mermaid 预览、OpenCode Agent 运行机制或 analytics 代码的修改。

本轮未执行完整技术文件生成业务回归、macOS 真机打包运行和 Windows 安装向导/快捷方式实装检查。这些项目需在发布验收前补测，不能由本报告视为已通过。

## 2. 测试环境

| 项目 | 结果 |
| --- | --- |
| 操作系统 | Windows |
| Node.js | `v26.1.0` |
| npm | `11.13.0` |
| Electron | `41.5.0` |
| electron-builder | `26.8.1` |
| 当前提交 | `f6d3e07` |
| 分支同步状态 | `main` 与 `origin/main` 相互领先/落后均为 0 |

## 3. 自动化与静态检查

| 检查项 | 方法 | 结果 |
| --- | --- | --- |
| TypeScript 与 Renderer 构建 | `cd client; npm run build` | 通过；仅有既有 chunk 体积提示 |
| Electron CJS 语法 | 对修改的 `.cjs` 文件执行 `node --check` | 通过 |
| Release Workflow 语法 | 使用仓库现有 `js-yaml` 解析 `.github/workflows/release.yml` | 通过 |
| Diff 格式 | `git diff --check` | 通过；仅有 Windows LF/CRLF 提示 |
| 旧品牌扫描 | 扫描用户可见代码、README 和发布脚本 | 未发现旧项目名称、旧仓库或旧 Wiki 链接 |
| 客户端旧 R2 更新源扫描 | 扫描客户端更新配置、下载地址和回退逻辑 | 未发现旧 R2 更新 URL 或 Cloudflare 更新渠道 |
| 受保护路径 | 对 technical-plan、导出、IPC、数据库和 analytics 执行差异检查 | 均未修改 |
| 内部技术标识 | 检查 `window.yibiao`、`yibiao.sqlite` 和 analytics 项目标识 | 均保留 |

仓库未配置 `lint` 或单元测试脚本，因此本轮没有可执行的 lint/单元测试结果。

## 4. 开发模式页面检查

执行 `npm run dev` 后，Vite 与 Electron 均正常启动。

| 检查项 | 结果 |
| --- | --- |
| Vite 地址 | `http://127.0.0.1:5173` 正常响应 |
| Electron 标题栏 | `佳图智能投标助手` |
| 页面标题 | `佳图智能投标助手` |
| 左上角品牌 | 公司 Logo + `Jato AI BID` |
| 一级入口 | 标书生成、模板设置、知识库、标书检查、设置 |
| 保留二级入口 | 生成技术方案、已有方案扩写、我的模板、新建模板、文档知识库、标书查重、废标项检查 |
| 隐藏入口 | 商务标、图片知识库、AI评标、使用文档、投标机会、资源下载未显示 |
| 设置页更新源 | 仅显示 `GitHub Releases` |
| 关于页 | 显示 Logo、软件名、用途、版本 1.0.0、中英文版权主体 |
| 原项目来源 | 关于页未显示原仓库、原作者或原 Wiki |
| 浏览器控制台 | 0 条 error，0 条 warning |

## 5. Logo 与图标检查

`client/assets/logo.png` 与仓库根目录 `logo.png` 的 SHA256 均为：

`2E86FDA9D56CA87B76743095F4E6369BFE6A9AFD9A4F946754CACA1B24CFA4BC`

| 文件 | 格式与尺寸 | 结果 |
| --- | --- | --- |
| `logo.png` | PNG，985 x 985，RGBA | 通过 |
| `icon_16.png` 至 `icon_256.png` | PNG，多尺寸，RGBA | 通过 |
| `icon.ico` | ICO，包含多尺寸资源 | 通过 |
| `icon.icns` | ICNS，最大 1024 x 1024 | 通过 |
| `yibiao_256.ico` | ICO，视觉内容已替换，内部文件名保留 | 通过 |

## 6. Windows 打包与启动检查

执行：

```powershell
cd client
npx electron-builder --win nsis --publish never
```

结果：

| 项目 | 结果 |
| --- | --- |
| NSIS 安装包 | `client/release/Jato AI BID Setup 1.0.0.exe` |
| 安装包大小 | 212,146,336 bytes |
| 安装包 SHA256 | `6DB3015F6013AF79AF0F8EB3BF3DC426A9C933BE4AD6F6932F172E115CE34B8B` |
| 解包程序 | `client/release/win-unpacked/Jato AI BID.exe` |
| ProductName / FileDescription | `Jato AI BID` |
| CompanyName | `Jato Digital Technology Co., Ltd.` |
| ProductVersion | `1.0.0.0` |
| 解包程序启动 | 通过 |
| 解包程序标题栏 | `佳图智能投标助手` |

electron-builder 在 `latest.yml` 中对空格文件名使用连字符 URL 编码形式，实际 NSIS 安装包名称仍符合 PRD。

## 7. 更新源检查

- GitHub Release API 与下载页均指向 `migrant1124/OpenJatoBID`。
- `client/package.json` 的 publish provider 指向 `migrant1124/OpenJatoBID`。
- 设置页不再提供 Cloudflare 更新渠道选择。
- 客户端不再包含旧 Cloudflare R2 更新 URL、下载地址或回退逻辑。
- Release Workflow 中既有 R2 发布作业按确认的实施计划保留；它不再是客户端更新源。

## 8. 主流程与边界检查

以下路径差异为 0：

- `client/src/features/technical-plan/`
- `client/electron/services/exportService.cjs`
- `client/electron/ipc/`
- `client/src/shared/types/ipc.ts`
- `client/electron/services/sqliteDatabase.cjs`
- `analytics/`

`window.yibiao` 暴露名、preload API 结构、`yibiao.sqlite`、现有 IPC 通道、Word 导出与 Mermaid 处理代码均未改名或重构。OpenCode 相关修改仅限用户可见标题和生成的工作区说明，运行机制及 analytics 项目标识保持不变。

## 9. 未执行项目与残余风险

1. **完整技术文件生成回归未执行**：本轮没有使用受控招标文件、测试模型配置和隔离工作区完成“上传 -> 解析 -> 目录 -> 全局事实 -> 正文 -> Word 导出”。当前证据仅能证明入口仍存在、构建与启动正常、核心路径没有代码差异。
2. **Windows 安装向导未实装**：已构建安装包并启动解包程序，但未实际安装，因此桌面快捷方式、开始菜单项、卸载信息和新 `userData` 目录需补测。
3. **macOS 未真机验证**：`.icns` 格式和 CI 配置已检查，但 DMG、Dock 图标和应用标题需在 Intel/Apple Silicon 环境验证。
4. **未配置代码签名**：Windows 与 macOS 的未签名提示仍是既有发布约束。
5. **GitHub 可达性**：删除 R2 更新源后，客户端更新依赖 GitHub Releases；公司网络环境下的可用性需单独验证。

## 10. 审查结论

按正确性、可读性、架构、安全与性能五个维度审查，本次变更未发现 Critical 或 Required 级问题：

- 变更符合第一阶段 PRD，未引入新依赖。
- 入口隐藏通过菜单过滤实现，源码模块仍保留。
- 更新源收敛到 GitHub，没有新增下载镜像或隐式回退。
- 未发现密钥、业务数据或用户数据进入变更。
- 品牌资源和少量静态配置不会引入可见性能风险。

本阶段可进入人工发布验收，但正式发布前必须补做第 9 节中的前三项。

## 11. 回滚方法

当前改动未提交。回滚时应按实际变更文件逐项恢复，不使用全仓库硬重置，避免误删用户原有的 `.codex/`、`docs/` 和根目录 `logo.png` 等未跟踪内容。二进制图标、品牌文档、菜单过滤、更新源和 `client/package.json` 应作为同一品牌变更批次回滚。
