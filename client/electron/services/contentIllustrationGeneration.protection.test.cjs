const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  applyGeneratedIllustrationsToDocument,
  stripGeneratedIllustrationsFromDocument,
} = require('./contentIllustrationGeneration.cjs');

const protectedBody = '承诺原文\n\n<!-- yibiao-illustration:start id="old" -->\n旧图\n<!-- yibiao-illustration:end -->';
const freeformBody = '方案正文\n\n<!-- yibiao-illustration:start id="old-free" -->\n旧图\n<!-- yibiao-illustration:end -->';
const outlineData = {
  outline: [
    { id: 'locked', title: '承诺函', response_mode: 'locked-commitment', content: protectedBody },
    { id: 'free', title: '方案', response_mode: 'freeform-markdown', content: freeformBody },
  ],
};
const sections = {
  locked: { id: 'locked', status: 'success', content: protectedBody },
  free: { id: 'free', status: 'success', content: freeformBody },
};

function blockHash(content) {
  return crypto.createHash('sha256').update(JSON.stringify(content), 'utf8').digest('hex').slice(0, 16);
}

test('illustration cleanup changes only freeform leaves', () => {
  const stripped = stripGeneratedIllustrationsFromDocument(outlineData, sections);
  assert.equal(stripped.sections.locked.content, protectedBody);
  assert.equal(stripped.outlineData.outline[0].content, protectedBody);
  assert.equal(stripped.sections.free.content, '方案正文');
  assert.equal(stripped.outlineData.outline[1].content, '方案正文');
});

test('illustration apply rejects protected targets', () => {
  assert.throws(() => applyGeneratedIllustrationsToDocument({
    items: [{
      item_id: 'new-image',
      kind: 'ai',
      title: '非法配图',
      section_ids: ['locked'],
      placement: 'after',
      generation: { status: 'success', asset_url: 'yibiao-asset://generated-images/test.png' },
    }],
  }, outlineData, sections), /不可写入的受控响应节点/);
});

test('多张图片按不同正文块锚点插入同一小节且保留顺序', () => {
  const localOutline = { outline: [{ id: 'free', title: '方案', response_mode: 'freeform-markdown', content: '第一段\n\n第二段' }] };
  const localSections = { free: { id: 'free', status: 'success', content: '第一段\n\n第二段' } };
  const result = applyGeneratedIllustrationsToDocument({
    items: [
      {
        item_id: 'after-1', kind: 'ai', title: '流程图一', purpose: '实施流程', section_ids: ['free'],
        anchor: { type: 'after_block', section_id: 'free', block_hash: blockHash('第一段'), sequence: 1 },
        generation: { status: 'success', asset_url: 'yibiao-asset://generated-images/one.png' },
      },
      {
        item_id: 'after-2', kind: 'ai', title: '流程图二', purpose: '职责关系', section_ids: ['free'],
        anchor: { type: 'after_block', section_id: 'free', block_hash: blockHash('第一段'), sequence: 2 },
        generation: { status: 'success', asset_url: 'yibiao-asset://generated-images/two.png' },
      },
      {
        item_id: 'end', kind: 'html', title: '质量控制图', purpose: '质量控制', section_ids: ['free'],
        anchor: { type: 'section_end', section_id: 'free', sequence: 1 },
        generation: { status: 'success', asset_url: 'yibiao-asset://generated-images/end.png' },
      },
    ],
  }, localOutline, localSections);
  const content = result.sections.free.content;
  assert.ok(content.indexOf('第一段') < content.indexOf('流程图一'));
  assert.ok(content.indexOf('流程图一') < content.indexOf('流程图二'));
  assert.ok(content.indexOf('流程图二') < content.indexOf('第二段'));
  assert.ok(content.indexOf('第二段') < content.indexOf('质量控制图'));
  assert.deepEqual(result.anchorFallbackItemIds, []);
});

test('正文块哈希失配时退化到章节末尾并返回人工核对标记', () => {
  const localOutline = { outline: [{ id: 'free', title: '方案', response_mode: 'freeform-markdown', content: '正文已变更' }] };
  const localSections = { free: { id: 'free', status: 'success', content: '正文已变更' } };
  const result = applyGeneratedIllustrationsToDocument({
    items: [{
      item_id: 'fallback', kind: 'ai', title: '待核对图', purpose: '实施说明', section_ids: ['free'],
      anchor: { type: 'after_block', section_id: 'free', block_hash: blockHash('旧正文'), sequence: 1 },
      generation: { status: 'success', asset_url: 'yibiao-asset://generated-images/fallback.png' },
    }],
  }, localOutline, localSections);
  assert.match(result.sections.free.content, /正文已变更[\s\S]*待核对图/);
  assert.deepEqual(result.anchorFallbackItemIds, ['fallback']);
});
