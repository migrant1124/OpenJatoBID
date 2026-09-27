const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const root = path.join(__dirname, '../../.tmp/v181-electron-userdata/workspace');
const sourceDb = new DatabaseSync(path.join(__dirname, 'live-layer-sample/sample.sqlite'));
const targetDb = new DatabaseSync(path.join(root, 'yibiao.sqlite'));
const original = path.join(__dirname, 'segmentation-source.png');
const directory = path.join(root, 'generated-images');
const workId = 'v181-layer-ui-sample';
const taskId = 'v181-layer-ui-task';
const source = path.join(directory, 'v181-layer-source.png');
fs.copyFileSync(original, source);
const now = new Date().toISOString();
const session = sourceDb.prepare('SELECT * FROM image_studio_psd_sessions LIMIT 1').get();
const layers = sourceDb.prepare('SELECT * FROM image_studio_psd_layers ORDER BY sort_order').all();
targetDb.exec('BEGIN');
try {
  targetDb.prepare(`INSERT INTO image_studio_tasks (task_id,status,prompt,model_provider,model_name,requested_size,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(taskId, 'completed', 'v1.8.1 分层界面隔离测试图', 'probe', 'gpt-image-2', '1536x1024', now, now);
  targetDb.prepare(`INSERT INTO image_studio_works (work_id,task_id,file_path,asset_url,mime_type,width,height,sha256,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(workId, taskId, source, 'yibiao-asset://generated-images/v181-layer-source.png',
    'image/png', 1536, 1024, crypto.createHash('sha256').update(fs.readFileSync(original)).digest('hex'), now);
  targetDb.prepare(`INSERT INTO image_studio_psd_sessions
    (set_id,source_kind,source_id,source_path,width,height,status,created_at,updated_at,subject_layer_id,background_layer_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(session.set_id, 'work', workId, source, session.width, session.height,
    session.status, now, now, session.subject_layer_id, session.background_layer_id);
  const insert = targetDb.prepare(`INSERT INTO image_studio_psd_layers
    (layer_id,set_id,name,file_path,asset_url,sort_order,visible,sha256) VALUES (?,?,?,?,?,?,?,?)`);
  for (const layer of layers) {
    const name = path.basename(layer.file_path);
    const destination = path.join(directory, name);
    fs.copyFileSync(layer.file_path, destination);
    insert.run(layer.layer_id, session.set_id, layer.name, destination,
      `yibiao-asset://generated-images/${name}`, layer.sort_order, layer.visible, layer.sha256);
  }
  targetDb.exec('COMMIT');
  console.log(JSON.stringify({ workId, setId: session.set_id, layerCount: layers.length }));
} catch (error) { targetDb.exec('ROLLBACK'); throw error; }
finally { sourceDb.close(); targetDb.close(); }
