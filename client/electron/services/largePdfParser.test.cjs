const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { parseLargePdfWithWorker } = require('./largePdfParser.cjs');

async function createPdf(filePath, pageTexts) {
  const { PDFDocument, StandardFonts } = await import('pdf-lib');
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);

  for (const text of pageTexts) {
    const page = pdf.addPage([500, 500]);
    page.drawText(text, { x: 48, y: 430, size: 18, font });
  }

  await fs.writeFile(filePath, await pdf.save());
}

test('大 PDF 子进程按页分片解析并合并 Markdown', async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jatobid-large-pdf-worker-'));
  t.after(() => fs.rm(tempDir, { recursive: true, force: true }));
  const inputPath = path.join(tempDir, 'source.pdf');
  await createPdf(inputPath, [
    'Alpha procurement text 1001',
    'Beta quotation text 2002',
    'Gamma delivery text 3003',
  ]);

  const progressEvents = [];
  const markdown = await parseLargePdfWithWorker(inputPath, {
    maxChunkBytes: 1200,
    onProgress: (event) => progressEvents.push(event),
  });

  assert.match(markdown, /Alpha procurement text 1001/);
  assert.match(markdown, /Beta quotation text 2002/);
  assert.match(markdown, /Gamma delivery text 3003/);
  assert.match(markdown, /PDF 分片/);
  assert.ok(progressEvents.some((event) => event.stage === 'split'));
  assert.ok(progressEvents.some((event) => event.stage === 'convert'));
});
