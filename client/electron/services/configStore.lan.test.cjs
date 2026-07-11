const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createConfigStore } = require('./configStore.cjs');

test('persists LAN management identity without replacing the existing analytics client id', (t) => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'jato-client-config-'));
  t.after(() => fs.rmSync(userData, { recursive: true, force: true }));
  const store = createConfigStore({ getPath: () => userData });
  const initial = store.load();

  store.save({
    ...initial,
    lan_management: {
      server_address: '192.168.10.8:47821',
      employee_name: '张三',
      employee_phone: '13800138000',
      management_public_key: 'PUBLIC KEY',
      application_id: 'application-1',
    },
  });
  const saved = store.load();

  assert.deepEqual(saved.lan_management, {
    server_address: '192.168.10.8:47821',
    employee_name: '张三',
    employee_phone: '13800138000',
    management_public_key: 'PUBLIC KEY',
    application_id: 'application-1',
  });
  assert.equal(saved.analytics_client_id, initial.analytics_client_id);
});
