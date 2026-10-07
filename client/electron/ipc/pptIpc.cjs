const methods = { conversation: 'conversation', 'save-conversation': 'saveConversation', 'attach-conversation': 'attachConversation', answer: 'answer', list: 'list', get: 'get', create: 'create', 'inspect-template': 'inspectTemplate', 'insert-layout': 'insertLayout', 'set-plan': 'setPlan', confirm: 'confirm',
  'import-materials': 'importMaterials', notes: 'notes', 'save-notes': 'saveNotes', 'import-narration': 'importNarration', agent: 'agent', annotations: 'annotations', 'save-annotation': 'saveAnnotation', 'apply-annotations': 'applyAnnotations', preferences: 'preferences', 'set-preferences': 'setPreferences', 'prepare-template': 'prepareTemplate', edit: 'edit',
  'native-replace': 'nativeReplace', 'native-objects': 'nativeObjects', 'deleted-projects': 'deletedProjects', 'restore-deleted': 'restoreDeleted', 'remove-personal-template': 'removePersonalTemplate', export: 'exportProject', rename: 'rename', remove: 'remove', cancel: 'cancel',
  page: 'page', busy: 'busy', restore: 'restore', relocate: 'relocate', 'select-skill-version': 'selectSkillVersion', 'personal-templates': 'personalTemplates', 'save-personal-template': 'savePersonalTemplate', 'select-directory': 'selectDirectory', 'select-materials': 'selectMaterials', 'select-ppt': 'selectPpt', 'select-skill': 'selectSkill' };
function registerPptIpc({ ipcMain, service }) {
  const channels = [];
  const subscriptions = new Map();
  ipcMain.handle('ppt:subscribe', (event, conversationId) => {
    subscriptions.get(event.sender.id)?.unsubscribe();
    const unsubscribe = service.onEvent((value) => { if (value.conversationId === conversationId && !event.sender.isDestroyed()) event.sender.send('ppt:event', value); });
    subscriptions.set(event.sender.id, {conversationId,unsubscribe});
    event.sender.once('destroyed', () => { subscriptions.get(event.sender.id)?.unsubscribe(); subscriptions.delete(event.sender.id); });
  });
  ipcMain.handle('ppt:unsubscribe', (event,conversationId) => { if(subscriptions.get(event.sender.id)?.conversationId === conversationId) { subscriptions.get(event.sender.id).unsubscribe(); subscriptions.delete(event.sender.id); } });
  channels.push('ppt:subscribe', 'ppt:unsubscribe');
  for (const [name, method] of Object.entries(methods)) { const channel = `ppt:${name}`; channels.push(channel); ipcMain.handle(channel, (_event, input) => service[method](input)); }
  for (const method of ['list', 'identify', 'install', 'remove', 'enable', 'discard', 'storage', 'configure']) { const channel = `ppt:skills-${method}`; channels.push(channel); ipcMain.handle(channel, (_event, input) => service.skills[method](input)); }
  return () => { subscriptions.forEach((entry) => entry.unsubscribe()); channels.forEach((channel) => ipcMain.removeHandler(channel)); };
}
module.exports = { registerPptIpc, PPT_CHANNELS: ['ppt:subscribe','ppt:unsubscribe',...Object.keys(methods).map((name) => `ppt:${name}`), ...['list', 'identify', 'install', 'remove', 'enable', 'discard', 'storage', 'configure'].map((name) => `ppt:skills-${name}`)] };
