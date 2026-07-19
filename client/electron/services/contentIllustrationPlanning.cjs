const crypto = require('node:crypto');

const ILLUSTRATION_PLAN_VERSION = 4;
const ROOT_PARENT_ID = '__root__';
const ILLUSTRATION_KINDS = ['html', 'ai', 'mermaid'];
const ILLUSTRATION_KIND_ORDER = new Map(ILLUSTRATION_KINDS.map((kind, index) => [kind, index]));
const AI_IMAGE_TYPES = new Set([
  'engineering_diagram',
  'realistic_photo',
  'campaign_key_visual',
  'event_scene_render',
  'spatial_concept_render',
  'poster_concept',
  'social_media_mockup',
  'brand_touchpoint_mockup',
  'storyboard',
  'creative_style_board',
]);
const CREATIVE_AI_IMAGE_TYPES = new Set([
  'campaign_key_visual',
  'event_scene_render',
  'spatial_concept_render',
  'poster_concept',
  'social_media_mockup',
  'brand_touchpoint_mockup',
  'storyboard',
  'creative_style_board',
]);
const MERMAID_IMAGE_TYPES = new Set(['process', 'hierarchy', 'responsibility']);
const AI_IMAGE_TYPE_DESCRIPTIONS = {
  engineering_diagram: '专业工程图示：用于展示设备、系统组件、部署位置、连接关系或工程实施场景，强调结构与关系；不用于步骤流转、组织层级或职责分工。',
  realistic_photo: '专业实景图片：用于表现设备、机房、监控中心、施工、巡检或维护现场等可真实拍摄的对象和环境；不用于抽象系统架构、流程或组织关系。',
  campaign_key_visual: '活动或宣传主视觉方案：用于活动主题、传播主张和主视觉方向；不得让模型绘制关键中文文字或伪造 Logo。',
  event_scene_render: '活动现场、舞台、展区或执行场景效果图：用于表现活动现场和执行场景；不能把未确认场地或真实案例伪造为既定事实。',
  spatial_concept_render: '空间、展陈、动线和功能区概念图：用于空间布局、功能分区和参观动线；需要区分概念方案与已落地事实。',
  poster_concept: '海报设计方向：用于展示海报创意方向和视觉构图；不直接生成最终印刷成品中的关键中文文案。',
  social_media_mockup: '社交媒体传播物料组合：用于公众号、短视频和社媒传播物料方向；不生成仿冒账号、品牌标识或无法核实的数据。',
  brand_touchpoint_mockup: '物料、展板、礼品、导视和终端触点效果：用于展示品牌触点延展；无用户提供资产时采用无 Logo 设计。',
  storyboard: '宣传片、短视频、直播或活动流程分镜：用于表达镜头或活动节奏；不得虚构真实人物、场地或案例。',
  creative_style_board: '创意风格与视觉情绪板：用于色彩、材质、摄影、字体和视觉情绪方向；不代替最终品牌规范。',
};
const MERMAID_IMAGE_TYPE_DESCRIPTIONS = {
  process: '流程图：用于表达按先后顺序发生的步骤、判断、流转和闭环处理过程；不用于静态系统拓扑或人员层级。',
  hierarchy: '层级图：用于表达组织、系统模块、资源分类等上下级或包含关系；不用于时间顺序或职责矩阵。',
  responsibility: '职责关系图：用于表达角色、岗位、责任边界和协作关系；不用于设备拓扑或纯流程步骤。',
};
const HTML_IMAGE_TYPE_LABELS = new Map([
  ['gantt', '甘特图'],
  ['network', '进度网络图'],
  ['organization', '组织架构图'],
  ['swimlane', '泳道图'],
  ['raci', 'RACI 职责矩阵'],
  ['risk-matrix', '风险矩阵'],
  ['architecture', '系统架构与拓扑图'],
  ['wbs', 'WBS 工作分解结构图'],
  ['fishbone', '鱼骨图'],
  ['timeline', '时间轴'],
  ['process', '流程图'],
  ['hierarchy', '层级图'],
  ['responsibility', '职责关系图'],
  ['bar', '柱状图'],
  ['line', '折线图'],
  ['pie', '饼图'],
  ['table', '数据表'],
]);
const HTML_IMAGE_TYPE_VALUES = new Set(HTML_IMAGE_TYPE_LABELS.values());

function singleLine(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizedTitleKey(value) {
  return singleLine(value).toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

function stableHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

// 解析用户允许的 HTML 图片类型。
function parseHtmlImageTypes(value) {
  return [...new Set(String(value || '').split(/[\n,，、;；]+/).map(singleLine).filter(Boolean))];
}

function resolveAllowedHtmlTypes(value) {
  const selectedTypes = parseHtmlImageTypes(value);
  const allowedTypes = selectedTypes.map((type) => HTML_IMAGE_TYPE_LABELS.get(type) || (HTML_IMAGE_TYPE_VALUES.has(type) ? type : '')).filter(Boolean);
  return allowedTypes.length ? [...new Set(allowedTypes)] : [...HTML_IMAGE_TYPE_LABELS.values()];
}

function normalizeLimit(value, fallback, sectionCount) {
  const number = Number(value);
  return Math.max(0, Math.min(Number.isFinite(number) ? Math.round(number) : fallback, sectionCount));
}

function resolveSectionContent(item, sections) {
  return String(sections?.[item.id]?.content || item?.content || '').trim();
}

function uniqueStrings(value) {
  return [...new Set((Array.isArray(value) ? value : []).map(singleLine).filter(Boolean))];
}

function resolveContentPlan(contentPlans, itemId) {
  const stored = contentPlans?.[itemId];
  return stored?.plan && typeof stored.plan === 'object' ? stored.plan : (stored || {});
}

function contentBlockType(content) {
  const text = String(content || '').trim();
  if (/^\s*\|.+\|\s*$/mu.test(text)) return 'markdown-table';
  if (/^\s*<table\b/imu.test(text)) return 'html-table';
  if (/^\s*(?:[-*+] |\d+[.)] )/mu.test(text)) return 'list';
  if (/yibiao-illustration:start/iu.test(text)) return 'existing-illustration-placeholder';
  return 'paragraph';
}

function splitContentBlocks(content, getNextBlockId) {
  return String(content || '').trim().split(/\n{2,}/u).map((part) => part.trim()).filter(Boolean).map((part) => ({
    id: getNextBlockId(),
    type: contentBlockType(part),
    hash: stableHash(part).slice(0, 16),
    content: part,
  }));
}

function buildIllustrationInput({ outlineData, contentPlans, requirementResponseMatrix, globalFacts, sectionMap }) {
  const matrix = requirementResponseMatrix || {};
  const knownScoringPoints = (matrix.scoring_points || []).map((point) => ({
    scoring_point_id: String(point?.scoring_point_id || ''),
    title: singleLine(point?.title),
    high_score_conditions: uniqueStrings(point?.high_score_conditions),
  })).filter((point) => point.scoring_point_id);
  const knownValueAnchors = (matrix.value_anchors || []).map((anchor) => ({
    anchor_id: String(anchor?.anchor_id || ''),
    title: singleLine(anchor?.title),
    route: String(anchor?.route || ''),
    status: String(anchor?.status || ''),
  })).filter((anchor) => anchor.anchor_id);
  const sections = [...sectionMap.values()].filter((section) => section.eligible).map((section) => {
    const plan = resolveContentPlan(contentPlans, section.id);
    return {
      section_id: section.id,
      title: section.title,
      writing_profile: String(plan?.writing_profile || section.writing_profile || 'standard'),
      scoring_point_ids: uniqueStrings(plan?.scoring_point_ids || section.scoring_point_ids),
      value_anchor_ids: uniqueStrings(plan?.value_anchor_ids || section.value_anchor_ids),
      illustration_briefs: Array.isArray(plan?.illustration_briefs) ? plan.illustration_briefs : [],
      content_blocks: section.blocks.map(({ id, type, hash }) => ({ id, type, hash })),
    };
  });
  return {
    project_name: singleLine(outlineData?.project_name),
    project_overview: String(outlineData?.project_overview || '').trim(),
    global_facts: (Array.isArray(globalFacts) ? globalFacts : []).map((item) => ({
      title: singleLine(item?.title), content: String(item?.content || '').trim(),
    })).filter((item) => item.title || item.content),
    scoring_points: knownScoringPoints,
    value_anchors: knownValueAnchors,
    sections,
  };
}

// 从真实目录树构建 Agent 输入和程序校验索引。
function buildIllustrationPlanningContext({ outlineData, sections, options, aiImagesAvailable = false, contentPlans, requirementResponseMatrix, globalFacts }) {
  const sectionMap = new Map();
  const eligibleSectionIds = [];
  const markdownLines = ['# 技术方案正文', ''];
  let nextBlockNumber = 1;
  const getNextBlockId = () => `B${String(nextBlockNumber++).padStart(3, '0')}`;

  function visit(items, parentId = ROOT_PARENT_ID, depth = 1) {
    return (Array.isArray(items) ? items : []).map((item, siblingIndex) => {
      const id = String(item?.id || '').trim();
      const title = singleLine(item?.title || '未命名章节');
      const description = String(item?.description || '').trim();
      const children = Array.isArray(item?.children) ? item.children : [];
      const isLeaf = children.length === 0;
      const content = isLeaf ? resolveSectionContent(item, sections) : '';
      const responseMode = item?.response_mode || 'freeform-markdown';
      const eligible = Boolean(isLeaf
        && responseMode === 'freeform-markdown'
        && content
        && sections?.[id]?.status !== 'error');
      const order = eligibleSectionIds.length;
      const contentPlan = resolveContentPlan(contentPlans, id);
      const blocks = eligible ? splitContentBlocks(content, getNextBlockId) : [];

      markdownLines.push(`${'#'.repeat(Math.min(depth + 1, 6))} ${id} ${title}`.trim());
      markdownLines.push('');
      if (eligible) {
        markdownLines.push(`<!-- yibiao-section-start id="${id}" -->`);
        for (const block of blocks) {
          markdownLines.push(`<!-- yibiao-content-block id="${block.id}" type="${block.type}" hash="${block.hash}" -->`);
          markdownLines.push(block.content);
          markdownLines.push('<!-- /yibiao-content-block -->');
          markdownLines.push('');
        }
        markdownLines.push(`<!-- yibiao-section-end id="${id}" -->`);
        markdownLines.push('');
      }

      sectionMap.set(id, {
        id,
        parentId,
        siblingIndex,
        order,
        isLeaf,
        eligible,
        title,
        writing_profile: String(contentPlan?.writing_profile || item?.writing_profile || 'standard'),
        scoring_point_ids: uniqueStrings(contentPlan?.scoring_point_ids || item?.mapped_scoring_point_ids),
        value_anchor_ids: uniqueStrings(contentPlan?.value_anchor_ids || item?.value_anchor_ids),
        blocks,
      });
      if (eligible) eligibleSectionIds.push(id);

      return {
        id,
        title,
        description,
        leaf: isLeaf,
        eligible,
        ...(children.length ? { children: visit(children, id, depth + 1) } : {}),
      };
    });
  }

  const outline = visit(outlineData?.outline || []);
  const eligibleCount = eligibleSectionIds.length;
  const allowedHtmlTypes = resolveAllowedHtmlTypes(options?.htmlImageTypes);
  const config = {
    ai: {
      enabled: Boolean(options?.useAiImages) && Boolean(aiImagesAvailable),
      limit: normalizeLimit(options?.maxAiImages, 6, eligibleCount),
      allowed_types: [...AI_IMAGE_TYPES],
      type_descriptions: AI_IMAGE_TYPE_DESCRIPTIONS,
    },
    mermaid: {
      enabled: Boolean(options?.useMermaidImages),
      limit: normalizeLimit(options?.maxMermaidImages, 5, eligibleCount),
      allowed_types: [...MERMAID_IMAGE_TYPES],
      type_descriptions: MERMAID_IMAGE_TYPE_DESCRIPTIONS,
    },
    html: {
      enabled: Boolean(options?.useHtmlImages) && allowedHtmlTypes.length > 0,
      limit: normalizeLimit(options?.maxHtmlImages, 10, eligibleCount),
      allowed_types: allowedHtmlTypes,
    },
    eligible_section_ids: eligibleSectionIds,
  };
  for (const kind of ILLUSTRATION_KINDS) {
    if (config[kind].limit <= 0) config[kind].enabled = false;
  }

  const illustrationInput = buildIllustrationInput({
    outlineData,
    contentPlans,
    requirementResponseMatrix,
    globalFacts,
    sectionMap,
  });

  return {
    sectionMap,
    eligibleSectionIds,
    config,
    files: [
      { path: 'technical-plan.md', content: markdownLines.join('\n').trim() },
      {
        path: 'outline-tree.json',
        content: JSON.stringify({
          project_name: singleLine(outlineData?.project_name),
          project_overview: String(outlineData?.project_overview || '').trim(),
          outline,
        }, null, 2),
      },
      { path: 'illustration-config.json', content: JSON.stringify(config, null, 2) },
      { path: 'illustration-input.json', content: JSON.stringify(illustrationInput, null, 2) },
    ],
    knownScoringPointIds: new Set(illustrationInput.scoring_points.map((item) => item.scoring_point_id)),
    knownValueAnchorIds: new Set(illustrationInput.value_anchors.map((item) => item.anchor_id)),
  };
}

// 构建 Agent 全文图片编排任务说明。
function buildIllustrationPlanningPrompt() {
  return `请基于工作目录中的四个输入文件完成投标文件技术方案的全文图片编排：

- technical-plan.md：投标文件全文；可写叶子小节由 yibiao-section-start / yibiao-section-end 标记，正文块由 yibiao-content-block 标记。
- outline-tree.json：目录树，用于核对目录 ID、父子关系和顺序。
- illustration-config.json：图片类型是否启用、允许类型和全文硬上限。
- illustration-input.json：章节写作合同摘要、评分点、增值锚点、全局事实和可用正文块；创意图片必须据此形成独立 Creative Brief。

工作要求：
1. 图片有 AI、Mermaid、HTML 三类；每类数量可低于上限，数量上限不是必须填满的目标。
2. kind 只能是 html、mermaid、ai；image_type 必须来自对应 allowed_types。先阅读 type_descriptions 的中文适用范围，不得按英文单词猜测。
3. 每项必须有简洁且不重复的 title、visual_role 和 purpose。图片必须能明确回答“帮助评委更快理解或相信什么”；不能回答时不要编排。
4. scoring_point_ids 和 value_anchor_ids 只能引用 illustration-input.json 中存在且与所选章节相关的 ID；无关联时返回空数组。
5. anchor 必须引用真实 section_id。before_block / after_block 的 block_id 必须来自该节的 content_blocks；after_heading 和 section_end 不填写 block_id；sequence 为同一锚点的从小到大顺序。
6. AI 图片适合工程、现场、创意场景、空间和视觉概念；Mermaid 只用于简单流程、层级和职责关系；HTML 用于精确结构、数据、流程和矩阵。
7. 创意 AI 类型 campaign_key_visual、event_scene_render、spatial_concept_render、poster_concept、social_media_mockup、brand_touchpoint_mockup、storyboard、creative_style_board 必须提供 creative_brief。未在输入中确认的客户、场地、受众、品牌色或资产必须写入 needs_user_confirmation，不得虚构事实。
8. Creative Brief 禁止伪造 Logo、品牌标识、真实案例、人物或场地；不得依赖 AI 图片生成关键中文文字。没有提供资产时 brand_assets 留空并采用无 Logo 设计。
9. priority 只能是 1-5 的整数，5 表示信息价值最高。输出前核对 section_ids、anchor、标题、视觉角色和评分关联均有效。
10. 只创建 illustration-plan.json，不修改输入文件，不创建其他结果文件。

illustration-plan.json 只能使用以下结构：
{
  "items": [
    {
      "kind": "ai",
      "image_type": "event_scene_render",
      "title": "活动执行场景概念图",
      "section_ids": ["3.2.1"],
      "visual_role": "执行场景",
      "purpose": "帮助评委理解活动执行场景和空间组织",
      "scoring_point_ids": ["R1.P1"],
      "value_anchor_ids": [],
      "priority": 5,
      "anchor": { "type": "after_block", "section_id": "3.2.1", "block_id": "B005", "sequence": 1 },
      "aspect_ratio": "16:9",
      "creative_brief": {
        "client_profile": "未提供则说明待确认",
        "project_goal": "活动执行方案表达",
        "target_audience": ["待确认"],
        "campaign_theme": "主题待确认",
        "key_message": "突出执行场景和服务价值",
        "event_type": "待确认",
        "venue_and_scene": "待确认",
        "mandatory_elements": ["正文明确的执行要素"],
        "prohibited_elements": ["伪造 Logo", "大量关键中文文字"],
        "style_keywords": ["专业", "克制"],
        "brand_colors": [],
        "brand_assets": [],
        "deliverable_type": "活动现场概念图",
        "aspect_ratio": "16:9",
        "source_scoring_point_ids": ["R1.P1"],
        "source_value_anchor_ids": [],
        "needs_user_confirmation": ["客户品牌资产"]
      }
    }
  ]
}`;
}

function extractJsonObject(content) {
  const text = String(content || '').trim();
  if (!text) throw new Error('Agent 图片编排结果为空');
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const source = fenced ? fenced[1].trim() : text;
  try {
    return JSON.parse(source);
  } catch {
    const start = source.indexOf('{');
    if (start < 0) throw new Error('Agent 图片编排结果不是 JSON 对象');
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < source.length; index += 1) {
      const char = source[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === '{') depth += 1;
      else if (char === '}') {
        depth -= 1;
        if (depth === 0) return JSON.parse(source.slice(start, index + 1));
      }
    }
    throw new Error('Agent 图片编排 JSON 不完整');
  }
}

function normalizeCandidate(item, index) {
  const source = item && typeof item === 'object' && !Array.isArray(item) ? item : {};
  return {
    kind: String(source.kind || '').trim(),
    image_type: singleLine(source.image_type),
    title: singleLine(source.title),
    section_ids: Array.isArray(source.section_ids) ? source.section_ids.map((id) => String(id || '').trim()) : [],
    visual_role: singleLine(source.visual_role),
    purpose: singleLine(source.purpose),
    scoring_point_ids: uniqueStrings(source.scoring_point_ids),
    value_anchor_ids: uniqueStrings(source.value_anchor_ids),
    priority: Number(source.priority),
    anchor: source.anchor && typeof source.anchor === 'object' ? {
      type: String(source.anchor.type || '').trim(),
      section_id: String(source.anchor.section_id || '').trim(),
      block_id: String(source.anchor.block_id || '').trim(),
      sequence: Number(source.anchor.sequence),
    } : null,
    aspect_ratio: singleLine(source.aspect_ratio),
    creative_brief: source.creative_brief && typeof source.creative_brief === 'object' ? {
      client_profile: singleLine(source.creative_brief.client_profile),
      project_goal: singleLine(source.creative_brief.project_goal),
      target_audience: uniqueStrings(source.creative_brief.target_audience),
      campaign_theme: singleLine(source.creative_brief.campaign_theme),
      key_message: singleLine(source.creative_brief.key_message),
      event_type: singleLine(source.creative_brief.event_type),
      venue_and_scene: singleLine(source.creative_brief.venue_and_scene),
      mandatory_elements: uniqueStrings(source.creative_brief.mandatory_elements),
      prohibited_elements: uniqueStrings(source.creative_brief.prohibited_elements),
      style_keywords: uniqueStrings(source.creative_brief.style_keywords),
      brand_colors: uniqueStrings(source.creative_brief.brand_colors),
      brand_assets: uniqueStrings(source.creative_brief.brand_assets),
      deliverable_type: singleLine(source.creative_brief.deliverable_type),
      aspect_ratio: singleLine(source.creative_brief.aspect_ratio),
      source_scoring_point_ids: uniqueStrings(source.creative_brief.source_scoring_point_ids),
      source_value_anchor_ids: uniqueStrings(source.creative_brief.source_value_anchor_ids),
      needs_user_confirmation: uniqueStrings(source.creative_brief.needs_user_confirmation),
    } : undefined,
    outputIndex: index,
  };
}

function validateReferenceIds(ids, knownIds, label) {
  const unknown = (ids || []).filter((id) => !knownIds.has(id));
  if (unknown.length) throw new Error(`${label} 包含未知 ID：${unknown.join(', ')}`);
}

function validateAnchor(anchor, candidate, context) {
  if (!anchor || !['before_block', 'after_block', 'after_heading', 'section_end'].includes(anchor.type)) {
    throw new Error('图片候选 anchor.type 无效');
  }
  if (!candidate.section_ids.includes(anchor.section_id)) {
    throw new Error('图片候选 anchor.section_id 必须属于 section_ids');
  }
  if (!Number.isInteger(anchor.sequence) || anchor.sequence < 0) {
    throw new Error('图片候选 anchor.sequence 必须是非负整数');
  }
  const section = context.sectionMap.get(anchor.section_id);
  if (['before_block', 'after_block'].includes(anchor.type)) {
    if (!anchor.block_id || !section?.blocks.some((block) => block.id === anchor.block_id)) {
      throw new Error('图片候选 anchor.block_id 必须是目标小节中的正文块');
    }
  } else if (anchor.block_id) {
    throw new Error('after_heading 或 section_end 锚点不得填写 block_id');
  }
}

function validateCreativeBrief(brief, candidate) {
  if (!brief) throw new Error('创意 AI 图片必须提供 creative_brief');
  const requiredTextFields = ['client_profile', 'project_goal', 'campaign_theme', 'key_message', 'deliverable_type', 'aspect_ratio'];
  for (const field of requiredTextFields) {
    if (!brief[field]) throw new Error(`creative_brief 缺少 ${field}`);
  }
  const requiredArrayFields = ['target_audience', 'mandatory_elements', 'prohibited_elements', 'style_keywords', 'brand_colors', 'brand_assets', 'source_scoring_point_ids', 'source_value_anchor_ids', 'needs_user_confirmation'];
  for (const field of requiredArrayFields) {
    if (!Array.isArray(brief[field])) throw new Error(`creative_brief 缺少 ${field}`);
  }
  if (JSON.stringify(brief.source_scoring_point_ids) !== JSON.stringify(candidate.scoring_point_ids)
    || JSON.stringify(brief.source_value_anchor_ids) !== JSON.stringify(candidate.value_anchor_ids)) {
    throw new Error('creative_brief 的评分点和增值锚点必须与图片计划一致');
  }
}

function validateCandidate(candidate, context) {
  const config = context.config[candidate.kind];
  if (!ILLUSTRATION_KIND_ORDER.has(candidate.kind) || !config?.enabled) {
    throw new Error(`图片候选类型未启用或无效：${candidate.kind || 'empty'}`);
  }
  if (!config.allowed_types.includes(candidate.image_type)) {
    throw new Error(`图片候选 image_type 无效：${candidate.image_type || 'empty'}`);
  }
  if (!candidate.title) {
    throw new Error('图片候选 title 不能为空');
  }
  if (candidate.title.length > 20) {
    throw new Error(`图片候选 title 不能超过 20 个字：${candidate.title}`);
  }
  if (/^图\s*[:：]/u.test(candidate.title)) {
    throw new Error(`图片候选 title 不应包含“图：”前缀：${candidate.title}`);
  }
  if (!Number.isInteger(candidate.priority) || candidate.priority < 1 || candidate.priority > 5) {
    throw new Error('图片候选 priority 必须是 1-5 的整数');
  }
  if (!candidate.visual_role || !candidate.purpose) {
    throw new Error('图片候选必须包含 visual_role 和 purpose');
  }
  if (!candidate.section_ids.length || new Set(candidate.section_ids).size !== candidate.section_ids.length) {
    throw new Error('图片候选 section_ids 不能为空或重复');
  }
  const sections = candidate.section_ids.map((id) => context.sectionMap.get(id));
  if (sections.some((section) => !section?.eligible)) {
    throw new Error(`图片候选包含无效正文小节：${candidate.section_ids.join(', ')}`);
  }
  if (candidate.kind !== 'html' && candidate.section_ids.length !== 1) {
    throw new Error(`${candidate.kind} 图片只能编排到一个小节`);
  }
  if (candidate.kind === 'html' && candidate.section_ids.length > 1) {
    const parentId = sections[0].parentId;
    if (!parentId || sections.some((section) => section.parentId !== parentId)) {
      throw new Error('HTML 多节图片必须属于同一直接父目录');
    }
    for (let index = 1; index < sections.length; index += 1) {
      if (sections[index].siblingIndex !== sections[index - 1].siblingIndex + 1) {
        throw new Error('HTML 多节图片的小节必须按目录顺序连续');
      }
    }
  }
  validateReferenceIds(candidate.scoring_point_ids, context.knownScoringPointIds, 'scoring_point_ids');
  validateReferenceIds(candidate.value_anchor_ids, context.knownValueAnchorIds, 'value_anchor_ids');
  validateAnchor(candidate.anchor, candidate, context);
  if (CREATIVE_AI_IMAGE_TYPES.has(candidate.image_type)) {
    validateCreativeBrief(candidate.creative_brief, candidate);
  }
  return { ...candidate, firstOrder: sections[0].order };
}

// 解析和严格校验图片计划；跨类型同节冲突与多图策略由后续选择阶段处理。
function resolveIllustrationPlan(content, context) {
  const parsed = typeof content === 'string' ? extractJsonObject(content) : content;
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.items)) {
    throw new Error('Agent 图片编排结果缺少 items 数组');
  }
  const extraRootFields = Object.keys(parsed).filter((key) => key !== 'items');
  if (extraRootFields.length) throw new Error(`Agent 图片编排结果包含多余字段：${extraRootFields.join(', ')}`);

  const allowedFields = new Set([
    'kind', 'image_type', 'title', 'section_ids', 'visual_role', 'purpose', 'scoring_point_ids',
    'value_anchor_ids', 'priority', 'anchor', 'aspect_ratio', 'creative_brief',
  ]);
  const candidates = parsed.items.map((item, index) => {
    const extraFields = Object.keys(item || {}).filter((key) => !allowedFields.has(key));
    if (extraFields.length) throw new Error(`图片候选包含多余字段：${extraFields.join(', ')}`);
    return validateCandidate(normalizeCandidate(item, index), context);
  });

  const occupiedSectionIds = new Set();
  const selected = [];
  const candidateStats = { html: 0, ai: 0, mermaid: 0 };
  const selectedStats = { html: 0, ai: 0, mermaid: 0 };
  for (const candidate of candidates) candidateStats[candidate.kind] += 1;

  for (const kind of ILLUSTRATION_KINDS) {
    const sorted = candidates
      .filter((candidate) => candidate.kind === kind)
      .sort((a, b) => b.priority - a.priority || a.firstOrder - b.firstOrder || a.outputIndex - b.outputIndex);
    for (const candidate of sorted) {
      if (selectedStats[kind] >= context.config[kind].limit) continue;
      if (candidate.section_ids.some((id) => occupiedSectionIds.has(id))) continue;
      selected.push(candidate);
      selectedStats[kind] += 1;
      for (const id of candidate.section_ids) occupiedSectionIds.add(id);
    }
  }

  selected.sort((a, b) => a.firstOrder - b.firstOrder
    || ILLUSTRATION_KIND_ORDER.get(a.kind) - ILLUSTRATION_KIND_ORDER.get(b.kind)
    || a.outputIndex - b.outputIndex);
  const titleByKey = new Map();
  for (const candidate of selected) {
    const titleKey = normalizedTitleKey(candidate.title);
    const existingTitle = titleByKey.get(titleKey);
    if (existingTitle) {
      throw new Error(`最终图片计划标题重复：${existingTitle} / ${candidate.title}`);
    }
    titleByKey.set(titleKey, candidate.title);
  }
  const planItems = selected.map(({
    kind, image_type, title, section_ids, visual_role, purpose, scoring_point_ids, value_anchor_ids,
    priority, anchor, aspect_ratio, creative_brief,
  }) => ({
    kind,
    image_type,
    title,
    section_ids,
    visual_role,
    purpose,
    scoring_point_ids,
    value_anchor_ids,
    priority,
    anchor,
    ...(aspect_ratio ? { aspect_ratio } : {}),
    ...(creative_brief ? { creative_brief } : {}),
  }));
  const revision = stableHash(planItems).slice(0, 24);
  return {
    plan: {
      plan_version: ILLUSTRATION_PLAN_VERSION,
      revision,
      items: planItems.map((item) => ({
        item_id: stableHash(item).slice(0, 24),
        ...item,
        generation: { status: 'pending' },
      })),
      updated_at: new Date().toISOString(),
    },
    stats: { candidate: candidateStats, selected: selectedStats },
  };
}

module.exports = {
  ILLUSTRATION_PLAN_VERSION,
  buildIllustrationPlanningContext,
  buildIllustrationPlanningPrompt,
  parseHtmlImageTypes,
  resolveIllustrationPlan,
};
