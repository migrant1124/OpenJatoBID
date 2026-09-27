import { WORKER_CODE_VERSION } from '../constants.js';
import { json } from '../http.js';

export function handleHealth(env) {
  return json({
    code: 0,
    ok: true,
    service: 'bidupdat-api',
    workerCodeVersion: WORKER_CODE_VERSION,
    noticeTimeFormat: 'YYYY-MM-DD HH:mm:ss Asia/Shanghai',
    releaseBucketConfigured: Boolean(env.RELEASE_BUCKET),
    noticeStoreConfigured: Boolean(env.NOTICE_STORE),
    analyticsDatabaseConfigured: Boolean(env.ANALYTICS_DB),
    resourceDatabaseConfigured: Boolean(env.RESOURCE_DB),
    resourceBucketConfigured: Boolean(env.RESOURCE_BUCKET),
  });
}
