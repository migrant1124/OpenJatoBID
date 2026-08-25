const crypto = require('node:crypto');

const DEFAULT_GROUP_ID = 'prompt-group-general';

function nowIso() {
  return new Date().toISOString();
}

function visibleLength(value) {
  const text = String(value || '');
  try {
    return [...new Intl.Segmenter('zh-CN', { granularity: 'grapheme' }).segment(text)].length;
  } catch {
    return Array.from(text).length;
  }
}

function toGroup(row) {
  return {
    groupId: row.group_id,
    groupName: row.group_name,
    description: row.description || '',
    iconKey: row.icon_key || 'blue',
    isSystem: Boolean(row.is_system),
    promptCount: Number(row.prompt_count || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toPrompt(row) {
  return {
    promptId: row.prompt_id,
    groupId: row.group_id,
    title: row.title,
    contentMarkdown: row.content_markdown || '',
    contentChars: Number(row.content_chars || 0),
    source: row.source,
    sourceFileName: row.source_file_name || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function createPromptLibraryStore({ db }) {
  function ensureDefaultGroup() {
    if (db.prepare('SELECT 1 FROM prompt_groups WHERE deleted_at IS NULL LIMIT 1').get()) return;
    const at = nowIso();
    db.prepare(`INSERT OR IGNORE INTO prompt_groups
      (group_id, group_name, description, icon_key, sort_order, is_system, created_at, updated_at)
      VALUES (?, '通用提示词', '常用提示词', 'blue', 0, 1, ?, ?)`)
      .run(DEFAULT_GROUP_ID, at, at);
  }

  function requireGroup(groupId) {
    const row = db.prepare('SELECT * FROM prompt_groups WHERE group_id = ? AND deleted_at IS NULL').get(groupId);
    if (!row) throw new Error('提示词分组不存在或已删除。');
    return row;
  }

  function requirePrompt(promptId) {
    const row = db.prepare('SELECT * FROM prompt_items WHERE prompt_id = ? AND deleted_at IS NULL').get(promptId);
    if (!row) throw new Error('提示词不存在或已删除。');
    return row;
  }

  function listGroups() {
    ensureDefaultGroup();
    return db.prepare(`SELECT g.*,
      (SELECT COUNT(*) FROM prompt_items p WHERE p.group_id = g.group_id AND p.deleted_at IS NULL) AS prompt_count
      FROM prompt_groups g WHERE g.deleted_at IS NULL ORDER BY g.sort_order, g.created_at`).all().map(toGroup);
  }

  function createGroup(input) {
    const groupName = String(input?.groupName || '').trim();
    if (!groupName || visibleLength(groupName) > 30) throw new Error('分组名称应为 1–30 个字符。');
    if (['全部提示词', '回收站'].includes(groupName)) throw new Error('该分组名称为系统保留名称。');
    if (db.prepare('SELECT 1 FROM prompt_groups WHERE group_name = ? AND deleted_at IS NULL').get(groupName)) throw new Error('分组名称已存在。');
    const groupId = crypto.randomUUID();
    const at = nowIso();
    db.prepare(`INSERT INTO prompt_groups
      (group_id, group_name, description, icon_key, sort_order, is_system, created_at, updated_at)
      VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM prompt_groups), 0, ?, ?)`)
      .run(groupId, groupName, String(input?.description || '').trim().slice(0, 100), String(input?.iconKey || 'blue'), at, at);
    return toGroup({ ...requireGroup(groupId), prompt_count: 0 });
  }

  function deleteGroup(groupId) {
    const group = requireGroup(groupId);
    if (group.is_system) throw new Error('默认分组不能删除。');
    if (db.prepare('SELECT 1 FROM prompt_items WHERE group_id = ? AND deleted_at IS NULL LIMIT 1').get(groupId)) throw new Error('该分组中仍有提示词，请先删除提示词。');
    const at = nowIso();
    db.prepare('UPDATE prompt_groups SET deleted_at = ?, updated_at = ? WHERE group_id = ?').run(at, at, groupId);
    return { success: true };
  }

  function listPrompts(input = {}) {
    ensureDefaultGroup();
    const groupId = String(input.groupId || '');
    const query = String(input.query || '').trim();
    const clauses = ['p.deleted_at IS NULL', 'g.deleted_at IS NULL'];
    const values = [];
    if (groupId) { clauses.push('p.group_id = ?'); values.push(groupId); }
    if (query) { clauses.push('(p.title LIKE ? OR g.group_name LIKE ?)'); values.push(`%${query}%`, `%${query}%`); }
    return db.prepare(`SELECT p.* FROM prompt_items p JOIN prompt_groups g ON g.group_id = p.group_id
      WHERE ${clauses.join(' AND ')} ORDER BY p.sort_order, p.updated_at DESC`).all(...values).map(toPrompt);
  }

  function getPrompt(promptId) {
    return toPrompt(requirePrompt(promptId));
  }

  function createPrompt(input = {}) {
    const group = requireGroup(input.groupId || DEFAULT_GROUP_ID);
    const title = String(input.title || '').trim().slice(0, 100) || '未命名提示词';
    const content = String(input.contentMarkdown || '');
    const promptId = crypto.randomUUID();
    const at = nowIso();
    db.prepare(`INSERT INTO prompt_items
      (prompt_id, group_id, title, content_markdown, source, source_file_name, content_chars, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM prompt_items WHERE group_id = ?), ?, ?)`)
      .run(promptId, group.group_id, title, content, input.source || 'manual', input.sourceFileName || null, visibleLength(content), group.group_id, at, at);
    return getPrompt(promptId);
  }

  function updatePrompt(input = {}) {
    const current = requirePrompt(input.promptId);
    const groupId = input.groupId === undefined ? current.group_id : requireGroup(input.groupId).group_id;
    const title = input.title === undefined ? current.title : (String(input.title || '').trim().slice(0, 100) || '未命名提示词');
    const content = input.contentMarkdown === undefined ? current.content_markdown : String(input.contentMarkdown || '');
    db.prepare(`UPDATE prompt_items SET group_id = ?, title = ?, content_markdown = ?, content_chars = ?, updated_at = ?
      WHERE prompt_id = ?`).run(groupId, title, content, visibleLength(content), nowIso(), input.promptId);
    return getPrompt(input.promptId);
  }

  function deletePrompt(promptId) {
    requirePrompt(promptId);
    const at = nowIso();
    db.prepare('UPDATE prompt_items SET deleted_at = ?, updated_at = ? WHERE prompt_id = ?').run(at, at, promptId);
    return { success: true };
  }

  ensureDefaultGroup();
  return { listGroups, createGroup, deleteGroup, listPrompts, getPrompt, createPrompt, updatePrompt, deletePrompt };
}

module.exports = { createPromptLibraryStore, DEFAULT_GROUP_ID };
