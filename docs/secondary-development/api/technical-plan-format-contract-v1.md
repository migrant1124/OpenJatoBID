# OpenJatoBID 技术方案格式与受控响应契约 v1

- 状态：Approved
- 日期：2026-07-13
- 关联 ADR：`docs/secondary-development/adr/format-driven-technical-plan.md`
- 需求基线：`D:\download\OpenJatoBID_招标解析_格式驱动目录与写作改造_最终需求.md`

## 1. 通用约定

- Renderer 类型权威仍为 `client/src/shared/types/ipc.ts` 与 `client/src/shared/types/outline.ts`；运行时校验权威在 Electron Main。
- Schema 版本从 `1` 开始；未知枚举、缺少必填字段、非法 source 或损坏 JSON 不得进入 `success`。
- Main 对 AI 返回的 ID 做稳定化；所有 source ID 必须属于当前工作区保存的原始招标文件集合。
- `outlineData.outline[*].content` 继续是最终 Markdown 正文权威。
- IPC 内部参数属于本地可信数据，但固定格式完整性是业务规则，必须在 Main/Store 再校验。

## 2. 解析任务元数据

`technicalPlan.loadState()` 增加：

```ts
interface BidAnalysisTaskDefinition {
  id: string;
  label: string;
  description: string;
  required: boolean;
  output: 'markdown' | 'json';
  group: 'key' | 'optional';
  schema_version?: number;
}

interface BidAnalysisTaskState {
  id: string;
  label: string;
  status: 'idle' | 'running' | 'success' | 'error';
  content: string;
  normalized_hash?: string;
  error?: string;
}

interface TechnicalPlanState {
  bidAnalysisTaskDefinitions: BidAnalysisTaskDefinition[];
  responseTemplates: ResponseTemplateRecord[];
  selectedFormatProfileId?: string;
  selectedFormatProfileHash?: string;
}
```

Renderer 不保存另一套生产任务清单或 Prompt。

活跃任务总数为 18；关键项共 7 项，顺序为：

```text
projectOverview
techRequirements
bidDocumentFormatRequirements  // UI：格式要求
procurementList                 // UI：采购与报价
projectInfo
partAInfo
deliveryAndServiceRequirements
```

`quotationRequirements` 不属于活跃任务目录；历史 SQLite 行只保留为不可见兼容数据。

## 3. 公共来源与适用范围

```ts
interface RequirementSource {
  source_file_id: string;
  source_file_name?: string;
  section_hint?: string;
  markdown_line_start: number;
  markdown_line_end: number;
  page_hint?: string;
  excerpt?: string;
}

interface SourceAnchor {
  id: string;
  sourceFileId: string;
  markdownLineStart: number;
  markdownLineEnd: number;
  rawText: string;
  visibleText: string;
  canonicalText: string;
  tableCells?: string[];
  tableCellSpans?: Array<{ text: string; rowspan: number; colspan: number }>;
  kind: 'markdown-line' | 'html-fragment' | 'html-table-row';
}

interface AiSourceReference {
  anchor_id?: string;
  anchor_ids?: string[];
}

interface ApplicableScope {
  section_id?: string;
  section_title?: string;
  package_ids: string[];
  package_names: string[];
  document_type: 'technical' | 'quotation' | 'business' | 'qualification' | 'other';
}

interface TechnicalApplicableScope extends ApplicableScope {
  document_type: 'technical';
}
```

规范化规则：

- 数组去重并保持源顺序；
- `SourceAnchor` 仅存在于 Main 的本次分析内存和模型输入中，不通过 IPC 暴露，也不写入 SQLite；
- `visibleText` 可加入标题层级和表格列分隔以帮助第一阶段识别；`canonicalText` 与 `tableCells` 不含这些人工层级/分隔标记，仅供 Main 做逐字和逐格校验，其中 HTML 空单元格在 `canonicalText` 中规范化为 `＿` 留空位；
- 普通 Markdown 行生成 `markdown-line` 锚点并保留标题/列表前缀；同一物理行上的 HTML 标题、段落和列表项拆为 `html-fragment`，标题用等价 `#` 层级展示；原始 HTML 表格按 `<tr>` 生成 `html-table-row` 锚点，避免把整张单行 HTML 交给模型反推物理行号；
- 第一阶段普通目录节点返回原始 `source_number + source_title`；能够唯一匹配时可省略 `AiSourceReference`，无编号或同名候选时必须提供一个输入中的真实锚点消歧。规则来源与固定模板位置仍使用 `AiSourceReference`，不得自行填写 `source_file_id`、行号或摘录；
- `anchor_id` 表示单个锚点，`anchor_ids` 表示一个或多个输入锚点。普通目录由 Main 注入唯一真实锚点；聚合的规则来源允许由 Main 按源文件和原文顺序拆成多条连续记录；固定模板的多锚点必须属于同一源文件且连续，只允许补齐同一 HTML 表格内部漏选的 `<tr>`，拒绝未知锚点、跨表格或跨普通正文组合；
- 回填后的 `source_file_id` 必须存在，`markdown_line_start/end` 必须是源 Markdown 内有效且有序的 1-based 行号，`excerpt` 使用锚点对应的原始片段；
- 规范化完成后，每个格式节点和固定模板都必须具有 Main 可解析并回填的 `RequirementSource`；只有“全文检索后未发现明确要求”的根级 negative result 可没有节点来源；
- profile scope key 由 Main 根据 `document_type`、标段和标包字段稳定生成；
- 没有明确标段/标包时允许空数组，但不能伪造 ID。

## 4. 格式要求（代码 ID：`bidDocumentFormatRequirements`）

### 4.1 规范化结果

```ts
type FormatStrength = 'strict' | 'fixed-roots' | 'none';
type NumberingPolicy = 'auto' | 'preserve-source' | 'none';
type ResponseMode =
  | 'freeform-markdown'
  | 'fixed-markdown-table'
  | 'locked-commitment'
  | 'evidence-markdown'
  | 'container'
  | 'explicit-none';

interface BidFormatNode {
  format_node_id: string;
  source_number?: string;
  source_title: string;
  description?: string;

  required_in_outline: boolean;
  response_required: boolean;
  title_locked: boolean;
  order_locked: boolean;
  level_locked: boolean;

  numbering_policy: NumberingPolicy;
  response_mode: ResponseMode;
  allow_ai_children: boolean;

  template_id?: string;
  empty_response_text?: string;
  missing_evidence_risk?: 'high' | 'potential-rejection';
  children: BidFormatNode[];
  source: RequirementSource;
}

interface BidFormatProfile {
  profile_id: string;
  applicable_scope: TechnicalApplicableScope;
  format_strength: FormatStrength;
  document_title: string;
  outline: BidFormatNode[];
}

interface BidDocumentFormatRequirements {
  schema_version: 1;
  has_explicit_technical_format: boolean;
  profiles: BidFormatProfile[];
  template_ids: string[];
  other_format_rules: {
    signature_and_seal: string[];
    file_and_upload: string[];
    typesetting: string[];
    required_template_ids: string[];
  };
  sources: RequirementSource[];
}
```

### 4.2 强制 normalizer 规则

- 标题含“如有”或语义为“其他”的适用节点强制：
  `required_in_outline = true`、`response_required = true`。
- 不允许 `optional_omit`。
- `locked-commitment` 和 `fixed-markdown-table` 必须有 `template_id`。
- `container` 必须有子节点；`allow_ai_children = false` 的节点禁止后续新增子节点。
- `preserve-source` 必须有 `source_number`。
- `source_title` 不含 `source_number`；`title` 在目录实例化时取 `source_title`，避免重复编号。
- `evidence-markdown` 缺少强制材料时的风险由 `missing_evidence_risk` 决定；未给出时规范化为 `high`。
- 所有格式 profile 的 `document_type` 必须为 `technical`；商务、报价或资格 profile 不得进入本契约。
- `has_explicit_technical_format = false` 时必须且只能返回一个全局 profile：标段/标包字段为空、`format_strength = none`；Step03 自动使用它，不进入人工选择门。
- `has_explicit_technical_format = true` 时至少有一个 `strict` 或 `fixed-roots` profile；允许为某个明确 scope 返回 `none`，表示该 scope 按评分回退。

### 4.3 profile 匹配算法

1. 根结果为 `has_explicit_technical_format = false`：直接选择唯一全局 `technical/none` profile。
2. 根结果为 true：只比较 technical profile。
3. profile 中非空的 `section_id/package_ids` 必须命中当前 scope；空数组或空字段表示该维度为通配。
4. ID 优先于标题/名称匹配；标题/名称只用于旧数据没有稳定 ID 时的兼容匹配。
5. 对所有匹配项计算 specificity：非空且命中的 section/package 维度越多，优先级越高。
6. 最高 specificity 唯一时自动选择；零个或最高分并列多个时阻断并要求用户明确选择。
7. 选择 `none` profile 才进入评分回退；任何 business/quotation/qualification profile 都是 Schema 错误。

### 4.4 两阶段 AI 结果与 Main 回填

第一阶段模型读取来源锚点列表，返回 profile、递归目录树、响应模式、固定模板描述，以及目录节点的原始 `source_number + source_title`；不返回自行推测的行号、摘录或固定模板正文。Main 对普通目录节点从完整锚点目录中确定性选择唯一匹配行，模型只在无编号或同名候选时提供一个输入中的真实锚点用于消歧。`result.sources` 的聚合引用由 Main 按源文件和真实锚点顺序拆为连续来源记录。Main 在第二阶段前校验模板锚点引用并解析原始片段；同一 HTML 表格内部漏选的 `<tr>` 行可确定性补齐，未知锚点、跨表格或跨普通正文引用仍拒绝。第二阶段完成后由 normalizer 统一回填持久化的 `RequirementSource`。

只有第一阶段识别出 `locked-commitment` 或 `fixed-markdown-table` 时，才启动第二阶段模板编译。第二阶段输入仅包含这些模板描述和对应锚点的原始片段，不重复提交完整招标文件；无固定模板时不发起第二阶段请求。

格式任务的两个阶段均关闭通用 JSON 修复调用：每阶段只请求一次，JSON/root 结构错误直接失败，来源和模板语义错误只由 Main 确定性校验报告，避免缺少完整证据的额外模型请求改写结果。

第二阶段返回固定模板结构后，Main 必须复核：

- 模板 `source_title` 必须与所引用格式节点的标题一致，并由 Main 使用节点标题落盘；
- 固定承诺函的 locked segments 必须按原顺序完整覆盖 `canonicalText`；每个 slot 必须在同一位置消费一个 `_`/`＿` 明确留空段，禁止遗漏留空位、增加无来源 slot 或把省略号/圆点等固定标点当留空；
- 固定表格必须按来源 `<tr>/<td>` 或 Markdown 表格行逐格复核表头、固定单元格和 slot 列；Main 先按 `rowspan/colspan` 展开逻辑网格，slot 只允许对应空单元格或 `_`/`＿` 明确留空段；
- 固定说明仍按原顺序、非重叠地在 canonical evidence 中定位；repeatable region 只能占据结构一致的来源行，不得改写固定内容。

两阶段结果通过 Main 的 normalizer 后返回：

```ts
interface NormalizedFormatAnalysis {
  result: BidDocumentFormatRequirements;
  templates: ResponseTemplateRecord[];
  normalized_hash: string;
}
```

`normalized_hash` 必须覆盖完整的 `result + templates`，而不是只覆盖模板 ID：

1. normalizer 先完成锚点校验、`RequirementSource` 确定性回填、稳定 ID、默认值和枚举校验；
2. 对象 key 按字典序递归排序，数组保留业务顺序；
3. 固定文本只统一 CRLF/LF，不改空格、标点或条款内容；
4. 排除 `confirmed`、`locked_hash`、`created_at`、`updated_at` 等运行态字段；
5. 对 `UTF-8(stableStringify({ result, templates }))` 计算 SHA-256。

Hash 输入必须包含 locked segments、slot schema、固定表头、有序表体、重复区和固定说明。

`result` 稳定序列化后写入 `technical_plan_bid_items.content`，`normalized_hash` 写入该行的 `normalized_hash`；模板在同一事务写入 `technical_plan_response_templates`。`result` 仅保存模板 ID，不复制模板本体。

重新解析时：

- 新旧 normalized Hash 相同：保留已确认模板及下游状态；
- Hash 不同：替换本次格式任务的模板记录并全部置为未确认，清理旧 locked Hash、引用节点和全部下游；
- 用户对模板的核对/重确认不改变解析 Hash，只更新确认模板和 locked Hash，并按模板引用做定向失效。

## 5. 采购与报价（代码 ID：`procurementList`）

`procurementList` 是必选关键项，输出类型为 Markdown，不再维护独立的结构化报价 Schema。内容应按当前投标范围合并整理：

- 采购清单、采购内容、规格参数、单位、数量、交付、验收、质保；
- 报价方式、预算与最高限价、税务与发票、价格组成、精度和舍入、计算公式；
- 必须提交的报价表、电子平台或提交渠道、一致性与优先级规则；
- 禁止或无效报价情形、异常低价审查、结算与付款、外部附件或依赖。

优先保留原始表格和字段含义；复杂表格可以按“清单项 + 要求说明”整理。没有明确内容时返回可读的未发现说明，不以空字符串冒充成功。

结果继续写入 `technical_plan_bid_items.content`。Step03、全局事实和普通技术正文 Prompt 默认不得读取“采购与报价”内容；技术目录中明确存在费用类固定节点时，以格式节点本身为输入。

历史 `quotationRequirements` SQLite 行保留但隐藏，不删除、不迁移，也不映射为 `procurementList` 的成功结果；历史工作区是否需要补跑由当前 7 个关键项的实际状态决定。

## 6. 固定响应模板

### 6.1 公共记录

```ts
interface ResponseTemplateRecord {
  template_id: string;
  kind: 'locked-commitment' | 'fixed-markdown-table';
  analysis_item_id: 'bidDocumentFormatRequirements';
  profile_id: string;
  format_node_id: string;
  source_title: string;
  source_location: RequirementSource;
  template: LockedCommitmentTemplate | FixedMarkdownTableTemplate;
  confirmed: boolean;
  locked_hash?: string;
  created_at?: string;
  updated_at?: string;
}
```

Renderer 提交的 `confirmed`、`locked_hash` 不作为权威；Main 确认后重新计算。

### 6.2 固定承诺函

```ts
interface LockedSegment {
  type: 'locked';
  text: string;
  hash?: string;
}

interface TemplateSlot {
  type: 'slot';
  slot_id: string;
  label: string;
  value_source: 'project-info' | 'part-a-info' | 'company-knowledge' | 'manual';
  required: boolean;
}

interface LockedCommitmentTemplate {
  kind: 'locked-commitment';
  segments: Array<LockedSegment | TemplateSlot>;
}

interface LockedTemplateValues {
  template_id: string;
  slot_values: Record<string, string>;
  knowledge_item_ids: string[];
  missing_slots: string[];
}
```

Main 按 segment 原顺序拼装 Markdown；仅 slot 值可变。

### 6.3 固定 Markdown 表格

```ts
interface FixedTableCell {
  kind: 'locked' | 'slot';
  text?: string;
  slot_id?: string;
  label?: string;
  value_source?: 'project-info' | 'part-a-info' | 'company-knowledge' | 'manual';
  required?: boolean;
}

interface FixedTableRow {
  row_id: string;
  cells: FixedTableCell[];
}

interface RepeatableTableRegion {
  kind: 'repeatable-region';
  region_id: string;
  row_template: FixedTableRow;
  min_rows: number;
  max_rows?: number;
}

interface FixedTableBodyRow {
  kind: 'row';
  row: FixedTableRow;
}

type FixedTableBodyItem = FixedTableBodyRow | RepeatableTableRegion;

interface FixedMarkdownTableTemplate {
  kind: 'fixed-markdown-table';
  table_title?: string;
  headers: string[];
  body: FixedTableBodyItem[];
  fixed_notes: string[];
  empty_response_text?: string;
}

interface FixedTableValues {
  template_id: string;
  cell_values: Record<string, string>;
  repeatable_rows: Record<string, Array<Record<string, string>>>;
  knowledge_item_ids: string[];
  missing_fields: string[];
}
```

`body` 是唯一的有序表体定义。Main 按数组顺序渲染固定行与重复区，因此多个重复区、固定尾行和固定说明前的插入位置都不存在歧义。

Main 必须校验表头、列数、列顺序、固定单元格、固定说明、region ID 唯一、重复区最小/最大行数后再生成 Markdown。

## 7. 目录节点持久化

Renderer 使用展开后的便利类型，SQLite 把约束和响应状态分别保存为 JSON。

```ts
interface OutlineFormatConstraints {
  format_node_id?: string;
  source_number?: string;
  source_title?: string;
  numbering_policy: NumberingPolicy;
  required_in_outline: boolean;
  response_required: boolean;
  title_locked: boolean;
  order_locked: boolean;
  level_locked: boolean;
  response_mode: ResponseMode;
  allow_ai_children: boolean;
  template_id?: string;
  empty_response_text?: string;
  missing_evidence_risk?: 'high' | 'potential-rejection';
  mapped_requirement_ids: string[];
}

type ResponseStatus =
  | 'pending'
  | 'responded-substantive'
  | 'responded-none'
  | 'needs-manual-input'
  | 'missing-required-evidence';

type ComplianceRisk = 'none' | 'warning' | 'high' | 'potential-rejection';

interface OutlineResponseState {
  template_values?: LockedTemplateValues | FixedTableValues;
  knowledge_item_ids: string[];
  response_status: ResponseStatus;
  compliance_risk: ComplianceRisk;
  compliance_message?: string;
}
```

旧目录节点缺少 JSON 时计算为自由 Markdown 默认值；不得根据标题猜测模板类型。

## 8. IPC 增量

```ts
interface TechnicalPlanBridge {
  confirmResponseTemplate(payload: {
    templateId: string;
    template: LockedCommitmentTemplate | FixedMarkdownTableTemplate;
  }): Promise<TechnicalPlanState>;

  saveOutlineConfig(payload: {
    referenceKnowledgeDocumentIds: string[];
    outlineExpansionMode?: OutlineExpansionMode;
    selectedFormatProfileId?: string;
  }): Promise<TechnicalPlanState>;

  saveLockedTemplateValues(payload: {
    nodeId: string;
    templateId: string;
    slotValues: Record<string, string>;
  }): Promise<TechnicalPlanState>;

  saveFixedTableValues(payload: {
    nodeId: string;
    templateId: string;
    cellValues: Record<string, string>;
    repeatableRows: Record<string, Array<Record<string, string>>>;
  }): Promise<TechnicalPlanState>;
}
```

既有 `saveChapterContent({ nodeId, content })` 只允许自由 Markdown 和允许人工编辑的证明材料节点；固定承诺函、固定表格、容器和明确无内容节点必须拒绝。

## 9. 技术方案导出

Renderer 调用：

```ts
exportWord({
  source: 'technical-plan',
  requestId,
  export_format,
  acknowledgeMissingEvidence?: boolean,
})
```

Main 行为：

1. 回读当前 Technical Plan Store；
2. 校验响应门禁；
3. 根据模板记录重新渲染固定节点；
4. 校验 locked Hash 和固定表格结构；
5. 按编号策略生成标题；
6. 复用现有 Markdown → DOCX 流程。

未传 `source = technical-plan` 的通用导出保持现状。

## 10. 错误与门禁

建议稳定中文错误：

| 场景 | 错误 |
| --- | --- |
| 7 项未完成 | 请先完成 7 个关键招标文件解析项 |
| profile 不唯一 | 当前投标范围存在多个格式方案，请先选择 |
| profile 无匹配 | 未找到当前投标范围的适用格式方案，请人工选择 |
| 删除固定节点 | 该节点属于招标文件固定目录，不能删除 |
| 修改锁定标题 | 该节点标题来自招标文件，不能修改 |
| 固定模板未确认 | 该固定模板尚未确认并锁定 |
| 普通保存固定正文 | 该章节使用受控模板，不能覆盖完整 Markdown |
| 固定 Hash 变化 | 固定模板内容校验失败，请重新核对模板 |
| 必填槽位缺失 | 固定模板仍有必填字段未填写 |
| 证明材料缺失 | 强制证明材料缺失，确认风险后方可导出 |

## 11. 失效规则

| 变化 | 清理 |
| --- | --- |
| 完整格式分析 Hash（result + templates）变化 | 模板确认、目录、profile 选择、全局事实、正文与配图全部下游 |
| “采购与报价”结果变化 | 不清理技术目录或正文 |
| profile 变化 | 目录、全局事实、正文与配图全部下游 |
| 模板重新确认，骨架不变 | 引用节点正文、正文任务/计划/运行态、配图计划 |
| 目录固定骨架或 response mode 变化 | 受影响正文及所有正文运行缓存 |
| 规范化结果相同 | 不清理 |

所有清理必须在 Store 事务中执行；任务启动前的 UI 只负责说明影响，不提前清空持久数据。
