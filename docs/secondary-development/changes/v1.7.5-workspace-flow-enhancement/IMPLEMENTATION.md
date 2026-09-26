# v1.7.5 项目工作区与流程增强实施记录

执行入口为 [`docs/v1.7.5-spec.md`](../../../v1.7.5-spec.md)，文档修订 1.1；本记录只说明本轮增量。实际基线：`v1.7.5-workspace`，`3b90d7899337fcc5eed3e23b1654dccdf0b6611f`，客户端版本 1.7.4。开始时无已跟踪文件改动，v1.7.5 规格、交接和图片是用户未跟踪文件。未回退审查提交，也未改 v1.7.4 两份规格。本文及 [分层测试报告](../../test-reports/v1.7.5-workspace-flow.md)均是未提交的本地交付。

| 步骤 | 输入 | 操作 | 输出 | 约束与边界 |
| --- | --- | --- | --- | --- |
| T01 | AGENTS、开发说明、SPEC、Handoff、测试及修订说明、当前 Git/版本 | 追踪 `TechnicalPlanHome`→P02/P03/P04、preload/IPC→任务/Store/导出及原右上解析动作；核对旧项目共享库和受管路径 | 基线与数据归属、版本源确认 | 原右上解析设置/标段选择/任务继续复用；不碰旧提交 |
| T02 | 68 组验收矩阵、Electron Node 框架 | 新增项目隔离、追加、删除重试、报告/目录 DOCX、图种/比例聚焦测试，建立合成 A/B 与 UI 取证脚本 | 新增测试、可重放合成取证 | 测试覆盖不等于 68 组已实机通过 |
| T03 | 旧全局库、路径、任务及导出调用链 | 全局 SQLite 迁移 v26–v32；新项目独立 SQLite/受管目录，旧单项目原位登记；Main 任务与导出捕获项目上下文 | 项目身份、隔离库、来源/标段快照、下游复核标记及带修订的导出记录 | 公共配置/模板/知识库、授权和 userData 根不迁移；旧正文/引用/图片不重写 |
| T04 | P01 参考图及项目服务 | 标书生成内部前置项目列表，点击名称进入，创建与红色删除确认；Main 忙闲门禁和目标目录边界检查 | 无状态列的 P01，删除失败可重试 | 不新增暂停/并行；只有目标项目的受管目录可删，外部源文件/Word 不删 |
| T05 | P02 最终图、旧解析入口及 fileService | 一个添加入口支持多选和追加；按字节哈希去重，同名异内容要求保留/替换选择；旧分析标记待复核 | 四列表及右上“开始招标文档解析” | 内部转换继续使用原解析器；不新增转换列/按钮、资料卡或 Markdown 大阅读区 |
| T06 | 原 P03、已存任务定义/结果、导出服务 | 基于已选解析项和来源快照生成可编辑 Word；保留失败、空值、过期提示及导出历史 | `ui-analysis-report.docx` 合成样例 | 无 AI 摘要；不改原结果主体及原导出门禁 |
| T07 | 原目录树、排序草稿及编号、Word 服务 | 正文前整棵子树升降及保存/取消；Main 拒绝已有正文/任务的层级变更；全树导出并可含说明 | `ui-outline.docx` 合成样例 | 不迁移正文/图片/附件；全局事实步骤仍在 |
| T08 | 既有 HTML 计划、渲染和四类图 | 仅新图固定 1280×720/960 逻辑画布、2 倍 PNG；普通、Agent、修复、恢复共用尺寸；流程/组织/时间/架构调用结构图渲染 | 2560×1440 与 2560×1920 样图 | 无比例 UI/新图表库/Skill；旧图不自动重做，失败保留原正文 |
| T09 | 全部改动、版本清单、合成资料 | 只把 `client/package.json` 与 lock 根/根包改为 1.7.5；运行语法、构建、测试、Electron 四页及 DOCX/PNG 包检查 | 结果见分层报告；未满足的验收保留为未验证 | 未运行安装包/授权实机/真实模型/Word 或 WPS 打开，不能据合成取证宣称完成这些项 |
| T10 | 差异、证据及资源清单 | 检查 v1.7.4 文档、五张原图哈希、受保护子系统及 Git 动作；交付本记录/报告 | 当前本地交付与遗留项 | 不推送、合并、打标签、创建 Release 或发布 |

## 版本、迁移与配置

- 版本修改清单：仅 `client/package.json` 的 `version`、`client/package-lock.json` 顶层及根包 `version`：`1.7.4 → 1.7.5`。依赖、管理端、Analytics、发布/更新配置均未升版。既有登录及“关于”读取 Main 的 `app.getVersion()`，无页面硬编码。
- 全局 SQLite 自 v25 逐级至 v32：v26 项目索引，v27 解析工作副本哈希，v28 项目导出历史，v29 解析来源文件快照，v30 解析投标范围快照，v31 导出内容修订，v32 下游复核标记。运行时和 `sql/workspace_schema.sql` 已同步。新项目库按原 schema 在 `userData/workspace/technical-plan/projects/<UUID>/plan.sqlite` 初始化；生成图片位于 `userData/workspace/generated-images/technical-plan/projects/<UUID>/`。旧单项目在原库登记为 `legacy-primary`，原文件和图片继续原位使用，不复制/覆盖、不重复登记。
- 原始招标文件从外部选择后复制到项目受管目录，前后哈希校验，外部原件不删除。追加资料或重选投标范围保留旧目录/正文/结果，标记旧解析和下游成果待复核；新来源单项重跑被拒绝，需重新解析整组已选项。删除项目先在本机工作区做临时可恢复副本，失败时回填文件并回滚索引/旧库，成功后清理备份；若备份清理失败会明确提示路径。仅将不透明项目 ID、动作、时间、成败和阶段记入本地 `userData/logs/technical-plan/project-deletion.jsonl`。既有外部另存 Word 不清理。删除前仍应备份真实项目；本轮只在合成项目执行。
- 无新增外部账户、密钥、付费授权或 Agent 联网配置。真实 Brave 研究、真实模型及授权登录需要用户提供已授权测试环境/样本；本轮未擅自启用或要求其凭据写入仓库。
- 合成 UI 取证可在 `client/` 启动 Vite `npm.cmd run dev:browser` 后，以环境变量 `JATO_PLAYWRIGHT_MODULE` 指向可用的 Playwright 包运行 `node scripts/v175-ui-capture.cjs`；使用临时 `userData` 和合成资料，不是安装包或真实授权验收。图样脚本需由 Electron 执行：`electron.cmd scripts/v175-artifact-samples.cjs`。

## 取证文件

- `artifacts/screenshots/P01-project-list.png`、`P02-tender-files.png`、`P03-analysis-result.png`、`P04-outline.png`：实际 Electron + 临时合成资料的四页截图，窗口为 1424×870；不是用户真实项目截图。
- `artifacts/ui-analysis-report.docx`、`ui-outline.docx`：从 Electron 正式 preload/IPC 导出路径产生的合成文档，已核对 DOCX 包结构，未用 Word/WPS 打开。
- `artifacts/synthetic-process-16x9.png`、`synthetic-organization-4x3.png`：Electron 本地渲染合成样例，尺寸分别为 2560×1440 和 2560×1920，已人工查看图面；不能代替真实模型生成效果。
- `artifacts/synthetic-analysis-report.docx`、`synthetic-outline.docx` 是服务级合成样例；最终交付以两个 `ui-*.docx` 为准。

五张 `assets/*.png` 的字节数与 SHA-256 均和 `assets/manifest.json` 一致；图片中的示例版本、日期、格式和额外控件未转为产品需求。CSS 仅在技术方案页面范围内调整。

## T07 后续修补：目录排序操作可见性与边界

在 `v1.7.5-workspace` 的 `b322267` 基线上，按反馈补齐排序模式顶部的“升一级／降一级／上移／下移”；同级按钮复用原拖拽的草稿、重编号、ID 映射及一次保存/取消链路。首末同级、一级升层、首项降层、锁定目标和超深目标会禁用对应按钮，并以按钮说明给出原因。合成五级分支实测发现原降级判断会漏放第六级，已修正边界；不改变 Main 的正文保护和项目存储。新增 [`P04-outline-sorting.png`](artifacts/screenshots/P04-outline-sorting.png) 展示隔离合成项目的排序态，验证结果见分层测试报告。未修改 v1.7.4 规格、版本字段、管理端或发布流程。
