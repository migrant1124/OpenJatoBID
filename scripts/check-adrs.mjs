import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const REQUIRED_SECTIONS = [
  '状态', '日期', '决策人或责任域', '背景', '决策', '不变量', '备选方案',
  '正面影响', '负面影响', '安全与隐私', '运维与回退', '关联代码和测试', 'Supersedes / Superseded by',
];
const VALID_STATUSES = new Set(['proposed', 'accepted', 'deprecated', 'superseded', 'rejected']);
const EXPECTED_FILES = [
  '0001-upstream-sync-strategy.md',
  '0002-product-identity-and-protected-paths.md',
  '0003-runtime-version-and-update-contract.md',
  '0004-structured-response-write-protection.md',
  '0005-local-renderer-concurrency-and-memory-model.md',
  '0006-structured-chart-dsl.md',
  '0007-config-versioning-and-migration.md',
  '0008-system-diagnostics-center.md',
  '0009-external-model-release-gate.md',
  '0010-user-manual-automation.md',
];

function readText(file) {
  return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
}

export function validateAdrContent(fileName, content, knownIds) {
  const errors = [];
  const id = fileName.slice(0, 4);
  if (!new RegExp(`^# ADR-${id}：`, 'm').test(content)) errors.push(`${fileName}: 标题必须以 ADR-${id} 开头`);
  for (const section of REQUIRED_SECTIONS) {
    if (!new RegExp(`^## ${section}$`, 'm').test(content)) errors.push(`${fileName}: 缺少“${section}”章节`);
  }
  const status = content.match(/^## 状态\s*\n+\s*([a-z-]+)/m)?.[1];
  if (!status || !VALID_STATUSES.has(status)) errors.push(`${fileName}: 状态不合法`);
  const references = [...content.matchAll(/ADR-(\d{4})/g)].map((match) => match[1]);
  for (const reference of references) {
    if (reference !== id && !knownIds.has(reference)) errors.push(`${fileName}: 引用了不存在的 ADR-${reference}`);
  }
  if (status === 'accepted' && !/\[[^\]]+\]\([^\n)]+\)/.test(content)) {
    errors.push(`${fileName}: accepted ADR 必须关联至少一个代码或测试链接`);
  }
  return errors;
}

export function validateAdrDirectory(root = process.cwd()) {
  const adrDir = path.join(root, 'docs', 'adr');
  const errors = [];
  if (!fs.existsSync(adrDir)) return [`缺少 ADR 目录：${adrDir}`];
  const files = fs.readdirSync(adrDir).filter((file) => /^\d{4}-.+\.md$/.test(file)).sort();
  if (!files.includes('0000-template.md')) errors.push('缺少 0000-template.md');
  const numbered = files.filter((file) => file !== '0000-template.md');
  if (JSON.stringify(numbered) !== JSON.stringify(EXPECTED_FILES)) errors.push('ADR 文件编号或文件名不完整、不连续');
  const knownIds = new Set(numbered.map((file) => file.slice(0, 4)));
  for (const file of numbered) errors.push(...validateAdrContent(file, readText(path.join(adrDir, file)), knownIds));
  const readme = path.join(adrDir, 'README.md');
  if (!fs.existsSync(readme)) {
    errors.push('缺少 ADR README.md');
  } else {
    const index = readText(readme);
    for (const file of numbered) {
      if (!index.includes(`](${file})`)) errors.push(`README 未索引 ${file}`);
    }
  }
  return errors;
}

if (path.resolve(process.argv[1] || '') === path.resolve(fileURLToPath(import.meta.url))) {
  const errors = validateAdrDirectory();
  if (errors.length) {
    console.error(`ADR 校验失败（${errors.length} 项）：\n- ${errors.join('\n- ')}`);
    process.exitCode = 1;
  } else {
    console.log('ADR 校验通过：0001–0010 连续、必填章节和 README 索引均有效。');
  }
}
