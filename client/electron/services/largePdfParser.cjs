const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const LARGE_PDF_THRESHOLD_BYTES = 100 * 1024 * 1024;
const LARGE_PDF_CHUNK_BYTES = 100 * 1024 * 1024;

function parseLargePdfWithWorker(inputPath, options = {}) {
  return new Promise(async (resolve, reject) => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'jatoaibid-large-pdf-')).catch(reject);
    if (!tempRoot) return;

    const payloadPath = path.join(tempRoot, 'payload.json');
    const outputPath = path.join(tempRoot, 'result.md');
    const payload = {
      inputPath,
      outputPath,
      tempRoot,
      includeImages: options.includeImages === true,
      maxChunkBytes: Number(options.maxChunkBytes || LARGE_PDF_CHUNK_BYTES),
    };

    try {
      await fs.writeFile(payloadPath, JSON.stringify(payload), 'utf-8');
    } catch (error) {
      await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
      reject(error);
      return;
    }

    const workerPath = path.join(__dirname, 'doc2markdown', 'largePdfWorker.mjs');
    const child = spawn(process.execPath, ['--max-old-space-size=4096', workerPath, payloadPath], {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      windowsHide: true,
    });

    let stderr = '';
    let workerError = null;

    child.stdout?.on('data', () => undefined);
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString('utf-8');
      if (stderr.length > 12000) {
        stderr = stderr.slice(-12000);
      }
    });
    child.on('message', (message) => {
      if ((message?.type === 'progress' || message?.type === 'done') && typeof options.onProgress === 'function') {
        options.onProgress(message);
      }
      if (message?.type === 'error') {
        workerError = new Error(message.message || '大 PDF 子进程解析失败');
        workerError.stack = message.stack || workerError.stack;
      }
    });
    child.on('error', async (error) => {
      await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
      reject(error);
    });
    child.on('close', async (code) => {
      try {
        if (workerError) {
          reject(workerError);
          return;
        }
        if (code !== 0) {
          reject(new Error(`大 PDF 子进程退出异常(${code})${stderr ? `：${stderr}` : ''}`));
          return;
        }
        const markdown = await fs.readFile(outputPath, 'utf-8');
        resolve(markdown);
      } catch (error) {
        reject(error);
      } finally {
        await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
      }
    });
  });
}

module.exports = {
  LARGE_PDF_CHUNK_BYTES,
  LARGE_PDF_THRESHOLD_BYTES,
  parseLargePdfWithWorker,
};
