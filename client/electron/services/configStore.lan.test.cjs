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

test('does not create a LongCat profile for new configurations', (t) => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'jato-client-config-'));
  t.after(() => fs.rmSync(userData, { recursive: true, force: true }));
  const config = createConfigStore({ getPath: () => userData }).load();

  assert.equal(config.text_model_provider, 'jinlong');
  assert.equal(Object.hasOwn(config.text_model_profiles, 'longcat'), false);
});

test('preserves an existing LongCat provider as a legacy configuration', (t) => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'jato-client-config-'));
  t.after(() => fs.rmSync(userData, { recursive: true, force: true }));
  const store = createConfigStore({ getPath: () => userData });
  const initial = store.load();

  store.save({
    ...initial,
    text_model_provider: 'longcat',
    text_model_profiles: {
      ...initial.text_model_profiles,
      longcat: {
        api_key: 'legacy-key',
        base_url: 'https://api.longcat.chat/openai/v1',
        model_name: 'legacy-model',
        context_length_limit: 128000,
        concurrency_limit: 3,
        request_mode: 'stream',
      },
    },
    api_key: 'legacy-key',
    base_url: 'https://api.longcat.chat/openai/v1',
    model_name: 'legacy-model',
    context_length_limit: 128000,
    concurrency_limit: 3,
    request_mode: 'stream',
  });

  const saved = store.load();
  assert.equal(saved.text_model_provider, 'longcat');
  assert.equal(saved.text_model_profiles.longcat.model_name, 'legacy-model');
  assert.equal(saved.text_model_profiles.longcat.concurrency_limit, 3);
});

test('migrates local rendering defaults without dropping LAN or unknown configuration fields', (t) => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'jato-client-config-'));
  t.after(() => fs.rmSync(userData, { recursive: true, force: true }));
  const configPath = path.join(userData, 'user_config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    config_version: 1,
    lan_management: { server_address: '192.168.10.8:47821' },
    components: { mermaid_concurrency_limit: 21, html_concurrency_limit: 0 },
    future_option: { enabled: true },
  }), 'utf-8');

  const config = createConfigStore({ getPath: () => userData }).load();

  assert.equal(config.config_version, 2);
  assert.deepEqual(config.local_rendering, {
    enabled: true,
    mermaid_concurrency_limit: 20,
    html_concurrency_limit: 5,
  });
  assert.equal(config.lan_management.server_address, '192.168.10.8:47821');
  assert.deepEqual(config.future_option, { enabled: true });
  assert.equal(fs.existsSync(`${configPath}.v1.backup`), true);
});

test('migrates the obsolete GitHub update channel to the Cloudflare R2 channel', (t) => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'jato-client-config-'));
  t.after(() => fs.rmSync(userData, { recursive: true, force: true }));
  const configPath = path.join(userData, 'user_config.json');
  fs.writeFileSync(configPath, JSON.stringify({ update_channel: 'github' }), 'utf-8');

  const config = createConfigStore({ getPath: () => userData }).load();

  assert.equal(config.update_channel, 'cloudflare-r2');
});
