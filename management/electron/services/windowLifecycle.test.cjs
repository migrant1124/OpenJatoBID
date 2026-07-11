const test = require('node:test');
const assert = require('node:assert/strict');
const { createWindowCloseHandler } = require('./windowLifecycle.cjs');

test('closing the window hides it while the tray service remains active', () => {
  let prevented = false;
  let hidden = false;
  const handler = createWindowCloseHandler({
    isQuitting: () => false,
    hide: () => { hidden = true; },
  });

  handler({ preventDefault: () => { prevented = true; } });

  assert.equal(prevented, true);
  assert.equal(hidden, true);
});

test('closing the window does not intercept an explicit application quit', () => {
  let prevented = false;
  let hidden = false;
  const handler = createWindowCloseHandler({
    isQuitting: () => true,
    hide: () => { hidden = true; },
  });

  handler({ preventDefault: () => { prevented = true; } });

  assert.equal(prevented, false);
  assert.equal(hidden, false);
});
