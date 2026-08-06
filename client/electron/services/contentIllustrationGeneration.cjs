const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { runWithRemoteImageRetry } = require('../utils/remoteImageRetry.cjs');
const { buildChartDslPrompt } = require('./chartDslPrompt.cjs');
const { assertValidChartDsl } = require('./chartDslValidator.cjs');
const { VISUAL_STYLE_PROFILES } = require('./contentIllustrationPlanning.cjs');
const {
  HTML_CAPTURE_SCALE,
  HTML_DESIGN_WIDTH,
  HTML_MAX_DESIGN_HEIGHT,
} = require('./localImageRenderService.cjs');

const HTML_AGENT_THRESHOLD_CHARS = 50000;
const HTML_LAYOUT_REPAIR_ATTEMPTS = 2;
const GENERATED_ILLUSTRATION_PATTERN = /<!-- yibiao-illustration:start\b[^>]*-->[\s\S]*?<!-- yibiao-illustration:end -->/gi;
const VISUAL_STYLE_PROFILE_BY_NAME = new Map(VISUAL_STYLE_PROFILES.map((profile) => [profile.name, profile]));

function singleLine(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function compactError(value, maxLength = 220) {
  const text = singleLine(value);
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function normalizeHtmlCode(value) {
  const text = String(value || '').trim();
  const fenced = /```(?:html)?\s*([\s\S]*?)```/i.exec(text);
  const source = fenced ? fenced[1].trim() : text;
  const start = source.search(/<!doctype\s+html|<html\b/i);
  const document = start >= 0 ? source.slice(start) : source;
  const end = document.toLowerCase().lastIndexOf('</html>');
  return (end >= 0 ? document.slice(0, end + '</html>'.length) : document).trim();
}

function validateHtmlCode(value) {
  const html = normalizeHtmlCode(value);
  if (!/<html\b/i.test(html) || !/<\/html>/i.test(html)) {
    throw new Error('HTML 图片结果必须是完整 HTML 文档');
  }
  return html;
}

function withPixelDensity(assetUrl, pixelDensity) {
  const value = String(assetUrl || '');
  if (!value) return value;
  return `${value}${value.includes('?') ? '&' : '?'}pixel-density=${Math.max(1, Math.round(Number(pixelDensity) || 1))}`;
}

// 从最终正文中构建图片生成参考材料。
function buildIllustrationReference(planItem, contextById, sections) {
  return planItem.section_ids.map((sectionId) => {
    const context = contextById.get(sectionId);
    const item = context?.item || {};
    const content = String(sections?.[sectionId]?.content || item.content || '').trim();
    return `## ${sectionId} ${singleLine(item.title || '未命名章节')}\n\n${content}`;
  }).join('\n\n');
}

function buildIllustrationExecutionContexts(plan, leafContexts, sections) {
  const contextById = new Map((leafContexts || []).map((context) => [context.item.id, context]));
  return (plan?.items || []).map((planItem) => ({
    planItem,
    visualStyle: plan?.visual_style || plan?.recommended_visual_style || '',
    contexts: planItem.section_ids.map((id) => contextById.get(id)).filter(Boolean),
    reference: buildIllustrationReference(planItem, contextById, sections),
  }));
}

function getPlannedTitle(execution) {
  const title = singleLine(execution.planItem.title);
  if (!title) throw new Error(`图片计划缺少 title：${execution.planItem.item_id || 'unknown'}`);
  return title;
}

function formatVisualStyle(style) {
  const profile = VISUAL_STYLE_PROFILE_BY_NAME.get(style);
  if (!profile) return style || '由内容自行判断';
  return `${profile.name}（${profile.definition} 配色：${profile.palette}）`;
}

function formatPlanContext(execution) {
  const item = execution.planItem || {};
  const list = (value) => Array.isArray(value) && value.length ? value.join('、') : '无';
  return `图片规划：视觉作用：${item.visual_role || '未指定'}；配图目的：${item.purpose || '未指定'}；比例：${item.aspect_ratio || '未指定'}；关联评分项：${list(item.scoring_point_ids)}；价值锚点：${list(item.value_anchor_ids)}；插入锚点：${item.anchor?.type || '章节末尾'}；全文视觉风格：${formatVisualStyle(execution.visualStyle)}。`;
}

function formatCreativeBrief(brief) {
  if (!brief || typeof brief !== 'object') return '';
  const list = (value) => (Array.isArray(value) ? value : []).filter(Boolean).join('、') || '无';
  return `创意简报：
客户与项目：${brief.client_profile || '待确认'}；${brief.project_goal || '待确认'}
受众：${list(brief.target_audience)}
主题与核心信息：${brief.campaign_theme || '待确认'}；${brief.key_message || '待确认'}
场景：${brief.event_type || '未指定'}；${brief.venue_and_scene || '未指定'}
必须元素：${list(brief.mandatory_elements)}
禁止元素：${list(brief.prohibited_elements)}
风格：${list(brief.style_keywords)}
品牌色：${list(brief.brand_colors)}
可用品牌资产：${list(brief.brand_assets)}
交付类型与比例：${brief.deliverable_type || '创意概念图'}；${brief.aspect_ratio || '16:9'}
待用户确认：${list(brief.needs_user_confirmation)}`;
}

function buildAiImagePrompt(execution) {
  const type = execution.planItem.image_type;
  const styleLabels = {
    realistic_photo: '专业实景图片',
    campaign_key_visual: '活动或宣传主视觉概念图',
    event_scene_render: '活动现场或执行场景概念图',
    spatial_concept_render: '空间与动线概念图',
    poster_concept: '海报创意方向图',
    social_media_mockup: '社交媒体传播物料概念图',
    brand_touchpoint_mockup: '品牌触点物料概念图',
    storyboard: '宣传片或活动流程分镜图',
    creative_style_board: '创意风格与视觉情绪板',
  };
  const styleLabel = styleLabels[type] || '专业工程图示';
  const title = getPlannedTitle(execution);
  const creativeBrief = formatCreativeBrief(execution.planItem.creative_brief);
  return `阅读并理解以下技术方案正文，生成一张${styleLabel}。
最终图题：${title}
必须围绕最终图题限定的对象、场景和关系重点组织画面，不要生成泛化的章节概览；图题用于限定画面主题，不要求把完整图题作为文字绘制在图片中。
图片需要准确表达正文中的设备、环境、部署关系或实施场景，不要编造正文中没有的关键对象。
不要有太多文字，专业、克制，适合投标技术方案。没有用户提供的品牌资产时不得生成 Logo 或近似 Logo；不得生成关键中文文案、伪造客户/人物/场地/案例。
${creativeBrief ? `\n${creativeBrief}\n` : ''}
${formatPlanContext(execution)}
参考内容如下：

${execution.reference}`;
}

function buildHtmlImagePrompt(execution) {
  const title = getPlannedTitle(execution);
  return `阅读并理解以下内容，用html绘制一张${execution.planItem.image_type}。
最终图题：${title}
${formatPlanContext(execution)}
必须围绕最终图题限定的对象、范围和关系重点设计图形，不要生成泛化的章节概览。
不要有太多文字描述，专业商务风格。这是一个类图片的html，所以注意仔细检查显示效果、文字换行、拥挤等问题。正文和节点文字不得小于24px，优先控制在12个主要信息节点以内，不得通过缩小字号强塞复杂内容。文字不得旋转、倒置、镜像或缩放变形，不得相互重叠、被前景元素遮挡或被容器裁切。不要使用固定或粘性文字布局，文字容器应随内容增长。宽度固定${HTML_DESIGN_WIDTH}px，高度自适应且原则上不超过${HTML_MAX_DESIGN_HEIGHT}px，不依赖在线字体或外部资源。
生成包含 html、head、body 的完整 HTML 文档，不依赖本地文件。参考内容如下：

${execution.reference}`;
}

function buildHtmlAgentPrompt(execution) {
  const title = getPlannedTitle(execution);
  return `请读取当前工作目录中的 reference.md，阅读并理解全部内容，用 HTML 绘制一张${execution.planItem.image_type}。

最终图题：${title}

${formatPlanContext(execution)}

要求：
1. 必须围绕最终图题限定的对象、范围和关系重点设计图形，不要生成泛化的章节概览。
2. 不要有太多文字描述，使用专业商务风格。
3. 这是一个类图片的 HTML，必须仔细检查显示效果、文字换行和内容拥挤问题；正文和节点文字不得小于 24px，优先控制在 12 个主要信息节点以内，不得通过缩小字号强塞复杂内容；文字不得旋转、倒置、镜像或缩放变形，不得相互重叠、被前景元素遮挡或被容器裁切。
4. 不要使用固定或粘性文字布局，文字容器应随内容增长；不依赖在线字体或外部资源。
5. 页面宽度固定为 ${HTML_DESIGN_WIDTH}px，高度自适应且原则上不超过 ${HTML_MAX_DESIGN_HEIGHT}px。
6. 生成完整 HTML 文档，包含 html、head、body，不依赖本地文件。
7. 只创建 illustration.html，不要修改 reference.md，不要创建其他结果文件。`;
}

// 使用生图模型基于最终正文生成 AI 图片。
async function generateAiIllustration(aiService, execution) {
  const title = getPlannedTitle(execution);
  const generated = await aiService.generateImage({
    title,
    logTitle: `AI生图-${execution.planItem.item_id}-${title}`,
    prompt: buildAiImagePrompt(execution),
    style: execution.planItem.image_type,
  });
  if (!generated?.asset_url) throw new Error('生图模型未返回本地图片地址');
  return {
    asset_url: generated.asset_url,
    attempts: 1,
    visual_qa: {
      status: 'needs-manual-review',
      reason: '当前图片模型未接入视觉审核能力，已完成生成文件状态检查，请人工核对图题、元素和品牌资产。',
    },
  };
}

async function requestHtmlScreenshot(html, localImageRenderService, onRetry, pauseControl = {}) {
  if (!localImageRenderService?.renderHtmlToPng) throw new Error('本地 HTML 转图组件尚未初始化');
  let requestAttempts = 0;
  const result = await runWithRemoteImageRetry(async (attempt) => {
    requestAttempts = attempt;
    if (pauseControl.isPauseRequested?.()) throw pauseControl.createPauseError?.() || new Error('HTML 转图已暂停');
    const rendered = await localImageRenderService.renderHtmlToPng(html, {
      timeoutMs: 120000,
      isPauseRequested: pauseControl.isPauseRequested,
      createPauseError: pauseControl.createPauseError,
    });
    if (!rendered?.buffer?.length || rendered.buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
      throw new Error('HTML 本地转图片失败：未生成有效 PNG');
    }
    return {
      buffer: rendered.buffer,
      width: rendered.width,
      height: rendered.height,
      layout_issues: Array.isArray(rendered.layout_issues) ? rendered.layout_issues : [],
    };
  }, {
    onRetry,
    shouldStop: pauseControl.isPauseRequested,
    createStopError: pauseControl.createPauseError,
  });
  return { ...result, attempts: requestAttempts };
}

async function requestHtmlLayoutProbe(html, localImageRenderService, onRetry, pauseControl = {}) {
  if (!localImageRenderService?.probeHtmlLayoutOnly) {
    return requestHtmlScreenshot(html, localImageRenderService, onRetry, pauseControl);
  }
  let requestAttempts = 0;
  const result = await runWithRemoteImageRetry(async (attempt) => {
    requestAttempts = attempt;
    if (pauseControl.isPauseRequested?.()) throw pauseControl.createPauseError?.() || new Error('HTML 质检已暂停');
    return localImageRenderService.probeHtmlLayoutOnly(html, {
      timeoutMs: 120000,
      isPauseRequested: pauseControl.isPauseRequested,
      createPauseError: pauseControl.createPauseError,
    });
  }, {
    onRetry,
    shouldStop: pauseControl.isPauseRequested,
    createStopError: pauseControl.createPauseError,
  });
  return { ...result, attempts: requestAttempts };
}

function getHtmlLayoutIssues(screenshot) {
  const width = Number(screenshot?.width) || 0;
  const height = Number(screenshot?.height) || 0;
  const issues = Array.isArray(screenshot?.layout_issues)
    ? screenshot.layout_issues.map((issue) => String(issue || '').trim()).filter(Boolean)
    : [];
  if (width > HTML_DESIGN_WIDTH + 4) issues.push(`出现横向溢出：实际宽度 ${width}px，设计宽度 ${HTML_DESIGN_WIDTH}px`);
  if (height > HTML_MAX_DESIGN_HEIGHT) issues.push(`画布过高：实际高度 ${height}px，建议不超过 ${HTML_MAX_DESIGN_HEIGHT}px`);
  if (height <= 0) issues.push('截图高度无效');
  return [...new Set(issues)];
}

function buildHtmlLayoutRepairPrompt(execution, html, issues, attempt) {
  return `请修复以下用于投标文件的 HTML 图片布局。\n最终图题：${getPlannedTitle(execution)}\n修复轮次：${attempt}/${HTML_LAYOUT_REPAIR_ATTEMPTS}\n渲染诊断：${issues.join('；')}\n\n要求：保持图题和正文事实不变；宽度固定 ${HTML_DESIGN_WIDTH}px，高度原则上不超过 ${HTML_MAX_DESIGN_HEIGHT}px；正文和节点文字不得小于 24px，优先控制在 12 个主要信息节点以内，不得通过缩小字号强塞复杂内容；禁止横向溢出、文字拥挤、重叠、遮挡和截断；文字不得旋转、倒置、镜像或缩放变形；不要使用固定或粘性文字布局，文字容器应随内容增长；保留专业商务风格；输出完整 HTML 文档且不依赖网络、本地文件、在线字体或外部资源。\n\n当前 HTML：\n${String(html || '').slice(0, 60000)}`;
}

async function repairHtmlLayout({ aiService, execution, html, issues, attempt, mode, runAgentHtml }) {
  const prompt = buildHtmlLayoutRepairPrompt(execution, html, issues, attempt);
  if (mode === 'agent') {
    const repaired = await runAgentHtml({
      title: `HTML配图布局修复-${execution.planItem.item_id}-${getPlannedTitle(execution)}`,
      prompt,
      outputFile: 'illustration.html',
      files: [{ path: 'reference.md', content: execution.reference }],
      validateOutput: (result) => validateHtmlCode(result?.output_content || ''),
    });
    return validateHtmlCode(repaired);
  }
  const response = await aiService.chat({
    messages: [{ role: 'user', content: `${prompt}\n\n仅返回 html 代码，不要返回其他内容。` }],
    temperature: 0.1,
    logTitle: `HTML配图布局修复-${execution.planItem.item_id}-${getPlannedTitle(execution)}`,
  });
  return validateHtmlCode(response);
}

async function generateChartIllustration({ aiService, execution, plan, workspaceStore, localImageRenderService }) {
  const sourcePath = execution.planItem.generation?.source_path;
  let spec = sourcePath ? workspaceStore.readIllustrationChart?.(sourcePath) : null;
  if (!spec) {
    spec = await aiService.collectJsonResponse({
      messages: [{ role: 'user', content: buildChartDslPrompt({ title: getPlannedTitle(execution), chartType: execution.planItem.image_type, reference: execution.reference }) }],
      temperature: 0.2,
      logTitle: `结构化图表-${execution.planItem.item_id}-${getPlannedTitle(execution)}`,
      progressLabel: '结构化图表生成',
      failureMessage: '模型返回的结构化图表无效',
      normalizer: (value) => value?.result && typeof value.result === 'object' ? value.result : value,
      validator: assertValidChartDsl,
    });
  }
  assertValidChartDsl(spec);
  if (spec.chart_type !== execution.planItem.image_type) throw new Error('结构化图表类型与编排计划不一致');
  const savedChart = workspaceStore.saveIllustrationChart({ revision: plan.revision, itemId: execution.planItem.item_id, spec, reference: execution.reference });
  const rendered = await localImageRenderService.renderChartToPng(spec, { timeoutMs: 120000 });
  const savedPng = workspaceStore.saveIllustrationPng({ revision: plan.revision, itemId: execution.planItem.item_id, buffer: rendered.buffer });
  return {
    mode: 'chart', source_path: savedChart.relativePath, asset_url: withPixelDensity(savedPng.assetUrl, HTML_CAPTURE_SCALE), attempts: 1,
    visual_qa: { status: 'needs-manual-review', reason: '已完成结构化图表本地渲染，请人工核对文字可读性和图文一致性。' },
  };
}

// 生成 HTML 源文件并在本地转换为 PNG。
async function generateHtmlIllustration({ aiService, execution, plan, workspaceStore, localImageRenderService, runAgentHtml, onSourceSaved, onRenderRetry, isPauseRequested, createPauseError }) {
  const recordedPath = execution.planItem.generation?.source_path;
  let sourcePath = recordedPath;
  let html = sourcePath ? workspaceStore.readIllustrationHtml(sourcePath) : '';
  if (!html) {
    const recovered = workspaceStore.findIllustrationHtml?.({ revision: plan.revision, itemId: execution.planItem.item_id });
    if (recovered?.content) {
      sourcePath = recovered.relativePath;
      html = recovered.content;
    }
  }
  const mode = execution.reference.length > HTML_AGENT_THRESHOLD_CHARS ? 'agent' : 'normal';
  let sourceAlreadyPersisted = Boolean(html && sourcePath && sourcePath === recordedPath);
  if (!html) {
    if (mode === 'agent') {
      html = await runAgentHtml({
        title: `HTML配图-${execution.planItem.item_id}-${getPlannedTitle(execution)}`,
        prompt: buildHtmlAgentPrompt(execution),
        outputFile: 'illustration.html',
        files: [{ path: 'reference.md', content: execution.reference }],
        validateOutput: (result) => validateHtmlCode(result?.output_content || ''),
      });
    } else {
      const response = await aiService.chat({
        messages: [{ role: 'user', content: `${buildHtmlImagePrompt(execution)}\n\n仅返回html代码，不要返回任何其他内容。` }],
        temperature: 0.2,
        logTitle: `HTML配图-${execution.planItem.item_id}-${getPlannedTitle(execution)}`,
      });
      html = validateHtmlCode(response);
    }
    html = validateHtmlCode(html);
  }

  let savedHtml;
  let layoutIssues = [];
  let layoutRepairAttempts = 0;
  while (layoutRepairAttempts <= HTML_LAYOUT_REPAIR_ATTEMPTS) {
    savedHtml = workspaceStore.saveIllustrationHtml({ revision: plan.revision, itemId: execution.planItem.item_id, content: html });
    if (!sourceAlreadyPersisted || layoutRepairAttempts > 0) onSourceSaved?.({ mode, source_path: savedHtml.relativePath });
    try {
      const probe = await requestHtmlLayoutProbe(html, localImageRenderService, onRenderRetry, { isPauseRequested, createPauseError });
      layoutIssues = getHtmlLayoutIssues(probe);
    } catch (error) {
      error.illustrationGeneration = { mode, source_path: savedHtml.relativePath };
      throw error;
    }
    if (!layoutIssues.length) break;
    if (layoutRepairAttempts >= HTML_LAYOUT_REPAIR_ATTEMPTS) {
      const error = new Error(`HTML 图片布局质检未通过：${layoutIssues.join('；')}`);
      error.illustrationGeneration = { mode, source_path: savedHtml.relativePath };
      throw error;
    }
    layoutRepairAttempts += 1;
    html = await repairHtmlLayout({ aiService, execution, html, issues: layoutIssues, attempt: layoutRepairAttempts, mode, runAgentHtml });
    sourceAlreadyPersisted = false;
  }
  let screenshot;
  try {
    screenshot = await requestHtmlScreenshot(html, localImageRenderService, onRenderRetry, { isPauseRequested, createPauseError });
  } catch (error) {
    error.illustrationGeneration = { mode, source_path: savedHtml.relativePath };
    throw error;
  }
  layoutIssues = getHtmlLayoutIssues(screenshot);
  if (layoutIssues.length) {
    const error = new Error(`HTML 图片布局质检未通过：${layoutIssues.join('；')}`);
    error.illustrationGeneration = { mode, source_path: savedHtml.relativePath };
    throw error;
  }
  const savedPng = workspaceStore.saveIllustrationPng({ revision: plan.revision, itemId: execution.planItem.item_id, buffer: screenshot.buffer });
  return {
    mode,
    source_path: savedHtml.relativePath,
    asset_url: withPixelDensity(savedPng.assetUrl, HTML_CAPTURE_SCALE),
    attempts: screenshot.attempts + layoutRepairAttempts,
    visual_qa: {
      status: 'needs-manual-review',
      reason: '已完成完整 HTML、PNG、画布溢出、文字变形、文字重叠、前景遮挡和裁切检查；请人工核对图题与正文事实一致性。',
      width: screenshot.width,
      height: screenshot.height,
      layout_repair_attempts: layoutRepairAttempts,
    },
  };
}

function stripGeneratedIllustrations(content) {
  return String(content || '').replace(GENERATED_ILLUSTRATION_PATTERN, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function contentBlockHash(content) {
  return crypto.createHash('sha256').update(JSON.stringify(String(content || '').trim()), 'utf8').digest('hex').slice(0, 16);
}

function splitContentBlocks(content) {
  return String(content || '').trim().split(/\n{2,}/u).map((part) => part.trim()).filter(Boolean).map((part) => ({
    content: part,
    hash: contentBlockHash(part),
  }));
}

function illustrationAnchor(planItem) {
  const source = planItem?.anchor;
  if (source?.type && source?.section_id) {
    return {
      type: source.type,
      section_id: String(source.section_id),
      block_hash: String(source.block_hash || ''),
      sequence: Number(source.sequence) || 0,
    };
  }
  const legacyBefore = planItem?.placement === 'before';
  return {
    type: legacyBefore ? 'after_heading' : 'section_end',
    section_id: legacyBefore ? planItem?.section_ids?.[0] : planItem?.section_ids?.[planItem.section_ids.length - 1],
    sequence: 0,
  };
}

function buildIllustrationLead(purpose) {
  const subject = singleLine(purpose).replace(/^帮助评委(?:更快)?理解/u, '').replace(/^说明/u, '');
  return subject ? `为便于理解${subject}，相关内容如下图所示。` : '相关内容如下图所示。';
}

function buildGeneratedIllustrationMarkdown(planItem) {
  const generation = planItem.generation || {};
  const caption = singleLine(planItem.title);
  if (!caption) throw new Error(`图片计划缺少 title：${planItem.item_id || 'unknown'}`);
  const body = generation.asset_url ? `![${caption}](${generation.asset_url})\n\n*图：${caption}*` : '';
  if (!body) return '';
  return `<!-- yibiao-illustration:start id="${planItem.item_id}" -->\n${buildIllustrationLead(planItem.purpose)}\n\n${body}\n<!-- yibiao-illustration:end -->`;
}

function mapOutlineContent(items, contentById) {
  return (items || []).map((item) => ({
    ...item,
    ...(contentById.has(item.id) ? { content: contentById.get(item.id) } : {}),
    ...(item.children?.length ? { children: mapOutlineContent(item.children, contentById) } : {}),
  }));
}

function collectIllustrationWritableIds(items, target = new Set()) {
  for (const item of items || []) {
    const children = Array.isArray(item?.children) ? item.children : [];
    if (!children.length && item?.manual_input_required !== true) {
      target.add(String(item.id || ''));
    }
    collectIllustrationWritableIds(children, target);
  }
  return target;
}

// 清除旧生成块，确保重新编排时只参考纯正文。
function stripGeneratedIllustrationsFromDocument(outlineData, sections) {
  const nextSections = { ...(sections || {}) };
  const contentById = new Map();
  const writableIds = collectIllustrationWritableIds(outlineData?.outline || []);
  for (const [itemId, section] of Object.entries(nextSections)) {
    if (!writableIds.has(itemId)) continue;
    const content = stripGeneratedIllustrations(section?.content || '');
    nextSections[itemId] = { ...section, content };
    contentById.set(itemId, content);
  }
  return {
    sections: nextSections,
    outlineData: outlineData ? { ...outlineData, outline: mapOutlineContent(outlineData.outline, contentById) } : outlineData,
  };
}

function compareIllustrationInsertionOrder(left, right) {
  const leftAnchor = illustrationAnchor(left);
  const rightAnchor = illustrationAnchor(right);
  if (leftAnchor.section_id !== rightAnchor.section_id) return leftAnchor.section_id.localeCompare(rightAnchor.section_id, 'zh-CN');
  if (leftAnchor.type !== rightAnchor.type) return leftAnchor.type.localeCompare(rightAnchor.type, 'zh-CN');
  if (leftAnchor.type === 'before_block') return leftAnchor.sequence - rightAnchor.sequence;
  if (leftAnchor.type === 'after_block' || leftAnchor.type === 'after_heading') return rightAnchor.sequence - leftAnchor.sequence;
  return leftAnchor.sequence - rightAnchor.sequence;
}

function insertIllustrationAtAnchor(content, block, anchor) {
  const blocks = splitContentBlocks(content);
  if (anchor.type === 'section_end') {
    return { content: [...blocks.map((item) => item.content), block].join('\n\n').trim(), fallback: false };
  }
  if (anchor.type === 'after_heading') {
    return { content: [block, ...blocks.map((item) => item.content)].join('\n\n').trim(), fallback: false };
  }
  const blockIndex = blocks.findIndex((item) => item.hash === anchor.block_hash);
  if (blockIndex < 0) {
    return { content: [...blocks.map((item) => item.content), block].join('\n\n').trim(), fallback: true };
  }
  const index = anchor.type === 'before_block' ? blockIndex : blockIndex + 1;
  blocks.splice(index, 0, { content: block, hash: '' });
  return { content: blocks.map((item) => item.content).join('\n\n').trim(), fallback: false };
}

// 按正文块锚点把成功图片一次性插入权威正文；块哈希变化时退化到章节末尾并要求人工核对。
function applyGeneratedIllustrationsToDocument(plan, outlineData, sections) {
  const nextSections = { ...(sections || {}) };
  const contentById = new Map();
  const writableIds = collectIllustrationWritableIds(outlineData?.outline || []);
  for (const [itemId, section] of Object.entries(nextSections)) {
    if (!writableIds.has(itemId)) continue;
    const content = stripGeneratedIllustrations(section?.content || '');
    nextSections[itemId] = { ...section, content };
    contentById.set(itemId, content);
  }

  const anchorFallbackItemIds = [];
  const items = (plan?.items || []).filter((item) => item.generation?.status === 'success').sort(compareIllustrationInsertionOrder);
  for (const planItem of items) {
    const block = buildGeneratedIllustrationMarkdown(planItem);
    if (!block) continue;
    const anchor = illustrationAnchor(planItem);
    const targetId = anchor.section_id;
    if (!writableIds.has(targetId)) {
      throw new Error(`配图计划引用了不可写入的受控响应节点：${targetId}`);
    }
    const current = String(nextSections[targetId]?.content || '').trim();
    const inserted = insertIllustrationAtAnchor(current, block, anchor);
    if (inserted.fallback) anchorFallbackItemIds.push(planItem.item_id);
    nextSections[targetId] = { ...nextSections[targetId], content: inserted.content, status: 'success', error: undefined, updated_at: new Date().toISOString() };
    contentById.set(targetId, inserted.content);
  }

  return {
    sections: nextSections,
    outlineData: outlineData ? { ...outlineData, outline: mapOutlineContent(outlineData.outline, contentById) } : outlineData,
    anchorFallbackItemIds,
  };
}

module.exports = {
  HTML_AGENT_THRESHOLD_CHARS,
  applyGeneratedIllustrationsToDocument,
  buildAiImagePrompt,
  buildHtmlImagePrompt,
  buildIllustrationExecutionContexts,
  formatPlanContext,
  generateAiIllustration,
  generateChartIllustration,
  generateHtmlIllustration,
  normalizeHtmlCode,
  stripGeneratedIllustrationsFromDocument,
  validateHtmlCode,
};
