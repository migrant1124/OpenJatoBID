import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { handleHealth } from './health.js';

test('health exposes only service metadata and binding availability booleans', async () => {
  const publicKey = '-----BEGIN PUBLIC KEY-----\r\nexample\r\n-----END PUBLIC KEY-----\r\n';
  const response = await handleHealth({
    RELEASE_BUCKET: { get() {} },
    NOTICE_STORE: { get() {} },
    ANALYTICS_DB: { prepare() {} },
    RESOURCE_DB: { prepare() {} },
    RESOURCE_BUCKET: { get() {} },
    ADMIN_TOKEN: 'must-not-leak',
    ANALYTICS_API_TOKEN: 'must-not-leak',
    JATOBID_UPDATE_LICENSE_PUBLIC_KEY: publicKey,
  });
  const body = await response.json();

  assert.equal(body.service, 'bidupdat-api');
  assert.equal(body.releaseBucketConfigured, true);
  assert.equal(body.noticeStoreConfigured, true);
  assert.equal(body.analyticsDatabaseConfigured, true);
  assert.equal(body.resourceDatabaseConfigured, true);
  assert.equal(body.resourceBucketConfigured, true);
  assert.equal(body.updateLicensePublicKeyConfigured, true);
  assert.equal(body.updateLicensePublicKeyFingerprint, createHash('sha256').update(publicKey.trim().replace(/\r\n/g, '\n')).digest('hex'));
  assert.equal(JSON.stringify(body).includes('must-not-leak'), false);
  assert.equal(JSON.stringify(body).includes(publicKey), false);
});

test('health reports absent bindings as false', async () => {
  const body = await (await handleHealth({})).json();

  assert.equal(body.releaseBucketConfigured, false);
  assert.equal(body.noticeStoreConfigured, false);
  assert.equal(body.analyticsDatabaseConfigured, false);
  assert.equal(body.resourceDatabaseConfigured, false);
  assert.equal(body.resourceBucketConfigured, false);
  assert.equal(body.updateLicensePublicKeyConfigured, false);
  assert.equal(body.updateLicensePublicKeyFingerprint, null);
});
