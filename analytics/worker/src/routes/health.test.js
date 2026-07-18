import assert from 'node:assert/strict';
import test from 'node:test';
import { handleHealth } from './health.js';

test('health exposes only service metadata and binding availability booleans', async () => {
  const response = handleHealth({
    RELEASE_BUCKET: { get() {} },
    NOTICE_STORE: { get() {} },
    ANALYTICS_DB: { prepare() {} },
    RESOURCE_DB: { prepare() {} },
    RESOURCE_BUCKET: { get() {} },
    ADMIN_TOKEN: 'must-not-leak',
    ANALYTICS_API_TOKEN: 'must-not-leak',
  });
  const body = await response.json();

  assert.equal(body.service, 'bidupdat-api');
  assert.equal(body.releaseBucketConfigured, true);
  assert.equal(body.noticeStoreConfigured, true);
  assert.equal(body.analyticsDatabaseConfigured, true);
  assert.equal(body.resourceDatabaseConfigured, true);
  assert.equal(body.resourceBucketConfigured, true);
  assert.equal(JSON.stringify(body).includes('must-not-leak'), false);
});

test('health reports absent bindings as false', async () => {
  const body = await handleHealth({}).json();

  assert.equal(body.releaseBucketConfigured, false);
  assert.equal(body.noticeStoreConfigured, false);
  assert.equal(body.analyticsDatabaseConfigured, false);
  assert.equal(body.resourceDatabaseConfigured, false);
  assert.equal(body.resourceBucketConfigured, false);
});
