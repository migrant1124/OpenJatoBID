const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DEFAULT_CONCURRENCY = 5;
const MIN_CONCURRENCY = 1;
const MAX_CONCURRENCY = 20;
const MAX_CAPTURE_SEGMENT_HEIGHT = 8192;
const HTML_DESIGN_WIDTH = 1240;
const HTML_INITIAL_HEIGHT = 900;
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

// 在最终截图前，用浏览器实际排版结果检查模型生成 HTML 中可客观识别的文字和画布问题。
// 只检查文字的 transform；writing-mode 不在检查范围内，竖排文字保持允许。
function buildHtmlLayoutProbeScript() {
  return `(() => {
    const root=document.getElementById('jato-capture-root')||document.body||document.documentElement;
    if(!root)return ['未找到截图画布'];
    const issues=[];
    const add=(value)=>{if(value&&!issues.includes(value)&&issues.length<12)issues.push(value)};
    const visible=(element)=>{const style=getComputedStyle(element);return style.display!=='none'&&style.visibility!=='hidden'&&Number(style.opacity||1)>0};
    const label=(element)=>{const tag=(element.tagName||'元素').toLowerCase();const className=String(element.className||'').trim().split(/\\s+/).filter(Boolean).slice(0,2).join('.');return className?tag+'.'+className:tag};
    const related=(left,right)=>left===right||left.contains(right)||right.contains(left);
    const rootRect=root.getBoundingClientRect();
    const textEntries=[];
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
    let node;
    while((node=walker.nextNode())){
      if(!node.nodeValue||!node.nodeValue.trim())continue;
      const element=node.parentElement;
      if(!element||!visible(element)||['script','style','noscript'].includes(element.tagName.toLowerCase()))continue;
      const range=document.createRange();range.selectNodeContents(node);
      const rects=Array.from(range.getClientRects()).filter((rect)=>rect.width>0&&rect.height>0);
      if(rects.length)textEntries.push({element,rects});
    }
    const hasInvalidTransform=(transform)=>{
      if(!transform||transform==='none')return false;
      const match=transform.match(/^matrix\\(([^)]+)\\)$/);
      if(match){const values=match[1].split(',').map(Number);return values.length!==6||Math.abs(values[1])>.01||Math.abs(values[2])>.01||values[0]<0||values[3]<0||Math.abs(Math.abs(values[0])-1)>.01||Math.abs(Math.abs(values[3])-1)>.01}
      const matrix3d=transform.match(/^matrix3d\\(([^)]+)\\)$/);
      if(matrix3d){const values=matrix3d[1].split(',').map(Number);return values.length!==16||Math.abs(values[1])>.01||Math.abs(values[4])>.01||Math.abs(values[0]-1)>.01||Math.abs(values[5]-1)>.01||values[0]<0||values[5]<0}
      return true;
    };
    for(const entry of textEntries){
      for(let element=entry.element;element&&element!==root.parentElement;element=element.parentElement){
        const style=getComputedStyle(element);
        if(hasInvalidTransform(style.transform)){add('文字存在旋转、倒置、镜像或缩放变形：'+label(element));break}
        if(style.position==='fixed'||style.position==='sticky'){add('文字使用固定或粘性定位，截图布局不稳定：'+label(element));break}
      }
      for(const rect of entry.rects){
        if(rect.left<rootRect.left-1||rect.right>rootRect.right+1||rect.top<rootRect.top-1||rect.bottom>rootRect.bottom+1){add('文字超出截图画布：'+label(entry.element));break}
        for(let element=entry.element.parentElement;element&&element!==root.parentElement;element=element.parentElement){
          const style=getComputedStyle(element);
          const clipsX=['hidden','clip','scroll','auto'].includes(style.overflowX);
          const clipsY=['hidden','clip','scroll','auto'].includes(style.overflowY);
          const box=element.getBoundingClientRect();
          if((clipsX&&(rect.left<box.left-1||rect.right>box.right+1))||(clipsY&&(rect.top<box.top-1||rect.bottom>box.bottom+1))){add('文字被容器裁切：'+label(element));break}
          if(style.textOverflow==='ellipsis'&&element.scrollWidth>element.clientWidth+1){add('文字被省略截断：'+label(element));break}
        }
      }
    }
    for(let index=0;index<textEntries.length;index+=1){
      for(let next=index+1;next<textEntries.length;next+=1){
        const left=textEntries[index];const right=textEntries[next];
        if(related(left.element,right.element)||left.element===right.element)continue;
        const overlaps=left.rects.some((a)=>right.rects.some((b)=>{
          const width=Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left));
          const height=Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));
          return width*height>=Math.max(8,Math.min(a.width*a.height,b.width*b.height)*.2);
        }));
        if(overlaps)add('文字内容发生重叠：'+label(left.element)+' 与 '+label(right.element));
      }
    }
    for(const entry of textEntries){
      const rect=entry.rects[0];
      const points=[[rect.left+rect.width/2,rect.top+rect.height/2],[rect.left+Math.min(3,rect.width/2),rect.top+rect.height/2]];
      for(const [x,y] of points){
        if(x<rootRect.left||x>rootRect.right||y<rootRect.top||y>rootRect.bottom)continue;
        const top=document.elementsFromPoint(x,y).find((element)=>element!==document.documentElement&&element!==document.body);
        if(!top||related(top,entry.element)||!visible(top))continue;
        const style=getComputedStyle(top);
        const background=style.backgroundImage!=='none'||!/^rgba?\\([^)]*,\\s*0\\)$/.test(style.backgroundColor)||['img','svg','canvas','video'].includes(top.tagName.toLowerCase());
        if(background){add('文字被前景元素遮挡：'+label(entry.element)+' 被 '+label(top)+' 覆盖');break}
      }
    }
    for(const element of root.querySelectorAll('*')){
      if(!visible(element))continue;
      const rect=element.getBoundingClientRect();
      if(rect.width>0&&rect.height>0&&(rect.left<rootRect.left-1||rect.right>rootRect.right+1)){add('元素横向超出截图画布：'+label(element));}
    }
    if(!textEntries.length&&!root.querySelector('img,svg,canvas,video'))add('截图画布没有可见内容');
    return issues;
  })()`;
}

async function probeHtmlLayoutIssues(webContents) {
  const result = await webContents.executeJavaScript(buildHtmlLayoutProbeScript(), true);
  return Array.isArray(result) ? result.map((issue) => String(issue || '').trim()).filter(Boolean) : [];
}

async function waitForLayoutReady(webContents, timeoutMs, options = {}) {
  const startedAt = Date.now();
  let lastSize = '';
  let stableSince = 0;
  while (Date.now() - startedAt < timeoutMs) {
    throwIfPaused(options, 'HTML 转图已暂停');
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
  const getLimit = () => {
    const config = configStore?.load?.().local_rendering || {};
    return normalizeConcurrency(config.html_concurrency_limit);
  };
  const htmlPool = createPool(getLimit);

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
      const metrics = await waitForLayoutReady(win.webContents, options.timeoutMs || 120000, options);
      const captureWidth = Math.max(Number(options.minWidth) || 1, metrics.width);
      const task = activeTasks.get(taskId);
      if (task) task.estimatedRgbaBytes = estimateRgbaBytes(captureWidth, metrics.height);
      const layoutIssues = options.kind === 'html' || options.kind === 'legacy-html'
        ? await probeHtmlLayoutIssues(win.webContents)
        : [];
      const buffer = await captureFullPage(win.webContents, captureWidth, metrics.height, options);
      return {
        buffer,
        width: captureWidth,
        height: metrics.height,
        estimated_rgba_bytes: estimateRgbaBytes(captureWidth, metrics.height),
        layout_issues: layoutIssues,
      };
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
    renderChartToPng(chartSpec, renderOptions = {}) {
      const { renderChartToHtml } = require('./chartDslRenderer.cjs');
      return this.renderHtmlToPng(renderChartToHtml(chartSpec), renderOptions);
    },
    getDiagnostics() {
      const tasks = [...activeTasks.values()];
      return {
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
  __test__: { buildGeneratedHtmlDocument, buildHtmlLayoutProbeScript, buildRenderWindowOptions, buildStaticDocument, createPool },
};
