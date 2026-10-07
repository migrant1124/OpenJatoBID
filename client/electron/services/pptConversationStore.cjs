const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const digest = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

function createPptConversationStore(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS ppt_conversations (
    conversation_id TEXT PRIMARY KEY, project_id TEXT UNIQUE, draft_json TEXT NOT NULL, checkpoint_json TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ppt_messages (
    message_id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL,
    metadata_json TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ppt_questions (
    question_id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, task_id TEXT NOT NULL, job_id TEXT NOT NULL,
    gate_id TEXT, phase TEXT, fingerprint TEXT NOT NULL, data_json TEXT NOT NULL, status TEXT NOT NULL,
    answer_json TEXT, created_at TEXT NOT NULL
  );`);
  db.prepare("UPDATE ppt_questions SET status='interrupted' WHERE status='pending' AND job_id IN (SELECT job_id FROM ppt_jobs WHERE status IN ('interrupted','cancelled','failed'))").run();
  for (const row of db.prepare('SELECT * FROM ppt_conversations WHERE project_id IS NOT NULL').all()) {
    const draft = JSON.parse(row.draft_json), project = db.prepare('SELECT root FROM ppt_projects WHERE project_id=?').get(row.project_id);
    let changed = false;
    for (const item of draft.attachments) if (item.status === 'parsing') {
      const raw = item.pendingPath && project && path.join(project.root,item.pendingPath), parsed = raw && `${raw}.md`;
      const installed = raw && fs.existsSync(parsed) && fs.existsSync(raw) && crypto.createHash('sha256').update(fs.readFileSync(raw)).digest('hex') === item.pendingHash;
      Object.assign(item, installed ? {status:'ready',path:`${item.pendingPath}.md`,hash:item.pendingHash} : {status:'failed',error:'上次资料解析中断，正式资料保留；可重试'});
      delete item.pendingPath; delete item.pendingHash; delete item.jobId; changed = true;
    }
    if (changed) db.prepare('UPDATE ppt_conversations SET draft_json=? WHERE conversation_id=?').run(JSON.stringify(draft),row.conversation_id);
  }
  function get({ conversationId, projectId } = {}) {
    const row = conversationId ? db.prepare('SELECT * FROM ppt_conversations WHERE conversation_id=?').get(conversationId)
      : projectId ? db.prepare('SELECT * FROM ppt_conversations WHERE project_id=?').get(projectId) : db.prepare('SELECT * FROM ppt_conversations WHERE project_id IS NULL ORDER BY updated_at DESC LIMIT 1').get();
    if (!row) {
      if (conversationId) throw new Error('PPT会话不存在，请重新读取');
      const id = crypto.randomUUID(), at = new Date().toISOString();
      const project = projectId ? db.prepare('SELECT root,requirements_json,resource_json FROM ppt_projects WHERE project_id=?').get(projectId) : null;
      const requirements = project ? JSON.parse(project.requirements_json) : {}, resource = project?.resource_json ? JSON.parse(project.resource_json) : {};
      const attachments=[];
      // 仅首次建立旧项目会话时迁移现有解析文件；以后以会话中的有效引用为准。
      const folder=project && path.join(project.root,'materials');
      if(folder && fs.existsSync(folder)) for(const name of fs.readdirSync(folder).filter(name=>/^[a-f0-9]{64}\.[^.]+\.md$/.test(name))) {
        const original=path.join(folder,name.slice(0,-3));if(fs.existsSync(original)) attachments.push({attachmentId:crypto.randomUUID(),original,name:'已导入资料 '+name.slice(0,8),bytes:fs.statSync(original).size,status:'ready',path:`materials/${name}`,hash:crypto.createHash('sha256').update(fs.readFileSync(original)).digest('hex')});
      }
      db.prepare('INSERT INTO ppt_conversations VALUES (?, ?, ?, NULL, ?, ?)').run(id, projectId || null, JSON.stringify({ text: '', selection: { creationScope: requirements.creationScope === 'single' ? 'single' : 'deck', skillHash: resource?.skillHash || '', template: null }, attachments }), at, at);
      return get({ conversationId: id });
    }
    return { conversationId: row.conversation_id, projectId: row.project_id, ...JSON.parse(row.draft_json), checkpoint: row.checkpoint_json ? JSON.parse(row.checkpoint_json) : null,
      messages: db.prepare('SELECT message_id AS messageId, role, content, metadata_json AS metadataJson, created_at AS createdAt FROM ppt_messages WHERE conversation_id=? ORDER BY rowid').all(row.conversation_id),
      questions: db.prepare('SELECT question_id AS questionId, task_id AS taskId, job_id AS jobId, gate_id AS gateId, phase, fingerprint, data_json AS dataJson, status, answer_json AS answerJson FROM ppt_questions WHERE conversation_id=? ORDER BY rowid').all(row.conversation_id) };
  }
  function save({ conversationId, text, selection, attachments }) {
    const value = get({ conversationId });
    const draft = { text: text ?? value.text, selection: selection ?? value.selection, attachments: attachments ?? value.attachments };
    if (!['deck', 'single'].includes(draft.selection.creationScope)) throw new Error('制作范围必须为整套或单页');
    db.prepare('UPDATE ppt_conversations SET draft_json=?, updated_at=? WHERE conversation_id=?').run(JSON.stringify(draft), new Date().toISOString(), value.conversationId);
    return get({ conversationId });
  }
  function add(conversationId, role, content, metadata = {}) {
    if (!content) return;
    const id = crypto.randomUUID(); db.prepare('INSERT INTO ppt_messages VALUES (?, ?, ?, ?, ?, ?)').run(id, conversationId, role, content, JSON.stringify(metadata), new Date().toISOString()); return id;
  }
  function attach({ conversationId, paths = [], removeId, retryId }) {
    const value = get({ conversationId }), attachments = value.attachments.filter((item) => item.attachmentId !== removeId);
    if (retryId) { const item = attachments.find((entry) => entry.attachmentId === retryId); if (!item || item.status !== 'failed') throw new Error('只能重试失败附件'); item.status = 'selected'; delete item.error; }
    for (const original of paths) {
      const file = fs.realpathSync(original), stat = fs.statSync(file);
      if (!stat.isFile() || stat.size > 256 * 1024 ** 2) throw new Error('请选择不超过256 MB的资料文件');
      if (!/\.(docx|pdf|md|txt|pptx|png|jpe?g|webp|xlsx|xls)$/i.test(file)) throw new Error('此资料格式尚未适配');
      if (!attachments.some((item) => item.original === file)) attachments.push({ attachmentId: crypto.randomUUID(), original: file, name: path.basename(file), bytes: stat.size, status: 'selected' });
    }
    if (attachments.reduce((sum, item) => sum + item.bytes, 0) > 1024 ** 3) throw new Error('本会话资料总量超过1 GB，请分批选择');
    return save({ conversationId, attachments });
  }
  function fingerprint(project, conversation, scope = []) {
    const requirements = { ...project.requirements }; delete requirements.secondsPerPage; delete requirements.mediaEnabled;
    return digest({ requirements, scope, scopeHashes: scope.map((id) => db.prepare('SELECT hash FROM ppt_pages WHERE slide_id=? AND project_id=?').get(id, project.projectId)?.hash),
      selection: conversation.selection, templateHash: project.resource?.sourceHash, skillHash: project.resource?.skillHash,
      materials: conversation.attachments.filter((item) => item.status === 'ready').map((item) => ({ id: item.attachmentId, hash: item.hash })).sort((a,b) => a.id.localeCompare(b.id)), route: project.route });
  }
  function confirmed(project, conversation, phase, scope = []) {
    const fingerprintNow = fingerprint(project, conversation, scope);
    const latest = conversation.questions.filter((item) => item.phase === phase).at(-1);
    return latest?.status === 'answered' && latest.fingerprint === fingerprintNow && JSON.parse(latest.answerJson || '{}').confirmed ? latest : null;
  }
  function requireGate(project, conversationId, phase, scope = [], requestId) {
    const conversation = get({ conversationId });
    const latest = conversation.questions.filter((item) => item.phase === phase).at(-1);
    const approvedScope = phase === 'phase1' ? [] : phase === 'phase2' ? JSON.parse(latest?.dataJson || '{}').scope || [] : scope;
    if (phase === 'phase2' && approvedScope.length && (scope.length !== approvedScope.length || scope.some((id) => !approvedScope.includes(id)))) throw new Error('本次页面范围与确认方案不同，请确认新范围');
    const approved = confirmed(project, conversation, phase, approvedScope);
    if (!approved) throw new Error(`请先在当前会话确认${phase === 'phase1' ? '用途、受众、目标与模板' : phase === 'scope' ? '原生编辑对象与范围' : '完整方案和制作设置'}；原确认范围可能已变化`);
    if (requestId && JSON.parse(approved.dataJson).requestId !== requestId) {
      const execution = confirmed(project, conversation, 'execute', scope), data = execution && JSON.parse(execution.dataJson);
      if (!data || data.requestId !== requestId || data.approvedGateId !== approved.gateId) throw new Error('本轮新指令尚未确认执行范围；已确认方案保留，请在会话中确认本次修改');
    }
    return approved;
  }
  function checkpoint(conversationId, value) { db.prepare('UPDATE ppt_conversations SET checkpoint_json=? WHERE conversation_id=?').run(value ? JSON.stringify(value) : null, conversationId); }
  return { get, save, add, attach, fingerprint, confirmed, requireGate, checkpoint,
    bind(conversationId, projectId) { db.prepare('UPDATE ppt_conversations SET project_id=? WHERE conversation_id=? AND project_id IS NULL').run(projectId, conversationId); const value = get({ conversationId }); if (value.projectId !== projectId) throw new Error('会话已绑定其他项目'); return value; },
  };
}
module.exports = { createPptConversationStore, digest };
