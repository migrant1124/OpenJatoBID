const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
};

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, JSON_HEADERS);
  response.end(JSON.stringify(body));
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new Error('PAYLOAD_TOO_LARGE');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new Error('INVALID_JSON');
  }
}

function validateApplicationInput(input) {
  return Boolean(
    input
    && typeof input.name === 'string' && input.name.trim()
    && typeof input.phone === 'string' && /^1[3-9]\d{9}$/.test(input.phone.replace(/\D/g, ''))
    && typeof input.deviceFingerprint === 'string' && input.deviceFingerprint
    && typeof input.clientId === 'string' && input.clientId
    && typeof input.platform === 'string' && input.platform
    && typeof input.arch === 'string' && input.arch
  );
}

function sendServiceError(response, error) {
  const code = error instanceof Error ? error.message : '';
  if (code === 'INVALID_JSON') return sendJson(response, 400, { error: { code, message: '请求 JSON 无法解析' } });
  if (code === 'PAYLOAD_TOO_LARGE') return sendJson(response, 413, { error: { code, message: '请求内容过大' } });
  if (code === 'INVALID_ANALYTICS_BATCH') return sendJson(response, 422, { error: { code, message: '埋点批次格式无效' } });
  if (code === 'APPLICATION_CONFLICT') return sendJson(response, 409, { error: { code, message: '当前设备已有待审批申请' } });
  return sendJson(response, 500, { error: { code: 'INTERNAL_ERROR', message: '管理端处理请求失败' } });
}

function createHttpRouter({ getServiceInfo, authorizationService, analyticsIngestService, now = () => new Date() }) {
  return async (request, response) => {
    const url = new URL(request.url, 'http://management.local');
    if (request.method === 'GET' && url.pathname === '/api/v1/health') {
      sendJson(response, 200, {
        data: {
          status: 'ok',
          apiVersion: 'v1',
          ...getServiceInfo(),
          serverTime: now().toISOString(),
        },
      });
      return;
    }

    if (authorizationService && request.method === 'POST' && url.pathname === '/api/v1/authorization/applications') {
      try {
        const input = await readJsonBody(request);
        if (!validateApplicationInput(input)) {
          sendJson(response, 422, { error: { code: 'VALIDATION_ERROR', message: '请填写有效的姓名、手机号和设备信息' } });
          return;
        }
        sendJson(response, 201, { data: authorizationService.submitApplication(input) });
      } catch (error) {
        sendServiceError(response, error);
      }
      return;
    }

    const applicationMatch = url.pathname.match(/^\/api\/v1\/authorization\/applications\/([^/]+)$/);
    if (authorizationService && request.method === 'GET' && applicationMatch) {
      const application = authorizationService.getApplication(decodeURIComponent(applicationMatch[1]));
      if (!application) {
        sendJson(response, 404, { error: { code: 'APPLICATION_NOT_FOUND', message: '授权申请不存在' } });
        return;
      }
      sendJson(response, 200, { data: application });
      return;
    }

    if (authorizationService && request.method === 'POST' && url.pathname === '/api/v1/authorization/login') {
      try {
        const input = await readJsonBody(request);
        if (!input?.name || !input?.phone || !input?.deviceFingerprint) {
          sendJson(response, 422, { error: { code: 'VALIDATION_ERROR', message: '姓名、手机号和设备信息不能为空' } });
          return;
        }
        sendJson(response, 200, { data: authorizationService.login(input) });
      } catch (error) {
        sendServiceError(response, error);
      }
      return;
    }

    if (authorizationService && request.method === 'POST' && url.pathname === '/api/v1/authorization/verify') {
      try {
        const input = await readJsonBody(request);
        if (!input?.licenseId || !input?.deviceFingerprint) {
          sendJson(response, 422, { error: { code: 'VALIDATION_ERROR', message: '授权和设备信息不能为空' } });
          return;
        }
        sendJson(response, 200, { data: authorizationService.verifyLicense(input) });
      } catch (error) {
        sendServiceError(response, error);
      }
      return;
    }

    if (analyticsIngestService && request.method === 'POST' && url.pathname === '/api/v1/analytics/events') {
      try {
        const input = await readJsonBody(request);
        const sourceIp = String(request.socket?.remoteAddress || '').replace(/^::ffff:/, '');
        sendJson(response, 202, {
          data: analyticsIngestService.ingest({ events: input.events, sourceIp }),
        });
      } catch (error) {
        sendServiceError(response, error);
      }
      return;
    }

    sendJson(response, 404, {
      error: { code: 'NOT_FOUND', message: '请求的接口不存在' },
    });
  };
}

module.exports = { createHttpRouter, readJsonBody, sendJson, validateApplicationInput };
