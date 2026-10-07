const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { fileURLToPath } = require('node:url');
const PREVIEW_VERSION = 'ppt-master-6.6.0-electron-2';
function createResourceImageDecoder({ BrowserWindow, nativeImage, session }) {
  return async (buffer) => {
    const image = nativeImage.createFromBuffer(buffer);
    if (!image.isEmpty()) return image.getSize();
    const partition = session.fromPartition(`resource-image-${crypto.randomUUID()}`);
    partition.webRequest.onBeforeRequest((request, callback) => callback({ cancel: !request.url.startsWith('data:') && request.url !== 'about:blank' }));
    const window = new BrowserWindow({ show: false, webPreferences: { session: partition, sandbox: true, nodeIntegration: false, contextIsolation: true } });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    const deadline = setTimeout(() => { if (!window.isDestroyed()) window.destroy(); }, 15000);
    try {
      await window.loadURL('data:text/html,' + encodeURIComponent('<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:">'));
      return await window.webContents.executeJavaScript(`(async () => { const bytes = Uint8Array.from(atob(${JSON.stringify(buffer.toString('base64'))}), c => c.charCodeAt(0)); const bitmap = await createImageBitmap(new Blob([bytes])); const size = {width:bitmap.width,height:bitmap.height}; bitmap.close(); return size; })()`);
    } catch { throw Object.assign(new Error('真实图片解码失败，文件未标为就绪'), { stage: 'image_decode', code: 'IMAGE_DECODE_FAILED', retryable: true }); }
    finally { clearTimeout(deadline); if (!window.isDestroyed()) window.destroy(); }
  };
}
function temporaryBytes(directory) {
  if (!fs.existsSync(directory)) return 0;
  return fs.readdirSync(directory, { withFileTypes: true }).reduce((total, item) => {
    if (item.isSymbolicLink()) throw new Error('预览暂存目录包含外部链接');
    const file = path.join(directory, item.name);
    return total + (item.isDirectory() ? temporaryBytes(file) : fs.statSync(file).size);
  }, 0);
}

function createResourcePreviewService({ app, BrowserWindow, nativeImage, session, rootOverride }) {
  const runtimeRoot = rootOverride || (app.isPackaged ? path.join(process.resourcesPath, 'ppt-runtime/win32-x64') : path.resolve(__dirname, '../../vendor/ppt-runtime/win32-x64'));
  const prepare = async function prepare(asset, report, { root, store, signal, quotaBytes }) {
    const modulePath = path.join(runtimeRoot, 'host-tools/pptRuntimeService.cjs');
    if (!fs.existsSync(modulePath)) throw new Error('管理端受管预览组件未安装，首页未标为就绪');
    const runtime = require(modulePath).createPptRuntimeService({ app, rootOverride: runtimeRoot });
    const candidate = path.join(root, '.preview-candidates', crypto.randomUUID());
    fs.mkdirSync(candidate, { recursive: true });
    const original = path.join(candidate, 'source.pptx');
    try {
      const usedBytes = () => store.database.prepare('SELECT COALESCE(SUM(bytes), 0) AS n FROM resource_assets').get().n + temporaryBytes(path.join(root, '.preview-candidates'));
      if (usedBytes() + fs.statSync(path.join(root, asset.relativePath)).size > quotaBytes) throw new Error('资源与预览暂存总量超出配额');
      await fs.promises.copyFile(path.join(root, asset.relativePath), original);
      if (crypto.createHash('sha256').update(await fs.promises.readFile(original)).digest('hex') !== asset.hash) throw new Error('预览原文件 hash 不符');
      await runtime.run({ script: 'pptx_to_svg.py', args: [original, '-o', path.join(candidate, 'native'), '--roundtrip'], projectRoot: candidate, signal });
      if (usedBytes() > quotaBytes) throw new Error('转换后的预览暂存总量超出配额');
      const pages = fs.readdirSync(path.join(candidate, 'native/authoring-svg-flat')).filter((name) => name.endsWith('.svg')).sort();
      if (pages.length !== report.pageCount) throw new Error('预览页数与原文件不一致');
      const previews = [];
      for (let page = 0; page < pages.length; page++) {
        if (signal?.aborted) throw new Error('预览准备已取消');
        const aspect = report.aspectRatio, width = 1200, height = Math.round(width / (Number(aspect) || (aspect === '4:3' ? 4 / 3 : 16 / 9)));
        const partition = session.fromPartition(`resource-preview-${crypto.randomUUID()}`);
        partition.webRequest.onBeforeRequest((request, callback) => {
          let permitted = false;
          try { const file = fs.realpathSync(fileURLToPath(request.url)); permitted = file.startsWith(`${fs.realpathSync(candidate)}${path.sep}`); } catch { permitted = request.url.startsWith('data:') || request.url === 'about:blank'; }
          callback({ cancel: !permitted });
        });
        const window = new BrowserWindow({ show: false, width, height, useContentSize: true, webPreferences: { session: partition, sandbox: true, nodeIntegration: false, contextIsolation: true, javascript: false } });
        window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        const abort = () => { if (!window.isDestroyed()) window.destroy(); }; signal?.addEventListener('abort', abort, { once: true });
        try {
          // 原生转换 SVG 保持原画幅，图片来自同一受管候选；禁止任何外连。
          const svgFile = path.join(candidate, 'native/authoring-svg-flat', pages[page]);
          const html = `${svgFile}.html`;
          const svg = fs.readFileSync(svgFile, 'utf8').replace(/\b((?:xlink:)?href)="([^"]+)"/g, (match, attribute, reference) => {
            if (reference.startsWith('#') || reference.startsWith('data:')) return match;
            const imageFile = fs.realpathSync(path.resolve(path.dirname(svgFile), reference));
            if (!imageFile.startsWith(`${fs.realpathSync(candidate)}${path.sep}`)) throw new Error('预览图片越出受管候选');
            const decoded = nativeImage.createFromPath(imageFile); if (decoded.isEmpty()) throw new Error('预览依赖图片无法解码');
            return `${attribute}="data:image/png;base64,${decoded.toPNG().toString('base64')}"`;
          });
          fs.writeFileSync(html, `<style>html,body{width:100%;height:100%;margin:0;overflow:hidden}svg{display:block;width:100vw;height:100vh}</style>${svg}`, 'utf8');
          await window.loadFile(html);
          const image = await window.webContents.capturePage(), bytes = image.toPNG(), decoded = nativeImage.createFromBuffer(bytes);
          if (decoded.isEmpty()) throw new Error('实际首页截图无法解码');
          const bitmap = decoded.toBitmap();
          if (!bitmap.some((value, index) => index % 4 !== 3 && value < 245)) throw new Error('页面截图为空白，预览未标为就绪');
          const hash = crypto.createHash('sha256').update(bytes).digest('hex'), relativePath = path.join('assets', hash);
          const used = usedBytes();
          if (used + bytes.length > quotaBytes || fs.statfsSync(root).bavail * fs.statfsSync(root).bsize < bytes.length + 64 * 1024 ** 2) throw new Error('预览空间或资源配额不足');
          fs.mkdirSync(path.join(root, 'assets'), { recursive: true }); await fs.promises.writeFile(path.join(root, relativePath), bytes);
          const dimensions = decoded.getSize();
          store.saveAsset({ assetId: hash, hash, bytes: bytes.length, mime: 'image/png', relativePath, ...dimensions });
          previews.push({ assetId: hash, hash, bytes: bytes.length, mime: 'image/png', role: page ? 'preview' : 'cover', page, generatorVersion: PREVIEW_VERSION, originalHash: asset.hash, ...dimensions });
        } finally { signal?.removeEventListener('abort', abort); if (!window.isDestroyed()) window.destroy(); partition.webRequest.onBeforeRequest(null); }
      }
      return previews;
    } finally {
      await runtime.close();
      const target = path.resolve(candidate), parent = path.resolve(root, '.preview-candidates');
      if (!target.startsWith(`${parent}${path.sep}`)) throw new Error('预览候选清理归属异常');
      await fs.promises.rm(target, { recursive: true, force: true });
    }
  };
  prepare.inspectDirectory = (selected) => {
    const target = fs.realpathSync(selected), system = fs.realpathSync(process.env.SystemRoot || 'C:/Windows');
    const volumes = JSON.parse(require('node:child_process').execFileSync(path.join(runtimeRoot, 'host-tools/pptSandbox.exe'), ['--volume', target, system], { encoding: 'utf8', windowsHide: true }));
    const stat = fs.statfsSync(target), probe = path.join(target, `.jato-resource-write-probe-${crypto.randomUUID()}`); fs.writeFileSync(probe, '', { flag: 'wx' }); fs.unlinkSync(probe);
    return { path: target, systemVolume: volumes.target === volumes.system, freeBytes: stat.bavail * stat.bsize };
  };
  return prepare;
}
module.exports = { createResourcePreviewService, createResourceImageDecoder, PREVIEW_VERSION };
