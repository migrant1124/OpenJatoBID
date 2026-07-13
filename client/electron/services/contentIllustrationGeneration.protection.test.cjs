const test = require('node:test');
const assert = require('node:assert/strict');
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
