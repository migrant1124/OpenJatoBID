# CHG-001：格式要求、目录生成与人工填写简化

- 状态：Approved
- 日期：2026-07-13
- 适用范围：`client/` 技术方案 Step02、Step03、Step05
- 原需求基线：`D:\download\招标解析_格式驱动目录与写作改造_最终需求.md`
- 替代范围：原需求中 `bidDocumentFormatRequirements` 结构化格式契约、来源锚点、多 profile、固定模板编译和受控模板写作

## 1. 变更原因

原方案把 `upstream-main` 中可选的 Markdown 解析项 `responseFileRequirements` 升级为严格结构化任务 `bidDocumentFormatRequirements`，并进一步要求模型返回来源锚点、连续来源、格式 profile 和固定模板描述。真实招标文件回归中连续出现无效 JSON、摘录无法定位、锚点不连续、未知锚点和重复锚点等错误。

这些错误发生在 Step02 格式解析阶段，不是普通正文生成失败。根因是一个原本只需提取业务语义的 Markdown 任务承担了来源身份、模板编译和逐字校验职责。继续修补锚点不能改变该职责错配。

## 2. 已批准的新业务规则

### 2.1 Step02：格式要求

- 恢复代码 ID：`responseFileRequirements`。
- 用户可见名称：`格式要求`。
- 设置为关键项，输出类型为 Markdown。
- 提取范围沿用 `upstream-main` 原“响应文件要求”：投标/响应文件组成、技术文件目录、固定表格或附件名称、签章、命名、装订、上传和递交要求。
- Markdown 第一行固定为 `【技术文件目录状态】：明确` 或 `【技术文件目录状态】：未明确`，供 Step03 在不增加 JSON 请求的情况下选择目录来源分支。
- 输入使用当前投标范围工作副本，不再读取全部原始源文件后生成多 profile。
- 不返回结构化 profile、来源锚点、行号、摘录、模板 JSON 或锁定 Hash。

### 2.2 Step03：一级目录来源

目录生成必须先读取成功的 `responseFileRequirements` Markdown，并严格按以下二选一规则确定一级目录来源：

1. 有明确技术文件格式：一级目录按格式要求生成，保留其标题、顺序以及列出的“如有”“其他”等节点。
2. 无明确技术文件格式：参考用户所选知识库文档的目录生成一级目录；多份参考文档由 AI 综合为一套目录。

两种情况下，技术评分项都只能映射或补充二级及以下目录，禁止创建新的一级目录。

若无明确格式且未选择任何参考知识库文档，阻止目录生成并提示：

> 招标文件未规定明确目录格式，请至少选择一份参考知识库文档后生成目录。

不得静默退回“按技术评分大类生成一级目录”，也不得自动生成通用一级目录。

### 2.3 Step05：正文与人工填写

- 普通技术章节继续由 AI 生成 Markdown，允许改写、扩写和专业化表达，不要求与招标文件正文逐字一致。
- 固定表格和承诺函必须保留目录节点，但不由 AI 生成或改写，交由用户人工填写。
- 目录节点仅增加最小业务字段 `manual_input_required?: boolean`；固定表格和承诺函设置为 `true`。
- 批量正文生成、单节重新生成、扩写和自动后处理必须跳过人工填写节点。
- 人工填写节点继续使用普通 Markdown 编辑与保存，不建立 slot、cell、模板 Hash 或专用固定模板保存接口。
- 导出前若人工填写节点正文为空，应列出节点并阻止导出；系统不校验其内容是否与招标原文逐字一致。

## 3. 保留的既有成果

- Main 作为招标解析任务目录、必选状态和 Prompt 的唯一权威。
- 7 个关键项及配置 Dialog 的关键项/其他项布局。
- `procurementList` 用户可见名称“采购与报价”，独立 `quotationRequirements` 保持隐藏历史数据。
- 后台任务生命周期、当前任务 `run_id` 防旧响应覆盖、Store 权威状态和既有 Markdown → Word 导出主链路。
- SQLite v18 结构保留，不执行数据库降级或删列；新路径只复用现有 `format_constraints_json` 保存 `manual_input_required`。

## 4. 被替代的既有成果

以下能力不再属于目标产品行为：

- `bidDocumentFormatRequirements` 活跃任务及其结构化 JSON Schema；
- AnchorCatalog、`source.anchor_ids`、excerpt 定位和连续性校验；
- technical format profile、profile 选择与 profile Hash；
- 固定承诺函/固定表格二阶段模板编译；
- `technical_plan_response_templates` 的新建、确认和受控写作路径；
- 六种 `response_mode` 对新目录的分流要求；
- 固定正文逐字 Hash、slot/cell/repeatable region 和专用保存接口；
- 以技术评分大类作为无明确格式时的一级目录来源。

旧数据库字段和历史记录可保留以避免破坏性迁移，但不得继续驱动新任务、目录、正文或导出。

## 5. 验收标准

1. 关键项中存在且只存在代码 ID `responseFileRequirements` 的“格式要求”，输出 Markdown。
2. Markdown 使用固定的技术文件目录状态首行，且只接受“明确/未明确”。
3. 格式要求解析不构建或校验任何来源锚点，也不发起固定模板第二阶段请求。
4. 有明确格式时，一级目录来自格式要求；技术评分项只能进入二级及以下。
5. 无明确格式时，一级目录来自所选知识库文档；技术评分项只能进入二级及以下。
6. 无明确格式且未选知识库时，使用批准的中文错误阻止生成。
7. 固定表格和承诺函节点设置 `manual_input_required = true`，正文 AI 与自动后处理均跳过。
8. 普通正文允许专业化改写，不执行招标原文逐字校验。
9. 历史 `bidDocumentFormatRequirements`、profile 和模板记录不冒充当前成功结果。
10. 两个技术方案入口、旧工作区加载、目录失效、正文保存和 Word 导出无回归。
11. 不修改依赖、管理端、Analytics、发布流程或 Word/OOXML 编辑能力。

## 6. 阶段影响

- 原 T49、T52—T59 及 T62、T64—T69 作为历史实现记录保留，但不再代表当前目标设计。
- 新实现任务由 `tasks/plan.md` 第 13 节和 `tasks/todo.md` 阶段 7F 管理。
- 原格式驱动测试报告只证明旧架构曾通过其自动化，不作为 CHG-001 验收证据。
