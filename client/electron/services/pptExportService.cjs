const fs = require('node:fs');
const path = require('node:path');
const { inspectPptx, hash } = require('./pptTemplateService.cjs');

function createPptExportService({ runtime, BrowserWindow }) {
  async function check({ root, project, pages, signal }) {
    const native = project.route === 'edit-native', working = native ? path.join(root, 'native') : root;
    if (!pages.length) throw new Error('没有可导出页面');
    for (const page of pages) if (hash(fs.readFileSync(path.join(root, page.sourcePath))) !== page.hash) throw new Error('源页面已变化，旧检查报告不能放行');
    const at = new Date().toISOString();
    await runtime.guard(root, signal);
    const check = await runtime.run({ script: 'svg_quality_checker.py', args: [working, ...(native ? ['--roundtrip'] : project.requirements.quick ? ['--quick-generate','--canonical-authoring','--stage','final'] : ['--canonical-authoring']), '--json'], projectRoot: root, signal });
    const fingerprint = hash(JSON.stringify(pages.map((page) => [page.slideId, page.hash])));
    fs.writeFileSync(path.join(root, 'reports', 'export-check.json'), JSON.stringify({ at, fingerprint, revision: project.revision, ...check }, null, 2), 'utf8');
    return check;
  }
  async function build({ root, project, pages, format, signal }) {
    const native = project.route === 'edit-native', working = native ? path.join(root, 'native') : root;
    const images = pages.map((page) => path.join(root, 'svg_final', `${page.slideId}.png`));
    if (!pages.length || images.some((image) => !fs.existsSync(image))) throw new Error('页面或预览未完成，不能导出');
    await check({ root, project, pages, signal });
    if (format === 'mp4') {
      if (!project.requirements.mediaEnabled) throw new Error('项目尚未明确启用视频导出');
      const seconds = Number(project.requirements.secondsPerPage || 5);
      if (!(seconds >= 1 && seconds <= 300)) throw new Error('每页时长必须在1至300秒之间');
      const frames = path.join(root, 'exports/video-frames'); fs.mkdirSync(frames, { recursive: true });
      const lines = [];
      for (let index = 0; index < images.length; index++) { const fileName = `frame_${String(index).padStart(4, '0')}.png`; fs.copyFileSync(images[index], path.join(frames, fileName)); lines.push(`file '${fileName}'`, `duration ${seconds}`); }
      lines.push(`file 'frame_${String(images.length - 1).padStart(4, '0')}.png'`);
      fs.writeFileSync(path.join(frames, 'frames.txt'), lines.join('\n'), 'utf8');
      await runtime.video({ projectRoot: root, aspectRatio: project.requirements.aspectRatio, audio: project.requirements.narrationFile, duration: seconds * images.length, signal });
      const file = path.join(root, 'exports/presentation.mp4');
      const probe = await runtime.probe({ projectRoot: root, file: 'exports/presentation.mp4', signal });
      const metadata = JSON.parse(probe.output);
      if (!metadata.streams.some((stream) => stream.codec_type === 'video') || Number(metadata.format.duration) < seconds * images.length - .5) throw new Error('视频流或时长检查失败');
      return { file, hash: hash(fs.readFileSync(file)), warnings: ['视频为逐页静态画面；PPT原生对象动画不转换为动态视频，旁白只使用用户提供的本地音频'] };
    }
    if (format === 'pptx') {
      const file = path.join(root, 'exports', 'presentation.pptx');
      await runtime.run({ script: 'svg_to_pptx.py', args: [working, '-o', file, ...(native ? ['--roundtrip'] : project.requirements.quick ? ['--quick-generate'] : []), '--native-charts-and-tables'], projectRoot: root, signal });
      const report = inspectPptx(file); if (report.pageCount !== pages.length) throw new Error('导出页数与当前修订不符');
      if(project.requirements.preserveContent) {await runtime.run({script:'beautify_inventory.py',args:[path.join(root,'reports/beautify-original-inventory.json'),'--verify',file],projectRoot:root,signal});require('./pptTemplateService.cjs').auditContentFacts(path.join(root,project.resource.nativePath),file);}
      return { file, hash: report.hash, structure: report, warnings: report.warnings };
    }
    if (format === 'notes') {
      const files = pages.map((page) => path.join(root, page.notesPath || `${native ? 'native/' : ''}notes/${path.basename(page.sourcePath, '.svg')}.md`));
      if (files.some((file) => !fs.existsSync(file))) throw new Error('所选页面的逐页讲稿不完整');
      const file = path.join(root, 'exports', 'speaker-notes.md');
      fs.writeFileSync(file, files.map((name) => fs.readFileSync(name, 'utf8')).join('\n\n'), 'utf8'); return { file, hash: hash(fs.readFileSync(file)) };
    }
    if (format === 'pdf') {
      const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true, javascript: false } });
      const abort = () => window.destroy(); signal?.addEventListener('abort', abort, { once: true });
      try {
        const html = `<style>@page{size:${project.requirements.aspectRatio === '4:3' ? '320mm 240mm' : '338.67mm 190.5mm'};margin:0}body{margin:0}article{height:100vh;break-after:page;display:flex;align-items:center;justify-content:center}article:last-child{break-after:auto}img{max-width:100%;max-height:100%;object-fit:contain}</style>${images.map((image) => `<article><img src="data:image/png;base64,${fs.readFileSync(image).toString('base64')}"></article>`).join('')}`;
        await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
        const file = path.join(root, 'exports', 'presentation.pdf'); fs.writeFileSync(file, await window.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true }));
        return { file, hash: hash(fs.readFileSync(file)), warnings: ['PDF 使用当前已检查页面预览；PPTX 的 Office 字体与媒体效果需另行验收'] };
      } finally { signal?.removeEventListener('abort', abort); if (!window.isDestroyed()) window.destroy(); }
    }
    throw new Error('该媒体格式缺少已验证运行组件，未执行导出');
  }
  return { build, check };
}
module.exports = { createPptExportService };
