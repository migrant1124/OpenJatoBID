const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('../../client/node_modules/playwright-core');

async function main() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9224');
  const page = browser.contexts()[0].pages()[0];
  await page.reload();
  const output = path.join(__dirname, 'electron-ui');
  fs.mkdirSync(output, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(700);
  const notice = page.getByText('知道了', { exact: true });
  if (await notice.isVisible()) await notice.click();
  if (await page.getByRole('dialog', { name: '图片预览' }).isVisible()) await page.keyboard.press('Escape');
  await page.getByText('生图模式', { exact: true }).first().click();
  await page.getByRole('heading', { name: '生图模式' }).waitFor();
  await page.screenshot({ path: path.join(output, 'create-1440x900.png') });
  const metrics = await page.evaluate(() => {
    const height = (selector) => [...document.querySelectorAll(selector)].map((element) => Math.round(element.getBoundingClientRect().height));
    return { textarea: height('.image-studio-compose-fields > textarea'),
      tools: height('.image-studio-tool-row > button'), presets: height('.image-studio-presets > button'),
      generate: height('.image-studio-generate'), size: document.querySelector('.image-studio-two-fields label:last-child select')?.value,
      qualityControls: document.querySelectorAll('.image-studio-two-fields label').length };
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.screenshot({ path: path.join(output, 'create-1280x800.png') });
  const state = await page.evaluate(() => window.yibiao.imageStudio.getState());
  if (state.assets.length) {
    await page.evaluate(async (asset) => {
      const current = await window.yibiao.imageStudio.getState();
      await window.yibiao.imageStudio.saveDraft({ revision: current.draft.revision, prompt: current.draft.prompt,
        state: { ...current.draft.state, references: [{ assetId: asset.assetId, assetUrl: asset.assetUrl, role: '主体' }] } });
    }, state.assets[0]);
    await page.reload();
    await page.getByText('生图模式', { exact: true }).first().click();
    await page.getByRole('button', { name: '放大参考图片 1' }).click();
    await page.getByRole('dialog', { name: '图片预览' }).waitFor();
    await page.screenshot({ path: path.join(output, 'reference-viewer.png') });
    await page.getByRole('button', { name: '放大', exact: true }).click();
    await page.getByRole('button', { name: '100%' }).click();
    await page.keyboard.press('Escape');
  }
  await page.getByRole('button', { name: '提示词中心' }).click();
  await page.locator('.image-studio-reference-card').first().waitFor();
  await page.waitForTimeout(2000);
  const pagination = await page.locator('.image-studio-pagination').innerText();
  await page.screenshot({ path: path.join(output, 'prompts-page1.png') });
  await page.getByRole('button', { name: '下一页' }).click();
  await page.locator('.image-studio-pagination').getByText(/第 2/).waitFor();
  await page.screenshot({ path: path.join(output, 'prompts-page2.png') });
  await page.getByRole('button', { name: '上一页' }).click();
  await page.locator('.image-studio-pagination').getByText(/第 1/).waitFor();
  await page.waitForTimeout(600);
  const addFavorite = page.locator('.image-studio-reference-card').first().getByRole('button', { name: '收藏到我的提示词' });
  if (await addFavorite.isVisible()) await addFavorite.click();
  await page.getByRole('button', { name: '我的提示词', exact: true }).click();
  await page.locator('.image-studio-personal-list article').first().waitFor();
  await page.screenshot({ path: path.join(output, 'favorite-in-mine.png') });
  const result = { metrics, pagination, favoritePersonalCount: await page.locator('.image-studio-personal-list article').count(),
    screenshots: fs.readdirSync(output).filter((name) => name.endsWith('.png')) };
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
  process.stdout.write(JSON.stringify(result));
  await browser.close();
}

main().catch((error) => { process.stderr.write(String(error.stack || error)); process.exit(1); });
