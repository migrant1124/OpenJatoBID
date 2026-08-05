const crypto = require('node:crypto');

const ILLUSTRATION_PLAN_VERSION = 9;
const ROOT_PARENT_ID = '__root__';
const ILLUSTRATION_KINDS = ['html', 'ai'];
const VISUAL_STYLES = ['技术研究', '管理咨询', '工程建设', '市场营销', '党群阵地', '工会活动', '安监环'];
const LONG_TEXT_SECTION_MIN_CHARS = 1600;
const MAX_LONG_TEXT_WITHOUT_IMAGE_COUNT = 1;
const MAX_LONG_TEXT_WITHOUT_IMAGE_RATIO = 0.25;
// 全文风格只按项目专业对象和核心成果识别，通用工作动作不参与判断。
const VISUAL_STYLE_PROFILES = [
  {
    name: '技术研究',
    definition: '科研、技术攻关、技术验证或数字技术研发，核心成果是研究结论、技术模型、原型或验证结果。',
    palette: '专业深蓝 #1F4E79，辅以冷灰和理性数据网格。',
    signals: ['科研课题', '技术攻关', '试验验证', '实验验证', '仿真验证', '算法模型', '原型系统', '研究报告', '技术研究', '科研创新'],
  },
  {
    name: '管理咨询',
    definition: '企业治理、组织运营、战略、制度、流程、绩效或内控咨询，核心成果是管理诊断、管理方案或制度流程成果。',
    palette: '稳重藏蓝 #233E63，辅以石墨灰和清晰信息层级。',
    signals: ['管理诊断', '战略规划', '组织优化', '流程再造', '制度体系', '绩效体系', '运营提升', '内控合规'],
  },
  {
    name: '工程建设',
    definition: '实体工程、基建、施工、安装、改造、运维或设备实施，核心成果是工程实体、设备设施或工程交付。',
    palette: '工程蓝 #245B82，辅以钢灰和结构化线条。',
    signals: ['工程建设', '勘察设计', '施工组织', '土建工程', '安装调试', '工程改造', '设备设施', '竣工验收'],
  },
  {
    name: '市场营销',
    definition: '市场拓展、品牌传播、客户运营、推广活动或销售转化，核心成果是营销传播、客户运营或市场转化成果。',
    palette: '品牌蓝 #146BC3，辅以暖橙作为重点强调。',
    signals: ['市场营销', '市场调研', '品牌定位', '品牌传播', '营销策划', '客户运营', '渠道推广', '市场推广', '招商推广'],
  },
  {
    name: '党群阵地',
    definition: '党的建设、思想政治、党员教育或党群文化阵地，核心对象必须是党组织、党员或党群服务。',
    palette: '党建红 #C8262D，辅以庄重金色点缀。',
    signals: ['党的建设', '党建', '党组织', '党员', '三会一课', '主题党日', '思想政治', '廉洁教育', '党群服务', '党建阵地'],
  },
  {
    name: '工会活动',
    definition: '工会组织及职工权益、服务、关爱或文体活动，核心对象必须是工会或职工服务。',
    palette: '工会蓝绿 #1677C8，辅以活力绿色点缀。',
    signals: ['工会', '职代会', '职工之家', '职工代表', '职工权益', '困难帮扶', '劳模工匠', '职工文体'],
  },
  {
    name: '安监环',
    definition: '安全生产、安全文化、生态环境或职业健康及其专业治理，核心成果是对应的创建、标准化、体系或专业交付物。',
    palette: '安全绿 #257A4B，辅以环保青绿和警示黄的克制强调。',
    signals: ['安全文化建设示范企业', '安全文化建设与评价', '安全生产标准化', '双重预防机制', '安全生产', '安全文化', '安健环', 'EHS', 'HSE', '环境保护', '生态环境', '职业健康', '隐患排查治理'],
  },
];
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

function buildVisualStyleProfilePrompt() {
  return VISUAL_STYLE_PROFILES.map((profile) => `- ${profile.name}：${profile.definition} 强识别依据：${profile.signals.join('、')}。`).join('\n');
}

function resolveVisualStyleRecommendation(context) {
  const input = context?.illustrationInput || {};
  const sources = [
    {
      label: '项目名称及概述',
      weight: 4,
      text: [input.project_name, input.project_overview].filter(Boolean).join('\n'),
    },
    {
      label: '评分项与目录',
      weight: 1,
      text: [
        ...(input.scoring_points || []).flatMap((item) => [item.title, ...(item.high_score_conditions || [])]),
        ...(input.sections || []).map((item) => item.title),
      ].filter(Boolean).join('\n'),
    },
  ];
  const candidates = VISUAL_STYLE_PROFILES.map((profile) => {
    const matched = [];
    let score = 0;
    for (const source of sources) {
      for (const signal of profile.signals) {
        if (source.text.includes(signal)) {
          score += source.weight;
          matched.push({ signal, source: source.label });
        }
      }
    }
    return { profile, score, matched };
  }).filter((candidate) => candidate.score > 0);
  if (!candidates.length) return undefined;
  candidates.sort((left, right) => right.score - left.score || right.matched.length - left.matched.length);
  if (candidates.length > 1 && candidates[0].score === candidates[1].score) return undefined;
  const selected = candidates[0];
  return {
    style: selected.profile.name,
    evidence: selected.matched.slice(0, 2).map((item) => item.signal),
  };
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
      content_length: section.contentLength,
      content_block_count: section.blocks.length,
      long_text_requires_image: section.contentLength >= LONG_TEXT_SECTION_MIN_CHARS,
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
      const eligible = Boolean(isLeaf
        && item?.manual_input_required !== true
        && content
        && sections?.[id]?.status !== 'error');
      const order = eligibleSectionIds.length;
      const contentPlan = resolveContentPlan(contentPlans, id);
      const blocks = eligible ? splitContentBlocks(content, getNextBlockId) : [];
      const contentLength = blocks.reduce((total, block) => total + String(block.content || '').length, 0);

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
        contentLength,
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
  const allowedHtmlTypes = resolveAllowedHtmlTypes(options?.htmlImageTypes);
  const config = {
    ai: {
      enabled: Boolean(options?.useAiImages ?? true) && Boolean(aiImagesAvailable),
      allowed_types: [...AI_IMAGE_TYPES],
      type_descriptions: AI_IMAGE_TYPE_DESCRIPTIONS,
    },
    html: {
      enabled: Boolean(options?.useHtmlImages ?? true) && allowedHtmlTypes.length > 0,
      allowed_types: allowedHtmlTypes,
    },
    eligible_section_ids: eligibleSectionIds,
  };
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
    illustrationInput,
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
- illustration-config.json：图片类型是否启用和允许类型。
- illustration-input.json：章节写作合同摘要、评分点、增值锚点、全局事实和可用正文块；创意图片必须据此形成独立 Creative Brief。

工作要求：
1. 图片有 AI、HTML 两类；由正文价值、评分关联、信息可视化必要性决定各自数量，不设程序数量上限，不为凑数量编排图片，也不因另一类图片数量压缩本类图片。
2. 当 AI 和 HTML 均启用时，AI 图片不能明显偏少。对于包含设备、材料、生产、安装、检验、包装运输、现场施工、验收、维保等实物或现场场景的技术方案，应主动编排一定比例 AI 图片；AI 图片数量原则上应接近有效图片总量的 25%-35%，但不得为了凑数生成无信息价值图片。
3. AI 图片优先选择现场安装、站内复核、标识固定节点、材料入厂检验、生产加工设备、表面处理/装配产线、包装运输、防腐抗风节点、巡检维保、质量抽检、验收移交、安全交底和作业许可场景。除非正文明确涉及监控中心、调度大屏或会议评审，不要生成蓝色大屏控制室、会议室、泛化商务汇报场景。
4. kind 只能是 html、ai；image_type 必须来自对应 allowed_types。先阅读 type_descriptions 的中文适用范围，不得按英文单词猜测。
5. 每项必须有简洁且不重复的 title、visual_role 和 purpose。图片必须能明确回答“帮助评委更快理解或相信什么”；不能回答时不要编排。
6. 长文小节是重要配图触发条件。illustration-input.json 中 content_length >= 1600 或 long_text_requires_image=true 的小节，原则上必须至少安排 1 张图片；不能让大量长段落或长小节无配图。长文含流程、清单、对比、职责、工期、风险时优先 HTML，长文含设备、安装、检查、验收、维保、现场动作时优先 AI。
7. 同一小节的图片应各自承担清晰且不重复的 visual_role；避免无价值重复，但不要以程序配额、跨引擎优先级或另一类图片数量删除有效图片。
8. HTML 多节图片必须属于同一直接父目录，且小节必须连续；跨父目录内容应拆成多张 HTML 图片，或只选择最核心的一组连续小节。AI 图片只能编排到一个小节。
9. scoring_point_ids 和 value_anchor_ids 只能引用 illustration-input.json 中存在且与所选章节相关的 ID；无关联时返回空数组。
10. anchor 必须引用真实 section_id。before_block / after_block 的 block_id 必须来自该节的 content_blocks；after_heading 和 section_end 不填写 block_id；sequence 为同一锚点的从小到大顺序。
11. AI 图片用于工程节点、现场安装、设备材料、检查验收、巡检维保、包装运输、安全作业等实物或现场场景；安健环标识类项目中，AI 图片应更多表现变电站现场、标识牌安装、材料与设备、检测与维保动作。HTML 用于精确结构、数据、流程、矩阵、清单、甘特图、组织关系和对比表。
12. 创意 AI 类型 campaign_key_visual、event_scene_render、spatial_concept_render、poster_concept、social_media_mockup、brand_touchpoint_mockup、storyboard、creative_style_board 必须提供 creative_brief。未在输入中确认的客户、场地、受众、品牌色或资产必须写入 needs_user_confirmation，不得虚构事实。
13. Creative Brief 禁止伪造 Logo、品牌标识、真实案例、人物或场地；不得依赖 AI 图片生成关键中文文字。没有提供资产时 brand_assets 留空并采用无 Logo 设计。
14. priority 只能是 1-5 的整数，5 表示信息价值最高。输出前核对 section_ids、anchor、标题、视觉角色和评分关联均有效。
15. visual_style 只能从下列预设中选择一个，或在证据不足时输出空字符串。必须按项目标的、核心成果、评分重点和明确交付物判断；创建、评价、评审、风险、现场、管理、体系、方案、培训、宣传、验收、咨询等通用工作动作不得单独用于风格判断。
${buildVisualStyleProfilePrompt()}
16. 只创建 illustration-plan.json，不修改输入文件，不创建其他结果文件。

illustration-plan.json 只能使用以下结构：
{
  "visual_style": "",
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
  if (!ILLUSTRATION_KINDS.includes(candidate.kind) || !config?.enabled) {
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
  const anchorSection = context.sectionMap.get(candidate.anchor.section_id);
  const anchorBlock = candidate.anchor.block_id
    ? anchorSection?.blocks.find((block) => block.id === candidate.anchor.block_id)
    : null;
  return {
    ...candidate,
    anchor: {
      ...candidate.anchor,
      ...(anchorBlock ? { block_hash: anchorBlock.hash } : {}),
    },
    firstOrder: anchorSection?.order ?? sections[0].order,
  };
}

function visualRoleKey(value) {
  return normalizedTitleKey(value);
}

function visualRhythmDiagnostic(code, message, sectionIds) {
  return { code, message, section_ids: sectionIds };
}

function getLongTextSections(context) {
  return [...context.sectionMap.values()]
    .filter((section) => section.eligible && section.contentLength >= LONG_TEXT_SECTION_MIN_CHARS);
}

function getUncoveredLongTextSectionIds(items, context) {
  const selectedSectionIds = new Set((Array.isArray(items) ? items : []).flatMap((item) => item.section_ids || []));
  return getLongTextSections(context)
    .filter((section) => !selectedSectionIds.has(section.id))
    .map((section) => section.id);
}

function assertLongTextCoverage(items, context) {
  if (!context?.config?.html?.enabled && !context?.config?.ai?.enabled) return;
  const longTextSections = getLongTextSections(context);
  if (!longTextSections.length) return;
  const uncovered = getUncoveredLongTextSectionIds(items, context);
  const uncoveredRatio = uncovered.length / longTextSections.length;
  if (uncovered.length > MAX_LONG_TEXT_WITHOUT_IMAGE_COUNT && uncoveredRatio > MAX_LONG_TEXT_WITHOUT_IMAGE_RATIO) {
    throw new Error(`长文小节配图覆盖不足：${uncovered.length}/${longTextSections.length} 个长文小节未安排配图（${uncovered.slice(0, 8).join('、')}）。长文小节必须优先配图，请补充 HTML 流程/矩阵/清单图或 AI 现场/设备/检查图。`);
  }
}

// 图片编排只给出节奏建议，绝不替用户自动增删、移动或选择图片。
function buildVisualRhythmDiagnostics(items, context) {
  const selected = Array.isArray(items) ? items : [];
  const selectedSectionIds = new Set(selected.flatMap((item) => item.section_ids || []));
  const eligibleSections = [...context.sectionMap.values()].filter((section) => section.eligible);
  const diagnostics = [];
  const highValueWithoutImage = eligibleSections
    .filter((section) => (section.scoring_point_ids.length || section.value_anchor_ids.length) && !selectedSectionIds.has(section.id))
    .map((section) => section.id);
  if (highValueWithoutImage.length) {
    diagnostics.push(visualRhythmDiagnostic('high-value-without-image', `有 ${highValueWithoutImage.length} 个评分或价值重点章节未安排配图，可检查是否需要补充结构化展示。`, highValueWithoutImage));
  }
  const longTextWithoutImage = getUncoveredLongTextSectionIds(selected, context);
  if (longTextWithoutImage.length) {
    diagnostics.push(visualRhythmDiagnostic('long-text-without-image', `有 ${longTextWithoutImage.length} 个长篇纯文字章节未安排配图，可按内容价值考虑流程、矩阵或场景展示。`, longTextWithoutImage));
  }
  const repeatedRoles = selected.reduce((groups, item) => {
    const key = visualRoleKey(item.visual_role);
    const list = groups.get(key) || [];
    list.push(item);
    groups.set(key, list);
    return groups;
  }, new Map());
  const repeatedRoleItemIds = [...repeatedRoles.values()]
    .filter((group) => group.length >= 3)
    .flatMap((group) => group.map((item) => item.item_id));
  if (repeatedRoleItemIds.length) {
    diagnostics.push(visualRhythmDiagnostic('repeated-visual-role', `有 ${repeatedRoleItemIds.length} 张图片使用相近视觉作用，请确认跨章节展示是否仍有必要。`, repeatedRoleItemIds));
  }
  const opening = eligibleSections.slice(0, Math.min(2, eligibleSections.length)).map((section) => section.id);
  const implementation = eligibleSections.filter((section) => /实施|执行|技术|服务方案/u.test(section.title)).map((section) => section.id);
  const assurance = eligibleSections.filter((section) => /保障|质量|安全|承诺|风险/u.test(section.title)).map((section) => section.id);
  for (const [code, label, sectionIds] of [
    ['opening-coverage', '开篇', opening],
    ['implementation-coverage', '核心实施', implementation],
    ['assurance-coverage', '保障环节', assurance],
  ]) {
    if (sectionIds.length && !sectionIds.some((id) => selectedSectionIds.has(id))) {
      diagnostics.push(visualRhythmDiagnostic(code, `${label}尚无配图覆盖，可结合内容价值判断是否需要补充。`, sectionIds));
    }
  }
  return diagnostics;
}

// 解析、严格校验并根据全文上限、同节安全上限和信息角色去重选择图片计划。
function resolveIllustrationPlan(content, context) {
  const parsed = typeof content === 'string' ? extractJsonObject(content) : content;
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.items)) {
    throw new Error('Agent 图片编排结果缺少 items 数组');
  }
  const extraRootFields = Object.keys(parsed).filter((key) => !['items', 'visual_style'].includes(key));
  if (extraRootFields.length) throw new Error(`Agent 图片编排结果包含多余字段：${extraRootFields.join(', ')}`);
  const agentVisualStyle = String(parsed.visual_style || '').trim();
  if (agentVisualStyle && !VISUAL_STYLES.includes(agentVisualStyle)) {
    throw new Error(`Agent 图片编排视觉风格无效：${agentVisualStyle}`);
  }

  const allowedFields = new Set([
    'kind', 'image_type', 'title', 'section_ids', 'visual_role', 'purpose', 'scoring_point_ids',
    'value_anchor_ids', 'priority', 'anchor', 'aspect_ratio', 'creative_brief',
  ]);
  const candidates = parsed.items.map((item, index) => {
    const extraFields = Object.keys(item || {}).filter((key) => !allowedFields.has(key));
    if (extraFields.length) throw new Error(`图片候选包含多余字段：${extraFields.join(', ')}`);
    return validateCandidate(normalizeCandidate(item, index), context);
  });

  const candidateStats = { html: 0, ai: 0 };
  for (const candidate of candidates) candidateStats[candidate.kind] += 1;
  const selected = [...candidates].sort((a, b) => a.firstOrder - b.firstOrder
    || a.anchor.sequence - b.anchor.sequence
    || a.outputIndex - b.outputIndex);
  const selectedStats = { ...candidateStats };
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
  const planItemsWithIds = planItems.map((item) => ({
    item_id: stableHash(item).slice(0, 24),
    ...item,
    selected: true,
    generation: { status: 'pending' },
  }));
  assertLongTextCoverage(planItemsWithIds, context);
  const visualRhythmDiagnostics = buildVisualRhythmDiagnostics(planItemsWithIds, context);
  const visualStyleRecommendation = resolveVisualStyleRecommendation(context);
  const revision = stableHash({ items: planItems, visualRhythmDiagnostics }).slice(0, 24);
  return {
    plan: {
      plan_version: ILLUSTRATION_PLAN_VERSION,
      revision,
      confirmation_status: 'pending',
      recommended_visual_style: visualStyleRecommendation?.style,
      recommended_visual_style_evidence: visualStyleRecommendation?.evidence,
      visual_rhythm_diagnostics: visualRhythmDiagnostics,
      items: planItemsWithIds,
      updated_at: new Date().toISOString(),
    },
    stats: { candidate: candidateStats, selected: selectedStats },
  };
}

module.exports = {
  ILLUSTRATION_PLAN_VERSION,
  VISUAL_STYLES,
  VISUAL_STYLE_PROFILES,
  buildIllustrationPlanningContext,
  buildIllustrationPlanningPrompt,
  buildVisualRhythmDiagnostics,
  parseHtmlImageTypes,
  resolveVisualStyleRecommendation,
  resolveIllustrationPlan,
};
