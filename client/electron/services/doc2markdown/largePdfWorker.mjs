import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { PDFDocument } from 'pdf-lib';

import { convertPathToMarkdown } from './convert.mjs';

function send(message) {
  if (typeof process.send === 'function') {
    process.send(message);
  }
}

function normalizePositiveInteger(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : fallback;
}

function formatPageRange(startPageIndex, endPageIndex) {
  return `${startPageIndex + 1}-${endPageIndex + 1}`;
}

async function savePdfChunk(sourcePdf, startPageIndex, maxChunkBytes, chunksDir, chunkIndex) {
  let lastGood = null;
  let lastGoodEndPageIndex = startPageIndex - 1;
  let overflowed = false;

  for (let pageIndex = startPageIndex; pageIndex < sourcePdf.getPageCount(); pageIndex += 1) {
    const candidate = await PDFDocument.create();
    const pageIndexes = [];
    for (let candidatePageIndex = startPageIndex; candidatePageIndex <= pageIndex; candidatePageIndex += 1) {
      pageIndexes.push(candidatePageIndex);
    }
    const copiedPages = await candidate.copyPages(sourcePdf, pageIndexes);
    copiedPages.forEach((page) => candidate.addPage(page));
    const bytes = await candidate.save();

    if (bytes.length > maxChunkBytes && lastGood) {
      overflowed = true;
      break;
    }

    lastGood = bytes;
    lastGoodEndPageIndex = pageIndex;

    if (bytes.length >= maxChunkBytes * 0.92) {
      break;
    }
  }

  if (!lastGood) {
    const singlePagePdf = await PDFDocument.create();
    const [copiedPage] = await singlePagePdf.copyPages(sourcePdf, [startPageIndex]);
    singlePagePdf.addPage(copiedPage);
    lastGood = await singlePagePdf.save();
    lastGoodEndPageIndex = startPageIndex;
  }

  const range = formatPageRange(startPageIndex, lastGoodEndPageIndex);
  const chunkPath = path.join(chunksDir, `chunk-${String(chunkIndex).padStart(4, '0')}-pages-${range}.pdf`);
  await writeFile(chunkPath, lastGood);
  return {
    path: chunkPath,
    startPage: startPageIndex + 1,
    endPage: lastGoodEndPageIndex + 1,
    bytes: lastGood.length,
    overflowed,
  };
}

async function splitPdfByPageSize(inputPath, tempRoot, maxChunkBytes) {
  const chunksDir = path.join(tempRoot, 'chunks');
  await mkdir(chunksDir, { recursive: true });
  const sourceBytes = await readFile(inputPath);
  const sourcePdf = await PDFDocument.load(sourceBytes, { ignoreEncryption: true });
  const pageCount = sourcePdf.getPageCount();
  const chunks = [];

  for (let startPageIndex = 0; startPageIndex < pageCount;) {
    const chunk = await savePdfChunk(sourcePdf, startPageIndex, maxChunkBytes, chunksDir, chunks.length + 1);
    chunks.push(chunk);
    send({
      type: 'progress',
      stage: 'split',
      startPage: chunk.startPage,
      endPage: chunk.endPage,
      totalPages: pageCount,
      chunkCount: chunks.length,
      chunkBytes: chunk.bytes,
    });
    startPageIndex = chunk.endPage;
  }

  return { chunks, pageCount };
}

async function parseLargePdf(payload) {
  const inputPath = path.resolve(String(payload.inputPath || ''));
  const outputPath = path.resolve(String(payload.outputPath || ''));
  const tempRoot = path.resolve(String(payload.tempRoot || ''));
  const maxChunkBytes = normalizePositiveInteger(payload.maxChunkBytes, 100 * 1024 * 1024);
  const includeImages = payload.includeImages === true;

  const { chunks, pageCount } = await splitPdfByPageSize(inputPath, tempRoot, maxChunkBytes);
  const parts = [];

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    send({
      type: 'progress',
      stage: 'convert',
      chunkIndex: index + 1,
      chunkCount: chunks.length,
      startPage: chunk.startPage,
      endPage: chunk.endPage,
    });

    const markdown = (await convertPathToMarkdown(chunk.path, { includeImages })).trim();
    if (markdown) {
      parts.push(`<!-- PDF 分片 ${index + 1}/${chunks.length}，页码 ${chunk.startPage}-${chunk.endPage} -->\n\n${markdown}`);
    }
  }

  const merged = parts.join('\n\n').trim();
  if (!merged) {
    throw new Error('大 PDF 分片解析后未得到有效 Markdown 内容，可能是扫描件或无可选中文字层');
  }

  send({
    type: 'progress',
    stage: 'merge',
    chunkCount: chunks.length,
    pageCount,
  });
  await writeFile(outputPath, `${merged}\n`, 'utf-8');
  send({
    type: 'done',
    pageCount,
    chunkCount: chunks.length,
  });
}

async function main() {
  const payloadPath = process.argv[2];
  if (!payloadPath) {
    throw new Error('缺少大 PDF 解析参数');
  }
  const payload = JSON.parse(await readFile(payloadPath, 'utf-8'));
  await parseLargePdf(payload);
}

main().catch((error) => {
  send({
    type: 'error',
    message: error.message || String(error),
    stack: error.stack || '',
  });
  process.exitCode = 1;
});
