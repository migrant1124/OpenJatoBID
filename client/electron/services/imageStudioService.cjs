const crypto = require('node:crypto');
const fs = require('node:fs');
const { dialog } = require('electron');
const { imageSize } = require('image-size');
const sharp = require('sharp');

function createImageStudioService({ db, aiService, configStore, dialogApi = dialog }) {
  const listeners = new Set();
  db.prepare("UPDATE image_studio_tasks SET status = 'unknown', updated_at = ? WHERE status IN ('queued', 'running')")
    .run(new Date().toISOString());

  function draft() {
    return db.prepare('SELECT prompt, revision, updated_at AS updatedAt FROM image_studio_draft WHERE id = 1').get()
      || { prompt: '', revision: 0, updatedAt: '' };
  }

  function listWorks() {
    return db.prepare(`SELECT w.work_id AS workId, w.task_id AS taskId, w.parent_work_id AS parentWorkId,
      w.asset_url AS assetUrl, w.mime_type AS mimeType, w.width, w.height, w.is_favorite AS isFavorite,
      w.created_at AS createdAt, t.prompt, t.model_provider AS modelProvider, t.model_name AS modelName
      FROM image_studio_works w JOIN image_studio_tasks t ON t.task_id = w.task_id
      WHERE w.deleted_at IS NULL ORDER BY w.created_at DESC`).all().map((row) => ({
      ...row, isFavorite: Boolean(row.isFavorite),
    }));
  }

  function listTasks() {
    return db.prepare(`SELECT task_id AS taskId, status, prompt, requested_size AS requestedSize,
      error, created_at AS createdAt, updated_at AS updatedAt
      FROM image_studio_tasks ORDER BY created_at DESC LIMIT 30`).all();
  }

  function getState() {
    const config = configStore.load();
    return {
      draft: draft(),
      works: listWorks(),
      tasks: listTasks(),
      imageModel: {
        available: Boolean(aiService.getImageModelAvailability().available),
        size: config.image_model?.image_size || '',
      },
    };
  }

  function saveDraft(input = {}) {
    const current = draft();
    if (input.revision !== current.revision) return { conflict: true, draft: current };
    const next = { prompt: String(input.prompt || ''), revision: current.revision + 1, updatedAt: new Date().toISOString() };
    db.prepare(`INSERT INTO image_studio_draft (id, prompt, revision, updated_at) VALUES (1, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET prompt = excluded.prompt, revision = excluded.revision, updated_at = excluded.updated_at`)
      .run(next.prompt, next.revision, next.updatedAt);
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
    const availability = aiService.getImageModelAvailability();
    if (!availability.available) throw new Error(availability.message);
    const config = configStore.load().image_model || {};
    const taskId = crypto.randomUUID();
    const at = new Date().toISOString();
    db.prepare(`INSERT INTO image_studio_tasks
      (task_id, status, prompt, model_provider, model_name, requested_size, created_at, updated_at)
      VALUES (?, 'queued', ?, ?, ?, ?, ?, ?)`)
      .run(taskId, prompt, config.provider || '', config.model_name || '', config.image_size || '', at, at);
    emit(taskId);

    void Promise.resolve().then(async () => {
      setTask(taskId, 'running');
      try {
        const result = await aiService.withQueueScope(`image-studio:${taskId}`).generateImage({
          prompt, title: '生图模式', preservePrompt: true,
        });
        const file = fs.readFileSync(result.file_path);
        const dimensions = imageSize(file);
        if (!dimensions.width || !dimensions.height) throw new Error('生成结果不是可识别的图片。');
        db.prepare(`INSERT INTO image_studio_works
          (work_id, task_id, parent_work_id, file_path, asset_url, mime_type, width, height, sha256, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(crypto.randomUUID(), taskId, null, result.file_path, result.asset_url,
            result.mime_type || 'image/png', dimensions.width, dimensions.height,
            crypto.createHash('sha256').update(file).digest('hex'), new Date().toISOString());
        setTask(taskId, 'completed');
      } catch (error) {
        setTask(taskId, 'unknown', String(error?.message || error));
      }
    });
    return { taskId };
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

  return {
    getState, saveDraft, start, setFavorite, deleteWork, exportImage,
    onEvent(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
}

module.exports = { createImageStudioService };
