import { execFile } from 'node:child_process';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const STABLE_TAG_PATTERN = /^v\d+\.\d+\.\d+$/;

function runGit(args) {
  return new Promise((resolve, reject) => {
    const child = execFile('git', args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }
      reject(new Error(`git ${args.join(' ')} failed: ${stderr || stdout}`));
    });
  });
}

export function parseForbiddenTerms(value) {
  const text = String(value || '').trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed.map((term) => String(term).trim()).filter(Boolean);
  } catch {
    // Fall through to simple separators for easier secret maintenance.
  }
  return text.split(/\r?\n|,/).map((term) => term.trim()).filter(Boolean);
}

export function validateReleaseNotesCompliance(content, forbiddenTerms) {
  const text = String(content || '');
  const terms = parseForbiddenTerms(forbiddenTerms);
  if (terms.length === 0) {
    throw new Error('JATOBID_RELEASE_FORBIDDEN_TERMS is required for official release notes compliance.');
  }
  for (const [index, term] of terms.entries()) {
    if (term && text.toLowerCase().includes(term.toLowerCase())) {
      throw new Error(`Release notes hit forbidden term list item ${index + 1}.`);
    }
  }
  const checks = [
    [/sk-[A-Za-z0-9_-]{12,}/, 'Release notes contain a possible API key fragment.'],
    [/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/i, 'Release notes contain a possible Bearer token fragment.'],
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'Release notes contain a private key fragment.'],
    [/\b[A-Za-z]:\\Users\\[^ \r\n]+/i, 'Release notes contain a Windows user directory.'],
    [/\b(?:[A-Za-z]:\\|\\\\)[^ \r\n]+/i, 'Release notes contain a local absolute path.'],
    [/\b(?:127\.0\.0\.1|0\.0\.0\.0|localhost)(?::\d{2,5})?\b/i, 'Release notes contain an internal debug address.'],
    [/\b(?:10|172\.(?:1[6-9]|2\d|3[0-1])|192\.168)\.\d{1,3}\.\d{1,3}(?::\d{2,5})?\b/, 'Release notes contain a private network debug address.'],
    [/\b(?:api[_-]?key|secret|private[_-]?key|access[_-]?token)\s*[:=]\s*[^ \r\n]{6,}/i, 'Release notes contain obvious client-sensitive information.'],
  ];
  for (const [pattern, message] of checks) {
    if (pattern.test(text)) throw new Error(message);
  }
}

export async function createReleaseNotes({
  tagName,
  repository,
  forbiddenTerms,
  outputPath = 'release_notes.md',
}) {
  if (!STABLE_TAG_PATTERN.test(String(tagName || ''))) {
    throw new Error(`Invalid release tag: ${tagName || '(empty)'}`);
  }
  const previousTag = await runGit(['describe', '--tags', '--abbrev=0', `${tagName}^`]).catch(() => '');
  const range = previousTag ? `${previousTag}..${tagName}` : tagName;
  const compareUrl = previousTag
    ? `https://github.com/${repository}/compare/${previousTag}...${tagName}`
    : `https://github.com/${repository}/commits/${tagName}`;
  const logOutput = await runGit(['log', range, '--no-merges', '--pretty=format:- %s (%h)']).catch(() => '');
  const body = [
    '## 更新内容',
    '',
    logOutput || '- 本版本没有可列出的普通提交。',
    '',
    `**Full Changelog**: ${compareUrl}`,
    '',
  ].join('\n');
  validateReleaseNotesCompliance(body, forbiddenTerms);
  await fsp.writeFile(outputPath, body, 'utf8');
  return { previousTag, range, compareUrl, outputPath: path.resolve(outputPath) };
}

async function main() {
  const tagName = String(process.env.TAG_NAME || '').trim();
  const repository = String(process.env.GITHUB_REPOSITORY || '').trim();
  const forbiddenTerms = process.env.JATOBID_RELEASE_FORBIDDEN_TERMS || '';
  if (!repository) throw new Error('GITHUB_REPOSITORY is required.');
  const result = await createReleaseNotes({ tagName, repository, forbiddenTerms });
  console.log(`Created compliant release notes for ${tagName}.`);
  console.log(`Compare URL: ${result.compareUrl}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exit(1);
  });
}
