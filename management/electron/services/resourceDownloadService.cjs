const fs = require('node:fs');
const path = require('node:path');
const dns = require('node:dns/promises');
const net = require('node:net');
const crypto = require('node:crypto');
const zlib = require('node:zlib');

function publicAddress(address) {
  const ip = address.toLowerCase().replace(/^::ffff:/, '');
  if (net.isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127));
  }
  return net.isIP(ip) === 6 && !/^(::|fc|fd|fe[89ab])/.test(ip);
}

async function validateUrl(raw, hosts) {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !hosts.includes(url.hostname)) throw new Error('资源地址不在批准的HTTPS来源范围');
  const addresses = await dns.lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => !publicAddress(address))) throw new Error('公共资源来源不能访问本机或内网');
  return url.href;
}

// 只读取有界ZIP目录及XML，不执行宏、脚本或外部关系。
function readZip(buffer) {
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0 || end + 22 > buffer.length) throw new Error('ZIP目录无效');
  const count = buffer.readUInt16LE(end + 10);
  let cursor = buffer.readUInt32LE(end + 16);
  const members = new Map(), names = new Set(); let total = 0;
  if (count > 20000 || count === 65535) throw new Error('ZIP成员数量超限或不支持ZIP64');
  for (let i = 0; i < count; i += 1) {
    if (cursor + 46 > end || buffer.readUInt32LE(cursor) !== 0x02014b50) throw new Error('ZIP中央目录损坏');
    const flags = buffer.readUInt16LE(cursor + 8), method = buffer.readUInt16LE(cursor + 10);
    const crc = buffer.readUInt32LE(cursor + 16), compressed = buffer.readUInt32LE(cursor + 20), size = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28), extra = buffer.readUInt16LE(cursor + 30), comment = buffer.readUInt16LE(cursor + 32);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    const local = buffer.readUInt32LE(cursor + 42);
    total += size;
    if (flags & 1 || total > 512 * 1024 * 1024 || size > 128 * 1024 * 1024 || names.has(name.toLowerCase()) || ((buffer.readUInt32LE(cursor + 38) >>> 16) & 0xf000) === 0xa000
      || name.includes('\\') || name.startsWith('/') || name.split('/').includes('..') || /^[a-z]:/i.test(name)) throw new Error('ZIP含加密、越界或超限成员');
    if (local + 30 > buffer.length || buffer.readUInt32LE(local) !== 0x04034b50) throw new Error('ZIP本地成员损坏');
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    if (start + compressed > buffer.length) throw new Error('ZIP长度不符');
    const data = method === 0 ? buffer.subarray(start, start + compressed)
      : method === 8 ? zlib.inflateRawSync(buffer.subarray(start, start + compressed), { maxOutputLength: size || 1 }) : null;
    if (!data || data.length !== size || zlib.crc32(data) !== crc) throw new Error('ZIP成员CRC校验失败');
    members.set(name, data);
    names.add(name.toLowerCase());
    cursor += 46 + nameLength + extra + comment;
  }
  return members;
}

function inspectPptx(buffer) {
  const files = readZip(buffer);
  if (!files.has('[Content_Types].xml') || !files.has('ppt/presentation.xml')) throw new Error('文件不是有效PPTX');
  let external = 0, macro = false;
  for (const [name, data] of files) {
    if (/vbaProject|activeX/i.test(name)) macro = true;
    if (/^ppt\/embeddings\//i.test(name)) {
      if (!/\.xlsx$/i.test(name)) macro = true;
      else {
        const workbook = readZip(data);
        if (!workbook.has('xl/workbook.xml') || [...workbook].some(([part, bytes]) => /vbaProject|activeX|embeddings/i.test(part)
          || /\.(xml|rels)$/i.test(part) && /<!DOCTYPE|<!ENTITY|TargetMode\s*=\s*["']External["']/i.test(bytes.toString('utf8')))) macro = true;
      }
    }
    if (/\.(?:xml|rels)$/i.test(name)) {
      const xml = data.toString('utf8');
      if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('不接受含XML实体的模板');
      if (/\.rels$/.test(name)) external += (xml.match(/TargetMode\s*=\s*["']External["']/g) || []).length;
    }
  }
  const presentation = files.get('ppt/presentation.xml').toString('utf8');
  const size = presentation.match(/<p:sldSz\b[^>]*\bcx="(\d+)"[^>]*\bcy="(\d+)"/);
  const slides = [...files].filter(([name]) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));
  if (!size || !slides.length || macro || external) throw new Error('模板尺寸缺失或包含宏、嵌入对象、外部关系');
  const pages = slides.map(([name, data]) => {
    const xml = data.toString('utf8');
    return { name, hash: crypto.createHash('sha256').update(data).digest('hex'),
      shapes: (xml.match(/<p:sp(?:\s|>)/g) || []).length,
      pictures: (xml.match(/<p:pic(?:\s|>)/g) || []).length,
      text: (xml.match(/<a:t(?:\s[^>]*)?>[^<]+<\/a:t>/g) || []).length,
      tables: (xml.match(/<a:tbl(?:\s|>)/g) || []).length,
      charts: (xml.match(/<c:chart(?:\s|>)/g) || []).length };
  });
  const native = pages.some((page) => page.shapes || page.text || page.tables || page.charts);
  return { pageCount: pages.length, width: Number(size[1]), height: Number(size[2]),
    aspectRatio: Number(size[1]) / Number(size[2]), pages, checked: 'structure_checked',
    capability: native ? 'native_candidate' : 'visual_reference_candidate', reuseVerified: false,
    adapterVersion: 'jato-ppt-inspect-1' };
}

function createResourceDownloadService({ root, store, fetchImpl = fetch, urlValidator = validateUrl, quotaBytes = 20 * 1024 ** 3, validateImage }) {
  fs.mkdirSync(root, { recursive: true });
  const inFlight = new Map();
  let reserved = 0;
  let active = 0;
  const waiting = [];
  async function response(url, { hosts, signal, etag = '', headers = {} }) {
    let target = url;
    for (let i = 0; i < 5; i += 1) {
      await urlValidator(target, hosts);
      const result = await fetchImpl(target, { redirect: 'manual', signal: AbortSignal.any([signal || new AbortController().signal, AbortSignal.timeout(60000)]),
        headers: { 'User-Agent': 'OpenJatoBID-Resources', ...headers, ...(etag ? { 'If-None-Match': etag } : {}) } });
      if (result.status >= 300 && result.status < 400 && result.status !== 304) {
        const location = result.headers.get('location');
        await result.body?.cancel();
        if (!location) throw new Error('资源重定向缺少地址');
        target = new URL(location, target).href;
      } else return result;
    }
    throw new Error('资源重定向次数超限');
  }
  async function json(url, options) {
    const result = await response(url, options);
    if (result.status === 304) return { notModified: true, etag: options.etag };
    if (!result.ok) throw new Error(`资源索引HTTP ${result.status}`);
    let bytes = 0; const chunks = [];
    for await (const chunk of result.body) {
      bytes += chunk.length;
      if (bytes > 16 * 1024 ** 2) throw new Error('资源索引超过16MiB');
      chunks.push(chunk);
    }
    return { data: JSON.parse(Buffer.concat(chunks).toString('utf8')), etag: result.headers.get('etag') || '' };
  }
  async function download(url, { hosts, signal, mime, expectedHash, maxBytes = 256 * 1024 ** 2 }) {
    const key = `${url}:${expectedHash || ''}`;
    if (inFlight.has(key)) return inFlight.get(key);
    const job = (async () => {
      if (active >= 2) await new Promise((resolve) => waiting.push(resolve)); else active += 1;
      try {
      if (signal?.aborted) throw new Error('本次资源同步已停止');
      const describe = async (asset) => {
        const value = { assetId: asset.asset_id, hash: asset.hash, bytes: asset.bytes, mime: asset.mime, relativePath: asset.relative_path };
        if (asset.mime.startsWith('image/')) Object.assign(value, await validateImage(await fs.promises.readFile(path.join(root, asset.relative_path))));
        return value;
      };
      const valid = async (asset) => asset && fs.existsSync(path.join(root, asset.relative_path))
        && fs.statSync(path.join(root, asset.relative_path)).size === asset.bytes
        && crypto.createHash('sha256').update(await fs.promises.readFile(path.join(root, asset.relative_path))).digest('hex') === asset.hash;
      if (expectedHash && await valid(store.getAsset(expectedHash))) return describe(store.getAsset(expectedHash));
      const urlHash = crypto.createHash('sha256').update(url).digest('hex');
      const origin = store.database.prepare('SELECT * FROM resource_download_origins WHERE url_hash = ?').get(urlHash);
      const oldAsset = origin ? store.getAsset(origin.asset_id) : null;
      const validOld = await valid(oldAsset);
      const part = path.join(root, `${urlHash}.part`), partialMeta = `${part}.json`;
      let partial; try { partial = JSON.parse(fs.readFileSync(partialMeta, 'utf8')); } catch { partial = null; }
      const existing = partial?.etag && fs.existsSync(part) ? fs.statSync(part).size : 0;
      const result = await response(url, { hosts, signal, etag: !existing && validOld ? origin.etag || '' : '',
        headers: existing ? { Range: `bytes=${existing}-`, 'If-Range': partial.etag } : {} });
      if (result.status === 304 && validOld) return describe(oldAsset);
      if (!result.ok) throw new Error(`资源文件HTTP ${result.status}`);
      const length = result.headers.get('content-length');
      if (length && Number(length) > maxBytes) throw new Error('资源文件超过下载上限');
      const used = store.database.prepare('SELECT COALESCE(SUM(bytes), 0) AS size FROM resource_assets').get().size;
      const budget = Math.min(maxBytes, quotaBytes - used - reserved, fs.statfsSync(root).bavail * fs.statfsSync(root).bsize - 64 * 1024 ** 2 + existing);
      if (budget <= 0) throw new Error('资源磁盘配额或剩余空间不足');
      const append = result.status === 206;
      if (append && (!existing || !new RegExp(`^bytes ${existing}-\\d+/\\d+$`).test(result.headers.get('content-range') || '') || result.headers.get('etag') !== partial.etag)) throw new Error('上游续传版本或范围不一致');
      reserved += budget;
      const handle = await fs.promises.open(part, append ? 'a' : 'w');
      const digest = crypto.createHash('sha256'); let bytes = append ? existing : 0;
      if (append) digest.update(await fs.promises.readFile(part));
      fs.writeFileSync(partialMeta, JSON.stringify({ etag: result.headers.get('etag') || '', urlHash }), 'utf8');
      let invalid = false;
      try {
        for await (const chunk of result.body) {
          if (signal?.aborted) throw new Error('本次资源同步已停止');
          bytes += chunk.length;
          if (bytes > budget) throw new Error('资源文件超过配额');
          digest.update(chunk); await handle.writeFile(chunk);
        }
        await handle.sync(); await handle.close();
        const observedHash = digest.digest('hex');
        if (!bytes || (length && Number(length) + (append ? existing : 0) !== bytes) || (expectedHash && expectedHash !== observedHash)) { invalid = true; throw new Error('资源文件长度或hash校验失败'); }
        const header = Buffer.alloc(16); const fd = fs.openSync(part, 'r'); fs.readSync(fd, header, 0, 16, 0); fs.closeSync(fd);
        if (mime === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' && header.readUInt32LE(0) !== 0x04034b50) throw new Error('PPTX内容类型错误');
        if (mime?.startsWith('image/') && !(header.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || header[0] === 255 && header[1] === 216
          || header.toString('ascii', 0, 3) === 'GIF' || header.toString('ascii', 8, 12) === 'WEBP')) throw new Error('资源图像内容类型错误');
        let dimensions = {};
        if (mime?.startsWith('image/')) {
          invalid = true;
          if (!validateImage) throw new Error('管理端图像解码组件不可用，未标记预览就绪');
          dimensions = await validateImage(await fs.promises.readFile(part));
          if (!dimensions.width || !dimensions.height || dimensions.width * dimensions.height > 80_000_000) throw new Error('图像不可解码或像素超限');
          mime = header[0] === 137 ? 'image/png' : header[0] === 255 ? 'image/jpeg' : header.toString('ascii', 0, 3) === 'GIF' ? 'image/gif' : 'image/webp';
        }
        const relativePath = path.join('assets', observedHash);
        const destination = path.join(root, relativePath); fs.mkdirSync(path.dirname(destination), { recursive: true });
        if (fs.existsSync(destination)) await fs.promises.unlink(part); else await fs.promises.rename(part, destination);
        await fs.promises.unlink(partialMeta);
        const asset = { assetId: observedHash, hash: observedHash, bytes, mime: mime || 'application/octet-stream', relativePath, ...dimensions };
        store.saveAsset(asset);
        store.database.prepare('INSERT OR REPLACE INTO resource_download_origins(url_hash, asset_id, etag) VALUES (?, ?, ?)')
          .run(urlHash, asset.assetId, result.headers.get('etag'));
        return asset;
      } catch (error) {
        await handle.close().catch(() => {});
        if (invalid) { await fs.promises.unlink(part).catch(() => {}); await fs.promises.unlink(partialMeta).catch(() => {}); }
        throw error;
      } finally { reserved -= budget; }
      } finally { const next = waiting.shift(); if (next) next(); else active -= 1; }
    })();
    inFlight.set(key, job);
    try { return await job; } finally { inFlight.delete(key); }
  }
  return { json, download, root };
}

module.exports = { createResourceDownloadService, validateUrl, publicAddress, readZip, inspectPptx };
