const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { app, dialog } = require('electron');

const userData = process.env.JATO_FP_USERDATA;
const outputDir = process.env.JATO_FP_OUTPUT;
if (!userData || !path.isAbsolute(userData) || !outputDir || !path.isAbsolute(outputDir)) throw new Error('必须显式提供隔离数据和证据目录');
fs.mkdirSync(userData, { recursive: true });
app.setPath('userData', userData);

// 测试进程使用真实 Main/IPC；文件选择只写入合成证据目录。
dialog.showSaveDialog = async () => ({ canceled: false, filePath: path.join(outputDir, '合成模板正文.docx') });
dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });

const configPath = path.join(userData, 'user_config.json');
const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {};
fs.writeFileSync(configPath, JSON.stringify({ ...config,
  developer_mode: false, gpu_hardware_acceleration_enabled: false, gpu_hardware_acceleration_configured: true,
}), 'utf8');

const ts = require('typescript');
const defaults = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/shared/types/exportFormat.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, { exports: defaults.exports, module: defaults, require });
const { createSqliteDatabase } = require('../electron/services/sqliteDatabase.cjs');
const { createTemplateStore } = require('../electron/services/templateStore.cjs');
const sqlite = createSqliteDatabase(app);
const templates = createTemplateStore({ db: sqlite.db });
if (!templates.listTemplates().length) templates.createTemplate({ ...defaults.exports.DEFAULT_EXPORT_FORMAT, template_name: '升级保留合成模板' });
sqlite.close();
require('../electron/bootstrap.cjs');
