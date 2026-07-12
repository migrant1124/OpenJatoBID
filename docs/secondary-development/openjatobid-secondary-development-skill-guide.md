# OpenJatoBID 二次开发技能使用说明

## 1. 目的

`openjatobid-secondary-development` 是本项目唯一的二次开发工作流技能入口，用来连接产品定义和工程交付：

```text
需求 / 问题
  -> PRD 决策门
  -> 技术计划决策门
  -> Build 或 Debug
  -> Verify 验证与证据
  -> Review 一致性审查
  -> 交付

中途范围变化 -> Change 影响分析 -> 返回最早受影响阶段
```

它替代此前项目内自动发现的 56 个 Product Manager Skills 和 24 个 agent-skills。新技能没有把原有约 3 万行内容拼接到一起，而是保留一套项目专用入口，并按阶段加载六份 reference。

## 2. 文件位置

```text
.agents/skills/openjatobid-secondary-development/
├── SKILL.md
├── agents/openai.yaml
└── references/
    ├── prd-workflow.md
    ├── planning-workflow.md
    ├── build-workflow.md
    ├── change-workflow.md
    ├── review-workflow.md
    └── verification-matrix.md
```

`SKILL.md` 负责阶段选择、优先级和决策门。只有进入对应阶段时，Codex 才读取相应 reference。

仓库级 Skill 按当前官方规范放在 `.agents/skills/`。项目级自定义 Agent 仍放在 `.codex/agents/`；本项目的只读 Reviewer 位于：

```text
.codex/agents/openjatobid-reviewer.toml
```

`.codex/skills/openjatobid-secondary-development/` 已不再保留。不要在旧目录创建同名副本或符号链接，否则两个同名 Skill 可能同时出现在选择器中。

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

### Change 模式

```text
$openjatobid-secondary-development change：
用户要求在已批准的批量导入功能中增加自动去重。
先比较当前 PRD、计划和已完成任务，说明应退回哪个阶段以及需要重做什么；未经确认不要修改源码。
```

### Review 模式

```text
$openjatobid-secondary-development review：
只读审查本轮实现与已批准 PRD、tasks/plan.md 和测试证据是否一致。
重要阶段使用独立 Reviewer，问题按严重程度和文件位置优先输出，不要直接修复。
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
| 已批准范围中途变化，需要评估影响 | `change` | 否；批准更新后的计划后再实现 |
| 只读检查需求、计划、实现和证据一致性 | `review` | 否 |
| 只做测试、验收或环境检查 | `verify` | 否 |
| 从需求到交付的完整流程 | `full` | 通过决策门后才是 |

窄范围 Bug、环境修复、只读审查不需要先写 PRD。已有明确任务时不要为了套流程重新生成一份 PRD。

Discovery 是 `prd` 的前置过程，不设独立模式；Status 直接读取 `tasks/todo.md`，也不设独立模式。只有中大型、跨文档需求才使用 `REQ-001` 一类需求 ID。

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
| 跨多个权威文档的重大变更记录 | `docs/secondary-development/changes/`（按需创建） |
| 重要阶段或发布审查报告 | `docs/secondary-development/reviews/`（按需创建） |
| 测试与验收证据 | `docs/secondary-development/test-reports/` |

同一个技术决策不要同时维护在 PRD、ADR 和任务计划中。PRD 负责“要什么”，计划和 ADR 负责“怎么做”。

`tasks/todo.md` 是唯一执行状态源。默认不创建 `state.yaml`、`audit.jsonl` 或第二套进度清单；重大变更文件只记录变更决策，不替代任务状态。

## 7. 关键约束

- 当前用户命令和阶段边界优先于技能默认流程。
- 修改 `client/` 前必须读取当前根目录 `开发说明.md`；旧检出仍使用 `client/开发说明.md` 时读取旧位置。
- 进入 Build 后只执行已确认范围；新想法返回 Plan 阶段。
- 已批准范围发生变化时先使用 `change`，未经确认不直接改代码。
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
6. 使用 `verify` 收集构建、运行、日志、截图和测试证据。
7. 重要阶段使用 `review` 检查 PRD、计划、实现和证据的一致性。
8. 修复获批问题后再次执行受影响的验证。

### Bug 修复

1. 直接使用 `debug`。
2. 复现并保存原始错误。
3. 定位到具体边界。
4. 在用户授权修复时做最小修改。
5. 重复原始复现并执行邻近回归检查。

### 本地环境修复

使用 `debug` 或 `verify`，明确写出“不修改源码”。技能会优先检查进程、文件、版本、日志、端口和运行时证据，不会用源码绕过环境问题。

### 中途需求变更

1. 使用 `change` 对比新要求与已批准基线。
2. 判断最早受影响阶段是 PRD、Plan、Build 还是 Verify。
3. 输出受影响文档、任务、代码、测试和已完成工作。
4. 涉及产品行为、架构、依赖、持久数据、Analytics 或发布边界时停止等待确认。
5. 确认后只更新对应权威文档和 `tasks/todo.md`，再从获批任务恢复实施。

## 9. 独立 Reviewer Agent

`.codex/agents/openjatobid-reviewer.toml` 定义了项目级只读 Reviewer：

- 继承当前 Codex 父任务支持的模型，并使用 `high` 推理强度，避免固定模型名导致账户或客户端版本不兼容；
- `sandbox_mode` 配置为 `read-only`，并在 Agent 指令中再次禁止写文件；
- 只输出问题，不修改文件、不创建 Git 状态；
- 检查需求一致性、范围扩大、回归、测试缺口、跨进程风险和 Analytics 保留；
- 只有改动触及 Prompt、投标内容、证据、导出或最终状态时，才执行投标内容合规检查。

独立 Reviewer 只用于重要阶段、发布、跨进程、高风险或用户明确要求的审查。普通小改和状态查询继续由主任务处理，避免无意义增加 Token。当前环境不能启动自定义 Agent 时，执行者必须说明评审不是独立上下文，不能伪称已完成独立评审。

## 10. 来源与许可证

新技能的设计吸收了以下两个上游项目的流程思想，但使用了针对 OpenJatoBID 重新编写的结构和文本，没有继续内置两套上游技能正文：

- `deanpeters/Product-Manager-Skills`：产品发现、PRD、用户故事和决策门。上游许可证为 CC BY-NC-SA 4.0。
- `addyosmani/agent-skills`：计划、增量实施、调试、验证和代码审查。上游许可证为 MIT。

上游地址：

- <https://github.com/deanpeters/Product-Manager-Skills>
- <https://github.com/addyosmani/agent-skills>

如果以后重新复制上游原文或脚本，必须同时恢复相应许可证和署名；不要把 CC BY-NC-SA 内容直接混入未标明许可的项目技能。

## 11. 维护与验证

修改技能后，在项目根目录运行：

```powershell
$env:PYTHONUTF8="1"
python "$env:USERPROFILE\.codex\skills\.system\skill-creator\scripts\quick_validate.py" ".agents\skills\openjatobid-secondary-development"
```

同时检查：

- `SKILL.md` 只有 `name` 和 `description` 两个 frontmatter 字段；
- 所有 Skill 内部 reference 路由都存在；按需输出目录不要求预先创建；
- `agents/openai.yaml` 的名称、说明和默认提示词仍与技能一致；
- `.codex/agents/openjatobid-reviewer.toml` 可以解析且保持只读；
- 仓库内只存在一个名为 `openjatobid-secondary-development` 的 `SKILL.md`；
- 旧 `.codex/skills/openjatobid-secondary-development/` 不存在；
- `AGENTS.md`、权威 `开发说明.md` 或 package scripts 变化后，验证矩阵同步更新；
- 至少试跑一次 `prd`、`change`、`build`、`review` 和 `verify` 请求，确认不会跨越阶段边界。
