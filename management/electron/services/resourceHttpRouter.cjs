const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const { readJsonBody, sendJson, readBearerToken } = require('./httpRouter.cjs');
const { serializeLicensePayload } = require('./signingService.cjs');
const { changesBetween } = require('./resourceStore.cjs');

function createResourceHttpRouter({ store, signingService, assetRoot, now = Date.now }) {
  const issuerId = signingService.getIssuerId();
  function verifyEnvelope(envelope) {
    if (!envelope?.payload || envelope.issuerId !== issuerId || envelope.algorithm !== 'ECDSA_P256_SHA256'
      || !crypto.verify('sha256', Buffer.from(serializeLicensePayload(envelope.payload)), signingService.getPublicKey(), Buffer.from(envelope.signature || '', 'base64'))) {
      throw new Error('RESOURCE_UNAUTHORIZED');
    }
    return envelope.payload;
  }
  function activeLicense(payload) {
    const row = store.database.prepare(`SELECT l.*, d.device_fingerprint, d.device_code, d.status AS device_status
      FROM licenses l JOIN devices d ON d.id = l.device_id WHERE l.id = ?`).get(payload.licenseId);
    if (!row || row.status !== 'ACTIVE' || row.device_status !== 'ACTIVE' || Date.parse(row.expires_at) <= now()
      || row.employee_id !== payload.employeeId || row.device_id !== payload.deviceId
      || (payload.deviceCode ? payload.deviceCode !== row.device_code : payload.deviceFingerprint !== row.device_fingerprint)
      || store.database.prepare('SELECT id FROM authorization_revocations WHERE license_id = ?').get(payload.licenseId)) throw new Error('RESOURCE_UNAUTHORIZED');
  }
  function authenticate(request) {
    let ticket;
    try { ticket = JSON.parse(Buffer.from(readBearerToken(request), 'base64url').toString('utf8')); } catch { throw new Error('RESOURCE_UNAUTHORIZED'); }
    const payload = verifyEnvelope(ticket);
    if (payload.purpose !== 'resource-read-v1' || payload.expiresAt <= now()) throw new Error('RESOURCE_UNAUTHORIZED');
    activeLicense(payload);
    return payload;
  }
  const signed = (payload) => ({ payload, envelope: signingService.signLicense(payload) });
  return async (request, response, url) => {
    if (!url.pathname.startsWith('/api/resource/v1/')) return false;
    try {
      if (request.method === 'POST' && url.pathname === '/api/resource/v1/session') {
        const input = await readJsonBody(request);
        const license = verifyEnvelope(input.license);
        if (license.purpose || Date.parse(license.offlineValidUntil) <= now() || Date.parse(license.expiresAt) <= now()
          || (license.deviceCode ? input.deviceCode !== license.deviceCode : input.deviceFingerprint !== license.deviceFingerprint)) throw new Error('RESOURCE_UNAUTHORIZED');
        activeLicense(license);
        const payload = { purpose: 'resource-read-v1', licenseId: license.licenseId, employeeId: license.employeeId,
          deviceId: license.deviceId, deviceCode: license.deviceCode || null, deviceFingerprint: license.deviceFingerprint,
          streamId: issuerId, protocolVersion: 1, expiresAt: now() + 10 * 60 * 1000 };
        const envelope = signingService.signLicense(payload);
        sendJson(response, 200, { data: { token: Buffer.from(JSON.stringify(envelope)).toString('base64url'), expiresAt: payload.expiresAt, streamId: issuerId, protocolVersion: 1 } });
        return true;
      }
      const identity = authenticate(request);
      if (url.searchParams.has('protocol') && url.searchParams.get('protocol') !== '1') throw new Error('RESOURCE_INCOMPATIBLE');
      if (request.method === 'GET' && url.pathname === '/api/resource/v1/catalog') {
        const requested = url.searchParams.get('version');
        const snapshot = store.snapshot(requested === null ? undefined : requested);
        if (requested !== null && Number(requested) !== snapshot.version) throw new Error('RESOURCE_VERSION_UNAVAILABLE');
        const center = url.searchParams.get('center');
        if (center && !['prompts', 'templates', 'skills'].includes(center)) throw new Error('RESOURCE_INVALID_REQUEST');
        const items = snapshot.items.filter((item) => !center || item.center === center);
        const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0), limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 100));
        const payload = { protocolVersion: 1, streamId: issuerId, version: snapshot.version, total: items.length, offset,
          items: items.slice(offset, offset + limit), sourceStates: store.listSources().map(({ sourceId, name, type, enabled, error }) => ({ sourceId, name, type, enabled, error })) };
        sendJson(response, 200, { data: signed(payload) }); return true;
      }
      if (request.method === 'GET' && url.pathname === '/api/resource/v1/digest') {
        const from = store.snapshot(Number(url.searchParams.get('from')) || 0);
        const to = store.snapshot(url.searchParams.has('to') ? Number(url.searchParams.get('to')) : undefined);
        const comparable = !Number(url.searchParams.get('from')) || from.version === Number(url.searchParams.get('from'));
        sendJson(response, 200, { data: signed({ protocolVersion: 1, streamId: issuerId, from: from.version, to: to.version,
          comparable, changes: comparable ? changesBetween(from.items, to.items).filter((item) => ['prompts', 'templates'].includes(item.center)) : [] }) }); return true;
      }
      const match = url.pathname.match(/^\/api\/resource\/v1\/assets\/([a-f0-9]{64})$/);
      if (request.method === 'GET' && match) {
        const version = Number(url.searchParams.get('version'));
        const snapshot = store.snapshot(version);
        if (snapshot.version !== version || !snapshot.items.some((item) => item.assets?.some((asset) => asset.assetId === match[1]))) throw new Error('RESOURCE_NOT_PUBLISHED');
        const asset = store.getAsset(match[1]);
        if (!asset) throw new Error('RESOURCE_PENDING');
        const file = path.resolve(assetRoot, asset.relative_path);
        if (!file.startsWith(`${path.resolve(assetRoot)}${path.sep}`) || !fs.existsSync(file) || fs.statSync(file).size !== asset.bytes) throw new Error('RESOURCE_FILE_UNAVAILABLE');
        const etag = `"${asset.hash}"`;
        if (request.headers['if-none-match'] === etag) { response.writeHead(304, { etag }); response.end(); return true; }
        let start = 0, end = asset.bytes - 1;
        const range = request.headers.range;
        if (range) {
          const parsed = /^bytes=(\d+)-(\d*)$/.exec(range);
          if (!parsed || (request.headers['if-range'] && request.headers['if-range'] !== etag)) throw new Error('RESOURCE_INVALID_RANGE');
          start = Number(parsed[1]); end = parsed[2] ? Number(parsed[2]) : end;
          if (start > end || end >= asset.bytes) throw new Error('RESOURCE_INVALID_RANGE');
        }
        response.writeHead(range ? 206 : 200, { 'content-type': asset.mime, 'content-length': end - start + 1,
          etag, 'accept-ranges': 'bytes', 'x-content-sha256': asset.hash, 'x-content-type-options': 'nosniff',
          ...(range ? { 'content-range': `bytes ${start}-${end}/${asset.bytes}` } : {}) });
        await pipeline(fs.createReadStream(file, { start, end }), response); return true;
      }
      if (request.method === 'POST' && url.pathname === '/api/resource/v1/requests') {
        const input = await readJsonBody(request);
        const item = store.snapshot(input.version).items.find((item) => item.resourceId === input.resourceId);
        if (!item) throw new Error('RESOURCE_NOT_PUBLISHED');
        sendJson(response, 200, { data: { resourceId: item.resourceId, status: item.status, assets: item.assets } }); return true;
      }
      if (request.method === 'POST' && url.pathname === '/api/resource/v1/repository-requests') {
        const input = await readJsonBody(request);
        if (!/^[\w.-]+\/[\w.-]+$/.test(input.repo || '') || !/^[\w./-]+$/.test(input.ref || 'main')
          || /(^|\/)\.\.($|\/)/.test(input.root || '') || /[\\:]|^\//.test(input.root || '')) throw new Error('RESOURCE_INVALID_REQUEST');
        const locator = { repo: input.repo, ref: input.ref || 'main', root: input.root || '' };
        const existing = store.database.prepare('SELECT request_id FROM resource_repository_requests WHERE license_id = ? AND locator_json = ?').get(identity.licenseId, JSON.stringify(locator));
        const requestId = existing?.request_id || crypto.randomUUID();
        if (!existing) store.database.prepare(`INSERT INTO resource_repository_requests(request_id, license_id, locator_json, status, created_at)
          VALUES (?, ?, ?, 'awaiting_admin', ?)`).run(requestId, identity.licenseId, JSON.stringify(locator), now());
        sendJson(response, 202, { data: { requestId, status: 'awaiting_admin' } }); return true;
      }
      const repositoryMatch = url.pathname.match(/^\/api\/resource\/v1\/repository-requests\/([a-f0-9-]+)$/);
      if (request.method === 'GET' && repositoryMatch) {
        const row = store.database.prepare('SELECT * FROM resource_repository_requests WHERE request_id = ? AND license_id = ?').get(repositoryMatch[1], identity.licenseId);
        if (!row) throw new Error('RESOURCE_NOT_PUBLISHED');
        sendJson(response, 200, { data: { requestId: row.request_id, status: row.status, result: row.result_json ? JSON.parse(row.result_json) : null } }); return true;
      }
      sendJson(response, 404, { error: { code: 'RESOURCE_NOT_FOUND', message: '资源接口不存在' } });
    } catch (error) {
      if (response.headersSent) { response.destroy(); return true; }
      const code = error.message.startsWith('RESOURCE_') ? error.message : 'RESOURCE_INVALID_REQUEST';
      const messages = { RESOURCE_UNAUTHORIZED: '授权无效、已过期或已撤销', RESOURCE_PENDING: '资源仍需管理端准备', RESOURCE_INCOMPATIBLE: '资源协议不兼容',
        RESOURCE_VERSION_UNAVAILABLE: '资源版本不可用', RESOURCE_NOT_PUBLISHED: '资源尚未发布或不在可见范围', RESOURCE_INVALID_RANGE: '下载范围无效', RESOURCE_FILE_UNAVAILABLE: '镜像文件不可用' };
      sendJson(response, code === 'RESOURCE_UNAUTHORIZED' ? 401 : code === 'RESOURCE_INVALID_RANGE' ? 416 : code === 'RESOURCE_PENDING' ? 409 : 422,
        { error: { code, message: messages[code] || '资源请求格式无效' } });
    }
    return true;
  };
}

module.exports = { createResourceHttpRouter };
