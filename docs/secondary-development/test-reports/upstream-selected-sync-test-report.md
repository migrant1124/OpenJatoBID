# Upstream 选定功能同步测试报告

## 1. 范围

本轮仅验证以下批准内容：

- Agent 全文图片编排与图片生成链路；
- 工作区 SQLite v17 迁移；
- 正文生成的 AI、HTML 配图配置和示例图；
- Mermaid 配图默认关闭、配置入口移除、历史字段兼容；
- “龙猫”文本模型移出可选列表并保留历史配置兼容；
- 废标检查小 Markdown 卡片隐藏“全屏”。

未修改 `management/`、`analytics/`、依赖、发布工作流或更新通道。

## 2. 环境

- Windows / PowerShell
- Node.js `v26.1.0`
- npm `11.13.0`
- Electron `v41.5.0`
- 分支：`main`

## 3. 自动化与静态检查

| 检查 | 结果 | 关键证据 |
| --- | --- | --- |
| 修改前基线 `cd client; npm run build` | 通过 | `tsc --noEmit` 与 Vite 构建退出 0 |
| 修改后 `cd client; npm run build` | 通过 | 2,089 个模块完成转换；仅保留既有 chunk 体积警告 |
| 改动的 Electron CJS 执行 `node --check` | 通过 | 配置、正文任务、图片编排/生成、导出、SQLite、Store、路径与 Mermaid 工具均退出 0 |
| `node --test electron\services\configStore.lan.test.cjs electron\services\contentIllustrationPlanning.test.cjs` | 通过 | 4/4：LAN 配置保留、新配置无 LongCat profile、历史 LongCat 配置可加载、历史 Mermaid 与 AI 冲突时优先保留 AI |
| 新增图片编排/生成模块 `require` 冒烟 | 通过 | 四个新模块均可加载并导出预期 API |
| `git diff --check` | 通过 | 无空白错误；仅提示工作区 LF 将按 Git 配置转换为 CRLF |

## 4. SQLite v17

使用隔离临时 `userData` 和 Electron ABI 创建完整工作区数据库，再模拟 v16：删除 `content_illustration_plan_json`、恢复 `illustration_type`、设置 `user_version=16`，随后执行当前 migration。

结果：

- `PRAGMA user_version = 17`；
- `technical_plan_meta.content_illustration_plan_json` 存在；
- `technical_plan_content_plans.illustration_type` 已删除；
- migration 退出 0，临时数据库与脚本已清理。

## 5. 运行态 UI

使用隔离临时 `userData` 启动 Vite 与 Electron，并通过 CDP 写入一份最小技术方案工作区后打开“正文生成配置”。

结果：

- AI 生图开关、上限和示例入口存在；
- HTML 图片开关、上限、高级类型设置和示例入口存在；
- Mermaid 开关、上限和示例入口均不存在；
- 持久化配置为 `useMermaidImages=false`，历史字段 `maxMermaidImages` 保留；
- 新配置的文本模型列表仅含金龙、火山、DeepSeek、Agnes 和自定义，不含可选 LongCat；
- Renderer 无新增异常；仅出现 Electron 开发态 CSP 警告，打包后不显示；
- 隔离运行数据和临时 CDP 脚本已清理。

## 6. 验收覆盖

| 验收项 | 结论 |
| --- | --- |
| 全文图片计划可跨 Main、Store、Renderer 持久化和展示 | 通过静态契约、构建与 SQLite 运行冒烟 |
| SQLite v16 可升级到 v17 | 通过 Electron 运行冒烟 |
| AI、HTML 配图配置与示例图可见 | 通过 Electron DOM 检查 |
| Mermaid 新配置默认关闭且 UI 无入口 | 通过持久化状态与 Electron DOM 检查 |
| Mermaid 历史字段和生成/渲染/导出代码仍保留 | 通过代码路径与构建检查 |
| 历史 Mermaid 与 AI 同节冲突按 `HTML > AI > Mermaid` 处理 | 通过图片计划单元测试 |
| LongCat 不可新选但历史配置可读 | 通过 3 个配置 Store 测试与新配置 UI 检查 |
| 小 Markdown 卡片不显示“全屏” | 通过组件调用检查与客户端构建 |
| LAN 授权、Analytics、品牌和 GitHub 更新通道保留 | 通过差异审查与配置 Store 回归测试 |

## 7. 限制与结论

未调用真实外部文本模型、生图模型或 OpenCode Agent，因此没有生成一份完整投标正文并实际导出 Word；这些路径需要有效模型配置和业务样例，避免在本轮同步中产生外部调用费用或写入用户业务数据。

只读 `openjatobid_reviewer` 终审未发现剩余 P0-P2；历史 Mermaid 与 AI 冲突优先级问题已修正并增加回归测试。新增文件尚未执行 `git add`，提交前需显式纳入 Git，本轮未获授权也未执行暂存、提交或合并。

结论：**通过，保留外部 AI/Agent 全流程实跑限制**。本地构建、迁移、配置兼容和关键 UI 行为均满足本轮批准范围。
