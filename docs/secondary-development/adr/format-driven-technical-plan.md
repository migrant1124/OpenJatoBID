# ADR：招标格式驱动的技术方案解析、目录与受控写作

- 状态：Accepted
- 日期：2026-07-13
- 需求基线：`D:\download\OpenJatoBID_招标解析_格式驱动目录与写作改造_最终需求.md`
- 需求 SHA-256：`386F8FD5CD1A83A3BC1601061CA0C663186D6B9D2558904D879CC7ED5ABA365D`
- 适用范围：`client/`；不修改 `management/`、`analytics/`、发布流程或依赖
- 2026-07-13 修订：按实测结果取消独立报价结构化任务，以“采购与报价”承接采购及报价信息，并将格式解析改为来源锚点与固定模板二阶段编译

## 背景

当前技术方案链路有以下已核实基线：

1. 招标解析共有 18 项，其中 5 项必选；`responseFileRequirements` 是可选 Markdown，`quotationRequirements` 不存在。
2. Main 与 Renderer 各维护一套解析任务定义和 Prompt，`techRequirements` 已发生实际漂移。所有 JSON 结果只做非空判断，无 Schema 门禁。
3. Step03 只读取项目概述和技术评分要求，以“评分大类”为一级目录，并在 Main、Renderer 和 Word 导出中依赖位置型 `item.id` 重编号。
4. SQLite v17 的目录节点不能表达格式锁定、响应模式、源编号、模板或合规状态。
5. Step05 把所有叶子节点作为自由 Markdown，普通保存、扩写、原方案替换、Agent 修复、表格清理和配图都可改写任意节点。
6. Word 导出信任 Renderer 传入的整棵目录，无法从 Store 复核固定模板或重新确定性渲染。

因此，仅修改 Prompt 或 UI 按钮不能满足冻结需求。格式骨架、模板原文和响应状态必须成为 Main 侧可验证的业务约束。

## 决策

### 1. Main 是解析任务目录和运行时契约的唯一权威

- 解析任务的 ID、名称、必选状态、输出类型、展示分组和版本只在 Main 定义。
- `technicalPlan.loadState()` 返回只读 `bidAnalysisTaskDefinitions`；Renderer 的分组、进度、等待文案和重试入口均从该元数据派生。
- Renderer 删除生产用 Prompt 与任务清单副本；开发者测试使用独立测试输入，不再复用另一套业务 Prompt。
- 活跃任务为 18 项、7 项必选，并严格保持关键项顺序：
  `projectOverview`、`techRequirements`、`bidDocumentFormatRequirements`、`procurementList`、`projectInfo`、`partAInfo`、`deliveryAndServiceRequirements`。
- `bidDocumentFormatRequirements` 的代码 ID 保持不变，用户可见名称改为“格式要求”；`procurementList` 的用户可见名称改为“采购与报价”，输出继续使用 Markdown。
- “采购与报价”在现有采购清单基础上覆盖报价方式与范围、限价、税务和发票、价格组成、精度/舍入、公式、报价表与平台、一致性与优先级、无效报价、异常低价、结算付款和外部附件依赖。
- 独立 `quotationRequirements` 不再进入任务目录。旧 SQLite 行保留为不可见兼容数据，不迁移、不删除，也不冒充 `procurementList` 的成功结果。

### 2. 结构化解析必须经过 Main 的解析、归一化和校验

- 继续复用 `aiService.requestJson()`，但格式任务的结构提取与固定模板编译均关闭通用 JSON 修复调用；每阶段最多一次模型请求，错误交给 Main 确定性报告。
- 所有 JSON 解析项都必须先 `JSON.parse`，再执行任务专属 normalizer 和 validator；格式任务的缺失、未知或跨文件锚点属于确定性来源错误，不交给缺少源原文的通用修复请求改写，校验不合法时该项为 `error`。
- `technical_plan_bid_items.content` 继续保存规范化后的稳定 JSON 字符串，避免为每个解析项增加分散列。
- AI 返回的 profile、格式节点和模板 ID 不直接作为权威 ID；normalizer 基于适用范围、树路径和 Main 回填的源位置生成稳定 ID。
- Main 在发送格式分析请求前，把普通 Markdown 内容和 HTML 表格 `<tr>` 行转换为带稳定 ID 的来源锚点。模型第一阶段为普通目录节点返回原始编号和标题；Main 以 `source_number + source_title` 在完整锚点目录中确定性定位唯一目录行，只有无编号或同名候选需要模型提供一个真实锚点消歧。模型不负责生成系统锚点 ID、行号或原文摘录；Main 确定性回填 `RequirementSource` 的文件、行区间和原始片段。
- 第一阶段只提取 profile、目录树、响应模式和固定模板描述；分散的规则来源引用由 Main 按源文件和锚点顺序拆为连续记录。仅对 `locked-commitment`、`fixed-markdown-table` 的锚定原文启动一次小上下文模板编译；同一 HTML 表格内部漏选的 `<tr>` 可由 Main 补齐，未知锚点、跨表格或跨普通正文的来源仍拒绝。Main 使用去除人工层级/列分隔的 canonical evidence 逐段核对承诺函，并按来源表格行列逐格核对固定表格；slot 必须与原文明确留空位一一对应。
- `bidDocumentFormatRequirements` 读取所有独立原始招标 Markdown；`procurementList` 与其余既有项目继续读取当前投标范围工作副本。这样既保留格式多 profile 能力，也避免其他标段的采购和报价内容污染当前结果。
- 旧 `responseFileRequirements` 与 `quotationRequirements` 行保留为不可见兼容数据，不迁移为新结构或“采购与报价”的成功结果。

### 3. SQLite v18 保存不可变约束、响应状态和模板注册表

一次 v18 migration 完成以下结构：

- `technical_plan_meta.selected_format_profile_id` 与 `selected_format_profile_hash`；
- `technical_plan_bid_items.normalized_hash`；
- `technical_plan_outline_nodes.format_constraints_json`；
- `technical_plan_outline_nodes.response_state_json`；
- `technical_plan_response_templates`，以 `template_id` 为主键，保存类型、来源、规范化模板 JSON、确认状态、锁定 Hash 和时间戳。

`format_constraints_json` 保存源格式节点 ID、源编号、源标题、编号策略、目录/响应必选、标题/顺序/层级锁定、响应模式、是否允许 AI 子节点、模板引用、无内容表述和评分映射。

`response_state_json` 保存结构化槽位或表格值、知识条目 ID、响应状态、合规风险和提示。固定模板本体不复制到每个目录节点。

旧节点的计算默认值为：

- `numbering_policy = auto`；
- `response_mode = freeform-markdown`；
- 无锁定、无模板。

旧节点不会自动升级为固定模板。非空但损坏的约束 JSON 必须阻断加载或保存，不能静默降级。

### 4. profile 选择是目录生成前的显式门禁

- `has_explicit_technical_format = false` 时，Schema 只允许一个全局 `technical/none` profile，Step03 自动选择并按评分回退，不进入人工选择门。
- 显式格式结果只允许 technical profile；商务、报价或资格 profile 在 Schema 门禁即失败。
- 显式格式按当前标段/标包 scope 匹配：非空维度必须命中，空维度为通配，优先选择 ID 命中且 specificity 最高的 profile。
- 唯一最高匹配时允许自动选择并持久化 profile ID 与规范化 Hash。
- 零个或最高 specificity 并列多个时阻断目录生成，由用户在 Step03 明确选择；存在明确格式时禁止悄悄回退到评分目录。
- 只有选中 profile 的 `format_strength = none` 时，才进入现有评分大类回退流程。
- “已有方案扩写”不构成例外：存在明确格式时仍以格式骨架优先，原方案只能作为允许区域的内容或目录补充参考；`original-only` 仅在 `format_strength = none` 时可用。

### 5. 固定骨架由程序复制，AI 和 Agent 只修改允许区域

- `id` 继续作为内部树地址，可因合法排序变化；`format_node_id` 稳定标识源格式节点。
- `source_number` 是招标原编号，`source_title` 是不含该编号的原始标题，锁定节点的 `title` 等于 `source_title`。
- `numbering_policy` 语义：
  - `auto`：沿用内部 ID 和导出模板编号；
  - `preserve-source`：只显示 `source_number`；
  - `none`：不显示编号。
- 严格或固定根 profile 先复制完整骨架，再映射评分项；“如有”和“其他”统一保留并要求响应。
- Agent 不再返回可任意重写的完整固定树，只返回评分映射、允许节点下的新增子目录及可修改说明。程序应用 patch 后重新执行格式门禁和评分覆盖门禁。
- 同一约束校验器用于首次生成、知识库补目录、Agent 修复、已有方案补目录和 Step05 最低字数补目录。

### 6. Store 是锁定约束的最终执行边界

Renderer 根据约束禁用编辑、删除、排序和添加，但 Main 不信任 Renderer 回传的锁字段。

`technicalPlanStore` 在保存整棵树及任何正文写入时，根据数据库中的稳定约束拒绝：

- 删除必留节点；
- 修改锁定标题、顺序、层级或源编号；
- 向 `allow_ai_children = false` 的节点添加子节点；
- 通过普通 `saveChapterContent` 覆盖固定承诺函或固定表格；
- 通过后台 `updateTechnicalPlan`、正文 section 写入或 Agent 回写绕过受控渲染。

### 7. Step05 先按响应模式分流，再进入现有自由正文流程

- `freeform-markdown`：唯一允许进入普通生成、扩写、原方案优化、最低字数扩写、一致性修复、表格清理和配图的模式。
- `locked-commitment`：Agent 只返回槽位值，Main 根据已确认模板确定性渲染。
- `fixed-markdown-table`：Agent 或用户只提交允许单元格和重复区数据，Main 根据固定表头、列顺序、固定说明和行规则渲染。
- `evidence-markdown`：Main 向 Agent 提供所选知识库的索引快照；Agent 只返回已知知识条目 ID 和结构化说明，Main 丢弃未知 ID 并生成 Markdown 索引。
- `explicit-none`：确定性写入模板指定表述或“无。”，同时保留风险状态。
- `container`：只承载子节点，不生成正文。

背景任务的 `success/error` 继续表示执行结果；业务完整性由节点 `response_status` 独立表示。任务执行成功但仍有 `needs-manual-input` 或 `missing-required-evidence` 时，UI 必须显示“生成完成但待处理”，导出门禁不得把它视为合规完成。

### 8. 模板确认与导出门禁

- Step02 可审阅并修正解析出的固定模板；Main 在确认时重新规范化并计算 Hash，不信任 Renderer 提交的 Hash。
- 未确认模板不阻止 Step03 复制目录骨架，但对应 Step05 节点保持 `needs-manual-input`，禁止受控生成和导出。
- 用户可重新核对模板；若目录已存在，只清理引用该模板的正文、正文计划、运行态和配图计划，不无条件删除未变化的目录骨架。
- 技术方案导出改为 Main 根据 `source = technical-plan` 回读 Store 的权威目录，重新渲染并校验固定模板，然后复用现有 Markdown → DOCX 链路。导出模板预览等通用导出继续使用原 payload 路径。
- 未确认模板、锁定 Hash 不一致、必填槽位缺失、固定表格结构损坏或 `pending/needs-manual-input` 为硬阻断。
- 缺少强制证明材料时显示显著风险并要求用户在 Radix Dialog 中明确确认后才允许本次导出；确认不改变 `missing-required-evidence` 和风险等级。

### 9. 缓存失效按变更类型处理

- 格式解析 Hash 使用稳定 JSON 的 SHA-256，并覆盖格式结果与全部解析模板（固定正文、slot、表头、有序表体、重复区和固定说明）；不是只对模板 ID 计算。
- 完整格式分析 Hash 或选中 profile 发生变化：重置本次模板确认并事务性清理目录、全局事实、正文任务、正文计划、运行态、正文和配图计划。
- 相同规范化结果不清理下游。
- 模板正文重新确认但骨架未变：只清理引用该模板的受影响节点正文及所有正文运行缓存。
- 目录的固定骨架或响应模式变化：清理受影响正文及正文运行缓存。
- 执行可能清空已有目录/正文的补充解析前，UI 必须明确提示影响。

## 固定表格 v1 选择

固定表格采用结构化模板，不接受完整 Markdown 回写：

- 锁定：标题、表头、列数、列顺序、固定单元格、固定说明；
- 可写：显式 `slot` 单元格；
- 表体：使用有序 `row | repeatable-region` 联合序列，重复区在固定行之间的插入位置不可歧义；
- 可重复：仅 `repeatable-region` 声明的行模板；
- Agent 输出：`template_id`、`cell_values`、`repeatable_rows`、`knowledge_item_ids`、`missing_fields`；
- Main 校验未知字段、列数、最大行数和固定 Hash 后再渲染 Markdown。

本版本只生成知识材料文字索引和 `knowledge_item_ids`，不复制或嵌入原附件；这与 Markdown 权威正文和不建设 OOXML 编辑能力的冻结范围一致。

## 被否决方案

- 继续维护 Main/Renderer 两套任务清单：已有真实漂移，无法形成 7 项一致门禁。
- 继续让模型填写行号和可见文本摘录：单物理行 HTML 表格中的标签结构与可见文本不一致，无法稳定完成唯一定位。
- 对来源校验错误使用不带源原文的通用 JSON 修复：修复请求没有重建证据位置所需的信息，只会延长解析并重复失败。
- 只在 UI 隐藏按钮：IPC、后台任务、Agent 和导出仍可绕过。
- 让 Agent 返回完整固定承诺函或完整固定表格 Markdown：无法证明固定正文未变。
- 用 `item.id` 同时承担树地址和源编号：排序会破坏招标原编号。
- 有明确格式但 profile 不唯一时自动猜测或退回评分目录：违反格式优先。
- 让“采购与报价”结果进入通用技术正文上下文：存在价格信息泄露风险。
- 新增 Word/OOXML 模板编辑或附件嵌入：超出冻结范围。

## 后果、风险与恢复

- 优点：固定格式和模板成为 Main 可验证约束；旧工作区有明确默认值；目录、写作和导出使用同一语义。
- 代价：v18 migration、Store 写入门禁和响应模式分流会触及多条现有链路，必须分阶段验证。
- 风险：四个真实验收样本当前未在仓库或 `D:\download` 找到；可先用结构化 fixtures 实现，但不能据此声称四样本 E2E 通过。
- 恢复：数据库升级沿用现有迁移前备份；功能回退时保留 v18 列和模板表但由旧客户端忽略。不得通过删除约束或降级校验恢复运行。

## 审批门

批准本 ADR 即确认以下实现口径：

1. v18 使用解析项 normalized Hash、两个节点 JSON 字段和一个模板表；
2. 全文原始招标文件仅用于格式多 profile 解析，“采购与报价”按当前投标范围工作副本提取；
3. 无明确格式自动使用全局 technical/none profile；显式格式无唯一最高匹配时由用户选择，禁止猜测；
4. 已有方案扩写也服从格式优先；
5. 未确认模板允许进入 Step03，但阻止对应写作和导出；
6. 缺少强制证据允许显式风险确认后导出，其他结构完整性问题硬阻断；
7. 证明材料 v1 只生成 Markdown 索引，不嵌入原附件。
