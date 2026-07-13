const assert = require('node:assert/strict');
const test = require('node:test');

const {
  ANALYSIS_ERROR_CODES,
  BID_DOCUMENT_FORMAT_PROMPT_VERSION,
  getBidAnalysisTaskById,
  getBidAnalysisTasks,
  runBidDocumentFormatAnalysis,
  runBidAnalysisTask,
} = require('./bidAnalysisTask.cjs');
const {
  buildBidAnalysisSourceAnchors,
  buildSourceAnchorContext,
  resolveSourceAnchorReference,
} = require('./bidAnalysisSourceAnchors.cjs');
const {
  normalizeBidDocumentFormatRequirements,
} = require('./bidAnalysisResultSchemas.cjs');
const {
  replayFixtures,
} = require('./__fixtures__/bidAnalysisFormatReplayFixtures.cjs');

const formatTask = getBidAnalysisTaskById('bidDocumentFormatRequirements');
const requiredTaskIds = getBidAnalysisTasks('key').map((task) => task.id);
const noFormatResult = {
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
};

function clone(value) {
  return structuredClone(value);
}

function createValidatorCatalogWithAmbiguousCover() {
  const tenderSources = [{
    id: 'doc-redacted-format-001',
    fileName: '脱敏招标文件.md',
    markdown: [
      '<table>',
      '<tr><td>三</td><td>技术文件（按包制作）</td></tr>',
      '<tr><td></td><td>封面页</td></tr>',
      '</table>',
      '<table><tr><td></td><td>封面页</td></tr></table>',
    ].join('\n'),
  }];
  const sourceAnchors = buildBidAnalysisSourceAnchors(tenderSources);
  return { tenderSources, sourceAnchors, fileContent: buildSourceAnchorContext(sourceAnchors) };
}

function completedTaskContent(task) {
  if (task.id === 'bidDocumentFormatRequirements') {
    return JSON.stringify(noFormatResult.result);
  }
  return task.output === 'json' ? '{}' : `${task.label}已完成`;
}

test('replay fixture keeps sanitized diagnostic metadata and no tender text', () => {
  const replay = replayFixtures.bareCf5UnknownAnchor;
  assert.equal(replay.run_id, 'run-redacted-format-001');
  assert.equal(replay.document_id, 'doc-redacted-format-001');
  assert.equal(replay.document_version, 'doc-version-redacted-001');
  assert.equal(replay.prompt_version, 'bid-format-replay-v1');
  assert.match(replay.anchor_catalog_hash, /^[a-f0-9]{64}$/u);
  assert.deepEqual(replay.prompt_anchor_ids, [
    'source-anchor-18e2409b0a42c722adf1',
    'source-anchor-cf5d4ad4f7605193cf2c',
    'source-anchor-fc2ec04da9b801713ae3',
  ]);
  assert.match(replay.raw_model_response, /cf5d4ad4f7605193cf2c/u);
  assert.doesNotMatch(replay.raw_model_response, /国网|湖北|武汉|供电|采购|招标编号/u);
});

test('model bare cf5d4ad4f7605193cf2c against current validator catalog reproduces unknown source anchor without API calls', async () => {
  const replay = replayFixtures.bareCf5UnknownAnchor;
  const catalog = createValidatorCatalogWithAmbiguousCover();

  assert.equal(catalog.sourceAnchors.byId.has('cf5d4ad4f7605193cf2c'), false);
  assert.equal(catalog.sourceAnchors.byId.has('source-anchor-cf5d4ad4f7605193cf2c'), false);

  let requestJsonCalls = 0;
  await assert.rejects(
    () => runBidDocumentFormatAnalysis({
      aiService: {
        requestJson: async () => {
          requestJsonCalls += 1;
          return clone(replay.parsed_result);
        },
      },
      task: formatTask,
      fileContent: catalog.fileContent,
      tenderSources: catalog.tenderSources,
      sourceAnchors: catalog.sourceAnchors,
    }),
    (error) => error?.code === ANALYSIS_ERROR_CODES.FORMAT_VALIDATION_FAILED
      && error?.path === 'result.profiles[0].outline[0].children[0].source.anchor_ids[0]'
      && /未知来源锚点 cf5d4ad4f7605193cf2c/u.test(error.message),
  );
  assert.equal(requestJsonCalls, 1);
});

test('format model request carries run/document/prompt/catalog metadata and no real API call', async () => {
  const catalog = createValidatorCatalogWithAmbiguousCover();
  let requestJsonCalls = 0;

  await runBidDocumentFormatAnalysis({
    aiService: {
      requestJson: async (request) => {
        requestJsonCalls += 1;
        assert.equal(request.analysis_context.run_id, 'direct-format-analysis');
        assert.match(request.analysis_context.document_id, /^[a-f0-9]{64}$/u);
        assert.match(request.analysis_context.document_version, /^[a-f0-9]{64}$/u);
        assert.equal(request.analysis_context.prompt_version, BID_DOCUMENT_FORMAT_PROMPT_VERSION);
        assert.equal(request.analysis_context.anchor_catalog_hash, catalog.sourceAnchors.anchor_catalog_hash);
        return clone(noFormatResult);
      },
    },
    task: formatTask,
    fileContent: catalog.fileContent,
    tenderSources: catalog.tenderSources,
    sourceAnchors: catalog.sourceAnchors,
  });

  assert.equal(requestJsonCalls, 1);
});

test('production preflight reports ANCHOR_CATALOG_MISMATCH before ordinary unknown-anchor validation', async () => {
  const replay = replayFixtures.catalogMismatch;
  const catalog = createValidatorCatalogWithAmbiguousCover();
  let requestJsonCalls = 0;

  await assert.rejects(
    () => runBidDocumentFormatAnalysis({
      aiService: {
        requestJson: async () => {
          requestJsonCalls += 1;
          return clone(replay.parsed_result);
        },
      },
      task: formatTask,
      fileContent: catalog.fileContent,
      tenderSources: catalog.tenderSources,
      sourceAnchors: catalog.sourceAnchors,
      analysisContext: {
        run_id: replay.run_id,
        document_id: replay.document_id,
        document_version: replay.document_version,
        prompt_version: replay.prompt_version,
        anchor_catalog_hash: replay.anchor_catalog_hash,
      },
    }),
    (error) => error?.code === ANALYSIS_ERROR_CODES.ANCHOR_CATALOG_MISMATCH
      && /ANCHOR_CATALOG_MISMATCH/u.test(error.message)
      && !/未知来源锚点/u.test(error.message),
  );
  assert.equal(requestJsonCalls, 0);
});

test('late response from an old run_id is ignored and does not overwrite the new task state', async () => {
  const oldReplay = replayFixtures.oldRunLateResponse;
  const requiredTasks = getBidAnalysisTasks('key');
  let state = {
    bidAnalysisMode: 'key',
    bidAnalysisSelectedTaskIds: requiredTaskIds,
    bidSectionMode: 'single',
    tenderFiles: [{ id: 'source-a', fileName: '脱敏.md' }],
    bidAnalysisTask: { task_id: oldReplay.run_id, status: 'running', progress: 0 },
    bidAnalysisTasks: Object.fromEntries(requiredTasks.map((task) => [task.id, {
      id: task.id,
      label: task.label,
      status: task.id === 'bidDocumentFormatRequirements' ? 'error' : 'success',
      content: completedTaskContent(task),
    }])),
  };
  let backgroundTask = { task_id: oldReplay.run_id, status: 'running', progress: 0 };
  let requestJsonCalls = 0;
  let saveCalls = 0;
  const workspaceStore = {
    readTenderMarkdown: () => '脱敏工作副本',
    readTenderSourceMarkdown: () => '格式要求\n技术文件采用固定目录。',
    loadTechnicalPlan: () => state,
    updateTechnicalPlan: (partial) => {
      state = { ...state, ...partial };
      return state;
    },
    saveStructuredBidAnalysisResult: () => {
      saveCalls += 1;
      throw new Error('旧任务不应保存');
    },
  };
  const updateTask = (partial) => {
    backgroundTask = { ...backgroundTask, ...partial };
    return backgroundTask;
  };

  await runBidAnalysisTask({
    aiService: {
      getConfig: () => ({}),
      requestJson: async () => {
        requestJsonCalls += 1;
        state = {
          ...state,
          bidAnalysisTask: { task_id: 'run-redacted-format-new', status: 'running', progress: 10 },
          bidAnalysisTasks: {
            ...state.bidAnalysisTasks,
            bidDocumentFormatRequirements: {
              id: 'bidDocumentFormatRequirements',
              label: '格式要求',
              status: 'running',
              content: 'new-run-state',
            },
          },
        };
        return clone(noFormatResult);
      },
    },
    workspaceStore,
    updateTask,
    payload: {
      run_id: oldReplay.run_id,
      mode: 'key',
      selected_task_ids: requiredTaskIds,
      task_ids: ['bidDocumentFormatRequirements'],
    },
  });

  assert.equal(requestJsonCalls, 1);
  assert.equal(saveCalls, 0);
  assert.equal(state.bidAnalysisTask.task_id, 'run-redacted-format-new');
  assert.equal(state.bidAnalysisTasks.bidDocumentFormatRequirements.content, 'new-run-state');
});

test('anchor IDs with surrounding whitespace are trimmed, but invisible characters still fail in current behavior', () => {
  const sourceAnchors = buildBidAnalysisSourceAnchors([{
    id: 'doc-anchor-whitespace',
    fileName: '脱敏.md',
    markdown: '第一项\n第二项',
  }]);
  const firstId = sourceAnchors.anchors[0].id;

  const resolved = resolveSourceAnchorReference({ anchor_ids: [` \t${firstId}\r\n`] }, sourceAnchors, 'node.source');
  assert.equal(resolved.anchors[0].id, firstId);

  assert.throws(
    () => resolveSourceAnchorReference({ anchor_ids: [`\u200b${firstId}`] }, sourceAnchors, 'node.source'),
    /node\.source\.anchor_ids\[0\]: 未知来源锚点/u,
  );
});

test('excerpt with source_line prefix reproduces whitespace-normalized source lookup failure', () => {
  const tenderSources = [{
    id: 'doc-excerpt-line-prefix',
    fileName: '脱敏.md',
    markdown: '技术文件采用固定目录。',
  }];
  const fixture = {
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
      sources: [{
        source_file_id: 'doc-excerpt-line-prefix',
        markdown_line_start: 1,
        markdown_line_end: 1,
        excerpt: '[source_line:1] 技术文件采用固定目录。',
      }],
    },
    templates: [],
  };

  assert.throws(
    () => normalizeBidDocumentFormatRequirements(fixture, tenderSources),
    /result\.sources\[0\]\.excerpt: 必须能在源文件中按空白归一化后定位/u,
  );
});

test('multiple anchors from the same file but not contiguous reproduce the continuity error', () => {
  const sourceAnchors = buildBidAnalysisSourceAnchors([{
    id: 'doc-non-contiguous',
    fileName: '脱敏.md',
    markdown: '第一项\n中间项\n第三项',
  }]);

  assert.throws(
    () => resolveSourceAnchorReference({
      anchor_ids: [sourceAnchors.anchors[0].id, sourceAnchors.anchors[2].id],
    }, sourceAnchors, 'template.source_location'),
    /template\.source_location\.anchor_ids: 多个来源锚点必须在同一源文件中连续/u,
  );
});

test('invalid JSON replay fails once and never retries or calls a real model', async () => {
  const replay = replayFixtures.invalidJson;
  const catalog = createValidatorCatalogWithAmbiguousCover();
  let requestJsonCalls = 0;

  await assert.rejects(
    () => runBidDocumentFormatAnalysis({
      aiService: {
        requestJson: async (request) => {
          requestJsonCalls += 1;
          assert.equal(request.max_retries, 0);
          assert.equal(request.repair_invalid_json, false);
          JSON.parse(replay.raw_model_response);
        },
      },
      task: formatTask,
      fileContent: catalog.fileContent,
      tenderSources: catalog.tenderSources,
      sourceAnchors: catalog.sourceAnchors,
    }),
    /Unexpected end of JSON input/u,
  );
  assert.equal(requestJsonCalls, 1);
});
