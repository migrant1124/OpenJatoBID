const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('../../client/node_modules/playwright-core');

async function main() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9225');
  const page = browser.contexts()[0].pages()[0];
  await page.reload();
  const notice = page.getByText('知道了', { exact: true });
  await notice.waitFor({ state: 'visible' });
  await notice.click();
  await page.getByText('生图模式', { exact: true }).first().click();
  await page.getByRole('button', { name: '局部修改' }).click();
  const stage = page.locator('.image-studio-mask-stage');
  const box = await stage.boundingBox();
  await page.mouse.move(box.x + box.width * .6, box.y + box.height * .5);
  await page.mouse.wheel(0, -500);
  await page.waitForTimeout(250);
  const zoomed = await stage.evaluate((node) => ({ scrollWidth: node.scrollWidth, clientWidth: node.clientWidth,
    scrollLeft: node.scrollLeft, scrollTop: node.scrollTop }));
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(box.x + box.width * .3, box.y + box.height * .3);
  await page.mouse.up({ button: 'middle' });
  const panned = await stage.evaluate((node) => ({ scrollLeft: node.scrollLeft, scrollTop: node.scrollTop }));
  await page.screenshot({ path: path.join(__dirname, 'electron-ui/local-zoom.png') });
  const report = { zoomed, panned, zoomWorks: zoomed.scrollWidth > zoomed.clientWidth,
    panWorks: panned.scrollLeft !== zoomed.scrollLeft || panned.scrollTop !== zoomed.scrollTop };
  fs.writeFileSync(path.join(__dirname, 'electron-ui/local-zoom-result.json'), JSON.stringify(report, null, 2));
  console.log(report);
  await browser.close();
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
