const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('../../client/node_modules/playwright-core');

async function main() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9224');
  const page = browser.contexts()[0].pages()[0];
  const output = path.join(__dirname, 'electron-ui');
  const styleName = `R4 回归风格 ${Date.now()}`;
  let styleId;
  try {
    const styles = await page.evaluate((name) => window.yibiao.imageStudio.saveStyle({ name,
      body: '自然窗光，真实摄影', notes: '回归测试' }), styleName);
    styleId = styles.find((style) => style.name === styleName).styleId;
    await page.reload();
    const notice = page.getByText('知道了', { exact: true });
    if (await notice.isVisible()) await notice.click();
    await page.getByText('生图模式', { exact: true }).first().click();
    await page.getByRole('button', { name: 'AI 生图' }).click();
    await page.locator('#image-studio-prompt').fill('窗边一只猫');
    await page.getByRole('button', { name: '提示词中心' }).click();
    await page.getByRole('button', { name: '常用风格' }).click();
    const card = page.locator('.image-studio-style-grid article').filter({ hasText: styleName });
    await card.getByRole('button', { name: '应用到当前输入' }).click();
    await page.locator('#image-studio-prompt').fill('窗边一只猫\n自然窗光，真实摄影\n后续用户补充');
    await page.getByRole('button', { name: '提示词中心' }).click();
    await page.getByRole('button', { name: '常用风格' }).click();
    await card.getByRole('button', { name: '撤销' }).click();
    await page.getByRole('button', { name: 'AI 生图' }).click();
    const afterUndo = await page.locator('#image-studio-prompt').inputValue();
    assert.equal(afterUndo, '窗边一只猫\n后续用户补充');
    await page.getByRole('button', { name: '我的作品' }).click();
    await page.locator('.image-studio-work-item').first().getByRole('button', { name: '详情' }).click();
    await page.getByRole('dialog', { name: '作品详情' }).getByRole('button', { name: '分层 PSD' }).click();
    await page.getByRole('dialog', { name: '分层 PSD' }).waitFor();
    await page.screenshot({ path: path.join(output, 'psd-from-work-detail.png') });
    const report = { styleUndoPreservedLaterText: true, afterUndo, psdOpenedFromWorkDetail: true };
    fs.writeFileSync(path.join(output, 'review-regression-result.json'), JSON.stringify(report, null, 2));
    process.stdout.write(JSON.stringify(report));
  } finally {
    if (styleId) await page.evaluate((id) => window.yibiao.imageStudio.deleteStyle({ styleId: id }), styleId);
    await browser.close();
  }
}

main().catch((error) => { process.stderr.write(String(error.stack || error)); process.exit(1); });
