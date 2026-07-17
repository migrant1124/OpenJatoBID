const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createAnalyticsIngestService } = require('./analyticsIngestService.cjs');
const { createAnalyticsQueryService } = require('./analyticsQueryService.cjs');
const { createAuthorizationService } = require('./authorizationService.cjs');
const { createDatabaseService } = require('./databaseService.cjs');
const { createHttpRouter } = require('./httpRouter.cjs');
const { createHttpServerService } = require('./httpServerService.cjs');
const { createSigningService } = require('./signingService.cjs');
const { createAnalyticsService } = require('../../../client/electron/services/analyticsService.cjs');
const { createDeviceBootstrapStore } = require('../../../client/electron/services/deviceBootstrapStore.cjs');
const { createLicenseService } = require('../../../client/electron/services/licenseService.cjs');

test('completes application, approval, login, analytics and revocation across both applications', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'jato-phase2-integration-'));
  const databaseService = createDatabaseService({ databasePath: ':memory:' });
  const now = () => new Date('2026-07-10T00:00:00.000Z');
  const authorizationService = createAuthorizationService({
    database: databaseService.database,
    signingService: createSigningService({ database: databaseService.database }),
    now,
  });
  const analyticsIngestService = createAnalyticsIngestService({ database: databaseService.database, now });
  const analyticsQueryService = createAnalyticsQueryService({ database: databaseService.database, now });
  const httpServer = createHttpServerService({
    router: createHttpRouter({
      getServiceInfo: () => ({ managementVersion: '1.0.0' }),
      authorizationService,
      analyticsIngestService,
      now,
    }),
  });

  try {
    const address = await httpServer.start({ host: '127.0.0.1', port: 0 });
    const serverAddress = `127.0.0.1:${address.port}`;
    let config = {
      analytics_client_id: 'integration-client-1',
      analytics_created_at: '2026-07-10',
      lan_management: {
        server_address: serverAddress,
        employee_name: '',
        employee_phone: '',
        management_public_key: '',
        application_id: '',
      },
    };
    const configStore = {
      load: () => structuredClone(config),
      save: (next) => {
        config = { ...config, ...next, lan_management: { ...config.lan_management, ...next.lan_management } };
        return { success: true };
      },
    };
    const clientLicense = createLicenseService({
      app: { isPackaged: true, getPath: () => userData },
      configStore,
      now,
      machineFingerprintFactory: () => 'integration-fingerprint-1',
      deviceBootstrapStore: createDeviceBootstrapStore({
        filePath: path.join(userData, 'device-bootstrap.json'),
        now,
      }),
      debugLicenseDisabled: false,
    });

    const application = await clientLicense.submitApplication({
      name: '张三',
      phone: '13800138000',
      serverAddress,
    });
    assert.equal(application.status, 'PENDING');

    const approved = authorizationService.approveApplication(application.id);
    const applicationStatus = await clientLicense.getApplicationStatus();
    assert.equal(applicationStatus.runtimeStatus.status, 'active');
    assert.equal((await clientLicense.login({ name: '张三', phone: '13800138000' })).status, 'active');

    const queue = [];
    const analytics = createAnalyticsService({
      app: { getVersion: () => '1.0.0' },
      configStore,
      queueStore: {
        enqueue: (event) => queue.push(event),
        list: () => [...queue],
        replace: (events) => { queue.splice(0, queue.length, ...events); },
      },
      now,
      eventIdFactory: () => 'integration-event-1',
    });
    await analytics.track({ event: 'page_view', page: 'settings' });

    const dashboard = analyticsQueryService.getDashboard('all');
    assert.equal(dashboard.summary.totalEvents, 1);
    assert.equal(dashboard.summary.totalClients, 1);
    assert.deepEqual(dashboard.pages, [{ name: 'settings', value: 1 }]);
    assert.deepEqual(dashboard.sourceIps, [{ name: '127.0.0.1', value: 1 }]);

    authorizationService.revokeLicense(approved.license.payload.licenseId);
    assert.equal((await clientLicense.verify()).status, 'revoked');
  } finally {
    await httpServer.stop();
    databaseService.close();
    fs.rmSync(userData, { recursive: true, force: true });
  }
});
