import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const EXPECTED_CRONS = ['0 17 * * *', '30 17 * * *', '0 18 * * *', '30 18 * * *', '0 19 * * *'];
const EXPECTED_D1 = {
  ANALYTICS_DB: { database_name: 'jatoaibid-analytics', database_id: 'a9575062-816e-41cb-aa03-33d79e2a30b1' },
  RESOURCE_DB: { database_name: 'jatoaibid-resources', database_id: '2aa37ad4-07b8-43ba-b35a-8b5e15d855a6' },
};
const FORBIDDEN_CONFIG_KEYS = ['assets', 'site', 'pages_build_output_dir', 'migrations'];

function parseJsonc(source) {
  let result = '';
  let inString = false;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < source.length; index += 1) {
    const current = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (current === '\n') {
        lineComment = false;
        result += current;
      }
      continue;
    }
    if (blockComment) {
      if (current === '*' && next === '/') {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (inString) {
      result += current;
      if (!escaped && current === '"') inString = false;
      escaped = !escaped && current === '\\';
      if (current !== '\\') escaped = false;
      continue;
    }
    if (current === '"') {
      inString = true;
      result += current;
    } else if (current === '/' && next === '/') {
      lineComment = true;
      index += 1;
    } else if (current === '/' && next === '*') {
      blockComment = true;
      index += 1;
    } else {
      result += current;
    }
  }
  return JSON.parse(result.replace(/,\s*([}\]])/g, '$1'));
}

function readJsonc(filePath, errors) {
  try {
    return parseJsonc(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    errors.push(`Cannot parse ${filePath}: ${error.message}`);
    return null;
  }
}

function findBinding(items, binding) {
  return Array.isArray(items) ? items.find((item) => item?.binding === binding) : null;
}

function isPlaceholder(value) {
  return !value || /<|>|placeholder|replace|todo|example/i.test(String(value));
}

function validateExactBinding(errors, items, binding, expected, key) {
  const item = findBinding(items, binding);
  if (!item) {
    errors.push(`Missing ${binding} binding.`);
    return;
  }
  if (isPlaceholder(item[key]) || item[key] !== expected) {
    errors.push(`${binding}.${key} must be ${expected}.`);
  }
}

function validateExactBindingSet(errors, items, expectedBindings, label) {
  if (!Array.isArray(items)) {
    errors.push(`${label} bindings must be an array.`);
    return;
  }
  const bindings = items.map((item) => item?.binding).filter(Boolean);
  const uniqueBindings = new Set(bindings);
  if (bindings.length !== expectedBindings.length
    || uniqueBindings.size !== expectedBindings.length
    || expectedBindings.some((binding) => !uniqueBindings.has(binding))) {
    errors.push(`${label} bindings must exactly match: ${expectedBindings.join(', ')}.`);
  }
}

export function validateProject({
  projectRoot = path.resolve(SCRIPT_DIR, '..', '..', '..'),
  workerDir = path.resolve(SCRIPT_DIR, '..'),
} = {}) {
  const errors = [];
  const config = readJsonc(path.join(workerDir, 'wrangler.jsonc'), errors);
  const packageJson = readJsonc(path.join(workerDir, 'package.json'), errors);
  if (!config || !packageJson) return errors;

  if (fs.existsSync(path.join(projectRoot, 'wrangler.jsonc'))) {
    errors.push('Repository root must not contain wrangler.jsonc.');
  }
  if (config.name !== 'bidupdat') errors.push('Worker name must be bidupdat.');
  if (config.main !== './src/index.js') errors.push('Worker main must be ./src/index.js.');
  if (config.compatibility_date !== '2026-07-14') errors.push('compatibility_date must be 2026-07-14.');
  if (config.workers_dev !== true) errors.push('workers_dev must be true.');
  if (config.keep_vars !== true) errors.push('keep_vars must be true.');
  for (const key of FORBIDDEN_CONFIG_KEYS) {
    if (Object.hasOwn(config, key)) errors.push(`wrangler.jsonc must not define ${key}.`);
  }
  const crons = config.triggers?.crons;
  if (!Array.isArray(crons) || crons.length !== EXPECTED_CRONS.length
    || new Set(crons).size !== EXPECTED_CRONS.length
    || EXPECTED_CRONS.some((cron) => !crons.includes(cron))) {
    errors.push('Configured cron triggers must exactly match the required schedule.');
  }
  validateExactBindingSet(errors, config.analytics_engine_datasets, ['ANALYTICS'], 'Analytics Engine');
  validateExactBindingSet(errors, config.kv_namespaces, ['NOTICE_STORE'], 'KV');
  validateExactBindingSet(errors, config.d1_databases, ['ANALYTICS_DB', 'RESOURCE_DB'], 'D1');
  validateExactBindingSet(errors, config.r2_buckets, ['RELEASE_BUCKET', 'RESOURCE_BUCKET'], 'R2');
  validateExactBinding(errors, config.analytics_engine_datasets, 'ANALYTICS', 'jatobid_analytics', 'dataset');
  validateExactBinding(errors, config.kv_namespaces, 'NOTICE_STORE', 'b844c8df3b1c486cbf0828bbd9070c41', 'id');
  for (const [binding, expected] of Object.entries(EXPECTED_D1)) {
    validateExactBinding(errors, config.d1_databases, binding, expected.database_name, 'database_name');
    validateExactBinding(errors, config.d1_databases, binding, expected.database_id, 'database_id');
  }
  validateExactBinding(errors, config.r2_buckets, 'RELEASE_BUCKET', 'jatoaibid', 'bucket_name');
  validateExactBinding(errors, config.r2_buckets, 'RESOURCE_BUCKET', 'jatoaibid', 'bucket_name');

  if (packageJson.engines?.node !== '>=22 <23') errors.push('package.json engines.node must be >=22 <23.');
  if (packageJson.devDependencies?.wrangler !== '4.111.0') errors.push('package.json must pin wrangler to 4.111.0.');
  const scripts = packageJson.scripts || {};
  const expectedDeploy = 'npm run validate:config && wrangler deploy --config wrangler.jsonc';
  const expectedDryRun = `${expectedDeploy} --dry-run`;
  if (scripts.test !== 'node --test') errors.push('test script must be node --test.');
  if (scripts.dev !== 'wrangler dev --config wrangler.jsonc') errors.push('dev script must use wrangler.jsonc.');
  if (scripts.deploy !== expectedDeploy) errors.push('deploy script must use only the local Wrangler config.');
  if (scripts['deploy:dry-run'] !== expectedDryRun) errors.push('deploy:dry-run script must use only the local Wrangler config.');
  for (const name of ['setup:notice-kv', 'setup:resources', 'setup:analytics-storage', 'backfill:analytics-stats', 'backfill:analytics-stat-fields']) {
    if (Object.hasOwn(scripts, name)) errors.push(`${name} must not be a Worker package script.`);
  }
  for (const [name, command] of Object.entries(scripts)) {
    if (/deploy|setup|backfill/.test(name) && /\.\.\/scripts|deploy-if-changed|setup-/.test(String(command))) {
      errors.push(`${name} must not call repository infrastructure scripts.`);
    }
  }
  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const errors = validateProject();
  if (errors.length) {
    console.error('Worker configuration validation failed:');
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
  } else {
    console.log('Worker configuration validation passed.');
  }
}
