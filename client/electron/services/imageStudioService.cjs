const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { dialog } = require('electron');
const { imageSize } = require('image-size');
const sharp = require('sharp');
const { getGeneratedImagesDir } = require('../utils/paths.cjs');
const { createImageStudioSources } = require('./imageStudioSources.cjs');

function createImageStudioService({ app, db, aiService, configStore, promptLibraryStore, dialogApi = dialog }) {
  const listeners = new Set();
  const stoppedTasks = new Set();
  const sources = createImageStudioSources({ db });
  db.prepare("UPDATE image_studio_tasks SET status = CASE WHEN sent_at IS NULL THEN 'paused' ELSE 'unknown' END, updated_at = ? WHERE status IN ('queued', 'running', 'sent', 'downloading')")
    .run(new Date().toISOString());

  function draft() {
    const row = db.prepare('SELECT prompt, revision, state_json AS stateJson, updated_at AS updatedAt FROM image_studio_draft WHERE id = 1').get();
    return row ? { prompt: row.prompt, revision: row.revision, state: JSON.parse(row.stateJson), updatedAt: row.updatedAt }
      : { prompt: '', revision: 0, state: {}, updatedAt: '' };
  }

  function listWorks() {
    return db.prepare(`SELECT w.work_id AS workId, w.task_id AS taskId, w.parent_work_id AS parentWorkId,
      w.asset_url AS assetUrl, w.mime_type AS mimeType, w.width, w.height, w.is_favorite AS isFavorite,
      w.created_at AS createdAt, w.kind, w.generation_json AS generationJson,
      t.prompt, t.model_provider AS modelProvider, t.model_name AS modelName
      FROM image_studio_works w JOIN image_studio_tasks t ON t.task_id = w.task_id
      WHERE w.deleted_at IS NULL ORDER BY w.created_at DESC`).all().map((row) => ({
      ...row, isFavorite: Boolean(row.isFavorite), generation: JSON.parse(row.generationJson || '{}'),
    }));
  }

  function listTasks() {
    return db.prepare(`SELECT task_id AS taskId, status, kind, prompt, requested_size AS requestedSize,
      requested_count AS requestedCount, completed_count AS completedCount,
      error, created_at AS createdAt, updated_at AS updatedAt
      FROM image_studio_tasks ORDER BY created_at DESC LIMIT 30`).all();
  }

  function getState() {
    const config = configStore.load();
    return {
      draft: draft(),
      works: listWorks(),
      tasks: listTasks(),
      assets: db.prepare(`SELECT asset_id AS assetId, asset_url AS assetUrl, mime_type AS mimeType,
        width, height, created_at AS createdAt FROM image_studio_assets ORDER BY created_at DESC LIMIT 30`).all(),
      imageModel: {
        available: Boolean(aiService.getImageModelAvailability().available),
        size: config.image_model?.image_size || '',
        name: config.image_model?.model_name || '',
      },
      textModelName: config.model_name || '',
    };
  }

  function saveDraft(input = {}) {
    const current = draft();
    if (input.revision !== current.revision) return { conflict: true, draft: current };
    const next = { prompt: String(input.prompt || ''), revision: current.revision + 1,
      state: input.state && typeof input.state === 'object' ? input.state : current.state,
      updatedAt: new Date().toISOString() };
    db.prepare(`INSERT INTO image_studio_draft (id, prompt, revision, state_json, updated_at) VALUES (1, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET prompt = excluded.prompt, revision = excluded.revision,
      state_json = excluded.state_json, updated_at = excluded.updated_at`)
      .run(next.prompt, next.revision, JSON.stringify(next.state), next.updatedAt);
    return { conflict: false, draft: next };
  }

  function emit(taskId) {
    const event = { taskId, tasks: listTasks(), works: listWorks() };
    for (const listener of listeners) listener(event);
  }

  function setTask(taskId, status, error = null) {
    if (db.open === false) return;
    db.prepare('UPDATE image_studio_tasks SET status = ?, error = ?, updated_at = ? WHERE task_id = ?')
      .run(status, error, new Date().toISOString(), taskId);
    emit(taskId);
  }

  function start(input = {}) {
    const prompt = String(input.prompt || '').trim();
    if (!prompt) throw new Error('请先输入图片需求。');
    if (prompt.length > 10000) throw new Error('图片需求最多 10,000 字，请缩短后再提交。');
    const count = Number(input.count || 1);
    if (![1, 2, 4].includes(count)) throw new Error('生成数量只能是 1、2 或 4 张。');
    if (Array.isArray(input.references) && input.references.length) throw new Error('当前渠道的参考图请求合同尚未验证，未提交生图请求。');
    if (input.kind && input.kind !== 'generate') throw new Error('当前渠道的图片编辑请求合同尚未验证，未提交生图请求。');
    const availability = aiService.getImageModelAvailability();
    if (!availability.available) throw new Error(availability.message);
    const baseConfig = configStore.load();
    // The current relay returns image data in JSON; its SSE path completed without image items.
    const submissionConfig = { ...baseConfig,
      image_model: { ...baseConfig.image_model, request_mode: 'normal' } };
    const config = submissionConfig.image_model || {};
    const size = String(input.size || config.image_size || '');
    if (size !== config.image_size) throw new Error('当前渠道尚未验证该尺寸，请使用设置中的已测试尺寸。');
    const configFingerprint = crypto.createHash('sha256').update(JSON.stringify({
      provider: config.provider, model: config.model_name, baseUrl: config.base_url,
      size: config.image_size, requestMode: config.request_mode,
    })).digest('hex');
    const taskId = crypto.randomUUID();
    const at = new Date().toISOString();
    db.prepare(`INSERT INTO image_studio_tasks
      (task_id, status, prompt, model_provider, model_name, requested_size, kind,
       requested_count, request_json, config_fingerprint, created_at, updated_at)
      VALUES (?, 'queued', ?, ?, ?, ?, 'generate', ?, ?, ?, ?, ?)`)
      .run(taskId, prompt, config.provider || '', config.model_name || '', size, count,
        JSON.stringify({ size, count, ratio: input.ratio || '', requestMode: 'normal' }), configFingerprint, at, at);
    emit(taskId);

    void Promise.resolve().then(async () => {
      if (!stoppedTasks.has(taskId)) setTask(taskId, 'running');
      let successes = 0;
      let lastError = null;
      let uncertain = false;
      for (let index = 0; index < count; index += 1) {
        if (stoppedTasks.has(taskId)) break;
        let sent = false;
        try {
          const result = await aiService.withQueueScope(`image-studio:${taskId}`).generateImage({
            prompt, size, title: '生图模式', preservePrompt: true,
            configSnapshot: submissionConfig, noRetry: true,
            onSent() {
              sent = true;
              db.prepare('UPDATE image_studio_tasks SET sent_at = ? WHERE task_id = ?').run(new Date().toISOString(), taskId);
              if (!stoppedTasks.has(taskId)) setTask(taskId, 'sent');
            },
          });
          if (!stoppedTasks.has(taskId)) setTask(taskId, 'downloading');
          const file = fs.readFileSync(result.file_path);
          const dimensions = imageSize(file);
          if (!dimensions.width || !dimensions.height) throw new Error('生成结果不是可识别的图片。');
          db.prepare(`INSERT INTO image_studio_works
            (work_id, task_id, parent_work_id, file_path, asset_url, mime_type, width, height, sha256, generation_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(crypto.randomUUID(), taskId, input.parentWorkId || null, result.file_path, result.asset_url,
              result.mime_type || 'image/png', dimensions.width, dimensions.height,
              crypto.createHash('sha256').update(file).digest('hex'),
              JSON.stringify({ size, ratio: input.ratio || '', index }), new Date().toISOString());
          successes += 1;
          db.prepare('UPDATE image_studio_tasks SET completed_count = ?, sent_at = NULL WHERE task_id = ?').run(successes, taskId);
          emit(taskId);
        } catch (error) {
          lastError = String(error?.message || error);
          uncertain ||= sent && !(Number(error?.statusCode) >= 400 && Number(error?.statusCode) < 500);
          if (!uncertain) db.prepare('UPDATE image_studio_tasks SET sent_at = NULL WHERE task_id = ?').run(taskId);
          if (uncertain) break;
        }
      }
      setTask(taskId, successes === count ? 'completed' : uncertain ? (stoppedTasks.has(taskId) ? 'stopped_waiting' : 'unknown')
        : successes ? 'partial' : stoppedTasks.has(taskId) ? 'cancelled' : 'failed', lastError);
      stoppedTasks.delete(taskId);
    });
    return { taskId };
  }

  function cancelTask({ taskId }) {
    const task = db.prepare('SELECT status, sent_at FROM image_studio_tasks WHERE task_id = ?').get(taskId);
    if (!task || !['queued', 'running', 'sent', 'downloading'].includes(task.status)) return listTasks();
    stoppedTasks.add(taskId);
    aiService.pauseQueueScope?.(`image-studio:${taskId}`);
    setTask(taskId, task.sent_at ? 'stopped_waiting' : 'cancelled');
    return listTasks();
  }

  function setFavorite({ workId, isFavorite }) {
    db.prepare('UPDATE image_studio_works SET is_favorite = ? WHERE work_id = ? AND deleted_at IS NULL')
      .run(isFavorite ? 1 : 0, workId);
    return listWorks();
  }

  function deleteWork({ workId }) {
    db.prepare('UPDATE image_studio_works SET deleted_at = ? WHERE work_id = ? AND deleted_at IS NULL')
      .run(new Date().toISOString(), workId);
    return listWorks();
  }

  async function exportImage({ workId, format }) {
    if (!['png', 'jpg', 'webp'].includes(format)) throw new Error('不支持的图片格式。');
    const work = db.prepare('SELECT * FROM image_studio_works WHERE work_id = ? AND deleted_at IS NULL').get(workId);
    if (!work || !fs.existsSync(work.file_path)) throw new Error('作品文件不存在。');
    const result = await dialogApi.showSaveDialog({
      title: '导出图片',
      defaultPath: `作品-${workId.slice(0, 8)}.${format}`,
      filters: [{ name: format.toUpperCase(), extensions: [format] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    const pipeline = sharp(work.file_path).rotate();
    const bytes = format === 'jpg' ? await pipeline.flatten({ background: '#ffffff' }).jpeg().toBuffer()
      : format === 'webp' ? await pipeline.webp().toBuffer() : await pipeline.png().toBuffer();
    fs.writeFileSync(result.filePath, bytes);
    return { canceled: false, filePath: result.filePath, format, background: format === 'jpg' ? '#ffffff' : null };
  }

  async function importAsset() {
    const selection = await dialogApi.showOpenDialog({
      title: '选择参考图片', properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    });
    if (selection.canceled || !selection.filePaths?.[0]) return { canceled: true };
    const filePath = selection.filePaths[0];
    if (fs.statSync(filePath).size > 25_000_000) throw new Error('参考图片超过 25 MB。');
    const input = fs.readFileSync(filePath);
    const image = sharp(input, { limitInputPixels: 40_000_000 });
    const metadata = await image.metadata();
    if (!['jpeg', 'png', 'webp'].includes(metadata.format) || !metadata.width || !metadata.height || metadata.width * metadata.height > 40_000_000) {
      throw new Error('参考图片格式无效或超过 4000 万像素。');
    }
    const png = await image.rotate().png().toBuffer();
    const dimensions = imageSize(png);
    if (!dimensions.width || !dimensions.height) throw new Error('无法读取参考图片。');
    const assetId = crypto.randomUUID();
    const fileName = `studio-${assetId}.png`;
    const target = path.join(getGeneratedImagesDir(app), fileName);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, png);
    const asset = { assetId, assetUrl: `yibiao-asset://generated-images/${fileName}`,
      mimeType: 'image/png', width: dimensions.width, height: dimensions.height, createdAt: new Date().toISOString() };
    db.prepare(`INSERT INTO image_studio_assets
      (asset_id, file_path, asset_url, mime_type, width, height, sha256, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(assetId, target, asset.assetUrl, asset.mimeType, asset.width, asset.height,
        crypto.createHash('sha256').update(png).digest('hex'), asset.createdAt);
    return { canceled: false, asset };
  }

  function selectedImage(input = {}) {
    if (input.assetId) return db.prepare('SELECT file_path FROM image_studio_assets WHERE asset_id = ?').get(input.assetId)?.file_path;
    if (input.workId) return db.prepare('SELECT file_path FROM image_studio_works WHERE work_id = ? AND deleted_at IS NULL').get(input.workId)?.file_path;
    return null;
  }

  async function invertImage(input = {}) {
    const filePath = selectedImage(input);
    if (!filePath) throw new Error('请先选择图片。');
    const configSnapshot = configStore.load();
    if (!configSnapshot.api_key || !configSnapshot.model_name) throw new Error('请先在设置中配置文本模型。');
    const image = await sharp(filePath).rotate().resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
    const content = await aiService.chat({
      configSnapshot, noRetry: true, sensitiveImage: true, logTitle: '生图模式-图片反推',
      messages: [
        { role: 'system', content: '根据用户提供的图片生成中文生图参考描述。不是原始提示词。只返回可用于生图的一段中文描述，包含主体、构图、光影、色彩和风格；不可伪造原模型或 seed。' },
        { role: 'user', content: [
          { type: 'text', text: '请描述这张图片。' },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${image.toString('base64')}` } },
        ] },
      ],
    });
    return { prompt: String(content || '').trim(), assetId: input.assetId || null, workId: input.workId || null };
  }

  async function optimizePrompt(input = {}) {
    const original = String(input.prompt || '').trim();
    if (!original) throw new Error('请先输入要优化的提示词。');
    const mode = String(input.mode || '优化');
    const configSnapshot = configStore.load();
    const optimized = await aiService.chat({
      configSnapshot, noRetry: true, logTitle: '生图模式-提示词优化',
      messages: [
        { role: 'system', content: `你是中文图像提示词编辑。执行“${mode}”，只返回修改后的提示词。保留原文的主体、数量、尺寸、指定画面文字、否定条件、专有名称与模板变量，不添加不存在的事实或商业承诺。` },
        { role: 'user', content: original },
      ],
    });
    return { original, optimized: String(optimized || '').trim(), mode };
  }

  function listMyPrompts() {
    return db.prepare(`SELECT p.prompt_id AS promptId, p.group_id AS groupId, p.title,
      p.content_markdown AS contentMarkdown, p.is_favorite AS isFavorite,
      m.tags_json AS tagsJson, m.notes, m.ratio, m.origin_kind AS originKind
      FROM image_studio_prompt_meta m JOIN prompt_items p ON p.prompt_id = m.prompt_id
      WHERE p.deleted_at IS NULL ORDER BY p.updated_at DESC`)
      .all().map((row) => ({ ...row, isFavorite: Boolean(row.isFavorite), tags: JSON.parse(row.tagsJson) }));
  }

  function saveMyPrompt(input = {}) {
    if (!promptLibraryStore) throw new Error('个人提示词库尚未初始化。');
    const body = { groupId: input.groupId || promptLibraryStore.listGroups()[0]?.groupId,
      title: input.title, contentMarkdown: input.contentMarkdown };
    const prompt = input.promptId ? promptLibraryStore.updatePrompt({ ...body, promptId: input.promptId })
      : promptLibraryStore.createPrompt(body);
    db.prepare(`INSERT INTO image_studio_prompt_meta
      (prompt_id, tags_json, notes, ratio, origin_kind, origin_source_id, origin_item_id, origin_version, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(prompt_id) DO UPDATE SET tags_json = excluded.tags_json, notes = excluded.notes,
      ratio = excluded.ratio, updated_at = excluded.updated_at`)
      .run(prompt.promptId, JSON.stringify(input.tags || []), String(input.notes || ''), String(input.ratio || ''),
        String(input.originKind || 'manual'), input.originSourceId || null, input.originItemId || null,
        input.originVersion || null, new Date().toISOString());
    return prompt;
  }

  function listStyles() {
    return db.prepare(`SELECT style_id AS styleId, name, body, ratio, notes,
      created_at AS createdAt, updated_at AS updatedAt FROM image_studio_styles ORDER BY updated_at DESC`).all();
  }

  function saveStyle(input = {}) {
    const name = String(input.name || '').trim();
    const body = String(input.body || '').trim();
    if (!name || !body) throw new Error('请填写风格名称和描述。');
    const styleId = input.styleId || crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO image_studio_styles (style_id, name, body, ratio, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(style_id) DO UPDATE SET name = excluded.name,
      body = excluded.body, ratio = excluded.ratio, notes = excluded.notes, updated_at = excluded.updated_at`)
      .run(styleId, name, body, String(input.ratio || ''), String(input.notes || ''), now, now);
    return listStyles();
  }

  function deleteStyle({ styleId }) {
    db.prepare('DELETE FROM image_studio_styles WHERE style_id = ?').run(styleId);
    return listStyles();
  }

  return {
    getState, saveDraft, start, cancelTask, setFavorite, deleteWork, exportImage,
    importAsset, invertImage, optimizePrompt, listMyPrompts, saveMyPrompt,
    listStyles, saveStyle, deleteStyle, ...sources,
    onEvent(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
}

module.exports = { createImageStudioService };
