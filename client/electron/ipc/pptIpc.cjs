const methods = { list: 'list', get: 'get', create: 'create', 'inspect-template': 'inspectTemplate', 'insert-layout': 'insertLayout', 'set-plan': 'setPlan', confirm: 'confirm',
  'import-materials': 'importMaterials', notes: 'notes', 'save-notes': 'saveNotes', 'import-narration': 'importNarration', agent: 'agent', annotations: 'annotations', 'save-annotation': 'saveAnnotation', 'apply-annotations': 'applyAnnotations', preferences: 'preferences', 'set-preferences': 'setPreferences', 'prepare-template': 'prepareTemplate', edit: 'edit',
  'native-replace': 'nativeReplace', 'native-objects': 'nativeObjects', 'deleted-projects': 'deletedProjects', 'restore-deleted': 'restoreDeleted', 'remove-personal-template': 'removePersonalTemplate', export: 'exportProject', rename: 'rename', remove: 'remove', cancel: 'cancel',
  page: 'page', busy: 'busy', restore: 'restore', relocate: 'relocate', 'select-skill-version': 'selectSkillVersion', 'personal-templates': 'personalTemplates', 'save-personal-template': 'savePersonalTemplate', 'select-directory': 'selectDirectory', 'select-materials': 'selectMaterials', 'select-ppt': 'selectPpt', 'select-skill': 'selectSkill' };
function registerPptIpc({ ipcMain, service }) {
  const channels = [];
  for (const [name, method] of Object.entries(methods)) { const channel = `ppt:${name}`; channels.push(channel); ipcMain.handle(channel, (_event, input) => service[method](input)); }
  for (const method of ['list', 'identify', 'install', 'remove', 'enable', 'discard', 'storage', 'configure']) { const channel = `ppt:skills-${method}`; channels.push(channel); ipcMain.handle(channel, (_event, input) => service.skills[method](input)); }
  return () => channels.forEach((channel) => ipcMain.removeHandler(channel));
}
module.exports = { registerPptIpc, PPT_CHANNELS: [...Object.keys(methods).map((name) => `ppt:${name}`), ...['list', 'identify', 'install', 'remove', 'enable', 'discard', 'storage', 'configure'].map((name) => `ppt:skills-${name}`)] };
