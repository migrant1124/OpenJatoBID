import childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const MANIFEST_PATH = 'docs/secondary-development/upstream-sync-manifest.yml';

function command(command, args, cwd) {
  return childProcess.execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

export function loadManifest(root = process.cwd()) {
  const manifestFile = path.join(root, MANIFEST_PATH);
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  if (manifest.schema_version !== 1 || !manifest.upstream?.branch || !Array.isArray(manifest.protected_paths)) {
    throw new Error('Manifest schema 无效');
  }
  for (const item of manifest.protected_paths) {
    if (!item.path || !item.reason || !item.owner || !item.required_adr) throw new Error('Manifest protected_paths 条目不完整');
  }
  return manifest;
}

export function isProtectedPath(file, protectedPaths) {
  return protectedPaths.some(({ path: protectedPath }) => file === protectedPath || file.startsWith(`${protectedPath}/`));
}

export function buildAuditReport({ base, head, mergeBase, counts, files, manifest }) {
  const changed = files.map(({ status, file }) => ({
    status,
    file,
    protected: isProtectedPath(file, manifest.protected_paths),
  }));
  const protectedHits = changed.filter((item) => item.protected);
  const adoptedChanges = (manifest.capabilities?.adopted || []).filter((capability) =>
    (capability.local_files || []).some((localFile) => changed.some(({ file }) => file === localFile || file.startsWith(`${localFile}/`))),
  ).map((capability) => capability.id);
  const documentsDeleted = changed.filter(({ status, file }) => status.startsWith('D') && file.startsWith('docs/')).map(({ file }) => file);
  const risks = changed.filter(({ file }) => /(?:brand|release|license|authorization|management|analytics)/i.test(file)).map(({ file }) => file);
  const candidates = changed.filter(({ protected: isProtected }) => !isProtected).map(({ file }) => file);
  const requiresReview = changed.length > 0;
  return {
    base,
    head,
    merge_base: mergeBase,
    exclusive_commits: { base: counts.base, head: counts.head },
    changed_files: changed,
    protected_path_hits: protectedHits,
    adopted_capability_changes: adoptedChanges,
    new_capability_candidates: candidates,
    rejected_capability_reappearance: [],
    deleted_documents: documentsDeleted,
    brand_release_license_management_risks: risks,
    recommended_action: protectedHits.length ? 'review' : (requiresReview ? 'adopt / fork / reject / review' : 'none'),
  };
}

function parseArgs(args) {
  const options = { json: false, failOn: '', base: 'main', head: '' };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--json') options.json = true;
    else if (argument === '--base') options.base = args[++index] || '';
    else if (argument === '--head') options.head = args[++index] || '';
    else if (argument === '--fail-on') options.failOn = args[++index] || '';
    else throw new Error(`未知参数：${argument}`);
  }
  return options;
}

function formatMarkdown(report) {
  const lines = [
    '# Upstream Audit Report',
    '',
    `- Merge base: \`${report.merge_base}\``,
    `- Base only commits: ${report.exclusive_commits.base}`,
    `- Head only commits: ${report.exclusive_commits.head}`,
    `- Recommended action: ${report.recommended_action}`,
    '',
    '## Changed files',
    '',
    ...(report.changed_files.length ? report.changed_files.map((item) => `- ${item.status} \`${item.file}\`${item.protected ? ' (protected)' : ''}`) : ['- None']),
    '',
    '## Risks',
    '',
    ...(report.brand_release_license_management_risks.length ? report.brand_release_license_management_risks.map((file) => `- \`${file}\``) : ['- None']),
  ];
  return lines.join('\n');
}

function run() {
  const root = process.cwd();
  const options = parseArgs(process.argv.slice(2));
  const manifest = loadManifest(root);
  const head = options.head || manifest.upstream.branch;
  const mergeBase = command('git', ['merge-base', options.base, head], root);
  const [baseCount, headCount] = command('git', ['rev-list', '--left-right', '--count', `${options.base}...${head}`], root).split(/\s+/).map(Number);
  const files = command('git', ['diff', '--name-status', `${options.base}...${head}`], root)
    .split('\n').filter(Boolean).map((line) => {
      const [status, ...fileParts] = line.split('\t');
      return { status, file: fileParts.at(-1) };
    });
  const report = buildAuditReport({ base: options.base, head, mergeBase, counts: { base: baseCount, head: headCount }, files, manifest });
  console.log(options.json ? JSON.stringify(report, null, 2) : formatMarkdown(report));
  if (report.protected_path_hits.length) return 3;
  if (options.failOn === 'protected') return 0;
  return report.changed_files.length ? 2 : 0;
}

if (path.resolve(process.argv[1] || '') === path.resolve(fileURLToPath(import.meta.url))) {
  try {
    process.exitCode = run();
  } catch (error) {
    console.error(`Upstream audit 失败：${error.message}`);
    process.exitCode = 4;
  }
}
