import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { validateProject } from './validate-config.mjs';

const validConfig = {
  name: 'bidupdat',
  main: './src/index.js',
  compatibility_date: '2026-07-14',
  workers_dev: true,
  keep_vars: true,
  triggers: { crons: ['0 17 * * *', '30 17 * * *', '0 18 * * *', '30 18 * * *', '0 19 * * *'] },
  analytics_engine_datasets: [{ binding: 'ANALYTICS', dataset: 'jatobid_analytics' }],
  kv_namespaces: [{ binding: 'NOTICE_STORE', id: 'b844c8df3b1c486cbf0828bbd9070c41' }],
  d1_databases: [
    { binding: 'ANALYTICS_DB', database_name: 'jatoaibid-analytics', database_id: 'a9575062-816e-41cb-aa03-33d79e2a30b1' },
    { binding: 'RESOURCE_DB', database_name: 'jatoaibid-resources', database_id: '2aa37ad4-07b8-43ba-b35a-8b5e15d855a6' },
  ],
  r2_buckets: [
    { binding: 'RELEASE_BUCKET', bucket_name: 'jatoaibid' },
    { binding: 'RESOURCE_BUCKET', bucket_name: 'jatoaibid' },
  ],
};

async function createProject(t, { config = validConfig, deploy = 'npm run validate:config && wrangler deploy --config wrangler.jsonc' } = {}) {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'jatobid-worker-config-'));
  const workerDir = path.join(projectRoot, 'analytics', 'worker');
  await fs.mkdir(workerDir, { recursive: true });
  await fs.writeFile(path.join(workerDir, 'wrangler.jsonc'), JSON.stringify(config, null, 2));
  await fs.writeFile(path.join(workerDir, 'package.json'), JSON.stringify({
    engines: { node: '>=22 <23' },
    devDependencies: { wrangler: '4.111.0' },
    scripts: {
      test: 'node --test',
      dev: 'wrangler dev --config wrangler.jsonc',
      deploy,
      'deploy:dry-run': 'npm run validate:config && wrangler deploy --config wrangler.jsonc --dry-run',
    },
  }, null, 2));
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));
  return { projectRoot, workerDir };
}

test('accepts the fixed, self-contained Worker configuration', async (t) => {
  const fixture = await createProject(t);
  assert.deepEqual(validateProject(fixture), []);
});

test('rejects assets, placeholder IDs, extra bindings and external deployment scripts', async (t) => {
  const fixture = await createProject(t, {
    config: {
      ...validConfig,
      assets: { directory: '../client/dist' },
      triggers: { crons: [...validConfig.triggers.crons, '0 0 * * *'] },
      kv_namespaces: [...validConfig.kv_namespaces, { binding: 'NOTICE_STORE', id: 'duplicate' }],
      d1_databases: [{ binding: 'ANALYTICS_DB', database_name: 'jatoaibid-analytics', database_id: '<REPLACE_ME>' }],
    },
    deploy: 'node ../scripts/deploy-if-changed.mjs analytics/worker',
  });
  const errors = validateProject(fixture);
  assert.ok(errors.some((error) => error.includes('assets')));
  assert.ok(errors.some((error) => error.includes('ANALYTICS_DB')));
  assert.ok(errors.some((error) => error.includes('cron')));
  assert.ok(errors.some((error) => error.includes('KV bindings')));
  assert.ok(errors.some((error) => error.includes('deploy')));
});

test('configuration errors make the validation command fail', async (t) => {
  const fixture = await createProject(t, {
    config: { ...validConfig, name: 'wrong-worker' },
  });
  const scriptsDir = path.join(fixture.workerDir, 'scripts');
  await fs.mkdir(scriptsDir);
  const copiedValidator = path.join(scriptsDir, 'validate-config.mjs');
  await fs.copyFile(path.join(import.meta.dirname, 'validate-config.mjs'), copiedValidator);

  const result = spawnSync(process.execPath, [copiedValidator], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Worker name must be bidupdat/);
});
