const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const DEFAULT_CONCURRENCY = 5;
const MIN_CONCURRENCY = 1;
const MAX_CONCURRENCY = 20;
const MAX_CAPTURE_SEGMENT_HEIGHT = 8192;
const HTML_DESIGN_WIDTH = 1240;
const HTML_INITIAL_HEIGHT = 900;
const MERMAID_RENDER_WIDTH = 680;
const MERMAID_INITIAL_HEIGHT = 480;
const LAYOUT_SETTLE_MS = 120;
const PAUSE_POLL_MS = 40;
let singleton = null;

function normalizeConcurrency(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return DEFAULT_CONCURRENCY;
  return Math.min(MAX_CONCURRENCY, Math.max(MIN_CONCURRENCY, Math.round(number)));
}

function estimateRgbaBytes(width, height) {
  return Math.max(0, Math.round(Number(width) || 0)) * Math.max(0, Math.round(Number(height) || 0)) * 4;
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function sanitizeLegacyHtml(value) {
  return String(value || '')
    .replace(/<\/?(?:script|iframe|object|embed|base)\b[^>]*>/gi, '')
    .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s(?:src|href)\s*=\s*(?:"https?:[^"]*"|'https?:[^']*'|https?:[^\s>]+)/gi, '')
    .replace(/url\s*\(\s*['"]?https?:[^)]*\)/gi, 'none');
}

function createPool(getLimit) {
  const queue = [];
  let active = 0;
  const pump = () => {
    while (active < getLimit() && queue.length) {
      const item = queue.shift();
      active += 1;
      Promise.resolve().then(item.task).then(item.resolve, item.reject).finally(() => {
        active -= 1;
        pump();
      });
    }
  };
  return {
    run(task) {
      return new Promise((resolve, reject) => {
        queue.push({ task, resolve, reject });
        pump();
      });
    },
    snapshot() {
      return { active, queued: queue.length, limit: getLimit() };
    },
  };
}

function throwIfPaused(options, message = '本地转图已暂停') {
  if (options?.isPauseRequested?.()) {
    throw options.createPauseError?.() || new Error(message);
  }
}

function buildRenderWindowOptions(partition, width = HTML_DESIGN_WIDTH, height = HTML_INITIAL_HEIGHT) {
  return {
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
    show: false,
    frame: false,
    webPreferences: {
      partition,
      offscreen: true,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: false,
    },
  };
}

function buildStaticDocument(content, width = 1240) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:"><style>
html,body{margin:0;padding:0;background:#fff;width:${width}px;min-width:${width}px}*{box-sizing:border-box}#jato-capture-root{width:${width}px;min-width:${width}px;min-height:1px;padding:0;margin:0;overflow:visible}img,svg,canvas{max-width:100%;height:auto}
</style></head><body><main id="jato-capture-root">${content}</main></body></html>`;
}

// 为模型生成的完整 HTML 注入统一截图容器和设计宽度，避免把第二个 html 文档嵌进 body。
function buildGeneratedHtmlDocument(value, width = 1240) {
  const source = String(value || '').trim();
  const styles = `<style id="jato-capture-style">
html,body{margin:0!important;padding:0!important;background:#fff!important;width:${width}px!important;min-width:${width}px!important;overflow-x:visible!important}*{box-sizing:border-box}#jato-capture-root{display:block;width:${width}px;min-width:${width}px;min-height:1px;margin:0;padding:0;background:#fff;overflow:visible}img,svg,canvas,video{max-width:100%;height:auto}
</style>`;
  const wrapScript = `<script>
(() => {
  const body = document.body;
  if (!body || document.getElementById('jato-capture-root')) return;
  const root = document.createElement('main');
  root.id = 'jato-capture-root';
  while (body.firstChild) root.appendChild(body.firstChild);
  body.appendChild(root);
})();
</script>`;
  if (!/<html[\s>]/i.test(source)) {
    return `<!doctype html><html><head><meta charset="utf-8">${styles}</head><body><main id="jato-capture-root">${source}</main></body></html>`;
  }

  let document = source;
  if (/<head[\s>]/i.test(document)) {
    document = document.replace(/<head([^>]*)>/i, `<head$1><meta charset="utf-8">${styles}`);
  } else {
    document = document.replace(/<html([^>]*)>/i, `<html$1><head><meta charset="utf-8">${styles}</head>`);
  }
  document = /<\/body>/i.test(document)
    ? document.replace(/<\/body>/i, `${wrapScript}</body>`)
    : /<\/html>/i.test(document)
      ? document.replace(/<\/html>/i, `${wrapScript}</html>`)
      : `${document}${wrapScript}`;
  return document;
}

function resolveMermaidScript(app) {
  const candidates = [
    path.join(app?.getAppPath?.() || '', 'node_modules', 'mermaid', 'dist', 'mermaid.min.js'),
    path.join(__dirname, '..', '..', 'node_modules', 'mermaid', 'dist', 'mermaid.min.js'),
  ];
  const script = candidates.find((candidate) => candidate && fs.existsSync(candidate));
  if (!script) throw new Error('未找到内置 Mermaid 脚本');
  return script;
}

function buildMermaidDocument(code, scriptUrl) {
  const source = JSON.stringify(String(code || ''));
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline' file:"><style>
html,body{margin:0;padding:0;background:#fff;width:fit-content;height:fit-content}#jato-capture-root{padding:8px;display:inline-block;background:#fff}svg{display:block;max-width:680px;height:auto}
</style><script src="${scriptUrl}"></script></head><body><main id="jato-capture-root"></main><script>
(async()=>{try{mermaid.initialize({startOnLoad:false,theme:'default',securityLevel:'strict'});const r=await mermaid.render('jato-'+Date.now(),${source});document.getElementById('jato-capture-root').innerHTML=r.svg;window.__jatoRenderReady=true}catch(e){window.__jatoRenderError=String(e&&e.message||e);window.__jatoRenderReady=true}})();
</script></body></html>`;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadHtmlDocument(win, documentUrl, timeoutMs, options = {}) {
  throwIfPaused(options);
  await new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => finish(new Error('加载本地渲染页面超时')), timeoutMs);
    const pauseWatcher = options.isPauseRequested
      ? setInterval(() => {
        if (!settled && options.isPauseRequested?.()) {
          try { win.webContents.stop(); } catch {}
          finish(options.createPauseError?.() || new Error('本地转图已暂停'));
        }
      }, PAUSE_POLL_MS)
      : null;

    const cleanup = () => {
      clearTimeout(timer);
      if (pauseWatcher) clearInterval(pauseWatcher);
      win.webContents.removeListener('did-finish-load', onLoad);
      win.webContents.removeListener('did-fail-load', onFail);
    };
    const finish = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const onLoad = () => finish();
    const onFail = (_event, code, description) => {
      if (options.isPauseRequested?.()) {
        finish(options.createPauseError?.() || new Error('本地转图已暂停'));
        return;
      }
      finish(new Error(`加载本地渲染页面失败：${description || code}`));
    };

    win.webContents.once('did-finish-load', onLoad);
    win.webContents.once('did-fail-load', onFail);
    win.loadURL(documentUrl).catch((error) => finish(error));
  });
}

async function setDeviceMetrics(webContents, width, height) {
  if (!webContents.debugger.isAttached()) webContents.debugger.attach('1.3');
  await webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
    deviceScaleFactor: 1,
    mobile: false,
  });
}

async function probeLayoutMetrics(webContents, minWidth = 1, contentOnly = false) {
  const floorWidth = Math.max(1, Math.round(Number(minWidth) || 1));
  return webContents.executeJavaScript(`(() => {
    const contentOnly=${contentOnly ? 'true' : 'false'};
    const documentRoot=document.documentElement;
    const body=document.body;
    const root=document.getElementById('jato-capture-root')||body||documentRoot;
    if(!root)return {ready:false,width:0,height:0};
    const rect=root.getBoundingClientRect();
    const imagesReady=Array.from(document.images||[]).every((image)=>image.complete);
    const fontsReady=!document.fonts||document.fonts.status==='loaded'||document.fonts.status==='idle';
    const width=Math.ceil(contentOnly
      ? Math.max(rect.width,root.scrollWidth||0,1)
      : Math.max(rect.width,root.scrollWidth||0,body?.scrollWidth||0,documentRoot?.scrollWidth||0,${floorWidth}));
    const height=Math.ceil(contentOnly
      ? Math.max(rect.height,root.scrollHeight||0,1)
      : Math.max(rect.height,root.scrollHeight||0,body?.scrollHeight||0,documentRoot?.scrollHeight||0,1));
    return {ready:imagesReady&&fontsReady&&width>0&&height>0,width,height};
  })()`, true);
}

async function waitForLayoutReady(webContents, timeoutMs, options = {}) {
  const startedAt = Date.now();
  let lastSize = '';
  let stableSince = 0;
  while (Date.now() - startedAt < timeoutMs) {
    throwIfPaused(options, options.kind === 'mermaid' ? 'Mermaid 转图已暂停' : 'HTML 转图已暂停');
    try {
      const metrics = await probeLayoutMetrics(webContents, options.minWidth, options.contentOnly === true);
      if (metrics?.ready && metrics.width > 0 && metrics.height > 0) {
        const size = `${metrics.width}x${metrics.height}`;
        if (size !== lastSize) {
          lastSize = size;
          stableSince = Date.now();
        } else if (Date.now() - stableSince >= LAYOUT_SETTLE_MS) {
          return metrics;
        }
      } else {
        lastSize = '';
        stableSince = 0;
      }
    } catch {
      lastSize = '';
      stableSince = 0;
    }
    await wait(PAUSE_POLL_MS);
  }
  throw new Error('等待 HTML 图片布局稳定超时');
}

function createLocalImageRenderService(options = {}) {
  const electron = options.electron || require('electron');
  const { BrowserWindow, nativeImage } = electron;
  const configStore = options.configStore;
  const app = options.app || electron.app;
  const activeTasks = new Map();
  let nextTaskId = 0;
  const getLimit = (kind) => {
    const config = configStore?.load?.().local_rendering || {};
    return normalizeConcurrency(kind === 'mermaid' ? config.mermaid_concurrency_limit : config.html_concurrency_limit);
  };
  const mermaidPool = createPool(() => getLimit('mermaid'));
  const htmlPool = createPool(() => getLimit('html'));

  function setupWindowSecurity(win, allowedUrls) {
    const { webContents } = win;
    const session = webContents.session;
    session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    webContents.on('will-attach-webview', (event) => event.preventDefault());
    webContents.on('will-navigate', (event, url) => {
      if (!allowedUrls.has(url)) event.preventDefault();
    });
    webContents.session.on('will-download', (event) => event.preventDefault());
    session.webRequest.onBeforeRequest((details, callback) => {
      const allowed = allowedUrls.has(details.url) || details.url.startsWith('data:') || details.url.startsWith('blob:');
      callback({ cancel: !allowed });
    });
  }

  async function captureFullPage(webContents, width, height, renderOptions = {}) {
    throwIfPaused(renderOptions);
    const safeWidth = Math.max(1, Math.ceil(width));
    const safeHeight = Math.max(1, Math.ceil(height));
    if (!webContents.debugger.isAttached()) webContents.debugger.attach('1.3');
    const buffers = [];
    for (let top = 0; top < safeHeight; top += MAX_CAPTURE_SEGMENT_HEIGHT) {
      throwIfPaused(renderOptions);
      const clipHeight = Math.min(MAX_CAPTURE_SEGMENT_HEIGHT, safeHeight - top);
      await webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
        width: safeWidth, height: Math.min(safeHeight, top + clipHeight), deviceScaleFactor: 1, mobile: false,
      });
      throwIfPaused(renderOptions);
      const result = await webContents.debugger.sendCommand('Page.captureScreenshot', {
        format: 'png', fromSurface: true, captureBeyondViewport: true,
        clip: { x: 0, y: top, width: safeWidth, height: clipHeight, scale: 1 },
      });
      if (!result?.data) throw new Error('本地截屏未返回图像数据');
      buffers.push(Buffer.from(result.data, 'base64'));
    }
    if (buffers.length === 1) return buffers[0];
    const rgba = Buffer.alloc(estimateRgbaBytes(safeWidth, safeHeight), 255);
    let offsetY = 0;
    for (const buffer of buffers) {
      const image = nativeImage.createFromBuffer(buffer);
      const { width: imageWidth, height: imageHeight } = image.getSize();
      const bitmap = image.toBitmap();
      for (let row = 0; row < imageHeight; row += 1) {
        bitmap.copy(rgba, ((offsetY + row) * safeWidth) * 4, row * imageWidth * 4, (row + 1) * imageWidth * 4);
      }
      offsetY += imageHeight;
    }
    const stitched = nativeImage.createFromBitmap(rgba, { width: safeWidth, height: safeHeight }).toPNG();
    if (!stitched?.length) throw new Error('拼接截图失败');
    return stitched;
  }

  async function renderDocument(document, options = {}) {
    const taskId = `render-${Date.now()}-${++nextTaskId}`;
    const tempDir = path.join(app?.getPath?.('temp') || os.tmpdir(), 'jato-local-image-render');
    fs.mkdirSync(tempDir, { recursive: true });
    const tempFile = path.join(tempDir, `${taskId}.html`);
    fs.writeFileSync(tempFile, document, 'utf8');
    const documentUrl = pathToFileURL(tempFile).toString();
    const allowedUrls = new Set([documentUrl, ...(options.allowedUrls || [])]);
    const partition = `temp:jato-image-render-${taskId}`;
    const initialWidth = options.initialWidth || HTML_DESIGN_WIDTH;
    const initialHeight = options.initialHeight || HTML_INITIAL_HEIGHT;
    const win = new BrowserWindow(buildRenderWindowOptions(partition, initialWidth, initialHeight));
    const startedAt = Date.now();
    activeTasks.set(taskId, { kind: options.kind, startedAt, window: win, estimatedRgbaBytes: 0 });
    try {
      setupWindowSecurity(win, allowedUrls);
      await loadHtmlDocument(win, documentUrl, options.timeoutMs || 120000, options);
      throwIfPaused(options);
      await setDeviceMetrics(win.webContents, initialWidth, initialHeight);
      if (options.waitForReady) {
        const until = Date.now() + (options.timeoutMs || 120000);
        while (!await win.webContents.executeJavaScript('Boolean(window.__jatoRenderReady)', true)) {
          throwIfPaused(options, 'Mermaid 转图已暂停');
          if (Date.now() >= until) throw new Error('本地 Mermaid 渲染超时');
          await wait(PAUSE_POLL_MS);
        }
        const renderError = await win.webContents.executeJavaScript('window.__jatoRenderError || ""', true);
        if (renderError) throw new Error(`Mermaid 渲染失败：${String(renderError).slice(0, 200)}`);
      }
      const metrics = await waitForLayoutReady(win.webContents, options.timeoutMs || 120000, options);
      const captureWidth = Math.max(Number(options.minWidth) || 1, metrics.width);
      const task = activeTasks.get(taskId);
      if (task) task.estimatedRgbaBytes = estimateRgbaBytes(captureWidth, metrics.height);
      const buffer = await captureFullPage(win.webContents, captureWidth, metrics.height, options);
      return { buffer, width: captureWidth, height: metrics.height, estimated_rgba_bytes: estimateRgbaBytes(captureWidth, metrics.height) };
    } finally {
      try { if (win.webContents.debugger.isAttached()) win.webContents.debugger.detach(); } catch {}
      try { if (!win.isDestroyed()) win.destroy(); } catch {}
      try { fs.rmSync(tempFile, { force: true }); } catch {}
      activeTasks.delete(taskId);
    }
  }

  return {
    renderHtmlToPng(html, renderOptions = {}) {
      const width = renderOptions.width || HTML_DESIGN_WIDTH;
      return htmlPool.run(() => renderDocument(buildGeneratedHtmlDocument(html, width), {
        ...renderOptions,
        kind: 'html',
        initialWidth: width,
        initialHeight: HTML_INITIAL_HEIGHT,
        minWidth: width,
      }));
    },
    renderLegacyHtmlToPng(html, renderOptions = {}) {
      const width = renderOptions.width || HTML_DESIGN_WIDTH;
      return htmlPool.run(() => renderDocument(buildGeneratedHtmlDocument(sanitizeLegacyHtml(html), width), {
        ...renderOptions,
        kind: 'legacy-html',
        initialWidth: width,
        initialHeight: HTML_INITIAL_HEIGHT,
        minWidth: width,
      }));
    },
    renderMermaidToPng(code, renderOptions = {}) {
      return mermaidPool.run(() => {
        const scriptUrl = pathToFileURL(resolveMermaidScript(app)).toString();
        return renderDocument(buildMermaidDocument(code, scriptUrl), {
          ...renderOptions,
          kind: 'mermaid',
          allowedUrls: [scriptUrl],
          waitForReady: true,
          contentOnly: true,
          initialWidth: MERMAID_RENDER_WIDTH,
          initialHeight: MERMAID_INITIAL_HEIGHT,
          timeoutMs: renderOptions.timeoutMs || 30000,
        });
      });
    },
    renderChartToPng(chartSpec, renderOptions = {}) {
      const { renderChartToHtml } = require('./chartDslRenderer.cjs');
      return this.renderHtmlToPng(renderChartToHtml(chartSpec), renderOptions);
    },
    getDiagnostics() {
      const tasks = [...activeTasks.values()];
      return {
        mermaid: mermaidPool.snapshot(),
        html: htmlPool.snapshot(),
        active_window_count: tasks.length,
        estimated_rgba_bytes: tasks.reduce((total, task) => total + task.estimatedRgbaBytes, 0),
      };
    },
    dispose() {
      for (const task of activeTasks.values()) {
        try { if (!task.window.isDestroyed()) task.window.destroy(); } catch {}
      }
      activeTasks.clear();
    },
  };
}

function initLocalImageRenderService(options) {
  singleton?.dispose?.();
  singleton = createLocalImageRenderService(options);
  return singleton;
}

function getLocalImageRenderService() {
  if (!singleton) throw new Error('本地图片渲染服务尚未初始化');
  return singleton;
}

function disposeLocalImageRenderService() {
  singleton?.dispose?.();
  singleton = null;
}

module.exports = {
  HTML_DESIGN_WIDTH,
  MAX_CAPTURE_SEGMENT_HEIGHT,
  MAX_CONCURRENCY,
  createLocalImageRenderService,
  disposeLocalImageRenderService,
  estimateRgbaBytes,
  getLocalImageRenderService,
  initLocalImageRenderService,
  normalizeConcurrency,
  sanitizeLegacyHtml,
  __test__: { buildGeneratedHtmlDocument, buildRenderWindowOptions, buildStaticDocument, createPool },
};
