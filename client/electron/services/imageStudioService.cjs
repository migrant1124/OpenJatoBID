const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { dialog, powerMonitor } = require('electron');
const { imageSize } = require('image-size');
const sharp = require('sharp');
const { getGeneratedImagesDir } = require('../utils/paths.cjs');
const { createImageStudioSources, assertPublicUrl } = require('./imageStudioSources.cjs');
const { createPixelLayers, writeLayeredPsd } = require('./imageStudioPsd.cjs');

function createImageStudioService({ app, db, aiService, configStore, promptLibraryStore, dialogApi = dialog }) {
  const listeners = new Set();
  const stoppedTasks = new Set();
  const coverInflight = new Map();
  const coverFailures = new Map();
  const coverWaiters = [];
  let coverActive = 0;
  const sources = createImageStudioSources({ db, translateBatch: async (rows) => {
    const configSnapshot = configStore.load();
    if (!configSnapshot.api_key || !configSnapshot.model_name) return [];
    const answer = await aiService.chat({ configSnapshot, noRetry: true, logTitle: '生图模式-增量中文化',
      messages: [
        { role: 'system', content: '将 JSON 数组内每条图片提示词的 title 和 prompt 翻译为自然中文。保留 id、专名、模板变量、引号中的画面文字。只返回同结构 JSON 数组，每项含 itemId、title、prompt。' },
        { role: 'user', content: JSON.stringify(rows.map(({ itemId, title, prompt }) => ({ itemId, title, prompt }))) },
      ] });
    try { return JSON.parse(String(answer).replace(/^```(?:json)?\s*|\s*```$/g, '')); }
    catch { return []; }
  } });
  if (typeof app?.on === 'function' && !process.env.R4_DISABLE_SOURCE_SYNC) {
    const check = () => { void sources.runDue().then((result) => {
      if (result.checked) emit('', { sourcesChecked: true, updatedSourceIds: result.updatedSourceIds });
    }).catch(() => {}); };
    const first = setTimeout(check, 15000);
    const hourly = setInterval(check, 3600000);
    first.unref?.(); hourly.unref?.();
    powerMonitor?.on?.('resume', check);
    app.on('before-quit', () => { clearTimeout(first); clearInterval(hourly); powerMonitor?.off?.('resume', check); });
  }
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

  function emit(taskId, sourceEvent = {}) {
    const event = { taskId, tasks: listTasks(), works: listWorks(), ...sourceEvent };
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
    const references = Array.isArray(input.references) ? input.references : [];
    if (references.length > 4) throw new Error('最多选择 4 张参考图片。');
    const kind = input.kind === 'edit' ? 'edit' : references.length ? 'reference' : 'generate';
    if (kind === 'edit' && (!references.length || !input.maskDataUrl)) throw new Error('局部修改需要原图和选区。');
    const imageInputs = references.map((reference) => {
      const filePath = selectedImage(reference);
      if (!filePath || !fs.existsSync(filePath)) throw new Error('参考图片已丢失，请重新选择。');
      if (!['主体', '风格', '构图', '色彩'].includes(reference.role)) throw new Error('参考图片用途无效。');
      if (fs.statSync(filePath).size > 25_000_000) throw new Error('参考图片实际 PNG 超过 25 MB，未发送模型请求。');
      return { buffer: fs.readFileSync(filePath), mimeType: 'image/png', role: reference.role };
    });
    if (imageInputs.reduce((total, image) => total + image.buffer.length, 0) > 50_000_000) {
      throw new Error('参考图片总量超过 50 MB，未发送模型请求。');
    }
    let mask = null;
    if (kind === 'edit') {
      const encoded = String(input.maskDataUrl).match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
      if (!encoded) throw new Error('选区不是有效 PNG。');
      mask = Buffer.from(encoded[1], 'base64');
      const originalSize = imageSize(imageInputs[0].buffer);
      const maskSize = imageSize(mask);
      if (originalSize.width !== maskSize.width || originalSize.height !== maskSize.height) throw new Error('选区与原图尺寸不一致。');
    }
    const availability = aiService.getImageModelAvailability();
    if (!availability.available) throw new Error(availability.message);
    const baseConfig = configStore.load();
    // The current relay returns image data in JSON; its SSE path completed without image items.
    const submissionConfig = { ...baseConfig,
      image_model: { ...baseConfig.image_model, request_mode: 'normal' } };
    const config = submissionConfig.image_model || {};
    const size = String(input.size || config.image_size || '');
    if (!/^\d{1,4}x\d{1,4}$/.test(size)) throw new Error('图片画幅无效。');
    const configFingerprint = crypto.createHash('sha256').update(JSON.stringify({
      provider: config.provider, model: config.model_name, baseUrl: config.base_url,
      size, requestMode: config.request_mode,
    })).digest('hex');
    const taskId = crypto.randomUUID();
    const at = new Date().toISOString();
    db.prepare(`INSERT INTO image_studio_tasks
      (task_id, status, prompt, model_provider, model_name, requested_size, kind,
       requested_count, request_json, reference_assets_json, parent_work_id, config_fingerprint, created_at, updated_at)
      VALUES (?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(taskId, prompt, config.provider || '', config.model_name || '', size, kind, count,
        JSON.stringify({ size, count, ratio: input.ratio || '', requestMode: 'normal',
          maskSha256: mask ? crypto.createHash('sha256').update(mask).digest('hex') : null }),
        JSON.stringify(references.map(({ assetId, workId, role }) => ({ assetId, workId, role }))),
        input.parentWorkId || null, configFingerprint, at, at);
    emit(taskId);

    void Promise.resolve().then(async () => {
      if (!stoppedTasks.has(taskId)) setTask(taskId, 'running');
      let successes = 0;
      let lastError = null;
      let uncertain = false;
      let requestImages = imageInputs;
      if (mask) {
        try {
          const pixels = await sharp(mask).ensureAlpha().raw().toBuffer();
          const original = await sharp(imageInputs[0].buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
          let selected = false;
          for (let i = 3; i < pixels.length; i += 4) {
            if (pixels[i] !== 0) continue;
            selected = true;
            original.data[i - 3] = Math.round(original.data[i - 3] * .4 + 255 * .6);
            original.data[i - 2] = Math.round(original.data[i - 2] * .4);
            original.data[i - 1] = Math.round(original.data[i - 1] * .4 + 48 * .6);
          }
          if (!selected) throw new Error('请先标记需要修改的区域。');
          const annotated = await sharp(original.data, { raw: { width: original.info.width,
            height: original.info.height, channels: 4 } }).png().toBuffer();
          requestImages = [...imageInputs, { buffer: annotated, mimeType: 'image/png', role: '选区标记' }];
        } catch (error) {
          setTask(taskId, 'failed', String(error.message || error));
          return;
        }
      }
      for (let index = 0; index < count; index += 1) {
        if (stoppedTasks.has(taskId)) break;
        let sent = false;
        try {
          const modelPrompt = requestImages.length
            ? `${prompt}\n${requestImages.map((image, i) => `图 ${i + 1}：${image.role}参考。`).join('\n')}${kind === 'edit' ? '\n图 1 是原图，最后一张图的红色区域是唯一允许修改的选区。输出不包含红色标记，保持其余区域不变。' : ''}`
            : prompt;
          const result = await aiService.withQueueScope(`image-studio:${taskId}`).generateImage({
            prompt: modelPrompt, size, images: requestImages, title: '生图模式', preservePrompt: true,
            configSnapshot: submissionConfig, noRetry: true,
            onSent() {
              sent = true;
              db.prepare('UPDATE image_studio_tasks SET sent_at = ? WHERE task_id = ?').run(new Date().toISOString(), taskId);
              if (!stoppedTasks.has(taskId)) setTask(taskId, 'sent');
            },
          });
          if (!stoppedTasks.has(taskId)) setTask(taskId, 'downloading');
          let outputPath = result.file_path;
          let outputUrl = result.asset_url;
          if (kind === 'edit') {
            const original = await sharp(imageInputs[0].buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
            const generated = await sharp(outputPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
            if (generated.info.width !== original.info.width || generated.info.height !== original.info.height) {
              throw new Error('编辑结果与原图尺寸不同，结果已保留但未写入作品。');
            }
            const maskPixels = await sharp(mask).ensureAlpha().raw().toBuffer();
            for (let i = 0; i < original.data.length; i += 4) {
              if (maskPixels[i + 3] > 0) generated.data.set(original.data.subarray(i, i + 4), i);
            }
            const editedName = `studio-edit-${crypto.randomUUID()}.png`;
            const outputDirectory = getGeneratedImagesDir(app);
            fs.mkdirSync(outputDirectory, { recursive: true });
            outputPath = path.join(outputDirectory, editedName);
            fs.writeFileSync(outputPath, await sharp(generated.data, { raw: { width: original.info.width, height: original.info.height, channels: 4 } }).png().toBuffer());
            outputUrl = `yibiao-asset://generated-images/${editedName}`;
          }
          const file = fs.readFileSync(outputPath);
          const dimensions = imageSize(file);
          if (!dimensions.width || !dimensions.height) throw new Error('生成结果不是可识别的图片。');
          db.prepare(`INSERT INTO image_studio_works
            (work_id, task_id, parent_work_id, file_path, asset_url, mime_type, width, height, sha256, generation_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(crypto.randomUUID(), taskId, input.parentWorkId || null, outputPath, outputUrl,
              kind === 'edit' ? 'image/png' : result.mime_type || 'image/png', dimensions.width, dimensions.height,
              crypto.createHash('sha256').update(file).digest('hex'),
              JSON.stringify({ size, ratio: input.ratio || '', index, kind,
                references: references.map(({ assetId, workId, role }) => ({ assetId, workId, role })) }), new Date().toISOString());
          db.prepare('UPDATE image_studio_works SET kind = ?, source_asset_id = ? WHERE task_id = ? AND file_path = ?')
            .run(kind, references[0]?.assetId || null, taskId, outputPath);
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
    if (png.length > 25_000_000) throw new Error('转换后的参考图片超过 25 MB，请选用较小图片。');
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

  async function readManagedImage(input = {}) {
    const filePath = input.layerId ? db.prepare('SELECT file_path FROM image_studio_psd_layers WHERE layer_id = ?').get(input.layerId)?.file_path
      : selectedImage(input);
    if (!filePath || !fs.existsSync(filePath)) throw new Error('受管图片已丢失。');
    const png = await sharp(filePath).rotate().png().toBuffer();
    const dimensions = imageSize(png);
    return { dataUrl: `data:image/png;base64,${png.toString('base64')}`, width: dimensions.width, height: dimensions.height };
  }

  function listLayerSets(input = {}) {
    const sourceKind = input.assetId ? 'asset' : 'work';
    const sourceId = input.assetId || input.workId;
    const sessions = db.prepare(`SELECT set_id AS setId, source_kind AS sourceKind, source_id AS sourceId,
      width, height, status, created_at AS createdAt, last_export_at AS lastExportAt,
      subject_layer_id AS subjectLayerId
      FROM image_studio_psd_sessions WHERE source_kind = ? AND source_id = ? ORDER BY created_at DESC`).all(sourceKind, sourceId);
    const getLayers = db.prepare(`SELECT layer_id AS layerId, name, asset_url AS assetUrl,
      sort_order AS sortOrder, visible FROM image_studio_psd_layers WHERE set_id = ? ORDER BY sort_order`);
    return sessions.map((session) => ({ ...session, layers: getLayers.all(session.setId).map((layer) => ({ ...layer, visible: Boolean(layer.visible) })) }));
  }

  async function createLayerSet(input = {}) {
    const filePath = selectedImage(input);
    if (!filePath || !fs.existsSync(filePath)) throw new Error('请选择存在的作品或导入图片。');
    const sourceKind = input.assetId ? 'asset' : 'work';
    const sourceId = input.assetId || input.workId;
    const image = await sharp(filePath).rotate().resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 84 }).toBuffer();
    const proposal = await aiService.chat({ configSnapshot: configStore.load(), noRetry: true,
      sensitiveImage: true, logTitle: '生图模式-PSD候选', messages: [
        { role: 'system', content: '识别图片最适合作为前景的单个主体。只返回 JSON：{"name":"简短中文名称","box":[x,y,w,h]}。box 是原图归一化坐标，值 0 到 1，尽量包围整个主体但不要包括大片背景。不要返回 markdown。' },
        { role: 'user', content: [{ type: 'text', text: '请给出可分层主体候选。' },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${image.toString('base64')}` } }] },
      ] });
    let candidate;
    try { candidate = JSON.parse(String(proposal).replace(/^```(?:json)?\s*|\s*```$/g, '')); }
    catch { throw new Error('视觉模型未返回可解析的分层候选。'); }
    const box = candidate.box;
    if (!Array.isArray(box) || box.length !== 4 || box.some((value) => !Number.isFinite(value) || value < 0 || value > 1) ||
      box[2] <= 0 || box[3] <= 0 || box[0] + box[2] > 1.001 || box[1] + box[3] > 1.001) {
      throw new Error('视觉模型返回的主体区域无效。');
    }
    const files = await createPixelLayers(filePath, box, String(candidate.name || '主体').slice(0, 40), getGeneratedImagesDir(app));
    const setId = crypto.randomUUID();
    const now = new Date().toISOString();
    db.exec('BEGIN');
    try {
      db.prepare(`INSERT INTO image_studio_psd_sessions
        (set_id, source_kind, source_id, source_path, width, height, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'ready', ?, ?)`).run(setId, sourceKind, sourceId, filePath, files[0].width, files[0].height, now, now);
      const insert = db.prepare(`INSERT INTO image_studio_psd_layers
        (layer_id, set_id, name, file_path, asset_url, sort_order, sha256) VALUES (?, ?, ?, ?, ?, ?, ?)`);
      files.forEach((layer, index) => {
        const layerId = crypto.randomUUID();
        insert.run(layerId, setId, layer.name, layer.filePath,
        `yibiao-asset://generated-images/${path.basename(layer.filePath)}`, index,
        crypto.createHash('sha256').update(fs.readFileSync(layer.filePath)).digest('hex'));
        if (index === 1) db.prepare('UPDATE image_studio_psd_sessions SET subject_layer_id = ? WHERE set_id = ?').run(layerId, setId);
      });
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return listLayerSets(input)[0];
  }

  function updateLayer(input = {}) {
    const layer = db.prepare('SELECT * FROM image_studio_psd_layers WHERE layer_id = ? AND set_id = ?').get(input.layerId, input.setId);
    if (!layer) throw new Error('图层不存在。');
    db.prepare(`UPDATE image_studio_psd_layers SET name = ?, visible = ?, sort_order = ? WHERE layer_id = ?`)
      .run(String(input.name ?? layer.name).slice(0, 80), input.visible === undefined ? layer.visible : Number(Boolean(input.visible)),
        Number.isInteger(input.sortOrder) ? input.sortOrder : layer.sort_order, layer.layer_id);
    const session = db.prepare('SELECT source_kind, source_id FROM image_studio_psd_sessions WHERE set_id = ?').get(input.setId);
    return listLayerSets(session.source_kind === 'asset' ? { assetId: session.source_id } : { workId: session.source_id })[0];
  }

  async function refineLayerSet(input = {}) {
    const session = db.prepare('SELECT * FROM image_studio_psd_sessions WHERE set_id = ?').get(input.setId);
    if (!session) throw new Error('分层会话不存在。');
    const encoded = String(input.maskDataUrl || '').match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
    if (!encoded) throw new Error('细修遮罩不是 PNG。');
    const rows = db.prepare('SELECT * FROM image_studio_psd_layers WHERE set_id = ? ORDER BY sort_order').all(input.setId);
    const subject = rows.find((row) => row.layer_id === session.subject_layer_id);
    if (!subject) throw new Error('主体图层已丢失。');
    const files = await createPixelLayers(session.source_path, null, subject.name, getGeneratedImagesDir(app), Buffer.from(encoded[1], 'base64'));
    db.exec('BEGIN');
    try {
      rows.forEach((row) => {
        const file = files[row.layer_id === session.subject_layer_id ? 1 : 0];
        db.prepare('UPDATE image_studio_psd_layers SET file_path = ?, asset_url = ?, sha256 = ? WHERE layer_id = ?')
          .run(file.filePath, `yibiao-asset://generated-images/${path.basename(file.filePath)}`,
            crypto.createHash('sha256').update(fs.readFileSync(file.filePath)).digest('hex'), row.layer_id);
      });
      db.prepare('UPDATE image_studio_psd_sessions SET updated_at = ? WHERE set_id = ?').run(new Date().toISOString(), input.setId);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return listLayerSets(session.source_kind === 'asset' ? { assetId: session.source_id } : { workId: session.source_id })[0];
  }

  async function exportLayeredPsd(input = {}) {
    const session = db.prepare('SELECT * FROM image_studio_psd_sessions WHERE set_id = ?').get(input.setId);
    if (!session) throw new Error('分层会话不存在。');
    const layers = db.prepare('SELECT name, file_path AS filePath, visible FROM image_studio_psd_layers WHERE set_id = ? ORDER BY sort_order')
      .all(input.setId).map((layer) => ({ ...layer, visible: Boolean(layer.visible) }));
    const selection = await dialogApi.showSaveDialog({ title: '导出分层 PSD', defaultPath: `分层作品-${input.setId.slice(0, 8)}.psd`,
      filters: [{ name: 'Photoshop PSD', extensions: ['psd'] }] });
    if (selection.canceled || !selection.filePath) return { canceled: true };
    const result = await writeLayeredPsd({ layers, outputPath: selection.filePath });
    db.prepare('UPDATE image_studio_psd_sessions SET last_export_at = ?, updated_at = ? WHERE set_id = ?')
      .run(new Date().toISOString(), new Date().toISOString(), input.setId);
    return { canceled: false, filePath: selection.filePath, ...result };
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

  async function loadCover(input) {
    const itemId = typeof input === 'string' ? input : input?.itemId;
    const item = db.prepare('SELECT cover_url FROM image_studio_reference_items WHERE item_id = ?').get(itemId);
    const coverUrl = typeof input === 'string' ? item?.cover_url : input?.coverUrl;
    if (!coverUrl) throw new Error('该条提示词没有示例图。');
    const cacheId = `${itemId}:${crypto.createHash('sha256').update(coverUrl).digest('hex').slice(0, 16)}`;
    const cached = db.prepare('SELECT * FROM image_studio_cover_cache WHERE item_id = ?').get(cacheId);
    const validCache = cached && fs.existsSync(cached.file_path) ? cached : null;
    if (validCache && !input?.retry && Date.now() - Date.parse(cached.updated_at) < 86400000) return { assetUrl: cached.asset_url };
    const recentFailure = coverFailures.get(cacheId);
    if (recentFailure && Date.now() - recentFailure.at < 30000 && !input?.retry) throw recentFailure.error;
    if (coverInflight.has(cacheId)) return coverInflight.get(cacheId);
    const pending = (async () => {
      if (coverActive >= 4) await new Promise((resolve) => coverWaiters.push(resolve));
      else coverActive += 1;
      try {
        let url = coverUrl;
        let response;
        for (let redirect = 0; redirect < 4; redirect += 1) {
          await assertPublicUrl(url);
          response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(20000) });
          if (response.status < 300 || response.status >= 400) break;
          const next = response.headers.get('location');
          if (!next) throw new Error('示例图重定向缺少地址。');
          url = new URL(next, url).href;
        }
        if (!response?.ok) throw new Error(`示例图下载失败（HTTP ${response?.status || '未知'}）。`);
        if (Number(response.headers.get('content-length') || 0) > 8_000_000) throw new Error('示例图超过 8 MB。');
        const chunks = []; let size = 0;
        for await (const part of response.body) {
          size += part.length;
          if (size > 8_000_000) throw new Error('示例图超过 8 MB。');
          chunks.push(part);
        }
        const image = sharp(Buffer.concat(chunks), { limitInputPixels: 40_000_000 });
        const meta = await image.metadata();
        if (!['jpeg', 'png', 'webp'].includes(meta.format)) throw new Error('示例图不是受支持的图片。');
        const png = await image.rotate().png().toBuffer();
        const fileName = `studio-cover-${crypto.createHash('sha256').update(`${itemId}:${coverUrl}`).digest('hex').slice(0, 16)}-${crypto.createHash('sha256').update(png).digest('hex').slice(0, 16)}.png`;
        const filePath = path.join(getGeneratedImagesDir(app), fileName);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, png);
        const assetUrl = `yibiao-asset://generated-images/${fileName}`;
        db.prepare(`INSERT INTO image_studio_cover_cache (item_id, cover_url, file_path, asset_url, updated_at)
          VALUES (?, ?, ?, ?, ?) ON CONFLICT(item_id) DO UPDATE SET cover_url = excluded.cover_url,
          file_path = excluded.file_path, asset_url = excluded.asset_url, updated_at = excluded.updated_at`)
          .run(cacheId, coverUrl, filePath, assetUrl, new Date().toISOString());
        coverFailures.delete(cacheId);
        return { assetUrl };
      } catch (error) {
        if (validCache && !input?.retry) return { assetUrl: validCache.asset_url };
        coverFailures.set(cacheId, { at: Date.now(), error });
        throw error;
      } finally {
        const next = coverWaiters.shift();
        if (next) next();
        else coverActive -= 1;
      }
    })();
    coverInflight.set(cacheId, pending);
    try { return await pending; }
    finally { if (coverInflight.get(cacheId) === pending) coverInflight.delete(cacheId); }
  }

  function listMyPrompts() {
    return db.prepare(`SELECT p.prompt_id AS promptId, p.group_id AS groupId, p.title,
      p.content_markdown AS contentMarkdown, p.is_favorite AS isFavorite,
      m.tags_json AS tagsJson, m.notes, m.ratio, m.origin_kind AS originKind,
      m.origin_source_id AS originSourceId, m.origin_item_id AS originItemId, m.cover_url AS coverUrl
      FROM image_studio_prompt_meta m JOIN prompt_items p ON p.prompt_id = m.prompt_id
      WHERE p.deleted_at IS NULL ORDER BY p.updated_at DESC`)
      .all().map((row) => ({ ...row, isFavorite: Boolean(row.isFavorite), tags: JSON.parse(row.tagsJson) }));
  }

  function saveMyPrompt(input = {}) {
    if (!promptLibraryStore) throw new Error('个人提示词库尚未初始化。');
    if (!input.promptId && input.originKind === 'reference' && input.originSourceId && input.originItemId) {
      const existing = db.prepare(`SELECT m.prompt_id FROM image_studio_prompt_meta m
        JOIN prompt_items p ON p.prompt_id = m.prompt_id
        WHERE m.origin_kind = 'reference' AND m.origin_source_id = ? AND m.origin_item_id = ?
          AND p.deleted_at IS NULL LIMIT 1`).get(input.originSourceId, input.originItemId);
      if (existing) {
        if (input.coverUrl) db.prepare(`UPDATE image_studio_prompt_meta SET cover_url = ?
          WHERE prompt_id = ? AND (cover_url IS NULL OR cover_url = '')`).run(input.coverUrl, existing.prompt_id);
        return promptLibraryStore.getPrompt(existing.prompt_id);
      }
    }
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
    if (!input.promptId && input.coverUrl) db.prepare('UPDATE image_studio_prompt_meta SET cover_url = ? WHERE prompt_id = ?')
      .run(input.coverUrl, prompt.promptId);
    return prompt;
  }

  function toggleReferenceFavorite({ sourceId, itemId, isFavorite }) {
    if (!promptLibraryStore) throw new Error('个人提示词库尚未初始化。');
    const item = db.prepare('SELECT * FROM image_studio_reference_items WHERE source_id = ? AND item_id = ?').get(sourceId, itemId);
    if (!item) throw new Error('参考提示词已不存在。');
    db.exec('BEGIN');
    try {
      const link = db.prepare('SELECT prompt_id FROM image_studio_reference_favorites WHERE source_id = ? AND item_id = ?').get(sourceId, itemId);
      const active = link && db.prepare('SELECT prompt_id FROM prompt_items WHERE prompt_id = ? AND deleted_at IS NULL').get(link.prompt_id);
      let promptId = active?.prompt_id;
      if (isFavorite && !promptId) {
        const copy = saveMyPrompt({ title: item.title_zh, contentMarkdown: item.prompt_zh,
          tags: JSON.parse(item.tags_json), originKind: 'reference', originSourceId: sourceId,
          originItemId: itemId, originVersion: item.content_hash, coverUrl: item.cover_url });
        promptId = copy.promptId;
        db.prepare(`INSERT INTO image_studio_reference_favorites (source_id, item_id, prompt_id, created_at)
          VALUES (?, ?, ?, ?) ON CONFLICT(source_id, item_id) DO UPDATE SET prompt_id = excluded.prompt_id`)
          .run(sourceId, itemId, promptId, new Date().toISOString());
      }
      if (promptId) promptLibraryStore.setFavorite({ promptId, isFavorite: Boolean(isFavorite) });
      db.exec('COMMIT');
      return { promptId: promptId || null, isFavorite: Boolean(isFavorite && promptId) };
    } catch (error) { db.exec('ROLLBACK'); throw error; }
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
    importAsset, readManagedImage, invertImage, optimizePrompt, listMyPrompts, saveMyPrompt,
    listStyles, saveStyle, deleteStyle, loadCover, toggleReferenceFavorite,
    listLayerSets, createLayerSet, updateLayer, refineLayerSet, exportLayeredPsd, ...sources,
    onEvent(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
}

module.exports = { createImageStudioService };
