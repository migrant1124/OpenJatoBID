const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createDatabaseService } = require('./databaseService.cjs');
const { createSigningService, serializeLicensePayload } = require('./signingService.cjs');

test('generates one local issuer key and signs a verifiable license envelope', () => {
  const databaseService = createDatabaseService({ databasePath: ':memory:' });
  const signing = createSigningService({ database: databaseService.database });
  const payload = { licenseId: 'license-1', employeeId: 'employee-1', expiresAt: '2027-07-10T00:00:00.000Z' };

  const envelope = signing.signLicense(payload);

  assert.equal(envelope.algorithm, 'ECDSA_P256_SHA256');
  assert.deepEqual(envelope.payload, payload);
  assert.equal(JSON.stringify(envelope).includes('PRIVATE KEY'), false);
  assert.equal(
    crypto.verify('sha256', Buffer.from(serializeLicensePayload(payload)), envelope.publicKey, Buffer.from(envelope.signature, 'base64')),
    true,
  );
  assert.equal(createSigningService({ database: databaseService.database }).getPublicKey(), envelope.publicKey);
  databaseService.close();
});
