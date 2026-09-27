const assert = require('node:assert/strict');
const test = require('node:test');
const { ImageStudioEditSession } = require('../../src/features/image-studio/pages/ImageStudioEditSession.ts');

const area = (name) => ({ tool: 'rectangle', maskDataUrl: name, edgeDataUrl: name,
  center: { x: 10, y: 10 }, bounds: { x: 0, y: 0, width: 20, height: 20 } });

test('empty candidate survives focus and zoom, then leaves without a ghost number', () => {
  const edit = new ImageStudioEditSession();
  edit.add(area('first'));
  assert.equal(edit.state.regions.length, 1);
  edit.add(area('second'));
  assert.deepEqual(edit.state.regions.map((item) => item.id), [2]);
  assert.equal(edit.valid.length, 0);
  edit.setPrompt(2, '  中文修改  ');
  assert.equal(edit.valid.length, 1);
  edit.add(area('third'));
  assert.deepEqual(edit.state.regions.map((item) => item.id), [2, 3]);
});

test('delete, undo, redo preserve the same mask, text and stable id', () => {
  const edit = new ImageStudioEditSession();
  for (const name of ['cat', 'blue', 'green']) {
    const id = edit.add(area(name)); edit.setPrompt(id, `${name} 修改`); edit.commitText();
  }
  edit.delete(2);
  assert.deepEqual(edit.state.regions.map((item) => item.id), [1, 3]);
  edit.undo();
  assert.deepEqual(edit.state.regions.map((item) => [item.id, item.maskDataUrl, item.prompt]),
    [[1, 'cat', 'cat 修改'], [2, 'blue', 'blue 修改'], [3, 'green', 'green 修改']]);
  edit.redo(); assert.deepEqual(edit.state.regions.map((item) => item.id), [1, 3]);
  edit.undo(); edit.clear(); edit.undo();
  assert.equal(edit.valid.length, 3);
});

test('cleared saved text is not deleted until leaving, and one undo restores it', () => {
  const edit = new ImageStudioEditSession();
  const first = edit.add(area('cat')); edit.setPrompt(first, '原意见'); edit.commitText();
  const second = edit.add(area('blue')); edit.setPrompt(second, '新意见'); edit.commitText();
  edit.activate(first); edit.setPrompt(first, '');
  assert.equal(edit.state.regions.length, 2);
  edit.activate(second);
  assert.deepEqual(edit.state.regions.map((item) => item.id), [second]);
  edit.undo();
  assert.equal(edit.state.regions.find((item) => item.id === first)?.prompt, '原意见');
});

test('explicit deletion of an empty card can be undone without changing another region', () => {
  const edit = new ImageStudioEditSession();
  const first = edit.add(area('cat')); edit.setPrompt(first, '改猫'); edit.commitText();
  const second = edit.add(area('blue'));
  edit.delete(second);
  assert.deepEqual(edit.state.regions.map((item) => item.id), [first]);
  edit.undo();
  assert.deepEqual(edit.state.regions.map((item) => [item.id, item.maskDataUrl]), [[first, 'cat'], [second, 'blue']]);
});

test('undoing or leaving a blank candidate does not leave an empty history step', () => {
  const edit = new ImageStudioEditSession();
  const first = edit.add(area('cat')); edit.setPrompt(first, '改猫'); edit.commitText();
  edit.add(area('blank')); edit.undo();
  assert.deepEqual(edit.state.regions.map((item) => item.id), [first]);
  edit.undo(); assert.equal(edit.state.regions[0].prompt, '');
  edit.redo(); assert.equal(edit.state.regions[0].prompt, '改猫');
  edit.add(area('blank2')); edit.add(area('next'));
  edit.undo(); assert.deepEqual(edit.state.regions.map((item) => item.id), [first]);
});
