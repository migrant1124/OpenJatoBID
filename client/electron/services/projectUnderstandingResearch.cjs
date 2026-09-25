const crypto = require('node:crypto');
const dns = require('node:dns').promises;
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const cheerio = require('cheerio');
const iconv = require('iconv-lite');
const { Agent, fetch } = require('undici');
const { parseDocumentWithConfig } = require('./fileService.cjs');
const { buildProjectUnderstandingSubtree, normalizeProjectUnderstanding, stableHash } = require('./projectUnderstanding.cjs');
const { NATURAL_OUTLINE_GROUPING_RULES } = require('./outlineNaturalGrouping.cjs');

const BRAVE_ENDPOINT = 'https://api.search.brave.com/res/v1/web/search';
const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
const RESEARCH_PROMPT_VERSION = 'project-understanding-v1.7.4-1';
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function canceledError() {
  const error = new Error('项目理解资料获取已取消');
  error.code = 'TASK_CANCELED';
  return error;
}

function waitForResearchOperation(operation, deadline, signal, onStop) {
  if (signal?.aborted) return Promise.reject(canceledError());
  return new Promise((resolve, reject) => {
    const timeoutMs = Math.max(1, deadline - Date.now());
    const finish = (callback, value) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      callback(value);
    };
    const cancel = () => {
      finish(reject, canceledError());
      onStop?.();
    };
    const timer = setTimeout(() => {
      finish(reject, new Error('项目理解资料获取超过整体任务预算'));
      onStop?.();
    }, timeoutMs);
    signal?.addEventListener('abort', cancel, { once: true });
    Promise.resolve(operation).then((value) => finish(resolve, value), (error) => finish(reject, error));
  });
}

function normalizeTopics(value) {
  const topics = Array.isArray(value) ? value : String(value || '').split(/[\n；;]/);
  return [...new Set(topics.map((topic) => String(topic || '').replace(/\s+/g, ' ').trim()).filter(Boolean))];
}

function projectContextLine(label, value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text ? `${label}：${text}` : '';
}

function assertPublicTopics(value) {
  const topics = normalizeTopics(value);
  if (!topics.length) throw new Error('请先填写经人工确认的公开研究主题');
  if (topics.length > 8) throw new Error('公开研究主题最多 8 项');
  const sensitive = /(api[_ -]?key|password|secret|token|密码|密钥|身份证|银行卡|银行账号|卡号|合同原文|合同报价|投标价|报价明细|人员证件|联系方式|秘密项目|机密|\b\d{11,19}\b|\b\d{17}[\dXx]\b|\d+(?:\.\d+)?\s*(?:万元|亿元)(?:报价|合同|预算)?|[A-Za-z]:\\|\\\\|file:\/\/)/i;
  for (const topic of topics) {
    if (topic.length > 180 || sensitive.test(topic)) throw new Error(`研究主题不适合外部检索：${topic.slice(0, 30)}`);
  }
  return topics;
}

function isPrivateAddress(address) {
  if (net.isIPv4(address)) {
    const parts = address.split('.').map(Number);
    return parts[0] === 10
      || parts[0] === 127
      || (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127)
      || (parts[0] === 169 && parts[1] === 254)
      || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
      || (parts[0] === 192 && parts[1] === 168)
      || (parts[0] === 192 && parts[1] === 0 && (parts[2] === 0 || parts[2] === 2))
      || (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19 || parts[1] === 51))
      || (parts[0] === 203 && parts[1] === 0 && parts[2] === 113)
      || parts[0] === 0
      || parts[0] >= 224;
  }
  if (net.isIPv6(address)) {
    const normalized = address.toLowerCase();
    if (normalized.startsWith('::ffff:')) return isPrivateAddress(normalized.slice(7));
    return normalized === '::1' || normalized === '::' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb') || normalized.startsWith('ff') || normalized.startsWith('2001:db8');
  }
  return true;
}

async function resolvePublicHttpsUrl(rawUrl) {
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:') throw new Error('仅允许访问 HTTPS 公开资料');
  if (url.username || url.password) throw new Error('公开资料地址不得包含凭据');
  if (['localhost', 'metadata.google.internal'].includes(url.hostname.toLowerCase())) throw new Error('拒绝访问本地或元数据地址');
  const addresses = await dns.lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) throw new Error('拒绝访问内网、回环或链路本地地址');
  return { url, addresses };
}

async function assertPublicHttpsUrl(rawUrl) {
  return (await resolvePublicHttpsUrl(rawUrl)).url;
}

function createPinnedDispatcher(addresses) {
  const selected = addresses[0];
  return new Agent({
    connect: {
      lookup: (_hostname, _options, callback) => callback(null, selected.address, selected.family),
    },
  });
}

async function readLimitedBody(body) {
  const chunks = [];
  let size = 0;
  for await (const chunk of body || []) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_SOURCE_BYTES) throw new Error('公开资料超过 2MB 限制');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks, size);
}

async function fetchWithPolicy(rawUrl, { headers = {}, timeoutMs = 20000, signal, retries = 2 } = {}) {
  let target = await resolvePublicHttpsUrl(rawUrl);
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    try {
      let redirects = 0;
      while (true) {
        const dispatcher = createPinnedDispatcher(target.addresses);
        try {
          const response = await fetch(target.url, { headers, redirect: 'manual', signal: controller.signal, dispatcher });
          if ([301, 302, 303, 307, 308].includes(response.status)) {
            if (redirects >= 5) throw new Error('来源重定向次数过多');
            const location = response.headers.get('location');
            if (!location) throw new Error('来源重定向缺少目标');
            await response.body?.cancel();
            target = await resolvePublicHttpsUrl(new URL(location, target.url).toString());
            redirects += 1;
            continue;
          }
          if (!response.ok) {
            const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
            await response.body?.cancel();
            if (retryable && attempt < retries) break;
            throw new Error(`公开资料请求失败（HTTP ${response.status}）`);
          }
          const declared = Number(response.headers.get('content-length') || 0);
          if (declared > MAX_SOURCE_BYTES) throw new Error('公开资料超过 2MB 限制');
          const bytes = await readLimitedBody(response.body);
          return { bytes, contentType: response.headers.get('content-type') || '', url: target.url.toString() };
        } finally {
          await dispatcher.close();
        }
      }
    } catch (error) {
      if (signal?.aborted) throw canceledError();
      if (attempt >= retries) throw error;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
    }
  }
  throw new Error('公开资料请求失败');
}

async function searchBrave(topic, config, signal) {
  const apiKey = String(config.api_key || '').trim();
  if (!apiKey) throw new Error('未配置 Brave Search API Key，请在“设置 > 组件设置 > 公开资料检索”中填写');
  const url = new URL(BRAVE_ENDPOINT);
  url.searchParams.set('q', topic);
  url.searchParams.set('count', String(Math.max(1, Math.min(20, Number(config.max_results_per_topic || 5)))));
  url.searchParams.set('country', 'CN');
  const response = await fetchWithPolicy(url.toString(), {
    headers: { Accept: 'application/json', 'X-Subscription-Token': apiKey },
    timeoutMs: Number(config.timeout_ms || 20000),
    signal,
  });
  const json = JSON.parse(response.bytes.toString('utf8'));
  return (json?.web?.results || []).map((item) => ({ title: item.title || '', url: item.url || '' })).filter((item) => item.url);
}

function htmlToText(bytes, contentType = '') {
  const header = `${contentType} ${bytes.subarray(0, 4096).toString('ascii')}`;
  const declared = header.match(/charset\s*=\s*["']?([A-Za-z0-9_-]+)/i)?.[1]?.toLowerCase() || 'utf-8';
  const encoding = ['gbk', 'gb2312', 'gb18030'].includes(declared) ? 'gb18030' : 'utf8';
  const $ = cheerio.load(iconv.decode(bytes, encoding));
  $('script,style,noscript,nav,footer,form,svg').remove();
  const title = $('meta[property="og:title"]').attr('content') || $('title').first().text().trim();
  const publisher = $('meta[name="author"]').attr('content') || $('meta[property="og:site_name"]').attr('content') || '';
  const publishedAt = $('meta[property="article:published_time"]').attr('content') || $('time[datetime]').first().attr('datetime') || '';
  const text = ($('article').text() || $('main').text() || $('body').text()).replace(/\s+/g, ' ').trim();
  if (text.length < 300 || /(验证码|安全验证|请登录|captcha)/i.test(text.slice(0, 800))) throw new Error('来源正文不可用或需要登录/验证');
  return { title, publisher, publishedAt, text: text.slice(0, 120000) };
}

async function loadSource(app, configStore, candidate, researchConfig, signal) {
  const response = await fetchWithPolicy(candidate.url, { timeoutMs: Number(researchConfig.timeout_ms || 20000), signal });
  let parsed;
  if (/pdf/i.test(response.contentType) || /\.pdf(?:$|\?)/i.test(response.url)) {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jatobid-pu-'));
    const filePath = path.join(tempDir, 'source.pdf');
    try {
      fs.writeFileSync(filePath, response.bytes);
      parsed = { title: candidate.title, publisher: '', publishedAt: '', text: await parseDocumentWithConfig(app, filePath, configStore.load(), { preserveImages: false, suppressFileIdentity: true }) };
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  } else {
    parsed = htmlToText(response.bytes, response.contentType);
  }
  const sourceId = `pu-${stableHash(response.url).slice(0, 12)}`;
  return {
    source_id: sourceId,
    title: parsed.title || candidate.title || response.url,
    publisher: parsed.publisher || new URL(response.url).hostname,
    source_type: 'public-web',
    version_type: 'actual-read-page',
    url: response.url,
    published_at: parsed.publishedAt || '',
    published_precision: parsed.publishedAt ? 'exact' : 'unknown',
    retrieved_at: new Date().toISOString(),
    content_hash: stableHash(parsed.text),
    body: String(parsed.text || '').trim(),
  };
}

function normalizeEvidenceResponse(value) {
  const source = value?.result && typeof value.result === 'object' ? value.result : value || {};
  return { evidence: Array.isArray(source.evidence) ? source.evidence : [], relations: Array.isArray(source.relations) ? source.relations : [], gaps: Array.isArray(source.gaps) ? source.gaps : [] };
}

function commitResearchVersionState(value, version, run = {}) {
  const next = normalizeProjectUnderstanding(value);
  next.reference_date = version.reference_date;
  next.versions.push(version);
  if (next.active_version_id) {
    next.pending_version_id = version.version_id;
  } else {
    next.active_version_id = version.version_id;
    next.human_review = { status: 'unreviewed' };
    next.content_review = { status: 'pending', issues: [] };
  }
  next.audit_log.push({ action: 'research-completed', version_id: version.version_id, run_id: run.run_id, provider: run.provider, model_name: run.model_name, started_at: version.started_at, at: new Date().toISOString(), status: version.status, source_count: version.sources.length, evidence_count: version.evidence.length });
  return next;
}

function buildResearchScopeHash(plan) {
  return stableHash(JSON.stringify({
    workflow_kind: plan?.workflowKind || '',
    selected_section_id: plan?.tenderFile?.selectedSectionId || '',
    selected_section_title: plan?.tenderFile?.selectedSectionTitle || '',
    tender_file: plan?.tenderFile || null,
    project_overview: plan?.projectOverview || '',
    tech_requirements: plan?.techRequirements || '',
  }));
}

function authorityStatus(rawUrl) {
  try {
    const hostname = new URL(rawUrl).hostname.toLowerCase();
    return hostname === 'gov.cn' || hostname.endsWith('.gov.cn') ? 'official' : 'review-required';
  } catch {
    return 'review-required';
  }
}

function loadInternalSources(knowledgeBaseService, documentIds, maxSources) {
  if (!knowledgeBaseService?.getOutlineReferences || !knowledgeBaseService?.readItems || !documentIds.length) return { sources: [], gaps: [] };
  const references = knowledgeBaseService.getOutlineReferences(documentIds)?.items || [];
  const itemMap = new Map();
  for (const documentId of documentIds) {
    for (const item of knowledgeBaseService.readItems(documentId) || []) {
      itemMap.set(`${documentId}::${item.id}`, item);
    }
  }
  const sources = [];
  const gaps = [];
  for (const reference of references.slice(0, maxSources)) {
    const item = itemMap.get(String(reference.id || ''));
    const body = String(item?.content || '').trim();
    if (!item || body.length < 8) continue;
    const fileName = path.win32.basename(String(item.source_file || '')).replace(/[\\/]/g, '');
    sources.push({
      source_id: `pu-internal-${stableHash(reference.id).slice(0, 12)}`,
      title: String(reference.title || item.title || '授权内部资料'),
      publisher: '授权知识库',
      source_type: 'internal',
      internal_location: [fileName, item.title].filter(Boolean).join(' > '),
      published_at: '',
      retrieved_at: new Date().toISOString(),
      content_hash: stableHash(body),
      authority_status: 'review-required',
      version_type: 'authorized-internal',
      body,
    });
    gaps.push(`[可人工确认]${reference.title || item.title}：内部资料版本及适用时点待人工复核`);
  }
  return { sources, gaps };
}

function getInternalSourceLimit(maxSources, researchConfig) {
  return Math.max(0, maxSources - (String(researchConfig?.api_key || '').trim() ? 1 : 0));
}

async function extractEvidence(aiService, sources, context) {
  let remainingChars = 80000;
  const sourceText = sources.map((source, index) => {
    const body = source.body.slice(0, Math.max(0, remainingChars));
    remainingChars -= body.length;
    return `### 来源 ${index + 1}\nsource_id: ${source.source_id}\n标题: ${source.title}\n发布机构: ${source.publisher}\n发布日期: ${source.published_at || '未知'}\n正文:\n${body}`;
  }).filter((text) => !text.endsWith('正文:\n')).join('\n\n');
  const result = await aiService.requestJson({
    messages: [
      { role: 'system', content: '你是项目理解证据核验助手。只能从给定来源正文逐字抽取可核验片段；不得把搜索摘要、推测或常识当作原文。' },
      { role: 'user', content: `研究截止日期：${context.referenceDate}\n公开研究主题：${context.topics.join('、')}\n当前项目与标包上下文（只用于相关性判断，不得当作公开来源）：\n${context.projectContext || '未提供'}\n\n请返回 JSON：{"evidence":[{"evidence_key":"本次响应内唯一短标识","source_id":"","excerpt":"来源中完全一致的连续原文","claim":"该片段联系到当前项目后可支持的认识","theme":"适合作为目录标题的简短独立主题","layer":"macro|industry|superior|procurer|project|response","relationship":"direct|background|inference","event_date":"可选","speaker":"可选","occasion":"可选","document_number":"可选文号","applicable_object":"可选适用对象","region":"可选地域","period":"可选时期","effective_status":"current|superseded|future|unknown|not-applicable","status_evidence":"支持有效性判断的连续原文"}],"relations":[{"from_evidence_key":"","to_evidence_key":"","relation_type":"regulatory|administrative-subordination|group-control|business-guidance|policy-to-project|background-context|analytical-inference","relationship":"direct|background|inference","support_evidence_keys":[""],"support_source_id":"","support_excerpt":"能逐字证明该关系或推导基础的连续原文","explanation":"仅描述证据支持的关联，不补造事实"}],"gaps":["待补证问题"]}。每条关联必须引用已返回的证据端点及支撑证据，并提供可逐字定位的 support_excerpt。组织关系或项目直接承接必须由该片段明确表述；只有相关性时使用 background-context/background，需要分析连接时使用 analytical-inference/inference。缺少组织关系或中间承接证据时写入 gaps，不得按层级顺序自动补边。所有元数据都必须能在来源正文中逐字定位，不能确定则留空或 unknown。theme 仅在存在多个可独立展开、边界清楚且不重复的主题时填写；能在父节完整说明则所有证据的 theme 留空。不得把日期、讲话原句、文号或政策全名直接当作 theme。\n\n${NATURAL_OUTLINE_GROUPING_RULES}\n\n${sourceText}` },
    ],
    temperature: 0.1,
    response_format: { type: 'json_object' },
    normalizer: normalizeEvidenceResponse,
    progressLabel: '项目理解证据核验',
    failureMessage: '项目理解证据核验结果无效',
    logTitle: '项目理解证据核验',
    signal: context.signal,
  });
  const sourceMap = new Map(sources.map((source) => [source.source_id, source]));
  const evidence = [];
  const evidenceKeyMap = new Map();
  const gaps = [...result.gaps];
  for (const item of result.evidence) {
    const source = sourceMap.get(String(item?.source_id || ''));
    const excerpt = String(item?.excerpt || '').trim();
    if (!source || excerpt.length < 8 || !source.body.includes(excerpt)) {
      gaps.push(`已拒绝无法与原文逐字匹配的引语：${excerpt.slice(0, 30) || '空引语'}`);
      continue;
    }
    const rawEventDate = String(item.event_date || '').trim();
    if (rawEventDate && /^\d{4}-\d{2}-\d{2}$/.test(rawEventDate) && rawEventDate > context.referenceDate) {
      gaps.push(`已拒绝超过截止日期的证据：${rawEventDate}`);
      continue;
    }
    let relationship = ['direct', 'background', 'inference'].includes(item.relationship) ? item.relationship : 'background';
    const rawSpeaker = String(item.speaker || '').trim();
    const rawOccasion = String(item.occasion || '').trim();
    const chineseDate = /^\d{4}-\d{2}-\d{2}$/.test(rawEventDate)
      ? `${Number(rawEventDate.slice(0, 4))}年${Number(rawEventDate.slice(5, 7))}月${Number(rawEventDate.slice(8, 10))}日`
      : '';
    const speaker = rawSpeaker && source.body.includes(rawSpeaker) ? rawSpeaker : '';
    const occasion = rawOccasion && source.body.includes(rawOccasion) ? rawOccasion : '';
    const eventDate = rawEventDate && (source.body.includes(rawEventDate) || source.body.includes(chineseDate)) ? rawEventDate : '';
    if ((rawSpeaker && !speaker) || (rawOccasion && !occasion) || (rawEventDate && !eventDate)) {
      gaps.push(`[可人工确认]${source.title}：模型返回的讲话属性未与来源正文匹配，未采用该属性`);
    }
    const speechLike = Boolean(rawSpeaker || rawOccasion || /(讲话|会议|指出|强调|提出|表示)/.test(`${item.claim || ''}${excerpt}`));
    if (relationship === 'direct' && speechLike && (!speaker || !eventDate || !occasion)) {
      relationship = 'background';
      gaps.push(`[可人工确认]${source.title}：讲话人、日期或场合未能与来源正文同时匹配，已降为背景关联`);
    }
    const literalField = (name, label) => {
      const raw = String(item[name] || '').trim();
      if (!raw || source.body.includes(raw)) return raw;
      gaps.push(`[可人工确认]${source.title}：${label}未与来源正文匹配，未采用`);
      return '';
    };
    const documentNumber = literalField('document_number', '文号');
    const applicableObject = literalField('applicable_object', '适用对象');
    const region = literalField('region', '适用地域');
    const period = literalField('period', '适用时期');
    const statusEvidence = literalField('status_evidence', '有效性依据');
    const requestedStatus = ['current', 'superseded', 'future', 'unknown', 'not-applicable'].includes(item.effective_status) ? item.effective_status : 'unknown';
    const effectiveStatus = ['unknown', 'not-applicable'].includes(requestedStatus) || statusEvidence ? requestedStatus : 'unknown';
    const evidenceId = `pu-e-${stableHash(`${source.source_id}\n${excerpt}`).slice(0, 16)}`;
    const evidenceKey = String(item.evidence_key || evidenceId).trim();
    if (evidenceKeyMap.has(evidenceKey)) {
      gaps.push(`存在重复证据标识，已拒绝：${evidenceKey.slice(0, 30)}`);
      continue;
    }
    evidenceKeyMap.set(evidenceKey, evidenceId);
    evidence.push({
      evidence_id: evidenceId,
      source_id: source.source_id,
      excerpt,
      location: `正文字符 ${source.body.indexOf(excerpt) + 1}-${source.body.indexOf(excerpt) + excerpt.length}`,
      claim: String(item.claim || '').trim(),
      theme: String(item.theme || '').trim().slice(0, 40),
      layer: ['macro', 'industry', 'superior', 'procurer', 'project', 'response'].includes(item.layer) ? item.layer : 'project',
      relationship,
      event_date: eventDate,
      speaker,
      occasion,
      document_number: documentNumber,
      applicability: { object: applicableObject, region, period },
      effective_status: effectiveStatus,
      status_evidence: statusEvidence,
    });
  }
  const layers = new Set(evidence.map((item) => item.layer));
  if (![...layers].some((layer) => ['macro', 'industry'].includes(layer))) gaps.push('缺少宏观或行业背景层证据');
  if (![...layers].some((layer) => ['superior', 'procurer'].includes(layer))) gaps.push('缺少上级部署或采购人职责层证据');
  if (![...layers].some((layer) => ['project', 'response'].includes(layer))) gaps.push('缺少项目需求或响应落点层证据');
  const relationTypes = new Set(['regulatory', 'administrative-subordination', 'group-control', 'business-guidance', 'policy-to-project', 'background-context', 'analytical-inference']);
  const relationships = new Set(['direct', 'background', 'inference']);
  const directRelationPatterns = {
    regulatory: /(监管|监督管理|主管部门|依法.{0,12}监管)/,
    'administrative-subordination': /(隶属|直属|下属|所属单位|上级单位|主管单位)/,
    'group-control': /(控股|全资|母公司|子公司|集团所属|出资设立)/,
    'business-guidance': /(业务指导|指导.{0,12}工作|接受.{0,12}指导)/,
    'policy-to-project': /((本项目|该项目|项目建设|采购项目).{0,40}(依据|落实|按照|执行|要求)|(依据|落实|按照|执行).{0,40}(本项目|该项目|项目建设|采购项目))/,
  };
  const acceptedEvidenceMap = new Map(evidence.map((item) => [item.evidence_id, item]));
  const relations = [];
  for (const item of result.relations || []) {
    const fromId = evidenceKeyMap.get(String(item?.from_evidence_key || '').trim());
    const toId = evidenceKeyMap.get(String(item?.to_evidence_key || '').trim());
    const supportIds = [...new Set((Array.isArray(item?.support_evidence_keys) ? item.support_evidence_keys : []).map((key) => evidenceKeyMap.get(String(key || '').trim())).filter(Boolean))];
    const supportSource = sourceMap.get(String(item?.support_source_id || ''));
    const supportExcerpt = String(item?.support_excerpt || '').trim();
    const supportMatches = supportSource && supportExcerpt.length >= 8 && supportSource.body.includes(supportExcerpt);
    const directPattern = directRelationPatterns[item?.relation_type];
    const directEndpointsProven = supportIds.includes(fromId)
      && supportIds.includes(toId)
      && supportExcerpt.includes(acceptedEvidenceMap.get(fromId)?.excerpt || '\0')
      && supportExcerpt.includes(acceptedEvidenceMap.get(toId)?.excerpt || '\0');
    const classificationMatches = item?.relation_type === 'background-context'
      ? item?.relationship === 'background'
      : item?.relation_type === 'analytical-inference'
        ? item?.relationship === 'inference'
        : item?.relationship === 'direct' && directEndpointsProven && directPattern?.test(supportExcerpt);
    if (!fromId || !toId || fromId === toId || !relationTypes.has(item?.relation_type) || !relationships.has(item?.relationship) || !supportIds.length || !supportMatches || !classificationMatches) {
      gaps.push('存在端点、关系类型或支撑证据不完整的关联候选，已拒绝');
      continue;
    }
    relations.push({
      from_evidence_id: fromId,
      to_evidence_id: toId,
      relation_type: item.relation_type,
      relationship: item.relationship,
      support_evidence_ids: supportIds,
      support_source_id: supportSource.source_id,
      support_excerpt: supportExcerpt,
      explanation: String(item.explanation || '').trim(),
    });
  }
  const adjacency = new Map();
  for (const relation of relations) {
    if (!adjacency.has(relation.from_evidence_id)) adjacency.set(relation.from_evidence_id, []);
    adjacency.get(relation.from_evidence_id).push(relation.to_evidence_id);
  }
  const upperIds = evidence.filter((item) => ['macro', 'industry'].includes(item.layer)).map((item) => item.evidence_id);
  const bridgeIds = new Set(evidence.filter((item) => ['superior', 'procurer'].includes(item.layer)).map((item) => item.evidence_id));
  const lowerIds = new Set(evidence.filter((item) => ['project', 'response'].includes(item.layer)).map((item) => item.evidence_id));
  const hasSupportedChain = upperIds.some((start) => (adjacency.get(start) || []).some((bridge) => bridgeIds.has(bridge) && (adjacency.get(bridge) || []).some((end) => lowerIds.has(end))));
  if (evidence.length && !hasSupportedChain) gaps.push('缺少由明确证据关系支撑的宏观/行业—上级/采购人—项目/响应关联链');
  return { evidence, relations, gaps: [...new Set(gaps)] };
}

async function runProjectUnderstandingResearchTask({ app, configStore, aiService, workspaceStore, knowledgeBaseService, updateTask, payload, taskControl }) {
  const startedAt = new Date().toISOString();
  const topics = assertPublicTopics(payload?.topics);
  const referenceDate = String(payload?.reference_date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(referenceDate)) throw new Error('请选择有效的研究截止日期');
  const appConfig = configStore.load() || {};
  const config = appConfig.project_research || {};
  const plan = workspaceStore.loadTechnicalPlan() || {};
  const state = normalizeProjectUnderstanding(plan.projectUnderstanding);
  const maxSources = Math.max(1, Math.min(20, Number(config.max_sources || 8)));
  const knowledgeDocumentIds = Array.isArray(plan.referenceKnowledgeDocumentIds) ? plan.referenceKnowledgeDocumentIds.map(String).filter(Boolean) : [];
  const internal = loadInternalSources(knowledgeBaseService, knowledgeDocumentIds, getInternalSourceLimit(maxSources, config));
  const outlineRevision = stableHash(JSON.stringify(plan.outlineData || {}));
  const scopeHash = buildResearchScopeHash(plan);
  const inputHash = stableHash(JSON.stringify({ topics, referenceDate, outlineRevision, scopeHash, promptVersion: RESEARCH_PROMPT_VERSION, provider: 'brave', internal: internal.sources.map((source) => [source.source_id, source.content_hash]) }));
  const cached = state.versions.find((version) => version.input_hash === inputHash
    && ['complete', 'partial'].includes(version.status)
    && Date.now() - Date.parse(version.completed_at || '') <= CACHE_MAX_AGE_MS);
  if (cached && payload?.force_refresh !== true) {
    state.active_version_id = state.active_version_id || cached.version_id;
    state.pending_version_id = state.active_version_id === cached.version_id ? undefined : cached.version_id;
    state.reference_date = referenceDate;
    const saved = workspaceStore.updateTechnicalPlan({ projectUnderstanding: state });
    updateTask({ status: 'success', progress: 100, logs: ['已复用相同条件的资料快照。'] }, saved);
    return;
  }

  const abortController = new AbortController();
  const deadline = Date.now() + Math.max(60000, Number(config.overall_timeout_ms || 300000));
  const assertWithinBudget = () => {
    if (Date.now() > deadline) throw new Error('项目理解资料获取超过整体任务预算');
  };
  let logs = ['开始获取项目理解公开资料。'];
  const update = (message, progress) => {
    logs = [...logs, message];
    updateTask({ status: 'running', progress, logs }, workspaceStore.loadTechnicalPlan());
  };
  taskControl.cancel = () => {
    abortController.abort();
    taskControl.pauseAiQueue?.();
  };
  update('正在调用 Brave Search API。', 10);
  const candidates = [];
  let searchError;
  for (const topic of topics) {
    assertWithinBudget();
    if (taskControl.isPauseRequested()) abortController.abort();
    try {
      candidates.push(...await waitForResearchOperation(
        searchBrave(topic, config, abortController.signal),
        deadline,
        abortController.signal,
        () => abortController.abort(),
      ));
    } catch (error) {
      if (error?.code === 'TASK_CANCELED' || /整体任务预算/.test(String(error?.message || ''))) throw error;
      searchError = error;
      if (!internal.sources.length) throw error;
      internal.gaps.push(`公开检索未完成：${error.message || String(error)}`);
      break;
    }
  }
  const unique = [...new Map(candidates.map((item) => [item.url, item])).values()]
    .sort((left, right) => Number(authorityStatus(left.url) !== 'official') - Number(authorityStatus(right.url) !== 'official'))
    .slice(0, Math.max(0, maxSources - internal.sources.length));
  const sources = [...internal.sources];
  const gaps = [...internal.gaps];
  for (let index = 0; index < unique.length; index += 1) {
    assertWithinBudget();
    if (taskControl.isPauseRequested()) abortController.abort();
    try {
      const source = await waitForResearchOperation(
        loadSource(app, configStore, unique[index], config, abortController.signal),
        deadline,
        abortController.signal,
        () => abortController.abort(),
      );
      const publishedDate = String(source.published_at || '').slice(0, 10);
      if (publishedDate && /^\d{4}-\d{2}-\d{2}$/.test(publishedDate) && publishedDate > referenceDate) {
        gaps.push(`${source.title}：发布日期 ${publishedDate} 超过研究截止日期，已排除`);
      } else {
        source.authority_status = authorityStatus(source.url);
        if (source.authority_status !== 'official') gaps.push(`[可人工确认]${source.title}：非政府官方域名，来源权威性待人工复核`);
        if (!publishedDate) gaps.push(`${source.title}：发布日期未知，无法核定适用时点`);
        sources.push(source);
      }
    } catch (error) {
      if (error?.code === 'TASK_CANCELED' || /整体任务预算/.test(String(error?.message || ''))) throw error;
      gaps.push(`${unique[index].title || unique[index].url}：${error.message || String(error)}`);
    }
    update(`已获取可用正文 ${sources.length}/${maxSources}。`, 20 + Math.round(((index + 1) / Math.max(1, unique.length)) * 45));
  }
  if (!sources.length) throw searchError || new Error('未获取到可核验的公开或授权内部来源正文');
  update('正在逐字核验原文引语并整理层级关联。', 75);
  const projectContext = [
    projectContextLine('当前标包', plan.tenderFile?.selectedSectionTitle || plan.tenderFile?.selectedSectionId),
    projectContextLine('项目概况', plan.projectOverview),
    projectContextLine('技术与履约要求', plan.techRequirements),
  ].filter(Boolean).join('\n').slice(0, 16000);
  taskControl.deferQueueResume = true;
  const extraction = extractEvidence(aiService, sources, { topics, referenceDate, projectContext, signal: abortController.signal });
  extraction.then(() => {
    taskControl.deferQueueResume = false;
    taskControl.resumeAiQueue?.();
  }, () => {
    taskControl.deferQueueResume = false;
    taskControl.resumeAiQueue?.();
  });
  const extracted = await waitForResearchOperation(extraction, deadline, abortController.signal, () => taskControl.pauseAiQueue?.());
  if (taskControl.isPauseRequested() || abortController.signal.aborted) throw canceledError();
  assertWithinBudget();
  const latest = workspaceStore.loadTechnicalPlan() || {};
  if (stableHash(JSON.stringify(latest.outlineData || {})) !== outlineRevision) throw new Error('目录已变更，本次资料结果未写回，请重新获取');
  if (buildResearchScopeHash(latest) !== scopeHash) throw new Error('当前项目或标包已变更，本次资料结果未写回，请重新获取');
  const version = {
    version_id: `pu-version-${crypto.randomUUID()}`,
    status: extracted.evidence.length && gaps.length + extracted.gaps.length === 0 ? 'complete' : 'partial',
    reference_date: referenceDate,
    topics,
    input_hash: inputHash,
    scope_hash: scopeHash,
    prompt_version: RESEARCH_PROMPT_VERSION,
    outline_revision: outlineRevision,
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    sources: sources.map(({ body, ...source }) => source),
    evidence: extracted.evidence,
    relations: extracted.relations,
    gaps: [...gaps, ...extracted.gaps],
  };
  const hadActiveVersion = Boolean(normalizeProjectUnderstanding(latest.projectUnderstanding).active_version_id);
  const next = commitResearchVersionState(latest.projectUnderstanding, version, {
    run_id: taskControl.queueScopeId?.split(':').slice(1).join(':'),
    provider: appConfig.text_model_provider,
    model_name: appConfig.model_name,
  });
  const nextOutlineData = hadActiveVersion
    ? latest.outlineData
    : buildProjectUnderstandingSubtree(latest.outlineData, next.placement, version.evidence);
  version.outline_revision = stableHash(JSON.stringify(nextOutlineData || {}));
  const saved = workspaceStore.updateTechnicalPlan({ outlineData: nextOutlineData, projectUnderstanding: next });
  updateTask({ status: 'success', progress: 100, logs: [...logs, `资料获取完成：${version.sources.length} 个来源、${version.evidence.length} 条已核验证据。`] }, saved, { outlineData: nextOutlineData });
}

module.exports = {
  assertPublicHttpsUrl,
  assertPublicTopics,
  buildResearchScopeHash,
  commitResearchVersionState,
  extractEvidence,
  getInternalSourceLimit,
  fetchWithPolicy,
  htmlToText,
  isPrivateAddress,
  loadInternalSources,
  readLimitedBody,
  runProjectUnderstandingResearchTask,
  searchBrave,
  waitForResearchOperation,
};
