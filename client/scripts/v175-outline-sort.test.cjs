const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { _electron } = require(process.env.JATO_PLAYWRIGHT_MODULE || 'playwright');

test('目录升降与同级上下移使用同一草稿并在保存后持久化', { timeout: 60000 }, async () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'jato-v175-sort-'));
  const appRoot = path.resolve(__dirname, '..');
  const rendererUrl = 'http://127.0.0.1:5173';
  let electron;
  try {
    const seeder = await _electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, 'v175-ui-harness.cjs')], cwd: appRoot,
      env: { ...process.env, JATO_V175_TEST_USERDATA: scratch, ELECTRON_RENDERER_URL: rendererUrl } });
    await seeder.firstWindow();
    await seeder.close();
    electron = await _electron.launch({ executablePath: require('electron'), args: ['.', `--user-data-dir=${scratch}`], cwd: appRoot,
      env: { ...process.env, ELECTRON_RENDERER_URL: rendererUrl } });
    await electron.firstWindow();
    const win = electron.windows().find((item) => item.url().includes(rendererUrl));
    assert.ok(win, '应打开 Vite Renderer 窗口');
    await win.getByRole('button', { name: '知道了' }).click();
    await win.getByRole('button', { name: /^生成技术方案/ }).click();
    await win.getByRole('button', { name: '合成项目A', exact: true }).click();
    await win.getByRole('button', { name: '开始招标文档解析' }).click();
    await win.getByRole('button', { name: '取消', exact: true }).click();
    await win.getByRole('button', { name: '下一步' }).click();
    await win.getByText('目录结构', { exact: true }).waitFor();

    await win.getByRole('button', { name: '目录排序' }).click();
    assert.equal(await win.getByRole('button', { name: '升一级' }).isDisabled(), true);
    assert.equal(await win.getByRole('button', { name: '升一级' }).getAttribute('title'), '当前已是一级目录');
    assert.equal(await win.getByRole('button', { name: '降一级' }).isDisabled(), true);
    assert.equal(await win.getByRole('button', { name: '降一级' }).getAttribute('title'), '没有可作为父级的前一个同级目录');
    assert.equal(await win.getByRole('button', { name: '上移' }).isDisabled(), true);
    await win.locator('.outline-tree-content').filter({ hasText: '实施流程' }).click();
    assert.equal(await win.getByRole('button', { name: '降一级' }).isDisabled(), true);
    await win.getByRole('button', { name: '升一级' }).click();
    await win.getByRole('button', { name: '保存调整' }).click();
    let state = await win.evaluate(() => window.yibiao.technicalPlan.loadState());
    assert.equal(state.outlineData.outline.length, 2);
    assert.equal(state.outlineData.outline[1].title, '实施流程');

    await win.getByRole('button', { name: '目录排序' }).click();
    if (process.env.JATO_SORT_SCREENSHOT) {
      await win.waitForFunction(() => document.querySelectorAll('.app-toast').length === 0);
      await win.screenshot({ path: process.env.JATO_SORT_SCREENSHOT });
    }
    await win.getByRole('button', { name: '上移' }).click();
    assert.equal(await win.getByRole('button', { name: '上移' }).isDisabled(), true);
    await win.getByRole('button', { name: '保存调整' }).click();
    state = await win.evaluate(() => window.yibiao.technicalPlan.loadState());
    assert.equal(state.outlineData.outline[0].title, '实施流程');

    await win.getByRole('button', { name: '目录排序' }).click();
    await win.getByRole('button', { name: '下移' }).click();
    await win.getByRole('button', { name: '降一级' }).click();
    await win.getByRole('button', { name: '保存调整' }).click();
    state = await win.evaluate(() => window.yibiao.technicalPlan.loadState());
    assert.equal(state.outlineData.outline.length, 1);
    assert.equal(state.outlineData.outline[0].children[0].title, '实施流程');

    await win.getByRole('button', { name: '目录排序' }).click();
    await win.getByRole('button', { name: '升一级' }).click();
    await win.getByRole('button', { name: '取消调整' }).click();
    state = await win.evaluate(() => window.yibiao.technicalPlan.loadState());
    assert.equal(state.outlineData.outline.length, 1);

    const deepBranch = { id: '2', title: '深层分支', children: [{ id: '2.1', title: '二级', children: [{ id: '2.1.1', title: '三级', children: [{ id: '2.1.1.1', title: '四级', children: [{ id: '2.1.1.1.1', title: '五级', children: [] }] }] }] }] };
    await win.evaluate((outline) => window.yibiao.technicalPlan.saveOutline({ outlineData: { outline }, reason: 'replace' }), [
      { id: '1', title: '目标父级', children: [] }, deepBranch,
    ]);
    await win.reload();
    await win.getByRole('button', { name: /^生成技术方案/ }).click();
    const projectButton = win.getByRole('button', { name: '合成项目A', exact: true });
    if (await projectButton.count()) await projectButton.click();
    await win.getByText('目录结构', { exact: true }).waitFor();
    await win.getByRole('button', { name: '目录排序' }).click();
    await win.locator('.outline-tree-content').filter({ hasText: '深层分支' }).click();
    assert.equal(await win.getByRole('button', { name: '降一级' }).isDisabled(), true);
    assert.equal(await win.getByRole('button', { name: '降一级' }).getAttribute('title'), '移动后会超过五级目录');
  } finally {
    if (electron) await electron.close();
    if (path.dirname(scratch) === os.tmpdir() && path.basename(scratch).startsWith('jato-v175-sort-')) fs.rmSync(scratch, { recursive: true, force: true });
  }
});
