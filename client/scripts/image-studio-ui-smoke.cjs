const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const outputDir = process.argv[2];
  if (!outputDir) throw new Error('需要截图输出目录。');
  fs.mkdirSync(outputDir, { recursive: true });
  const pages = await (await fetch('http://127.0.0.1:9222/json')).json();
  const page = pages.find((item) => item.type === 'page' && item.url.includes('127.0.0.1:5173'));
  if (!page) throw new Error('未找到 Electron 客户端窗口。');
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let id = 0;
  const pending = new Map();
  const events = [];
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (!message.id) {
      if (/exception|console|entryAdded/i.test(message.method || '')) events.push(message);
      return;
    }
    const request = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const nextId = ++id;
    pending.set(nextId, { resolve, reject });
    socket.send(JSON.stringify({ id: nextId, method, params }));
  });
  const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value;
  try {
    await send('Runtime.enable');
    await send('Log.enable');
    const navigation = await evaluate(`(() => {
      const candidates = [...document.querySelectorAll('button, a, [role="button"]')]
        .filter((el) => el.textContent.includes('生图模式'));
      const target = candidates.sort((a, b) => a.textContent.length - b.textContent.length)[0];
      if (target) target.click();
      return { found: Boolean(target), tag: target?.outerHTML.slice(0, 300), bridge: Boolean(window.yibiao), text: document.body.innerText.slice(0, 900) };
    })()`);
    for (let attempt = 0; attempt < 30; attempt += 1) {
      if (await evaluate(`Boolean(document.querySelector('.image-studio-page'))`)) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    console.log(JSON.stringify({ navigation, events: events.slice(-8) }));
    for (const [width, height, scale] of [[1440, 900, 100], [1280, 800, 100], [1024, 768, 100], [1280, 800, 125]]) {
      await evaluate(`window.resizeTo(${width}, ${height}); document.documentElement.style.zoom = '${scale}%'; true`);
      await new Promise((resolve) => setTimeout(resolve, 250));
      const metrics = await evaluate(`(() => ({ width: innerWidth, height: innerHeight,
        scrollWidth: document.documentElement.scrollWidth, text: document.body.innerText.slice(0, 380),
        page: Boolean(document.querySelector('.image-studio-page')) }))()`);
      const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      const file = path.join(outputDir, `electron-${width}x${height}-${scale}.png`);
      fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
      console.log(JSON.stringify({ file, metrics }));
    }
    await evaluate(`document.documentElement.style.zoom = '100%'; true`);
    await evaluate(`window.resizeTo(1440, 900); document.querySelectorAll('.image-studio-tabs button')[1].click(); true`);
    await new Promise((resolve) => setTimeout(resolve, 500));
    for (const [name, expression] of [
      ['prompts', 'true'],
      ['sources', `document.querySelector('.image-studio-list-tools button')?.click(); true`],
      ['works', `document.querySelector('.image-studio-overlay [aria-label="关闭"]')?.click(); document.querySelectorAll('.image-studio-tabs button')[2].click(); true`],
    ]) {
      await evaluate(expression);
      await new Promise((resolve) => setTimeout(resolve, 400));
      const metrics = await evaluate(`(() => ({ page: Boolean(document.querySelector('.image-studio-page')),
        text: document.body.innerText.slice(-600), scrollWidth: document.documentElement.scrollWidth,
        width: innerWidth }))()`);
      const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      const file = path.join(outputDir, `electron-${name}.png`);
      fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
      console.log(JSON.stringify({ file, metrics }));
    }
  } finally { socket.close(); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
