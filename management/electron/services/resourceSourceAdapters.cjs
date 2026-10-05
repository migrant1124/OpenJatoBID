const fs = require('node:fs');
const path = require('node:path');
const { inspectPptx } = require('./resourceDownloadService.cjs');
const { hash, businessContent } = require('./resourceStore.cjs');
const { PREVIEW_VERSION } = require('./resourcePreviewService.cjs');

const promptNames = [
  ['banana-prompt-quicker', 'Banana Prompt Quicker', ['cdn.jsdelivr.net', 'linux.do', 'pbs.twimg.com', 'i.mji.rip', 'storage.googleapis.com']], ['davidwu-gpt-image2-prompts', 'DavidWu GPT Image 2'],
  ['freestylefly-gpt-image-2', 'Freestylefly GPT Image 2'], ['awesome-gpt-image', 'Awesome GPT Image', ['pbs.twimg.com']],
  ['awesome-gpt4o-image-prompts', 'Awesome GPT-4o', ['cdn.imgedify.com']], ['youmind-gpt-image-2', 'YouMind GPT Image 2', ['cms-assets.youmind.com']],
  ['youmind-nano-banana-pro', 'YouMind Nano Banana Pro', ['cms-assets.youmind.com']],
];
const DEFAULT_SOURCES = [
  ...promptNames.map(([sourceId, name, imageHosts = []]) => ({ sourceId, name, type: 'prompts', repo: 'yukkcat/image-prompts',
    branch: 'main', indexPath: `dist/sources/${sourceId}.json`, license: '保留上游条目许可',
    hosts: ['api.github.com', 'raw.githubusercontent.com', 'github.com', 'camo.githubusercontent.com',
      'images.unsplash.com', 'cdn.youmind.com', 'youmind.com', 'assets.youmind.com', 'glidea.github.io', 'i.imgur.com', ...imageHosts] })),
  { sourceId: 'wuhua-ppt-templates', name: 'wuhua 原生模板', type: 'ppt-tree', repo: 'wuhua2026/ppt-templates', branch: 'main',
    license: 'MIT', hosts: ['api.github.com', 'raw.githubusercontent.com'] },
  { sourceId: 'free-ppt-template', name: 'free 视觉参考模板', type: 'ppt-index', repo: 'ai-ppt-template/free-ppt-template', branch: 'main',
    indexPath: 'index.json', license: 'CC BY 4.0（保留内部展示例外与原许可）', hosts: ['api.github.com', 'raw.githubusercontent.com', 'cdn.ppttemplate.ai'] },
  { sourceId: 'ppt-master', name: 'ppt-master Skill', type: 'skill', repo: 'hugohe3/ppt-master', branch: 'main',
    root: 'skills/ppt-master', license: '保留完整上游许可', hosts: ['api.github.com', 'raw.githubusercontent.com', 'codeload.github.com', 'github.com'] },
];
const PPT_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const rawUrl = (source, commit, name) => `https://raw.githubusercontent.com/${source.repo}/${commit}/${name.split('/').map(encodeURIComponent).join('/')}`;

function createResourceSourceAdapters({ downloader, store, preparePreview }) {
  async function entries(source, signal) {
    const options = { hosts: source.hosts, signal };
    const head = await downloader.json(`https://api.github.com/repos/${source.repo}/commits/${encodeURIComponent(source.branch)}`, options);
    const commit = head.data.sha;
    if (!/^[a-f0-9]{40}$/.test(commit || '')) throw new Error('来源固定提交无效');
    if (source.type === 'ppt-tree' || source.type === 'skill') {
      const { data } = await downloader.json(`https://api.github.com/repos/${source.repo}/git/trees/${commit}?recursive=1`, options);
      if (data.truncated || !Array.isArray(data.tree)) throw new Error('来源文件树不完整');
      const files = data.tree.filter((entry) => entry.type === 'blob');
      if (source.type === 'skill') {
        const roots = source.root ? [source.root] : files.filter((file) => /(^|\/)SKILL\.md$/.test(file.path)).map((file) => path.posix.dirname(file.path) === '.' ? '' : path.posix.dirname(file.path));
        if (!roots.length) throw new Error('仓库或所选子目录缺少技能入口');
        return { commit, entries: roots.map((root) => {
          const members = files.filter((file) => !root || file.path.startsWith(`${root}/`));
          if (!members.some((file) => file.path === `${root ? `${root}/` : ''}SKILL.md`)) throw new Error('Skill缺少入口');
          return { id: root || '.', title: root ? path.posix.basename(root) : source.repo.split('/')[1], kind: 'skill', manifest: members, knownBytes: members.reduce((sum, file) => sum + (file.size || 0), 0) };
        }) };
      }
      return { commit, entries: files.filter((file) => /\.pptx$/i.test(file.path)).map((file) => ({ id: file.path,
        title: path.basename(file.path, '.pptx'), kind: file.path.includes('deck') || !file.path.startsWith('templates/') ? 'deck' : 'layout',
        pptxUrl: rawUrl(source, commit, file.path), originHash: file.sha })) };
    }
    const { data } = await downloader.json(rawUrl(source, commit, source.indexPath), options);
    if (!Array.isArray(data) || !data.length) throw new Error('来源目录无效或异常为空');
    return { commit, entries: source.type === 'prompts' ? data.map((entry, index) => ({ ...entry, id: String(entry.id ?? index), kind: 'prompt' }))
      : data.filter((entry) => entry.template_type === 'presentation').map((entry) => ({ ...entry, id: entry.slug, kind: 'deck', pptxUrl: entry.pptx_url,
        coverUrl: entry.cover, previewUrls: entry.preview_urls || [] })) };
  }
  async function prepare(source, entry, commit, signal) {
    const assetDescription = (asset, role, page = 0) => ({ assetId: asset.assetId, hash: asset.hash, bytes: asset.bytes, mime: asset.mime,
      role, page, generatorVersion: 'source-1', width: asset.width || null, height: asset.height || null });
    const resourceId = `${source.sourceId}:${entry.id}`;
    const previous = store.snapshot().items.find((item) => item.resourceId === resourceId);
    const common = { resourceId, sourceId: source.sourceId, upstreamId: entry.id, center: source.type === 'prompts' ? 'prompts' : 'templates',
      kind: entry.kind, title: String(entry.title || entry.id), description: String(entry.description || ''), tags: entry.tags || [],
      author: String(entry.author || ''), prompt: String(entry.prompt || ''), category: entry.category || '',
      license: source.license, sourceRevision: commit, assets: [], status: 'pending', capability: 'pending', sourceUrl: entry.sourceUrl || '' };
    if (entry.kind === 'skill') {
      const asset = await downloader.download(`https://codeload.github.com/${source.repo}/zip/${commit}`, { hosts: source.hosts, signal, mime: 'application/zip' });
      const { readZip } = require('./resourceDownloadService.cjs');
      const members = readZip(await fs.promises.readFile(path.join(downloader.root, asset.relativePath)));
      const entryRoot = entry.id === '.' ? '' : `${entry.id}/`;
      const prefix = `${source.repo.split('/')[1]}-${commit}/${entryRoot}`;
      for (const file of entry.manifest) {
        const bytes = members.get(`${source.repo.split('/')[1]}-${commit}/${file.path}`);
        if (!bytes || bytes.length !== file.size || require('node:crypto').createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes])).digest('hex') !== file.sha) throw new Error('完整Skill包成员校验失败');
      }
      if (!members.has(`${prefix}SKILL.md`)) throw new Error('完整Skill入口缺失');
      return { ...common, center: 'skills', manifest: entry.manifest, root: entry.id, repository: source.repo,
        packagePrefix: prefix, knownBytes: entry.knownBytes, assets: [assetDescription(asset, 'package')], status: 'mirrored', capability: 'requires_confirmation' };
    }
    if (entry.kind === 'prompt' && (!common.title.trim() || !common.prompt.trim())) throw new Error('提示词条目正文为空');
    const download = (url, mime) => downloader.download(url, { hosts: source.hosts, signal, mime });
    if (entry.pptxUrl) {
      // 固定Git blob未变可直接复用；线路和README变化不会制造模板更新。
      if (previous?.originHash && previous.originHash === entry.originHash && previous.assets.some((asset) => asset.role === 'cover' && asset.generatorVersion === PREVIEW_VERSION) && !previous.previewError) return { ...previous, sourceRevision: commit };
      const asset = await download(entry.pptxUrl, PPT_MIME);
      const inspected = inspectPptx(await fs.promises.readFile(path.join(downloader.root, asset.relativePath)));
      Object.assign(common, inspected, { kind: inspected.pageCount === 1 ? 'layout' : 'deck', status: 'mirrored', originHash: entry.originHash || '', assets: [assetDescription(asset, 'original')] });
      const cachedPreviews = previous?.assets?.filter((item) => ['cover', 'preview'].includes(item.role) && item.originalHash === asset.hash && item.generatorVersion === PREVIEW_VERSION) || [];
      if (cachedPreviews.some((item) => item.role === 'cover') && cachedPreviews.length === inspected.pageCount && !previous.previewError) common.assets.push(...cachedPreviews);
      else if (preparePreview) {
        try { common.assets.push(...await preparePreview(asset, inspected, { signal })); }
        catch (error) { common.previewError = String(error.message); store.audit(source.sourceId, 'PREVIEW_FAILED', { resourceId, message: common.previewError }); }
      }
    }
    const images = entry.kind === 'prompt' ? (entry.coverUrl ? [entry.coverUrl] : []) : common.assets.some((item) => item.role === 'cover') ? [] : entry.previewUrls?.length ? entry.previewUrls : entry.coverUrl ? [entry.coverUrl] : [];
    for (let page = 0; page < images.length; page += 1) {
      try { common.assets.push(assetDescription(await download(images[page], 'image/jpeg'), page === 0 ? 'cover' : 'preview', page)); }
      catch (error) {
        if (entry.kind === 'prompt') { store.audit(source.sourceId, 'PREVIEW_FAILED', { resourceId, page, retained: Boolean(previous), message: String(error.message) }); throw error; }
        common.previewError = String(error.message);
        const sameOriginal = common.assets.find((asset) => asset.role === 'original')?.hash === previous?.assets?.find((asset) => asset.role === 'original')?.hash;
        const old = sameOriginal ? previous?.assets?.find((asset) => asset.page === page && ['cover', 'preview'].includes(asset.role)) : null;
        if (old) common.assets.push(old);
        store.audit(source.sourceId, 'PREVIEW_FAILED', { resourceId, page, retained: Boolean(old), message: String(error.message) });
      }
    }
    if (entry.kind === 'prompt') common.status = images.length && !common.assets.length ? 'preview_pending' : 'ready';
    else if (common.assets.some((asset) => asset.role === 'cover')) common.status = 'preview_ready';
    common.contentHash = hash(businessContent(common));
    return common;
  }
  return { entries, prepare };
}

module.exports = { DEFAULT_SOURCES, PPT_MIME, rawUrl, createResourceSourceAdapters };
