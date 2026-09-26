const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require(process.env.JATO_PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'jato-v175-ui-'));
  const seeder = await _electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, 'v175-ui-harness.cjs')],
    cwd: path.resolve(__dirname, '..'), env: { ...process.env, JATO_V175_TEST_USERDATA: scratch, ELECTRON_RENDERER_URL: 'http://127.0.0.1:5173' } });
  await seeder.firstWindow();
  await seeder.close();
  const electron = await _electron.launch({ executablePath: require('electron'), args: ['.', `--user-data-dir=${scratch}`],
    cwd: path.resolve(__dirname, '..'), env: { ...process.env, ELECTRON_RENDERER_URL: 'http://127.0.0.1:5173' } });
  try {
    await electron.firstWindow();
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const windows = electron.windows();
    const win = windows.find((item) => item.url().includes('127.0.0.1:5173'));
    await win.getByRole('button', { name: '知道了' }).click();
    await win.getByRole('button', { name: /^生成技术方案/ }).click();
    await win.getByText('项目列表', { exact: true }).waitFor();
    const output = path.resolve(__dirname, '../../docs/secondary-development/changes/v1.7.5-workspace-flow-enhancement/artifacts/screenshots');
    fs.mkdirSync(output, { recursive: true });
    await win.screenshot({ path: path.join(output, 'P01-project-list.png') });
    await win.getByRole('button', { name: '合成项目A', exact: true }).click();
    await win.getByRole('heading', { name: '招标资料' }).waitFor();
    await win.screenshot({ path: path.join(output, 'P02-tender-files.png') });
    await win.getByRole('button', { name: '开始招标文档解析' }).click();
    await win.getByRole('button', { name: '取消', exact: true }).click();
    await win.screenshot({ path: path.join(output, 'P03-analysis-result.png') });
    const reportPath = path.resolve(output, '../ui-analysis-report.docx');
    await electron.evaluate(({ dialog }, target) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: target }); }, reportPath);
    const reportResult = await win.evaluate(() => window.yibiao.export.exportWord({ source: 'technical-plan-analysis' }));
    if (!reportResult.success || !fs.existsSync(reportPath)) throw new Error('解析报告 UI 导出失败');
    await win.getByRole('button', { name: '下一步' }).click();
    await win.getByText('目录结构', { exact: true }).waitFor();
    await win.screenshot({ path: path.join(output, 'P04-outline.png') });
    const outlinePath = path.resolve(output, '../ui-outline.docx');
    await electron.evaluate(({ dialog }, target) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: target }); }, outlinePath);
    const outlineResult = await win.evaluate(() => window.yibiao.export.exportWord({ source: 'technical-plan-outline', includeDescriptions: true }));
    if (!outlineResult.success || !fs.existsSync(outlinePath)) throw new Error('目录大纲 UI 导出失败');
    await win.getByRole('button', { name: '目录排序' }).click();
    await win.locator('.outline-tree-content').filter({ hasText: '实施流程' }).click();
    await win.getByRole('button', { name: '升一级' }).click();
    await win.getByRole('button', { name: '保存调整' }).click();
    await win.getByText('2 个一级目录').waitFor();
    process.stdout.write(`captured P01-P04 with synthetic projects; app version: ${await win.evaluate(() => window.yibiao.getVersion())}\n`);
  } finally { await electron.close(); }
})().catch((error) => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });
