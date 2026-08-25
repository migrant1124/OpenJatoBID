const { ipcMain } = require('electron');

function registerPromptLibraryIpc({ promptLibraryService }) {
  const channels = {
    'prompt-library:list-groups': 'listGroups',
    'prompt-library:create-group': 'createGroup',
    'prompt-library:delete-group': 'deleteGroup',
    'prompt-library:batch-delete': 'batchDelete',
    'prompt-library:list-prompts': 'listPrompts',
    'prompt-library:get-prompt': 'getPrompt',
    'prompt-library:create-prompt': 'createPrompt',
    'prompt-library:update-prompt': 'updatePrompt',
    'prompt-library:delete-prompt': 'deletePrompt',
    'prompt-library:set-favorite': 'setFavorite',
    'prompt-library:import-single': 'importSingle',
    'prompt-library:prepare-batch-import': 'prepareBatchImport',
    'prompt-library:commit-batch-import': 'commitBatchImport',
  };
  Object.entries(channels).forEach(([channel, method]) => ipcMain.handle(channel, (_event, input) => promptLibraryService[method](input)));
}

module.exports = { registerPromptLibraryIpc };
