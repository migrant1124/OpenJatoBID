const assert = require('node:assert/strict');
const test = require('node:test');

const {
  getBidAnalysisTaskDefinitions,
  getBidAnalysisTaskById,
  getBidAnalysisTasks,
  isBidAnalysisTaskResultValid,
  runBidDocumentFormatAnalysis,
  runBidAnalysisPromptTask,
  runBidAnalysisTask,
  runSingleBidAnalysisPromptTask,
} = require('./bidAnalysisTask.cjs');
const {
  buildBidAnalysisSourceAnchors,
  buildSourceAnchorContext,
} = require('./bidAnalysisSourceAnchors.cjs');

const requiredIds = [
  'projectOverview',
  'techRequirements',
  'bidDocumentFormatRequirements',
  'procurementList',
  'projectInfo',
  'partAInfo',
  'deliveryAndServiceRequirements',
];

const noFormatResult = {
  schema_version: 1,
  has_explicit_technical_format: false,
  profiles: [{
    profile_id: 'technical-profile-test',
    applicable_scope: { package_ids: [], package_names: [], document_type: 'technical' },
    format_strength: 'none',
    document_title: '技术文件',
    outline: [],
  }],
  template_ids: [],
  other_format_rules: { signature_and_seal: [], file_and_upload: [], typesetting: [], required_template_ids: [] },
  sources: [],
};

function completedTaskContent(task) {
  if (task.id === 'bidDocumentFormatRequirements') return JSON.stringify(noFormatResult);
  return task.output === 'json' ? '{}' : `${task.label}旧结果`;
}

test('Main task catalog is the frozen 18/7 authority without prompts', () => {
  const definitions = getBidAnalysisTaskDefinitions();
  assert.equal(definitions.length, 18);
  assert.deepEqual(definitions.filter((task) => task.required).map((task) => task.id), requiredIds);
  assert.deepEqual(definitions.slice(0, 7).map((task) => task.id), requiredIds);
  assert.equal(getBidAnalysisTasks('key').length, 7);
  assert.equal(Object.isFrozen(definitions), true);
  assert.equal(Object.isFrozen(definitions[0]), true);
  assert.equal('prompt' in definitions[0], false);
  assert.equal(definitions[2].group, 'key');
  assert.equal(definitions[2].schema_version, 1);
  assert.equal(definitions[2].label, '格式要求');
  assert.deepEqual(definitions[3], {
    id: 'procurementList',
    label: '采购与报价',
    required: true,
    output: 'markdown',
    description: '采购内容、数量、规格参数以及完整报价规则。',
    group: 'key',
  });
  assert.equal(getBidAnalysisTaskById('quotationRequirements'), undefined);
});

test('JSON task completion requires a success state containing a JSON object', () => {
  const definition = getBidAnalysisTaskDefinitions().find((task) => task.id === 'projectInfo');
  assert.ok(definition);
  assert.equal(isBidAnalysisTaskResultValid(definition, { status: 'success', content: '{}' }), true);
  assert.equal(isBidAnalysisTaskResultValid(definition, { status: 'success', content: '[]' }), false);
  assert.equal(isBidAnalysisTaskResultValid(definition, { status: 'success', content: '```json\n{}\n```' }), false);
  assert.equal(isBidAnalysisTaskResultValid(definition, { status: 'error', content: '{}' }), false);
});

test('structured task completion rejects empty profile results', () => {
  const formatTask = getBidAnalysisTaskById('bidDocumentFormatRequirements');
  assert.equal(isBidAnalysisTaskResultValid(formatTask, {
    status: 'success',
    content: JSON.stringify({ schema_version: 1, has_explicit_technical_format: false, profiles: [], template_ids: [] }),
  }), false);
});

test('single JSON analysis uses requestJson and stores canonical JSON text', async () => {
  const task = getBidAnalysisTaskById('projectInfo');
  let chatCalls = 0;
  let jsonCalls = 0;
  const result = await runSingleBidAnalysisPromptTask({
    aiService: {
      chat: async () => { chatCalls += 1; return 'unexpected'; },
      requestJson: async (request) => {
        jsonCalls += 1;
        assert.equal(typeof request.normalizer, 'function');
        return { project_name: '测试项目' };
      },
    },
    fileContent: '测试招标文件',
    task,
  });

  assert.equal(jsonCalls, 1);
  assert.equal(chatCalls, 0);
  assert.deepEqual(JSON.parse(result), { project_name: '测试项目' });
});

test('structured JSON analysis applies deterministic validation without semantic repair', async () => {
  const task = getBidAnalysisTaskById('bidDocumentFormatRequirements');
  let extractionCalls = 0;
  let semanticRepairCalls = 0;
  const result = await runSingleBidAnalysisPromptTask({
    aiService: {
      requestJson: async (request) => {
        extractionCalls += 1;
        assert.equal(request.max_retries, 0);
        assert.equal(request.repair_invalid_json, false);
        assert.deepEqual(request.normalizer({ stage: 'draft' }), { stage: 'draft' });
        assert.equal(request.repairMessagesBuilder, undefined);
        const prompt = request.messages.map((message) => message.content).join('\n');
        assert.match(prompt, /anchor_ids/u);
        assert.match(prompt, /source_location/u);
        assert.match(prompt, /严禁用目录编号、标题或示例自行构造/u);
        assert.doesNotMatch(prompt, /source-anchor-\.\.\./u);
        return { stage: 'draft' };
      },
      parseJsonResponseContent: async () => {
        semanticRepairCalls += 1;
        throw new Error('不应发起语义修复');
      },
    },
    fileContent: '来源锚点目录',
    task,
    jsonNormalizer: (value) => ({ ...value, stage: 'valid' }),
  });

  assert.equal(extractionCalls, 1);
  assert.equal(semanticRepairCalls, 0);
  assert.deepEqual(JSON.parse(result), { stage: 'valid' });
});

test('segmented JSON analysis reparses the merged response before success', async () => {
  const task = getBidAnalysisTaskById('projectInfo');
  let jsonCalls = 0;
  let parseCalls = 0;
  const result = await runBidAnalysisPromptTask({
    aiService: {
      getConfig: () => ({}),
      requestJson: async () => ({ project_name: `分段${jsonCalls += 1}` }),
      chat: async () => '```json\n{"project_name":"合并项目"}\n```',
      parseJsonResponseContent: async (_request, content) => {
        parseCalls += 1;
        assert.match(content, /```json/);
        return { project_name: '合并项目' };
      },
    },
    fileContent: '完整内容',
    fileSegments: ['第一段', '第二段'],
    task,
  });

  assert.equal(jsonCalls, 2);
  assert.equal(parseCalls, 1);
  assert.deepEqual(JSON.parse(result), { project_name: '合并项目' });
});

test('single-item retry preserves completed tasks and closes the 7-item gate', async () => {
  const requiredTasks = getBidAnalysisTasks('key');
  let state = {
    bidAnalysisMode: 'key',
    bidAnalysisSelectedTaskIds: requiredIds,
    bidAnalysisTasks: Object.fromEntries(requiredTasks.map((task) => [task.id, {
      id: task.id,
      label: task.label,
      status: task.id === 'projectInfo' ? 'error' : 'success',
      content: completedTaskContent(task),
    }])),
    bidSectionMode: 'single',
  };
  const preservedOverview = state.bidAnalysisTasks.projectOverview.content;
  const workspaceStore = {
    readTenderMarkdown: () => '测试招标文件',
    loadTechnicalPlan: () => state,
    updateTechnicalPlan: (partial) => {
      state = { ...state, ...partial };
      return state;
    },
  };
  let backgroundTask = {};
  const updateTask = (partial) => {
    backgroundTask = { ...backgroundTask, ...partial };
    return backgroundTask;
  };

  await runBidAnalysisTask({
    aiService: {
      getConfig: () => ({}),
      requestJson: async () => ({ project_name: '重试成功' }),
    },
    workspaceStore,
    updateTask,
    payload: { mode: 'key', selected_task_ids: requiredIds, task_ids: ['projectInfo'] },
  });

  assert.equal(state.bidAnalysisTasks.projectOverview.content, preservedOverview);
  assert.equal(state.bidAnalysisTasks.projectInfo.status, 'success');
  assert.deepEqual(JSON.parse(state.bidAnalysisTasks.projectInfo.content), { project_name: '重试成功' });
  assert.equal(state.bidAnalysisTask.status, 'success');
});

test('format analysis reads every original source and persists normalized result plus templates atomically', async () => {
  const requiredTasks = getBidAnalysisTasks('key');
  let state = {
    bidAnalysisMode: 'key',
    bidAnalysisSelectedTaskIds: requiredIds,
    tenderFiles: [
      { id: 'source-a', fileName: 'A.md' },
      { id: 'source-b', fileName: 'B.md' },
    ],
    bidAnalysisTasks: Object.fromEntries(requiredTasks.map((task) => [task.id, {
      id: task.id,
      label: task.label,
      status: task.id === 'bidDocumentFormatRequirements' ? 'error' : 'success',
      content: completedTaskContent(task),
    }])),
    bidSectionMode: 'single',
  };
  let savedStructured;
  const workspaceStore = {
    readTenderMarkdown: () => '工作副本不得用于格式解析',
    readTenderSourceMarkdown: (id) => id === 'source-a' ? 'A 文件第一行\nA 文件第二行' : 'B 文件第一行',
    loadTechnicalPlan: () => state,
    updateTechnicalPlan: (partial) => {
      state = { ...state, ...partial };
      return state;
    },
    saveStructuredBidAnalysisResult: (payload) => {
      savedStructured = payload;
      state = {
        ...state,
        bidAnalysisTasks: { ...state.bidAnalysisTasks, [payload.task.id]: payload.task },
        responseTemplates: payload.responseTemplates,
      };
      return state;
    },
  };
  let backgroundTask = {};
  let requestJsonCalls = 0;
  let semanticRepairCalls = 0;
  const updateTask = (partial) => {
    backgroundTask = { ...backgroundTask, ...partial };
    return backgroundTask;
  };

  await runBidAnalysisTask({
    aiService: {
      getConfig: () => ({}),
      requestJson: async (request) => {
        requestJsonCalls += 1;
        const context = request.messages.map((message) => message.content).join('\n');
        assert.match(context, /source_file_id: source-a/);
        assert.match(context, /source_file_id: source-b/);
        assert.match(context, /source-anchor-[a-f0-9]+/u);
        assert.match(context, /A 文件第二行/u);
        assert.doesNotMatch(context, /2\|A 文件第二行/u);
        assert.doesNotMatch(context, /工作副本不得用于格式解析/);
        return request.normalizer({
          result: {
            schema_version: 1,
            has_explicit_technical_format: false,
            profiles: [{
              profile_id: 'none',
              applicable_scope: { package_ids: [], package_names: [], document_type: 'technical' },
              format_strength: 'none',
              document_title: '技术文件',
              outline: [],
            }],
            template_ids: [],
            other_format_rules: { signature_and_seal: [], file_and_upload: [], typesetting: [], required_template_ids: [] },
            sources: [],
          },
          templates: [],
        });
      },
      parseJsonResponseContent: async () => {
        semanticRepairCalls += 1;
        throw new Error('不应发起语义修复');
      },
    },
    workspaceStore,
    updateTask,
    payload: { mode: 'key', selected_task_ids: requiredIds, task_ids: ['bidDocumentFormatRequirements'] },
  });

  assert.equal(savedStructured.task.id, 'bidDocumentFormatRequirements');
  assert.equal(savedStructured.task.status, 'success');
  assert.match(savedStructured.normalizedHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(savedStructured.responseTemplates, []);
  assert.equal(JSON.parse(savedStructured.task.content).profiles[0].format_strength, 'none');
  assert.equal(requestJsonCalls, 1);
  assert.equal(semanticRepairCalls, 0);
  assert.equal(state.bidAnalysisTask.status, 'success');
});

test('format analysis compiles fixed templates from only their anchored raw evidence in a second stage', async () => {
  const tenderSources = [{
    id: 'source-a',
    fileName: 'A.md',
    markdown: '<table><tr><td>一、</td><td>投标承诺函</td></tr></table>\n<p>我方承诺严格履行。</p><p>投标人：____</p>\n无关正文',
  }];
  const sourceAnchors = buildBidAnalysisSourceAnchors(tenderSources);
  const fileContent = buildSourceAnchorContext(sourceAnchors);
  const anchorIdFor = (text) => {
    const line = fileContent.split('\n').find((item) => item.includes(text));
    return line?.match(/\[(source-anchor-[a-f0-9]+)\]/u)?.[1];
  };
  const directoryAnchorId = anchorIdFor('一、 | 投标承诺函');
  const templateAnchorIds = [anchorIdFor('我方承诺严格履行'), anchorIdFor('投标人：____')];
  const unrelatedAnchorId = anchorIdFor('无关正文');
  assert.ok(directoryAnchorId);
  assert.ok(templateAnchorIds.every(Boolean));
  assert.ok(unrelatedAnchorId);
  const stageOneDraft = {
    result: {
      schema_version: 1,
      has_explicit_technical_format: true,
      profiles: [{
        profile_id: 'profile-1',
        applicable_scope: { section_id: 'section-1', section_title: '一标段', package_ids: [], package_names: [], document_type: 'technical' },
        format_strength: 'strict',
        document_title: '技术文件',
        outline: [{
          format_node_id: 'node-commitment',
          source_number: '一、',
          source_title: '投标承诺函',
          required_in_outline: true,
          response_required: true,
          title_locked: true,
          order_locked: true,
          level_locked: true,
          numbering_policy: 'preserve-source',
          response_mode: 'locked-commitment',
          allow_ai_children: false,
          template_id: 'template-commitment',
          children: [],
          source: { anchor_ids: [directoryAnchorId] },
        }],
      }],
      template_ids: ['template-commitment'],
      other_format_rules: { signature_and_seal: [], file_and_upload: [], typesetting: [], required_template_ids: ['template-commitment'] },
      sources: [],
    },
    templates: [{
      template_id: 'template-commitment',
      kind: 'locked-commitment',
      profile_id: 'profile-1',
      format_node_id: 'node-commitment',
      source_title: '投标承诺函',
      source_location: { anchor_ids: templateAnchorIds },
      template: { kind: 'locked-commitment', segments: [{ type: 'locked', text: '阶段一内容不得采用' }] },
    }],
  };

  let requestJsonCalls = 0;
  let semanticRepairCalls = 0;
  const resultText = await runBidDocumentFormatAnalysis({
    aiService: {
      requestJson: async (request) => {
        requestJsonCalls += 1;
        if (requestJsonCalls === 1) {
          assert.equal(request.progressLabel, '格式要求');
          assert.equal(request.repair_invalid_json, false);
          return request.normalizer(stageOneDraft);
        }

        assert.equal(request.progressLabel, '格式要求固定模板编译');
        assert.equal(request.repair_invalid_json, false);
        const prompt = request.messages.map((message) => message.content).join('\n');
        assert.match(prompt, /<p>我方承诺严格履行。<\/p><p>投标人：____<\/p>/u);
        assert.doesNotMatch(prompt, /<td>一、<\/td>/u);
        return request.normalizer({
          templates: [{
            template_id: 'template-commitment',
            template: {
              kind: 'locked-commitment',
              segments: [
                { type: 'locked', text: '我方承诺严格履行。投标人：' },
                { type: 'slot', slot_id: 'bidder', label: '投标人', value_source: 'company-knowledge', required: true },
              ],
            },
          }],
        });
      },
      parseJsonResponseContent: async () => {
        semanticRepairCalls += 1;
        throw new Error('不应发起语义修复');
      },
    },
    task: getBidAnalysisTaskById('bidDocumentFormatRequirements'),
    fileContent,
    tenderSources,
    sourceAnchors,
  });

  const normalized = JSON.parse(resultText);
  assert.equal(requestJsonCalls, 2);
  assert.equal(semanticRepairCalls, 0);
  assert.equal(normalized.result.profiles[0].outline[0].source.excerpt, '<tr><td>一、</td><td>投标承诺函</td></tr>');
  assert.equal(normalized.templates[0].source_location.excerpt, '<p>我方承诺严格履行。</p><p>投标人：____</p>');
  assert.equal(normalized.templates[0].template.segments[0].text, '我方承诺严格履行。投标人：');

  let failureCalls = 0;
  await assert.rejects(
    () => runBidDocumentFormatAnalysis({
      aiService: {
        requestJson: async () => {
          failureCalls += 1;
          if (failureCalls === 1) return stageOneDraft;
          throw new Error('供应商请求超时');
        },
      },
      task: getBidAnalysisTaskById('bidDocumentFormatRequirements'),
      fileContent,
      tenderSources,
      sourceAnchors,
    }),
    /格式要求固定模板编译失败：供应商请求超时/u,
  );

  const nonContiguousTemplateDraft = structuredClone(stageOneDraft);
  nonContiguousTemplateDraft.templates[0].source_location = {
    anchor_ids: [templateAnchorIds[0], unrelatedAnchorId],
  };
  await assert.rejects(
    () => runBidDocumentFormatAnalysis({
      aiService: { requestJson: async () => nonContiguousTemplateDraft },
      task: getBidAnalysisTaskById('bidDocumentFormatRequirements'),
      fileContent,
      tenderSources,
      sourceAnchors,
    }),
    /templates\[0\]\.source_location\.anchor_ids: 多个来源锚点必须在同一源文件中连续/u,
  );
});

test('format analysis replays fabricated outline IDs, scattered rule sources, and an omitted template table row', async () => {
  const tenderSources = [{
    id: 'source-a',
    fileName: 'A.md',
    markdown: '<table><tr><td>2.10</td><td>技术偏差表</td></tr></table>\n<table><tr><td>列1</td><td>列2</td></tr><tr><td>固定1</td><td>固定2</td></tr><tr><td>固定3</td><td>固定4</td></tr></table>',
  }];
  const sourceAnchors = buildBidAnalysisSourceAnchors(tenderSources);
  const rows = sourceAnchors.anchors.filter((anchor) => anchor.kind === 'html-table-row');
  const directoryRow = rows.find((anchor) => anchor.tableCells?.[0] === '2.10');
  const templateRows = rows.filter((anchor) => anchor !== directoryRow);
  assert.equal(templateRows.length, 3);
  const draft = {
    result: {
      schema_version: 1,
      has_explicit_technical_format: true,
      profiles: [{
        profile_id: 'profile-table',
        applicable_scope: { package_ids: [], package_names: [], document_type: 'technical' },
        format_strength: 'strict',
        document_title: '技术文件',
        outline: [{
          format_node_id: 'node-table',
          source_number: '2.10',
          source_title: '技术偏差表',
          required_in_outline: true,
          response_required: true,
          title_locked: true,
          order_locked: true,
          level_locked: true,
          numbering_policy: 'preserve-source',
          response_mode: 'fixed-markdown-table',
          allow_ai_children: false,
          template_id: 'template-table',
          children: [],
          source: { anchor_ids: ['source-anchor-2.10'] },
        }],
      }],
      template_ids: ['template-table'],
      other_format_rules: { signature_and_seal: [], file_and_upload: [], typesetting: [], required_template_ids: ['template-table'] },
      sources: [{ anchor_ids: [directoryRow.id, templateRows[2].id] }],
    },
    templates: [{
      template_id: 'template-table',
      kind: 'fixed-markdown-table',
      profile_id: 'profile-table',
      format_node_id: 'node-table',
      source_title: '技术偏差表',
      source_location: { anchor_ids: [templateRows[0].id, templateRows[2].id] },
    }],
  };
  let requestJsonCalls = 0;
  await assert.rejects(
    () => runBidDocumentFormatAnalysis({
      aiService: {
        requestJson: async (request) => {
          requestJsonCalls += 1;
          if (requestJsonCalls === 1) return structuredClone(draft);
          const prompt = request.messages.map((message) => message.content).join('\n');
          assert.match(prompt, /固定3/u);
          throw new Error('STOP_AFTER_TABLE_SOURCE');
        },
      },
      task: getBidAnalysisTaskById('bidDocumentFormatRequirements'),
      fileContent: buildSourceAnchorContext(sourceAnchors),
      tenderSources,
      sourceAnchors,
    }),
    /格式要求固定模板编译失败：STOP_AFTER_TABLE_SOURCE/u,
  );
  assert.equal(requestJsonCalls, 2);

  const crossTable = structuredClone(draft);
  crossTable.templates[0].source_location = { anchor_ids: [directoryRow.id, templateRows[0].id] };
  await assert.rejects(
    () => runBidDocumentFormatAnalysis({
      aiService: { requestJson: async () => crossTable },
      task: getBidAnalysisTaskById('bidDocumentFormatRequirements'),
      fileContent: buildSourceAnchorContext(sourceAnchors),
      tenderSources,
      sourceAnchors,
    }),
    /templates\[0\]\.source_location\.anchor_ids: 固定模板来源不得跨越多个 HTML 表格/u,
  );

  const lockedCrossTable = structuredClone(crossTable);
  lockedCrossTable.result.profiles[0].outline[0].response_mode = 'locked-commitment';
  lockedCrossTable.templates[0].kind = 'locked-commitment';
  await assert.rejects(
    () => runBidDocumentFormatAnalysis({
      aiService: { requestJson: async () => lockedCrossTable },
      task: getBidAnalysisTaskById('bidDocumentFormatRequirements'),
      fileContent: buildSourceAnchorContext(sourceAnchors),
      tenderSources,
      sourceAnchors,
    }),
    /templates\[0\]\.source_location\.anchor_ids: 固定模板来源不得跨越多个 HTML 表格/u,
  );

  const unknownTemplateSource = structuredClone(draft);
  unknownTemplateSource.templates[0].source_location = { anchor_ids: ['source-anchor-missing'] };
  await assert.rejects(
    () => runBidDocumentFormatAnalysis({
      aiService: { requestJson: async () => unknownTemplateSource },
      task: getBidAnalysisTaskById('bidDocumentFormatRequirements'),
      fileContent: buildSourceAnchorContext(sourceAnchors),
      tenderSources,
      sourceAnchors,
    }),
    /templates\[0\]\.source_location\.anchor_ids\[0\]: 未知来源锚点 source-anchor-missing/u,
  );
});

test('format analysis deterministically keeps the matching directory anchor when an outline source also cites a distant detail heading', async () => {
  const tenderSources = [{
    id: 'source-a',
    fileName: 'A.md',
    markdown: '<h2>10 技术偏差表</h2>\n编号干扰\n<h2>1.技术偏差表</h2>\n中间无关内容\n<table><tr><td>1</td><td>技术偏差表</td></tr><tr><td>2</td><td>专项投标文件</td></tr><tr><td>2.10</td><td>禁止转包、分包承诺函</td></tr></table>',
  }];
  const sourceAnchors = buildBidAnalysisSourceAnchors(tenderSources);
  const directoryAnchor = sourceAnchors.anchors.find((anchor) => anchor.tableCells?.join('|') === '1|技术偏差表');
  const wrongNumberAnchor = sourceAnchors.anchors.find((anchor) => anchor.visibleText === '## 10 技术偏差表');
  const detailAnchor = sourceAnchors.anchors.find((anchor) => anchor.visibleText === '## 1.技术偏差表');
  const unrelatedAnchor = sourceAnchors.anchors.find((anchor) => anchor.visibleText === '中间无关内容');
  assert.ok(directoryAnchor);
  assert.ok(wrongNumberAnchor);
  assert.ok(detailAnchor);
  assert.ok(unrelatedAnchor);

  const stageOneDraft = {
    result: {
      schema_version: 1,
      has_explicit_technical_format: true,
      profiles: [{
        profile_id: 'profile-1',
        applicable_scope: { section_id: 'section-1', section_title: '一标段', package_ids: [], package_names: [], document_type: 'technical' },
        format_strength: 'strict',
        document_title: '技术文件',
        outline: [{
          format_node_id: 'node-table',
          source_number: '1',
          source_title: '技术偏差表',
          required_in_outline: true,
          response_required: true,
          title_locked: true,
          order_locked: true,
          level_locked: true,
          numbering_policy: 'preserve-source',
          response_mode: 'freeform-markdown',
          allow_ai_children: false,
          children: [],
          source: { anchor_ids: [wrongNumberAnchor.id, detailAnchor.id, directoryAnchor.id] },
        }],
      }],
      template_ids: [],
      other_format_rules: { signature_and_seal: [], file_and_upload: [], typesetting: [], required_template_ids: [] },
      sources: [],
    },
    templates: [],
  };
  let requestJsonCalls = 0;
  const developerEvents = [];
  const resultText = await runBidDocumentFormatAnalysis({
    aiService: {
      requestJson: async () => {
        requestJsonCalls += 1;
        return structuredClone(stageOneDraft);
      },
    },
    task: getBidAnalysisTaskById('bidDocumentFormatRequirements'),
    fileContent: buildSourceAnchorContext(sourceAnchors),
    tenderSources,
    sourceAnchors,
    developerLogger: {
      enabled: true,
      write: (event, payload) => developerEvents.push({ event, payload }),
    },
  });

  const normalized = JSON.parse(resultText);
  assert.equal(requestJsonCalls, 1);
  assert.equal(normalized.result.profiles[0].outline[0].source.excerpt, '<tr><td>1</td><td>技术偏差表</td></tr>');
  assert.doesNotMatch(normalized.result.profiles[0].outline[0].source.excerpt, /中间无关内容/u);
  assert.equal(developerEvents.find((item) => item.event === 'format.outline_source.normalized')?.payload.selected_anchor_id, directoryAnchor.id);

  const fabricatedAnchor = structuredClone(stageOneDraft);
  fabricatedAnchor.result.profiles[0].outline[0].source_number = '2.10';
  fabricatedAnchor.result.profiles[0].outline[0].source_title = '禁止转包、分包承诺函';
  fabricatedAnchor.result.profiles[0].outline[0].source.anchor_ids = ['source-anchor-2.10'];
  const fabricatedAnchorResult = await runBidDocumentFormatAnalysis({
    aiService: { requestJson: async () => structuredClone(fabricatedAnchor) },
    task: getBidAnalysisTaskById('bidDocumentFormatRequirements'),
    fileContent: buildSourceAnchorContext(sourceAnchors),
    tenderSources,
    sourceAnchors,
  });
  assert.equal(
    JSON.parse(fabricatedAnchorResult).result.profiles[0].outline[0].source.excerpt,
    '<tr><td>2.10</td><td>禁止转包、分包承诺函</td></tr>',
  );

  const omittedAnchor = structuredClone(fabricatedAnchor);
  delete omittedAnchor.result.profiles[0].outline[0].source;
  const omittedAnchorResult = await runBidDocumentFormatAnalysis({
    aiService: { requestJson: async () => structuredClone(omittedAnchor) },
    task: getBidAnalysisTaskById('bidDocumentFormatRequirements'),
    fileContent: buildSourceAnchorContext(sourceAnchors),
    tenderSources,
    sourceAnchors,
  });
  assert.equal(
    JSON.parse(omittedAnchorResult).result.profiles[0].outline[0].source.excerpt,
    '<tr><td>2.10</td><td>禁止转包、分包承诺函</td></tr>',
  );

  const numberedOnly = structuredClone(stageOneDraft);
  numberedOnly.result.profiles[0].outline[0].source.anchor_ids = [wrongNumberAnchor.id, detailAnchor.id];
  const numberedText = await runBidDocumentFormatAnalysis({
    aiService: { requestJson: async () => structuredClone(numberedOnly) },
    task: getBidAnalysisTaskById('bidDocumentFormatRequirements'),
    fileContent: buildSourceAnchorContext(sourceAnchors),
    tenderSources,
    sourceAnchors,
  });
  assert.equal(JSON.parse(numberedText).result.profiles[0].outline[0].source.excerpt, '<tr><td>1</td><td>技术偏差表</td></tr>');

  const wrongNumberOnly = structuredClone(stageOneDraft);
  wrongNumberOnly.result.profiles[0].outline[0].source.anchor_ids = [wrongNumberAnchor.id, unrelatedAnchor.id];
  const wrongNumberText = await runBidDocumentFormatAnalysis({
    aiService: { requestJson: async () => structuredClone(wrongNumberOnly) },
    task: getBidAnalysisTaskById('bidDocumentFormatRequirements'),
    fileContent: buildSourceAnchorContext(sourceAnchors),
    tenderSources,
    sourceAnchors,
  });
  assert.equal(JSON.parse(wrongNumberText).result.profiles[0].outline[0].source.excerpt, '<tr><td>1</td><td>技术偏差表</td></tr>');

  const scatteredRuleSources = structuredClone(stageOneDraft);
  scatteredRuleSources.result.sources = [{ anchor_ids: [wrongNumberAnchor.id, directoryAnchor.id] }];
  const scatteredRuleText = await runBidDocumentFormatAnalysis({
    aiService: { requestJson: async () => structuredClone(scatteredRuleSources) },
    task: getBidAnalysisTaskById('bidDocumentFormatRequirements'),
    fileContent: buildSourceAnchorContext(sourceAnchors),
    tenderSources,
    sourceAnchors,
  });
  assert.deepEqual(
    JSON.parse(scatteredRuleText).result.sources.map((source) => source.excerpt),
    ['<h2>10 技术偏差表</h2>', '<tr><td>1</td><td>技术偏差表</td></tr>'],
  );

  const unmatched = structuredClone(stageOneDraft);
  unmatched.result.profiles[0].outline[0].source_title = '未被引用锚点证明的标题';
  unmatched.result.profiles[0].outline[0].source.anchor_ids = [unrelatedAnchor.id];
  await assert.rejects(
    () => runBidDocumentFormatAnalysis({
      aiService: { requestJson: async () => unmatched },
      task: getBidAnalysisTaskById('bidDocumentFormatRequirements'),
      fileContent: buildSourceAnchorContext(sourceAnchors),
      tenderSources,
      sourceAnchors,
    }),
    /无法根据 source_number 与 source_title 定位真实来源/u,
  );

  const ambiguous = structuredClone(stageOneDraft);
  ambiguous.result.profiles[0].outline[0].source_number = undefined;
  ambiguous.result.profiles[0].outline[0].source_title = '封面页';
  const ambiguousSources = buildBidAnalysisSourceAnchors([{
    id: 'source-a',
    fileName: 'A.md',
    markdown: '<table><tr><td></td><td>封面页</td></tr></table>\n中间无关内容\n<table><tr><td></td><td>封面页</td></tr></table>',
  }]);
  ambiguous.result.profiles[0].outline[0].source.anchor_ids = ambiguousSources.anchors
    .filter((anchor) => anchor.kind === 'html-table-row')
    .map((anchor) => anchor.id);
  await assert.rejects(
    () => runBidDocumentFormatAnalysis({
      aiService: { requestJson: async () => ambiguous },
      task: getBidAnalysisTaskById('bidDocumentFormatRequirements'),
      fileContent: buildSourceAnchorContext(ambiguousSources),
      tenderSources: [{ id: 'source-a', fileName: 'A.md', markdown: '<table><tr><td></td><td>封面页</td></tr></table>\n中间无关内容\n<table><tr><td></td><td>封面页</td></tr></table>' }],
      sourceAnchors: ambiguousSources,
    }),
    /多个来源锚点必须在同一源文件中连续/u,
  );

  const ambiguousWithUnknown = structuredClone(ambiguous);
  ambiguousWithUnknown.result.profiles[0].outline[0].source.anchor_ids = [
    ambiguousSources.anchors.find((anchor) => anchor.kind === 'html-table-row').id,
    'source-anchor-missing',
  ];
  await assert.rejects(
    () => runBidDocumentFormatAnalysis({
      aiService: { requestJson: async () => ambiguousWithUnknown },
      task: getBidAnalysisTaskById('bidDocumentFormatRequirements'),
      fileContent: buildSourceAnchorContext(ambiguousSources),
      tenderSources: [{ id: 'source-a', fileName: 'A.md', markdown: '<table><tr><td></td><td>封面页</td></tr></table>\n中间无关内容\n<table><tr><td></td><td>封面页</td></tr></table>' }],
      sourceAnchors: ambiguousSources,
    }),
    /result\.profiles\[0\]\.outline\[0\]\.source\.anchor_ids\[1\]: 未知来源锚点 source-anchor-missing/u,
  );
});

test('deterministic format validation failure never saves a result or starts semantic repair', async () => {
  const requiredTasks = getBidAnalysisTasks('key');
  let state = {
    bidAnalysisMode: 'key',
    bidAnalysisSelectedTaskIds: requiredIds,
    tenderFiles: [{ id: 'source-a', fileName: 'A.md' }],
    bidAnalysisTasks: Object.fromEntries(requiredTasks.map((task) => [task.id, {
      id: task.id,
      label: task.label,
      status: task.id === 'bidDocumentFormatRequirements' ? 'error' : 'success',
      content: completedTaskContent(task),
    }])),
    bidSectionMode: 'single',
  };
  let saveCalls = 0;
  const workspaceStore = {
    readTenderMarkdown: () => '测试招标文件',
    readTenderSourceMarkdown: () => 'A 文件第一行',
    loadTechnicalPlan: () => state,
    updateTechnicalPlan: (partial) => {
      state = { ...state, ...partial };
      return state;
    },
    saveStructuredBidAnalysisResult: () => {
      saveCalls += 1;
      throw new Error('不应保存');
    },
  };
  let backgroundTask = {};
  let requestJsonCalls = 0;
  let semanticRepairCalls = 0;
  const updateTask = (partial) => {
    backgroundTask = { ...backgroundTask, ...partial };
    return backgroundTask;
  };

  await runBidAnalysisTask({
    aiService: {
      getConfig: () => ({}),
      requestJson: async () => {
        requestJsonCalls += 1;
        return {
          result: {
            schema_version: 1,
            has_explicit_technical_format: false,
            profiles: [{
              profile_id: 'none',
              applicable_scope: { package_ids: [], package_names: [], document_type: 'technical' },
              format_strength: 'none',
              document_title: '技术文件',
              outline: [],
            }],
            template_ids: [],
            other_format_rules: { signature_and_seal: [], file_and_upload: [], typesetting: [], required_template_ids: [] },
            sources: [{ anchor_ids: ['source-anchor-missing'] }],
          },
          templates: [],
        };
      },
      parseJsonResponseContent: async () => {
        semanticRepairCalls += 1;
        throw new Error('不应发起语义修复');
      },
    },
    workspaceStore,
    updateTask,
    payload: { mode: 'key', selected_task_ids: requiredIds, task_ids: ['bidDocumentFormatRequirements'] },
  });

  assert.equal(saveCalls, 0);
  assert.equal(requestJsonCalls, 1);
  assert.equal(semanticRepairCalls, 0);
  assert.equal(state.bidAnalysisTasks.bidDocumentFormatRequirements.status, 'error');
  assert.match(state.bidAnalysisTasks.bidDocumentFormatRequirements.error, /确定性校验失败.*未知来源锚点/u);
  assert.equal(state.bidAnalysisTasks.bidDocumentFormatRequirements.diagnostic.error_code, 'FORMAT_VALIDATION_FAILED');
  assert.equal(state.bidAnalysisTasks.bidDocumentFormatRequirements.diagnostic.requires_manual_review, true);
  assert.equal(state.bidAnalysisTasks.bidDocumentFormatRequirements.requires_manual_review, true);
  assert.match(state.bidAnalysisTasks.bidDocumentFormatRequirements.diagnostic.error_path, /result\.sources\[0\]\.anchor_ids\[0\]/u);
  assert.match(state.bidAnalysisTasks.bidDocumentFormatRequirements.diagnostic.anchor_catalog_hash, /^[a-f0-9]{64}$/u);
  assert.equal(state.bidAnalysisTask.status, 'error');
});
