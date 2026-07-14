# OpenJatoBID 格式要求、目录来源与人工填写契约

- 状态：Approved
- 日期：2026-07-13
- 修订依据：`docs/secondary-development/changes/format-requirements-simplification-change.md`
- 关联 ADR：`docs/secondary-development/adr/format-driven-technical-plan.md`
- 说明：本文件保留原路径以避免引用漂移；原 v1 profile、锚点和固定模板契约已被本修订整体替代

## 1. 通用约定

- Main 是解析任务定义和运行时 Prompt 的唯一权威。
- Renderer 只读取 `technicalPlan.loadState()` 返回的任务元数据和业务状态。
- `outlineData.outline[*].content` 继续是最终 Markdown 正文权威。
- 格式要求是 Markdown 业务语义，不是来源证明或模板数据。
- IPC 参数属于可信本地调用；只校验真实业务约束，不重复做无意义的跨层校验。
- SQLite 保持 v18，不删列、不降级、不新增 migration。

## 2. 招标解析任务契约

### 2.1 任务定义

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
```

关键项顺序固定为：

```text
projectOverview
techRequirements
responseFileRequirements
procurementList
projectInfo
partAInfo
deliveryAndServiceRequirements
```

格式要求定义固定为：

```ts
const responseFileRequirements: BidAnalysisTaskDefinition = {
  id: 'responseFileRequirements',
  label: '格式要求',
  description: '投标/响应文件组成、技术目录、固定表格或附件、签章、命名、装订、上传和递交要求。',
  required: true,
  output: 'markdown',
  group: 'key',
};
```

`bidDocumentFormatRequirements` 不再是活跃任务。历史 Store 行允许存在，但不出现在任务定义、不计入进度，也不作为 `responseFileRequirements` 的成功结果。

### 2.2 输入与输出

输入：当前投标范围工作副本 Markdown。若用户已经选择标段/标包，格式要求不得重新读取其他范围并生成多 profile。

输出：普通 Markdown，至少覆盖能够从原文识别的以下信息：

- 投标/响应文件组成；
- 技术文件明确目录及先后顺序；
- 固定表格、承诺函和附件名称；
- 必须提供与如适用内容；
- 文件命名、格式、份数、签章、装订、上传和递交规则；
- 未发现明确要求时的可读说明。

第一行必须且只能是：

```text
【技术文件目录状态】：明确
```

或：

```text
【技术文件目录状态】：未明确
```

Main 只读取该首行选择 Step03 分支；状态缺失或非法时该项不得保存为成功。其余内容仍作为普通 Markdown 保存和展示。

输出不得包含运行时依赖的：

- `profiles`、`format_strength` 或 scope ID；
- `source.anchor_ids`、行号、excerpt 或 source catalog；
- `templates`、slot、cell、repeatable region 或固定 Hash。

格式要求使用普通 Markdown AI 请求。不得进入格式专属 `requestJson()`、来源锚点校验或固定模板第二阶段请求。

## 3. Step03 目录生成契约

### 3.1 输入

```ts
interface SimplifiedOutlineGenerationContext {
  project_overview: string;
  technical_scoring_requirements: string;
  format_requirements: string;
  reference_knowledge_document_ids: string[];
  reference_document_outlines: Array<{
    document_id: string;
    title: string;
    outline_markdown: string;
  }>;
  original_plan_outline?: string;
}
```

`format_requirements` 来自成功的 `responseFileRequirements`。`reference_document_outlines` 只包含用户本次明确选择的知识库文档目录或可用于恢复目录的标题结构，不把全部知识库隐式加入 Prompt。

### 3.2 一级目录分支

目录生成必须先判断格式要求是否明确给出技术文件目录。

```text
有明确格式
  → 一级目录来自 format_requirements
  → reference_document_outlines 仅用于二级及以下参考
  → 技术评分项只能映射或补充二级及以下

无明确格式
  → 必须存在至少一份 reference_document_outlines
  → 一级目录综合所选知识库文档目录生成
  → 技术评分项只能映射或补充二级及以下
```

无明确格式且没有参考知识库文档时，抛出稳定业务错误：

```text
招标文件未规定明确目录格式，请至少选择一份参考知识库文档后生成目录。
```

禁止的回退：

- 按技术评分大类创建一级目录；
- 自动生成实施方案、质量、安全、进度、售后等通用一级目录；
- 使用未选择的知识库文档；
- 使用历史 profile 或历史 `selected_format_profile_id`。

### 3.3 目录节点

沿用现有 `OutlineItem`，只新增一个业务字段：

```ts
interface OutlineItem {
  id: string;
  title: string;
  description?: string;
  children?: OutlineItem[];
  content?: string;
  manual_input_required?: boolean;
}
```

规则：

- 固定表格和承诺函节点必须设置 `manual_input_required = true`；
- 其他节点缺省为 `false`；
- 该字段不表示标题、顺序、层级或正文被程序锁定；
- 用户可在 Step03 将误判节点切换为 AI 编写或人工填写；
- 重新编号、移动或保存目录时必须保留该字段；
- 持久化复用 `technical_plan_outline_nodes.format_constraints_json`，只要求保存该布尔值；不新增列。

### 3.4 评分覆盖

技术评分项首先映射到已经确定的一级目录，再在其下新增二级及以下节点。目录生成、知识库补充、Agent 修复和最终审查均不得新增一级目录。

最低校验要求：

1. 一级目录非空；
2. 每个一级目录都来源于当前分支允许的上下文；
3. 所有技术评分项至少映射到一个二级或更深节点；
4. `manual_input_required` 只能是布尔值；
5. 四级目录不得继续包含子节点。

校验不要求模型返回来源 ID，也不执行招标原文逐字比对。

## 4. Step05 正文契约

### 4.1 普通节点

`manual_input_required !== true` 的叶子节点进入现有正文生成、单节重新生成、扩写、原方案优化、最低字数补充、表格清理和配图流程。

正文允许改写、扩写、调序、合并和专业化表达，不要求与招标文件或知识库素材逐字一致，但不得虚构项目事实和证明材料。

### 4.2 人工填写节点

`manual_input_required === true` 的节点：

- 不进入批量正文 AI 目标集合；
- 单节 AI 生成、重新生成和扩写入口禁用；
- 不进入自动一致性修复、最低字数补充、表格清理或配图改写；
- 使用普通 Markdown 编辑器人工填写；
- 保存仍走现有章节正文保存接口；
- 不需要 `template_id`、确认状态、slot/cell 值或专用保存 IPC。

若用户尝试调用 AI 操作，返回：

```text
该章节需要人工填写，不能使用 AI 生成或改写。
```

### 4.3 导出

导出继续读取权威 Store。若存在 `manual_input_required === true` 且正文为空的节点，阻止导出并返回节点标题列表：

```text
以下章节需要人工填写后才能导出：{节点标题列表}
```

正文非空即可通过该项检查。系统不比较招标原文、不验证固定表头或承诺文字、不计算模板 Hash。

## 5. UI 与 IPC

本次不新增专用 IPC。现有接口只需携带 `manual_input_required`：

- 目录生成返回与 Store 保存；
- 目录编辑保存；
- 技术方案状态加载；
- 正文页面选择节点；
- Word 导出前完整性检查。

Renderer 类型同步 `OutlineItem.manual_input_required`。Main/Renderer 不再暴露或消费：

- `selectedFormatProfileId`、`selectedFormatProfileHash`；
- 新生成的 `responseTemplates`；
- 固定模板确认、slot 保存和 fixed table 保存入口。

历史字段可继续出现在旧工作区加载结果中，但新 UI 不显示旧 profile 和模板操作。

## 6. 失效规则

| 变化 | 必须清理 |
| --- | --- |
| `responseFileRequirements` 内容变化 | 目录、全局事实、正文任务、正文计划、正文运行态、正文和配图计划 |
| 有/无明确格式判断变化 | 同上 |
| 无明确格式时参考知识库文档选择变化 | 同上 |
| 一级目录变化 | 正文及全部正文运行缓存 |
| `manual_input_required` 变化 | 对应节点正文任务状态、正文计划和自动处理缓存 |

相同输入和相同目录不重复清理。

## 7. 兼容规则

- SQLite 保持 v18。
- 历史 `bidDocumentFormatRequirements`、profile、模板和旧响应模式数据不删除。
- 新任务成功后以 `responseFileRequirements` 为唯一格式要求来源。
- 新目录不生成 `format_node_id`、`source_number`、锁定字段、`response_mode` 或 `template_id`。
- 加载旧目录时保留其正文；只有用户重新生成目录后才应用新契约。
- 不得把旧 `bidDocumentFormatRequirements` JSON 自动转换成新的 Markdown 成功结果。

## 8. 验收用例

1. `responseFileRequirements` 在任务元数据中是第 3 个关键项、Markdown 输出、UI 名称“格式要求”。
2. 解析请求不包含 source catalog，模型/API 调用只有一次普通 Markdown 请求。
3. 缺失或非法目录状态首行不能保存为成功，不猜测分支。
4. 明确格式 fixture 的一级目录来自格式要求，评分项只生成二级及以下。
5. 无格式 fixture 使用所选知识库目录生成一级目录，评分项只生成二级及以下。
6. 无格式且知识库为空时返回固定中文错误，AI 目录请求次数为 0。
7. 多份知识库文档只使用已选文档，并能综合为一套一级目录。
8. 固定表格和承诺函节点被标记人工填写，正文 AI 调用次数为 0。
9. 人工节点可以通过普通 Markdown 编辑器保存；空内容阻止导出，非空允许导出。
10. 普通正文仍允许生成、扩写、保存和导出。
11. 旧 v18 工作区可加载，旧 profile/template 数据不驱动新流程。
