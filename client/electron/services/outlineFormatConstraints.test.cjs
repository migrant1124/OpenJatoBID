const test = require('node:test');
const assert = require('node:assert/strict');

const {
  applyControlledOutlinePatch,
  instantiateFormatOutline,
  mergeScoringOutlineIntoFormat,
  numberOutlineForDisplay,
  selectApplicableFormatProfile,
  validateFormatOutline,
} = require('./outlineFormatConstraints.cjs');

function scope(overrides = {}) {
  return {
    package_ids: [],
    package_names: [],
    document_type: 'technical',
    ...overrides,
  };
}

function formatNode(id, title, overrides = {}) {
  return {
    format_node_id: id,
    source_title: title,
    required_in_outline: true,
    response_required: true,
    title_locked: true,
    order_locked: true,
    level_locked: true,
    numbering_policy: 'auto',
    response_mode: 'freeform-markdown',
    allow_ai_children: false,
    children: [],
    ...overrides,
  };
}

function profile(id, formatStrength, applicableScope, outline = []) {
  return {
    profile_id: id,
    applicable_scope: applicableScope,
    format_strength: formatStrength,
    document_title: `${id} 文档`,
    outline,
  };
}

function result(profiles, explicit = true) {
  return {
    schema_version: 1,
    has_explicit_technical_format: explicit,
    profiles,
    template_ids: [],
    other_format_rules: {
      signature_and_seal: [],
      file_and_upload: [],
      typesetting: [],
      required_template_ids: [],
    },
    sources: [],
  };
}

function expectCode(code) {
  return (error) => error?.code === code;
}

function strictProfile() {
  return profile('state-grid', 'strict', scope({ section_id: 'section-a', package_ids: ['pkg-1'] }), [
    formatNode('root-tech', '1 技术文件', {
      source_number: '1',
      numbering_policy: 'preserve-source',
      response_mode: 'container',
      allow_ai_children: true,
      children: [
        formatNode('commitment', '承诺函', {
          source_number: '1.1',
          numbering_policy: 'preserve-source',
          response_mode: 'locked-commitment',
          template_id: 'tpl-commitment',
        }),
        formatNode('other', '其他（如有）', {
          source_number: '1.2',
          numbering_policy: 'preserve-source',
          required_in_outline: false,
          response_required: false,
        }),
      ],
    }),
    formatNode('root-service', '服务方案', {
      allow_ai_children: true,
      children: [
        formatNode('service-fixed', '固定服务要求'),
      ],
    }),
  ]);
}

test('未发现明确格式时自动选择唯一全局 technical/none profile', () => {
  const none = profile('global-none', 'none', scope(), []);
  assert.equal(selectApplicableFormatProfile(result([none], false), scope()), none);
  assert.deepEqual(instantiateFormatOutline(none), { outline: [] });

  assert.throws(
    () => selectApplicableFormatProfile(result([none, profile('other-none', 'none', scope(), [])], false), scope()),
    expectCode('INVALID_FORMAT_RESULT'),
  );
});

test('显式格式拒绝全局 none 回退', () => {
  const fixed = profile('scoped', 'strict', scope({ package_ids: ['a'] }), [formatNode('a-root', 'A包')]);
  const globalNone = profile('global-none', 'none', scope(), []);
  assert.throws(
    () => selectApplicableFormatProfile(result([fixed, globalNone]), scope({ package_ids: ['b'] })),
    expectCode('INVALID_FORMAT_RESULT'),
  );
});

test('显式格式按 scope specificity 选择，ID 在相同 specificity 下优先于标题兼容', () => {
  const wildcard = profile('wildcard', 'fixed-roots', scope(), [formatNode('w', '通用')]);
  const titleCompatible = profile('title', 'fixed-roots', scope({ section_title: '第一标段' }), [formatNode('t', '标题匹配')]);
  const idMatch = profile('id', 'strict', scope({ section_id: 's1' }), [formatNode('i', 'ID匹配')]);
  const selected = selectApplicableFormatProfile(
    result([wildcard, titleCompatible, idMatch]),
    scope({ section_id: 's1', section_title: '第一标段' }),
  );
  assert.equal(selected.profile_id, 'id');

  const packageSpecific = profile(
    'package-specific',
    'fixed-roots',
    scope({ section_title: '第一标段', package_names: ['包1'] }),
    [formatNode('p', '标包匹配')],
  );
  assert.equal(
    selectApplicableFormatProfile(
      result([idMatch, packageSpecific]),
      scope({ section_id: 's1', section_title: '第一标段', package_names: ['包1'] }),
    ).profile_id,
    'package-specific',
  );
});

test('显式 profile ID 必须存在且适用，显式 scope 的 none 可被选中', () => {
  const fixed = profile('south-grid-a', 'fixed-roots', scope({ package_ids: ['a'] }), [formatNode('a-root', 'A包')]);
  const none = profile('south-grid-b-none', 'none', scope({ package_ids: ['b'] }), []);
  const parsed = result([fixed, none]);
  assert.equal(selectApplicableFormatProfile(parsed, scope({ package_ids: ['b'] })).profile_id, none.profile_id);
  assert.equal(selectApplicableFormatProfile(parsed, scope({ package_ids: ['b'] }), none.profile_id), none);
  assert.throws(
    () => selectApplicableFormatProfile(parsed, scope({ package_ids: ['a'] }), none.profile_id),
    expectCode('FORMAT_PROFILE_NOT_APPLICABLE'),
  );
  assert.throws(
    () => selectApplicableFormatProfile(parsed, scope({ package_ids: ['a'] }), 'missing'),
    expectCode('FORMAT_PROFILE_NOT_FOUND'),
  );
});

test('零匹配和最高 specificity 并列均阻断，不自动猜测', () => {
  const a = profile('a', 'strict', scope({ package_ids: ['a'] }), [formatNode('a1', 'A')]);
  const b = profile('b', 'fixed-roots', scope({ package_ids: ['b'] }), [formatNode('b1', 'B')]);
  assert.throws(
    () => selectApplicableFormatProfile(result([a, b]), scope({ package_ids: ['c'] })),
    expectCode('FORMAT_PROFILE_NOT_FOUND'),
  );

  const a2 = profile('a2', 'fixed-roots', scope({ package_ids: ['a'] }), [formatNode('a2-1', 'A2')]);
  assert.throws(
    () => selectApplicableFormatProfile(result([a, a2]), scope({ package_ids: ['a'] })),
    expectCode('FORMAT_PROFILE_AMBIGUOUS'),
  );
});

test('非法非 technical profile 在选择门禁失败', () => {
  const invalid = profile('quotation', 'strict', { ...scope(), document_type: 'quotation' }, [formatNode('q', '报价')]);
  assert.throws(
    () => selectApplicableFormatProfile(result([invalid]), scope()),
    expectCode('INVALID_FORMAT_PROFILE_TYPE'),
  );
});

test('strict profile 完整实例化骨架、默认状态并强制保留如有和其他', () => {
  const instantiated = instantiateFormatOutline(strictProfile());
  assert.deepEqual(instantiated.outline.map((item) => item.format_node_id), ['root-tech', 'root-service']);
  assert.equal(instantiated.outline[0].title, '技术文件');
  assert.equal(instantiated.outline[0].source_number, '1');
  assert.equal(instantiated.outline[0].id, '1');
  assert.equal(instantiated.outline[0].children[0].id, '1.1');
  assert.equal(instantiated.outline[0].children[0].content, '');
  assert.equal(instantiated.outline[0].children[0].response_status, 'needs-manual-input');
  assert.equal(instantiated.outline[0].children[0].compliance_risk, 'none');
  assert.deepEqual(instantiated.outline[0].children[0].knowledge_item_ids, []);
  assert.equal(instantiated.outline[0].children[1].required_in_outline, true);
  assert.equal(instantiated.outline[0].children[1].response_required, true);
  assert.equal(instantiated.outline[0].children[1].title, '其他（如有）');
});

test('fixed-roots profile 保留固定根并允许在声明位置展开', () => {
  const tobacco = profile('sichuan-tobacco', 'fixed-roots', scope(), [
    formatNode('implementation', '实施方案', { allow_ai_children: true }),
    formatNode('commitment-root', '服务承诺', { allow_ai_children: false }),
  ]);
  const base = instantiateFormatOutline(tobacco);
  const next = applyControlledOutlinePatch(base, {
    additions: [{
      parent_format_node_id: 'implementation',
      node: { title: '项目组织', description: '对应评分项', mapped_requirement_ids: ['score-1'] },
    }],
  }, tobacco);
  assert.equal(next.outline.length, 2);
  assert.equal(next.outline[0].children[0].title, '项目组织');
  assert.deepEqual(validateFormatOutline(next, tobacco, { requireScoreCoverage: ['score-1'] }), {
    valid: true,
    mappedRequirementIds: ['score-1'],
    missingRequirementIds: [],
  });
});

test('非必选且未锁顺序的固定节点可删除或重排', () => {
  const optional = profile('optional', 'fixed-roots', scope(), [
    formatNode('required', '必选', { order_locked: false }),
    formatNode('optional-node', '可选', { required_in_outline: false, order_locked: false }),
  ]);
  const instantiated = instantiateFormatOutline(optional);
  assert.doesNotThrow(() => validateFormatOutline({ outline: [instantiated.outline[1], instantiated.outline[0]] }, optional));
  assert.doesNotThrow(() => validateFormatOutline({ outline: [instantiated.outline[0]] }, optional));
});

test('格式门禁拒绝删除、改名、重排、换层级、改源编号和锁字段', () => {
  const currentProfile = strictProfile();
  const cases = [];

  const deleted = instantiateFormatOutline(currentProfile);
  deleted.outline[0].children.splice(0, 1);
  cases.push(deleted);

  const renamed = instantiateFormatOutline(currentProfile);
  renamed.outline[0].title = '新的技术文件';
  cases.push(renamed);

  const reordered = instantiateFormatOutline(currentProfile);
  reordered.outline.reverse();
  cases.push(reordered);

  const moved = instantiateFormatOutline(currentProfile);
  moved.outline[1].children.push(moved.outline[0].children.shift());
  cases.push(moved);

  const sourceChanged = instantiateFormatOutline(currentProfile);
  sourceChanged.outline[0].source_number = '2';
  cases.push(sourceChanged);

  const numberingChanged = instantiateFormatOutline(currentProfile);
  numberingChanged.outline[0].numbering_policy = 'none';
  cases.push(numberingChanged);

  const lockChanged = instantiateFormatOutline(currentProfile);
  lockChanged.outline[0].title_locked = false;
  cases.push(lockChanged);

  const modeChanged = instantiateFormatOutline(currentProfile);
  modeChanged.outline[0].children[0].response_mode = 'freeform-markdown';
  cases.push(modeChanged);

  const templateChanged = instantiateFormatOutline(currentProfile);
  templateChanged.outline[0].children[0].template_id = 'different';
  cases.push(templateChanged);

  for (const candidate of cases) {
    assert.throws(() => validateFormatOutline(candidate, currentProfile), expectCode('FORMAT_GATE_FAILED'));
  }
});

test('格式门禁拒绝额外顶级目录和向 allow_ai_children=false 节点新增', () => {
  const currentProfile = strictProfile();
  const extraRoot = instantiateFormatOutline(currentProfile);
  extraRoot.outline.push({ id: '3', title: '并列根', children: [] });
  assert.throws(() => validateFormatOutline(extraRoot, currentProfile), expectCode('FORMAT_GATE_FAILED'));

  const forbiddenChild = instantiateFormatOutline(currentProfile);
  forbiddenChild.outline[0].children[0].children.push({ id: '1.1.1', title: '越权子目录', children: [] });
  assert.throws(() => validateFormatOutline(forbiddenChild, currentProfile), expectCode('FORMAT_GATE_FAILED'));
});

test('评分覆盖门禁返回缺失 requirement IDs', () => {
  const currentProfile = strictProfile();
  const base = instantiateFormatOutline(currentProfile);
  base.outline[0].mapped_requirement_ids = ['score-1'];
  assert.throws(
    () => validateFormatOutline(base, currentProfile, { requireScoreCoverage: true, requirementIds: ['score-1', 'score-2'] }),
    (error) => error?.code === 'SCORE_COVERAGE_FAILED' && error.details.missingRequirementIds[0] === 'score-2',
  );
});

test('受控 patch 只允许可变区的描述、评分映射和新增目录', () => {
  const currentProfile = strictProfile();
  const base = instantiateFormatOutline(currentProfile);
  const next = applyControlledOutlinePatch(base, {
    updates: [{
      format_node_id: 'root-tech',
      description: '覆盖项目要求',
      mapped_requirement_ids: ['score-1', 'score-1'],
    }],
    additions: [{
      parent_format_node_id: 'root-service',
      node: {
        title: '质量保障措施',
        mapped_requirement_ids: ['score-2'],
        children: [{ title: '质量检查', mapped_requirement_ids: ['score-3'] }],
      },
    }],
  }, currentProfile);
  assert.equal(next.outline[0].description, '覆盖项目要求');
  assert.deepEqual(next.outline[0].mapped_requirement_ids, ['score-1']);
  assert.equal(next.outline[1].children[1].title, '质量保障措施');
  assert.equal(next.outline[1].children[1].children[0].id, '2.2.1');
  assert.equal(base.outline[1].children.length, 1, '不得原地修改 base');
  validateFormatOutline(next, currentProfile, { requireScoreCoverage: ['score-1', 'score-2', 'score-3'] });
});

test('受控 patch 拒绝 Agent 删除、改名、重排、换层级、改源编号和禁用节点新增', () => {
  const currentProfile = strictProfile();
  const base = instantiateFormatOutline(currentProfile);
  const invalidPatches = [
    { deletions: ['commitment'] },
    { updates: [{ format_node_id: 'root-tech', title: '改名' }] },
    { updates: [{ format_node_id: 'root-tech', order: 2 }] },
    { updates: [{ format_node_id: 'root-tech', parent_id: '2' }] },
    { updates: [{ format_node_id: 'root-tech', source_number: '9' }] },
    { additions: [{ parent_format_node_id: 'commitment', node: { title: '非法子目录' } }] },
  ];
  for (const patch of invalidPatches) {
    assert.throws(
      () => applyControlledOutlinePatch(base, patch, currentProfile),
      (error) => error?.code === 'INVALID_CONTROLLED_PATCH' || error?.code === 'FORMAT_GATE_FAILED',
    );
  }
});

test('国网式全骨架合并评分结果时不提升并列根并保持确定顺序', () => {
  const currentProfile = strictProfile();
  const base = instantiateFormatOutline(currentProfile);
  const merged = mergeScoringOutlineIntoFormat(base, {
    outline: [
      {
        title: '组织实施方案',
        target_format_node_id: 'root-tech',
        source_requirement_id: 'score-1',
        children: [{ title: '人员组织', mapped_requirement_ids: ['score-2'] }],
      },
      {
        title: '售后服务',
        target_format_node_id: 'root-service',
        mapped_requirement_ids: ['score-3'],
      },
    ],
  }, ['score-1', 'score-2', 'score-3']);
  assert.equal(merged.outline.length, 2);
  assert.deepEqual(merged.outline.map((item) => item.format_node_id), ['root-tech', 'root-service']);
  assert.equal(merged.outline[0].children[2].title, '组织实施方案');
  assert.equal(merged.outline[1].children[1].title, '售后服务');
  assert.deepEqual(merged.outline[0].children[2].mapped_requirement_ids, ['score-1']);
});

test('南网式多个可展开位置要求评分结果明确目标，禁止猜测和禁用节点写入', () => {
  const currentProfile = strictProfile();
  const base = instantiateFormatOutline(currentProfile);
  assert.throws(
    () => mergeScoringOutlineIntoFormat(base, { outline: [{ title: '未指定位置', source_requirement_id: 's1' }] }, ['s1']),
    expectCode('SCORING_TARGET_AMBIGUOUS'),
  );
  assert.throws(
    () => mergeScoringOutlineIntoFormat(base, {
      outline: [{ title: '越权位置', target_format_node_id: 'commitment', source_requirement_id: 's1' }],
    }, ['s1']),
    expectCode('FORMAT_GATE_FAILED'),
  );
});

test('none profile 的评分目录保持普通顶级目录并完成覆盖校验', () => {
  const none = profile('global-none', 'none', scope(), []);
  const merged = mergeScoringOutlineIntoFormat(instantiateFormatOutline(none), {
    outline: [{ title: '技术评分响应', source_requirement_id: 'score-1' }],
  }, ['score-1']);
  assert.equal(merged.outline[0].id, '1');
  assert.equal(merged.outline[0].title, '技术评分响应');
});

test('编号预览分别处理 auto、preserve-source、none，源编号只出现一次', () => {
  const numbered = numberOutlineForDisplay({
    outline: [
      { id: '1', title: '1 自动编号标题', numbering_policy: 'auto', children: [] },
      { id: '2', title: '4.2 固定源编号标题', source_number: '4.2', numbering_policy: 'preserve-source', children: [] },
      { id: '3', title: '不显示编号', source_number: '7', numbering_policy: 'none', children: [] },
    ],
  });
  assert.equal(numbered.outline[0].display_title, '1 自动编号标题');
  assert.equal(numbered.outline[1].display_title, '4.2 固定源编号标题');
  assert.equal((numbered.outline[1].display_title.match(/4\.2/gu) || []).length, 1);
  assert.equal(numbered.outline[2].display_number, '');
  assert.equal(numbered.outline[2].display_title, '不显示编号');
});
