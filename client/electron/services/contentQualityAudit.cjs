'use strict';

function compact(value) {
  return String(value || '').replace(/\s+/gu, ' ').trim();
}

function words(value) {
  return compact(value).length;
}

function isSubstantive(value) {
  return words(value) >= 80;
}

function secondLevelId(context) {
  const path = [...(context?.parentChapters || []), context?.item].filter(Boolean);
  return String(path.find((item) => String(item?.id || '').split('.').length === 2)?.id || '');
}

function contractFor(context, plans) {
  const stored = plans?.[context?.item?.id];
  return stored?.plan || stored || {};
}

function scoreWeight(point) {
  const levels = { 'potential-rejection': 100, high: 80, important: 60, normal: 40 };
  const explicitScore = Number(point?.score_value);
  return (Number.isFinite(explicitScore) && explicitScore > 0 ? explicitScore * 10 : 0)
    + (levels[point?.mandatory_level] || 40);
}

function belongsToPrimaryNode(context, primaryNodeId) {
  const itemId = String(context?.item?.id || '');
  const nodeId = String(primaryNodeId || '');
  return Boolean(nodeId) && (itemId === nodeId || itemId.startsWith(`${nodeId}.`));
}

function rankContentExpansionCandidates(contexts, { sections, plans, requirementResponseMatrix } = {}) {
  const points = requirementResponseMatrix?.scoring_points || [];
  return (contexts || []).map((context) => {
    const itemId = String(context?.item?.id || '');
    const content = sections?.[itemId]?.content || context?.content || context?.item?.content || '';
    const contract = contractFor(context, plans);
    const relevantPoints = points.filter((point) => belongsToPrimaryNode(context, point?.primary_node_id));
    const minWords = Math.max(0, Number(contract?.target_words?.min) || 0);
    const preferredWords = Math.max(minWords, Number(contract?.target_words?.preferred) || 0);
    const missingWords = Math.max(0, preferredWords - words(content));
    const scoreValue = relevantPoints.reduce((sum, point) => sum + scoreWeight(point), 0);
    const deepGap = contract?.writing_profile === 'deep' && !/(参数|阈值|验收|交付|边界|闭环|频次|时限)/u.test(content) ? 45 : 0;
    const anchorGap = (contract?.value_anchor_ids || []).length && !/(增值|改进|闭环|风险|保障|优化)/u.test(content) ? 25 : 0;
    const evidenceGap = (contract?.evidence_requirements || []).length && !/(证明|材料|待确认|记录|附件)/u.test(content) ? 20 : 0;
    const priority = scoreValue + Math.min(80, missingWords / 10) + deepGap + anchorGap + evidenceGap;
    return {
      context,
      priority,
      reasons: [
        ...(relevantPoints.length ? [`承担 ${relevantPoints.length} 个原子评分点`] : []),
        ...(missingWords ? [`距合同目标篇幅仍差 ${missingWords} 字`] : []),
        ...(deepGap ? ['深度写作要素不足'] : []),
        ...(anchorGap ? ['增值锚点未充分展开'] : []),
        ...(evidenceGap ? ['证据要求未显式体现'] : []),
      ],
    };
  }).sort((left, right) => right.priority - left.priority || String(left.context?.item?.id).localeCompare(String(right.context?.item?.id), 'zh-CN'));
}

function comparableParagraphs(contexts, sections) {
  const paragraphs = [];
  for (const context of contexts || []) {
    const content = String(sections?.[context.item.id]?.content || context.item?.content || '');
    const withoutCode = content.replace(/```[\s\S]*?```/gu, '\n');
    for (const [index, raw] of withoutCode.split(/\n\s*\n/gu).entries()) {
      const text = raw.trim();
      if (!text || /^(?:#{1,6}\s|>\s|!\[|\|)/u.test(text)) continue;
      const normalized = text
        .replace(/[*_`~]/gu, '')
        .replace(/[\s，。！？；：、,.!?;:'"“”‘’（）()\[\]{}<>|—-]+/gu, '')
        .trim();
      if (normalized.length < 40) continue;
      paragraphs.push({ node_id: context.item.id, paragraph_index: index, text: compact(text), normalized });
    }
  }
  return paragraphs;
}

function semanticMarkers(value) {
  const text = String(value || '');
  return {
    numbers: (text.match(/\d+(?:\.\d+)?(?:%|年|月|日|天|小时|分钟|万元|元|台|人|次)?/gu) || []).join('|'),
    negatives: (text.match(/不得|不能|禁止|不应|未|无/gu) || []).join('|'),
  };
}

function bigrams(value) {
  const result = new Set();
  for (let index = 0; index < value.length - 1; index += 1) result.add(value.slice(index, index + 2));
  return result;
}

function diceSimilarity(left, right) {
  const leftPairs = bigrams(left);
  const rightPairs = bigrams(right);
  let shared = 0;
  for (const pair of leftPairs) if (rightPairs.has(pair)) shared += 1;
  return leftPairs.size + rightPairs.size ? (2 * shared) / (leftPairs.size + rightPairs.size) : 0;
}

function duplicateIssue(left, right, type, reason, confidence) {
  return {
    left_node_id: left.node_id,
    right_node_id: right.node_id,
    type,
    reason,
    confidence,
    left_paragraph_index: left.paragraph_index,
    right_paragraph_index: right.paragraph_index,
    left_excerpt: left.text.slice(0, 180),
    right_excerpt: right.text.slice(0, 180),
  };
}

function detectDuplicates(contexts, sections) {
  const paragraphs = comparableParagraphs(contexts, sections);
  const duplicates = [];
  const exact = new Map();
  const compared = new Set();
  paragraphs.forEach((paragraph, paragraphIndex) => {
    const previous = exact.get(paragraph.normalized) || [];
    for (const entry of previous) {
      duplicates.push(duplicateIssue(entry.paragraph, paragraph, 'exact-paragraph', '正文段落重复候选', 1));
      compared.add(`${entry.index}:${paragraphIndex}`);
    }
    previous.push({ paragraph, index: paragraphIndex });
    exact.set(paragraph.normalized, previous);
  });

  const gramIndex = new Map();
  paragraphs.forEach((paragraph, index) => {
    for (const gram of bigrams(paragraph.normalized)) {
      const ids = gramIndex.get(gram) || [];
      ids.push(index);
      gramIndex.set(gram, ids);
    }
  });
  paragraphs.forEach((right, rightIndex) => {
    const hits = new Map();
    for (const gram of bigrams(right.normalized)) {
      for (const leftIndex of gramIndex.get(gram) || []) {
        if (leftIndex >= rightIndex) continue;
        hits.set(leftIndex, (hits.get(leftIndex) || 0) + 1);
      }
    }
    for (const [leftIndex, shared] of hits) {
      const pairKey = `${leftIndex}:${rightIndex}`;
      if (compared.has(pairKey) || shared < 12) continue;
      const left = paragraphs[leftIndex];
      if (Math.max(left.normalized.length, right.normalized.length) / Math.min(left.normalized.length, right.normalized.length) > 1.25) continue;
      const leftMarkers = semanticMarkers(left.text);
      const rightMarkers = semanticMarkers(right.text);
      if (leftMarkers.numbers !== rightMarkers.numbers || leftMarkers.negatives !== rightMarkers.negatives) continue;
      const similarity = diceSimilarity(left.normalized, right.normalized);
      if (similarity >= 0.86) duplicates.push(duplicateIssue(left, right, 'near-paragraph', '正文段落轻微改写重复候选', Number(similarity.toFixed(3))));
    }
  });
  return duplicates;
}

function detectFragmentedExpressions(contexts, sections) {
  const issues = [];
  for (const context of contexts || []) {
    const content = String(sections?.[context.item.id]?.content || context.item?.content || '');
    for (const paragraph of content.split(/\n\s*\n/gu)) {
      const sentences = paragraph.split(/[。！？!?]/gu).map(compact).filter(Boolean);
      const shortSubjectSentences = sentences.filter((sentence) => sentence.length <= 18 && /^(?:我们|我方)/u.test(sentence));
      if (sentences.length >= 4 && shortSubjectSentences.length >= 4) {
        issues.push({ node_id: context.item.id, reason: '连续同主语碎片句候选', excerpt: compact(paragraph).slice(0, 180), sentence_count: sentences.length });
      }
    }
  }
  return issues;
}

function auditContentQuality({ contexts, sections, plans, requirementResponseMatrix, outlineData }) {
  const matrix = requirementResponseMatrix || {};
  const allContexts = contexts || [];
  const uncovered = [];
  const scoreItems = (matrix.scoring_points || []).map((point) => {
    const evidenceContexts = allContexts.filter((context) => belongsToPrimaryNode(context, point?.primary_node_id));
    const substantive = evidenceContexts.filter((context) => isSubstantive(sections?.[context.item.id]?.content || context.item?.content));
    const combinedContent = substantive.map((context) => sections?.[context.item.id]?.content || context.item?.content || '').join('\n');
    const highScoreConditions = (point?.high_score_conditions || []).map(compact).filter(Boolean);
    const matchedHighScoreConditions = highScoreConditions.filter((condition) => {
      const keywords = condition.match(/[\p{Script=Han}A-Za-z0-9]{2,}/gu) || [];
      return keywords.some((keyword) => combinedContent.includes(keyword));
    });
    const maxScore = Number(point?.score_value) > 0 ? Number(point.score_value) : 5;
    const coverageRatio = highScoreConditions.length
      ? matchedHighScoreConditions.length / highScoreConditions.length
      : (substantive.length ? 0.8 : 0);
    const estimatedScore = Number((maxScore * (substantive.length ? Math.max(0.4, coverageRatio) : 0)).toFixed(2));
    if (!substantive.length) uncovered.push(String(point?.scoring_point_id || ''));
    return {
      scoring_point_id: String(point?.scoring_point_id || ''),
      max_score: maxScore,
      estimated_score: estimatedScore,
      evidence_node_ids: substantive.map((context) => context.item.id),
      strengths: substantive.length ? ['存在实质正文', ...matchedHighScoreConditions.map((condition) => `已体现：${condition}`)] : [],
      deductions: substantive.length ? highScoreConditions.filter((condition) => !matchedHighScoreConditions.includes(condition)).map((condition) => `高分条件未见明确证据：${condition}`) : ['未找到实质正文'],
      missing_evidence: substantive.length ? highScoreConditions.filter((condition) => !matchedHighScoreConditions.includes(condition)) : ['需补充评分点实质响应'],
      repair_node_ids: evidenceContexts.map((context) => context.item.id),
    };
  });
  const manualMissing = allContexts.filter((context) => context.item?.manual_input_required && !compact(sections?.[context.item.id]?.content || context.item?.content)).map((context) => context.item.id);
  const unhandledRisks = (matrix.rejection_risks || []).filter((item) => item?.status === 'unhandled').map((item) => item.risk_id);
  const unhandledHidden = (matrix.hidden_requirements || []).filter((item) => item?.status === 'unhandled').map((item) => item.requirement_id);
  const deepGaps = allContexts.filter((context) => {
    const contract = contractFor(context, plans);
    const content = sections?.[context.item.id]?.content || context.item?.content || '';
    return contract.writing_profile === 'deep' && !/(参数|阈值|验收|交付|边界|闭环|频次|时限)/u.test(content);
  }).map((context) => context.item.id);
  const duplicates = detectDuplicates(allContexts, sections);
  const fragmentedExpressions = detectFragmentedExpressions(allContexts, sections);
  const chapters = [...new Set(allContexts.map(secondLevelId).filter(Boolean))].map((chapterId) => ({
    chapter_node_id: chapterId,
    section_ids: allContexts.filter((context) => secondLevelId(context) === chapterId).map((context) => context.item.id),
  }));
  const overallFindings = [
    ...(uncovered.length ? [`未覆盖评分点：${uncovered.join('、')}`] : []),
    ...(manualMissing.length ? [`待人工填写章节：${manualMissing.join('、')}`] : []),
    ...(deepGaps.length ? [`深度写作要素不足：${deepGaps.join('、')}`] : []),
    ...(duplicates.length ? [`存在重复正文：${duplicates.map((item) => `${item.left_node_id}/${item.right_node_id}`).join('、')}`] : []),
    ...(fragmentedExpressions.length ? [`存在碎片化表达候选：${fragmentedExpressions.map((item) => item.node_id).join('、')}`] : []),
  ];
  return {
    schema_version: 1,
    label: '模拟评分/预估',
    can_proceed: !uncovered.length && !manualMissing.length && !unhandledRisks.length && !unhandledHidden.length,
    chapter_synthesis: chapters,
    compliance: { unhandled_risk_ids: unhandledRisks, unhandled_hidden_requirement_ids: unhandledHidden, manual_missing_node_ids: manualMissing },
    scoring_coverage: { uncovered_scoring_point_ids: uncovered, items: scoreItems },
    executability: { deep_gap_node_ids: deepGaps },
    evidence: { needs_confirmation_count: (matrix.rejection_risks || []).filter((item) => item?.status === 'needs-confirmation').length },
    editorial: { duplicates, fragmented_expressions: fragmentedExpressions },
    reviewer_simulation: { items: scoreItems, overall_findings: overallFindings },
  };
}

module.exports = { auditContentQuality, rankContentExpansionCandidates };
