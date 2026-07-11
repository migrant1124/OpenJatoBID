# OpenJatoBID 二次开发技能使用说明

## 1. 目的

`openjatobid-secondary-development` 是本项目唯一的二次开发工作流技能入口，用来连接产品定义和工程交付：

```text
需求 / 问题
  -> PRD 决策门
  -> 技术计划决策门
  -> Build 或 Debug
  -> 验证与交付证据
```

它替代此前项目内自动发现的 56 个 Product Manager Skills 和 24 个 agent-skills。新技能没有把原有约 3 万行内容拼接到一起，而是保留一套项目专用入口，并按阶段加载四份 reference。

## 2. 文件位置

```text
.codex/skills/openjatobid-secondary-development/
├── SKILL.md
├── agents/openai.yaml
└── references/
    ├── prd-workflow.md
    ├── planning-workflow.md
    ├── build-workflow.md
    └── verification-matrix.md
```

`SKILL.md` 负责阶段选择、优先级和决策门。只有进入对应阶段时，Codex 才读取相应 reference。

技能目录变化后，需要重新打开项目或新建 Codex 任务，让技能目录重新扫描；当前已经打开的任务可能仍显示旧技能清单。

## 3. 调用方式

在 Codex 对话中输入 `$openjatobid-secondary-development`，后面写明模式、目标和边界。

### PRD 模式

```text
$openjatobid-secondary-development prd：
通过逐步提问帮我编制批量导入功能 PRD。
本阶段只确定需求、范围和验收标准，不修改源码。
```

### 技术计划模式

```text
$openjatobid-secondary-development plan：
读取已确认的 PRD 和当前代码，编制 ADR、接口契约、tasks/plan.md 和 tasks/todo.md。
先不要实现。
```

### Build 模式

```text
$openjatobid-secondary-development build：
只执行 tasks/plan.md 中的 T12，不扩大范围，不提交 Git。
完成后运行该任务要求的构建、测试和运行时验证。
```

### Debug 模式

```text
$openjatobid-secondary-development debug：
排查 Electron 登录后白屏。先复现、读取日志并定位根因，确认属于当前范围后再修复。
```

### Verify 模式

```text
$openjatobid-secondary-development verify：
只验证 OpenCode Agent 启动链路，不修改源码，输出命令、日志和当前异常状态。
```

### Full 模式

```text
$openjatobid-secondary-development full：
从需求澄清开始推进该功能。PRD 和技术计划完成后都必须等我确认，确认后才能进入下一阶段。
```

`full` 不代表一次性无人确认地写完全部代码。它仍然保留 PRD 和计划两个明确决策门。

## 4. 模式选择

| 场景 | 模式 | 是否默认改源码 |
| --- | --- | --- |
| 新功能、范围不清、需要 PRD | `prd` | 否 |
| PRD 已确认，需要拆架构和任务 | `plan` | 否 |
| 已确认任务需要实现 | `build` | 是 |
| 已出现具体故障，需要定位或修复 | `debug` | 仅在请求包含修复时 |
| 只做测试、验收、审查或环境检查 | `verify` | 否 |
| 从需求到交付的完整流程 | `full` | 通过决策门后才是 |

窄范围 Bug、环境修复、只读审查不需要先写 PRD。已有明确任务时不要为了套流程重新生成一份 PRD。

## 5. Chrome DevTools MCP 与 Playwright

本项目做本地页面调试和一次性验收时，优先使用 Chrome DevTools MCP；需要沉淀可重复执行的 E2E 回归脚本时，再使用 Playwright。

简单判断：

| 场景 | 优先工具 | 原因 |
| --- | --- | --- |
| 打开 `http://127.0.0.1:5173` 检查页面、控制台、网络请求、截图 | Chrome DevTools MCP | 直接返回结构化快照、console、network，通常更省 token |
| 排查页面顶部错误、按钮是否出现、请求是否失败 | Chrome DevTools MCP | 不需要生成完整测试脚本 |
| 需要把流程保存成可重复跑的自动化测试 | Playwright | 脚本可复用，适合作为回归证据 |
| CI 或长期版本验收 | Playwright | 更适合稳定、可审计的测试套件 |
| Electron Main/preload/IPC/OpenCode 进程问题 | DevTools MCP + 进程/日志/脚本检查 | DevTools 只能覆盖浏览器可见部分，仍要看 `.tmp`、Main 日志和进程状态 |

推荐的 verify/debug 调用方式：

```text
$openjatobid-secondary-development verify：
启动项目后，用 Chrome DevTools MCP 打开 http://127.0.0.1:5173，
检查页面快照、console error/warn、network 失败请求和必要截图。
不要修改源码。
```

如果当前 Codex 任务里没有暴露 Chrome DevTools MCP 工具，执行者必须明确说明“本任务不可用”，再选择最小的替代验证方式。

## 6. 文档职责

| 内容 | 权威位置 |
| --- | --- |
| 用户、问题、范围、业务规则、验收标准 | `docs/secondary-development/prd/` |
| 架构选择及替代方案 | `docs/secondary-development/adr/` |
| HTTP、IPC、事件或文件契约 | `docs/secondary-development/api/` |
| 视觉基线和设计决策 | `docs/secondary-development/design/` |
| 实施顺序、依赖和验证命令 | `tasks/plan.md` |
| 当前任务状态 | `tasks/todo.md` |
| 测试与验收证据 | `docs/secondary-development/test-reports/` |

同一个技术决策不要同时维护在 PRD、ADR 和任务计划中。PRD 负责“要什么”，计划和 ADR 负责“怎么做”。

## 7. 关键约束

- 当前用户命令和阶段边界优先于技能默认流程。
- 修改 `client/` 前必须读取 `client/开发说明.md`。
- 进入 Build 后只执行已确认范围；新想法返回 Plan 阶段。
- 不自动创建分支、提交、推送、合并、变基、标签或发布。
- 不删除、绕过或弱化 Analytics。
- 只在用户输入和真实外部边界校验，不在本地可信层级间重复校验。
- 不通过隐藏错误、注释验证器或删除测试让验收变绿。
- 用户工作区可以是 dirty 状态，必须保留无关修改。

## 8. 典型工作流

### 新功能

1. 使用 `prd` 确认问题、流程、范围和验收。
2. 用户确认 PRD。
3. 使用 `plan` 检查真实代码并生成实施计划。
4. 用户确认计划。
5. 使用 `build` 按任务 ID 分批实施。
6. 使用 `verify` 汇总构建、运行、日志、截图和测试报告。

### Bug 修复

1. 直接使用 `debug`。
2. 复现并保存原始错误。
3. 定位到具体边界。
4. 在用户授权修复时做最小修改。
5. 重复原始复现并执行邻近回归检查。

### 本地环境修复

使用 `debug` 或 `verify`，明确写出“不修改源码”。技能会优先检查进程、文件、版本、日志、端口和运行时证据，不会用源码绕过环境问题。

## 9. 来源与许可证

新技能的设计吸收了以下两个上游项目的流程思想，但使用了针对 OpenJatoBID 重新编写的结构和文本，没有继续内置两套上游技能正文：

- `deanpeters/Product-Manager-Skills`：产品发现、PRD、用户故事和决策门。上游许可证为 CC BY-NC-SA 4.0。
- `addyosmani/agent-skills`：计划、增量实施、调试、验证和代码审查。上游许可证为 MIT。

上游地址：

- <https://github.com/deanpeters/Product-Manager-Skills>
- <https://github.com/addyosmani/agent-skills>

如果以后重新复制上游原文或脚本，必须同时恢复相应许可证和署名；不要把 CC BY-NC-SA 内容直接混入未标明许可的项目技能。

## 10. 维护与验证

修改技能后，在项目根目录运行：

```powershell
$env:PYTHONUTF8="1"
python "$env:USERPROFILE\.codex\skills\.system\skill-creator\scripts\quick_validate.py" ".codex\skills\openjatobid-secondary-development"
```

同时检查：

- `SKILL.md` 只有 `name` 和 `description` 两个 frontmatter 字段；
- 所有本地相对链接都存在；
- `agents/openai.yaml` 的名称、说明和默认提示词仍与技能一致；
- `AGENTS.md`、`client/开发说明.md` 或 package scripts 变化后，验证矩阵同步更新；
- 至少试跑一次 `prd`、一次 `build` 和一次 `verify` 请求，确认不会跨越阶段边界。
