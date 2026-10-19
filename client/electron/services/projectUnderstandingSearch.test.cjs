'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Readable } = require('node:stream');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dns = require('node:dns').promises;
const undici = require('undici');
const { createConfigStore } = require('./configStore.cjs');

function loadResearch(t, fetch) {
  t.mock.method(dns, 'lookup', async () => [{ address: '8.8.8.8', family: 4 }]);
  t.mock.method(undici, 'fetch', fetch);
  const filename = require.resolve('./projectUnderstandingResearch.cjs');
  const cached = require.cache[filename];
  delete require.cache[filename];
  const research = require(filename);
  if (cached) require.cache[filename] = cached;
  else delete require.cache[filename];
  return research;
}

function jsonResponse(value, status = 200) {
  return { ok: status >= 200 && status < 300, status, headers: new Headers(), body: Readable.from([Buffer.from(JSON.stringify(value))]) };
}

test('国内搜索只保留百度，不将旧搜索 Key 当作百度 Key，也不影响文本模型 Key', () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'jato-search-config-'));
  try {
    const store = createConfigStore({ getPath: () => userData });
    assert.equal(store.load().project_research.provider, 'baidu');
    store.save({ project_research: { provider: 'baidu', baidu_api_key: 'fixture-baidu' } });
    assert.equal(store.load().project_research.baidu_api_key, 'fixture-baidu');
    const filename = path.join(userData, 'user_config.json');
    fs.writeFileSync(filename, JSON.stringify({ api_key: 'fixture-text-model', project_research: { provider: 'brave', api_key: 'legacy-search-key' } }), 'utf8');
    const config = store.load();
    assert.equal(config.project_research.provider, 'baidu');
    assert.equal(config.project_research.baidu_api_key, '');
    assert.equal(config.project_research.api_key, undefined);
    assert.equal(config.api_key, 'fixture-text-model');
    fs.writeFileSync(filename, JSON.stringify({ project_research: { provider: 'volcengine', volcengine_api_key: 'old-search-key' } }), 'utf8');
    assert.equal(store.load().project_research.baidu_api_key, '');
    assert.equal(store.load().project_research.volcengine_api_key, undefined);
  } finally {
    fs.rmSync(userData, { recursive: true, force: true });
  }
});

test('百度搜索按官方 POST 协议调用，仅把网页链接传给原文抓取阶段', async (t) => {
  let calls = 0;
  const research = loadResearch(t, async (url, options) => {
    calls++;
    assert.equal(String(url), 'https://qianfan.baidubce.com/v2/ai_search/web_search');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers['X-Appbuilder-Authorization'], 'Bearer fixture-key');
    assert.deepEqual(JSON.parse(options.body), { messages: [{ content: '行业政策 site:gov.cn', role: 'user' }], search_source: 'baidu_search_v2', resource_type_filter: [{ type: 'web', top_k: 5 }] });
    return jsonResponse({ references: [{ type: 'web', title: '政策正文', url: 'https://www.gov.cn/policy/example', content: '不可冒充已取回原文' }, { title: '没有链接' }, { type: 'image', url: 'https://image.example/test' }] });
  });
  const result = await research.searchBaidu('行业政策 site:gov.cn', { baidu_api_key: 'fixture-key' });
  assert.deepEqual(result, [{ title: '政策正文', url: 'https://www.gov.cn/policy/example' }]);
  assert.equal(calls, 1);
});

test('免费额度耗尽立即停止，不重试、不切换其他搜索源', async (t) => {
  let calls = 0;
  const research = loadResearch(t, async () => {
    calls++;
    return jsonResponse({ code: 'QUOTA_USER_DAILY_FREE', message: '请开通后付费' }, 429);
  });
  await assert.rejects(research.searchBaidu('行业政策', { baidu_api_key: 'fixture-key' }), (error) => error.code === 'SEARCH_FREE_QUOTA_EXHAUSTED' && /不转付费/.test(error.message));
  assert.equal(calls, 1);
});

test('带 Key 的搜索请求拒绝跨来源重定向', async (t) => {
  let calls = 0;
  const research = loadResearch(t, async () => {
    calls++;
    return { status: 307, headers: new Headers({ location: 'https://other.example/search' }), body: { cancel: async () => {} } };
  });
  await assert.rejects(research.searchBaidu('行业政策', { baidu_api_key: 'fixture-key' }), /重定向.*凭据/);
  assert.equal(calls, 1);
});

test('缺 Key 时不发请求', async (t) => {
  const research = loadResearch(t, async () => { assert.fail('不应发起 HTTP 请求'); });
  await assert.rejects(research.searchBaidu('行业政策', {}), /未配置.*百度.*Key/);
});

test('鉴权或限流失败不重试，也不把服务端原始错误写入提示', async (t) => {
  let calls = 0;
  const research = loadResearch(t, async () => {
    calls++;
    return jsonResponse({ code: 216003, message: '服务端可能回显 fixture-secret' }, 401);
  });
  await assert.rejects(research.searchBaidu('行业政策', { baidu_api_key: 'fixture-secret' }), (error) => /Key 无效|权限/.test(error.message) && !error.message.includes('fixture-secret'));
  assert.equal(calls, 1);
});

test('空搜索结果正常返回，不能把摘要作为证据', async (t) => {
  const research = loadResearch(t, async () => jsonResponse({ references: [] }));
  assert.deepEqual(await research.searchBaidu('行业政策', { baidu_api_key: 'fixture-key' }), []);
});

test('内部来源预算按所选服务的 Key 判断', (t) => {
  const research = loadResearch(t, async () => { assert.fail('不应发起 HTTP 请求'); });
  assert.equal(research.getInternalSourceLimit(8, { provider: 'baidu', api_key: 'legacy-search-key', volcengine_api_key: 'old-search-key' }), 8);
  assert.equal(research.getInternalSourceLimit(8, { provider: 'baidu', baidu_api_key: 'fixture-key' }), 7);
});

test('代理虚拟 DNS 地址经独立公网解析核验后才允许访问', async (t) => {
  let dnsRequests = 0;
  const research = loadResearch(t, async (url, options) => {
    assert.equal(new URL(url).hostname, 'dns.alidns.com');
    assert.equal(new URL(url).searchParams.get('name'), 'qianfan.baidubce.com');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers, undefined);
    dnsRequests++;
    return jsonResponse({ Answer: [{ type: 1, data: '8.8.8.8' }] });
  });
  t.mock.method(dns, 'lookup', async () => [{ address: '198.18.0.102', family: 4 }]);
  await research.assertPublicHttpsUrl('https://qianfan.baidubce.com/v2/ai_search/web_search');
  assert.equal(dnsRequests, 1);
});

test('独立解析仍返回内网地址时拒绝访问，普通内网地址不走补充解析', async (t) => {
  let dnsRequests = 0;
  const research = loadResearch(t, async () => { dnsRequests++; return jsonResponse({ Answer: [{ type: 1, data: '192.168.1.1' }] }); });
  t.mock.method(dns, 'lookup', async () => [{ address: '198.18.0.102', family: 4 }]);
  await assert.rejects(research.assertPublicHttpsUrl('https://fixture.gov.cn/source'), /拒绝访问内网/);
  assert.equal(dnsRequests, 1);
  t.mock.method(dns, 'lookup', async () => [{ address: '192.168.1.1', family: 4 }]);
  await assert.rejects(research.assertPublicHttpsUrl('https://fixture.gov.cn/source'), /拒绝访问内网/);
  assert.equal(dnsRequests, 1);
});

test('固定公网地址连接同时兼容单地址和 all 地址查询', async (t) => {
  t.mock.method(undici, 'Agent', function (options) { this.options = options; this.close = async () => {}; });
  const research = loadResearch(t, async (_url, { dispatcher }) => {
    dispatcher.options.connect.lookup('fixture.gov.cn', { all: true }, (error, addresses) => {
      assert.equal(error, null);
      assert.deepEqual(addresses, [{ address: '8.8.8.8', family: 4 }]);
    });
    dispatcher.options.connect.lookup('fixture.gov.cn', {}, (error, address, family) => {
      assert.equal(error, null);
      assert.equal(address, '8.8.8.8');
      assert.equal(family, 4);
    });
    return jsonResponse({ references: [] });
  });
  await research.fetchWithPolicy('https://fixture.gov.cn/source', { retries: 0 });
});

test('多个主题按免费账号每秒一次的限流依次搜索', async (t) => {
  const started = [];
  const research = loadResearch(t, async () => {
    started.push(Date.now());
    return started.length === 1 ? jsonResponse({ references: [] }) : jsonResponse({ code: 'QUOTA_USER_DAILY_FREE' }, 429);
  });
  await assert.rejects(research.runProjectUnderstandingResearchTask({
    configStore: { load: () => ({ project_research: { baidu_api_key: 'fixture-key' } }) },
    workspaceStore: { loadTechnicalPlan: () => ({}) }, updateTask: () => {},
    taskControl: { isPauseRequested: () => false },
    payload: { topics: ['行业政策', '公共文化'], reference_date: '2026-10-19' },
  }), (error) => error.code === 'SEARCH_FREE_QUOTA_EXHAUSTED');
  assert.equal(started.length, 2);
  assert.ok(started[1] - started[0] >= 1000, `两次搜索间隔 ${started[1] - started[0]}ms`);
});
