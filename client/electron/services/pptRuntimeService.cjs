const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const lock = require('./ppt-runtime-lock.json');
const hash = (value) => require('node:crypto').createHash('sha256').update(value).digest('hex');

const SCRIPTS = new Set(['attribution_guard.py', 'pptx_to_svg.py', 'svg_quality_checker.py', 'finalize_svg.py', 'svg_to_pptx.py', 'project_manager.py', 'register_template.py']);
function createPptRuntimeService({ app, rootOverride }) {
  const root = rootOverride || (app.isPackaged ? path.join(process.resourcesPath, 'ppt-runtime/win32-x64') : path.resolve(__dirname, '../../vendor/ppt-runtime/win32-x64'));
  const skillRoot = path.join(root, 'ppt-master'), python = path.join(root, 'python/python.exe');
  const sandbox = path.join(root, 'host-tools/pptSandbox.exe'), launcher = path.join(root, 'host-tools/pptTrustedTool.py');
  const pending = new Set(), operations = new Set(); let closed = false;
  function status() {
    const complete = process.platform === 'win32' && fs.existsSync(sandbox) && fs.existsSync(launcher) && fs.existsSync(python) && fs.existsSync(path.join(skillRoot, 'SKILL.md')) && fs.existsSync(path.join(root, 'files-manifest.json'));
    return { complete, root, skillRoot, pythonVersion: lock.python.version, skillVersion: lock.skill.version,
      sandbox: 'Windows AppContainer（无网络能力）+ 单进程 Job',
      message: complete ? '固定运行组件与 Windows 隔离器已安装，使用前校验' : '缺少受管运行组件或 Windows 隔离器，工具执行已阻止；不会使用系统 PATH' };
  }
  async function verify() {
    if (!status().complete) throw new Error(status().message);
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'files-manifest.json'), 'utf8'));
    for (let offset = 0; offset < manifest.files.length; offset += 16) await Promise.all(manifest.files.slice(offset, offset + 16).map(async (entry) => {
      const full = path.resolve(root, entry.path);
      if (!full.startsWith(`${root}${path.sep}`) || hash(await fs.promises.readFile(full)) !== entry.hash) throw new Error(`运行组件校验失败：${entry.path}`);
    }));
  }
  async function runInternal({ script, args = [], projectRoot, signal, timeoutMs = 180000 }, media = false) {
    if (closed) throw new Error('PPT 运行组件已关闭');
    if (!media && !SCRIPTS.has(script)) throw new Error('未批准的脚本；不允许任意 shell、Python 或 pip');
    if (signal?.aborted) throw signal.reason || new Error('任务已取消');
    await verify();
    if (closed) throw new Error('PPT 运行组件已关闭');
    if (signal?.aborted) throw signal.reason || new Error('任务已取消');
    const project = fs.realpathSync(projectRoot);
    const instruction = { script: path.join(skillRoot, 'scripts', script), args, readRoots: [root, project, path.join(process.env.SystemRoot || 'C:/Windows', 'Fonts')], writeRoot: project };
    const instructionFile = path.join(project, `.runtime-${require('node:crypto').randomUUID()}.json`);
    fs.writeFileSync(instructionFile, JSON.stringify(instruction), 'utf8');
    const sandboxFile = `${instructionFile}.sandbox.json`;
    fs.writeFileSync(sandboxFile, JSON.stringify({ executable: media ? path.join(root, 'ffmpeg/bin', script === 'probe' ? 'ffprobe.exe' : 'ffmpeg.exe') : python, launcher, policy: instructionFile, writeRoot: project, readRoots: [root], ...(media ? { kind: 'media', arguments: args } : {}) }), 'utf8');
    const environment = { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, LOCALAPPDATA: process.env.LOCALAPPDATA, USERPROFILE: process.env.USERPROFILE, TEMP: project, TMP: project,
      PYTHONIOENCODING: 'utf-8', PYTHONDONTWRITEBYTECODE: '1', PATH: path.dirname(python) };
    return new Promise((resolve, reject) => {
      const child = spawn(sandbox, [sandboxFile], { cwd: project, env: environment, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      pending.add(child); let output = '', error = '', killed = false;
      let killTimer;
      const abort = () => { if (killed) return; killed = true; child.stdin.write('cancel\n'); killTimer = setTimeout(() => child.kill(), 5000); };
      child.cancel = abort;
      child.stdin.on('error', () => {});
      const timer = setTimeout(abort, timeoutMs);
      signal?.addEventListener('abort', abort, { once: true });
      child.stdout.on('data', (chunk) => { output = (output + chunk.toString('utf8')).slice(-1024 * 1024); });
      child.stderr.on('data', (chunk) => { error = (error + chunk.toString('utf8')).slice(-1024 * 1024); });
      child.on('error', (cause) => { error = cause.message; });
      child.on('close', (code) => {
        clearTimeout(timer); clearTimeout(killTimer); pending.delete(child); signal?.removeEventListener('abort', abort);
        fs.rmSync(instructionFile, { force: true });
        fs.rmSync(sandboxFile, { force: true });
        if (code !== 0 || killed) reject(new Error(killed ? 'PPT 工具已取消或超时' : `PPT 工具失败（${code}）：${[error, output].filter(Boolean).join('\n')}`));
        else resolve({ script, exitCode: code, output, warnings: error });
      });
    });
  }
  function run(payload) {
    const operation = runInternal(payload); operations.add(operation);
    operation.finally(() => operations.delete(operation)).catch(() => {}); return operation;
  }
  function media(payload, probe = false) {
    const project = fs.realpathSync(payload.projectRoot);
    const safe = (relative) => { const value = path.resolve(project, relative); if (!value.startsWith(`${project}${path.sep}`) || !fs.realpathSync(value).startsWith(`${project}${path.sep}`)) throw new Error('媒体路径越出候选'); return value; };
    let args;
    if (probe) args = ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-show_streams', '-show_format', '-of', 'json', safe(payload.file)];
    else {
      const frames = safe('exports/video-frames'), output = path.join(project, 'exports/presentation.mp4');
      const size = payload.aspectRatio === '4:3' ? '1280:960' : '1280:720';
      args = ['-nostdin', '-hide_banner', '-y', '-protocol_whitelist', 'file,pipe', '-f', 'concat', '-safe', '1', '-i', path.join(frames, 'frames.txt')];
      if (payload.audio) args.push('-protocol_whitelist', 'file,pipe', '-i', safe(payload.audio));
      args.push('-vf', `scale=${size}:force_original_aspect_ratio=decrease,pad=${size}:(ow-iw)/2:(oh-ih)/2,fps=25,tpad=stop_mode=clone:stop_duration=${payload.duration}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-threads', '2');
      if (payload.audio) args.push('-af', 'apad', '-c:a', 'aac', '-shortest');
      if (!(payload.duration > 0)) throw new Error('视频需要实际整稿时长');
      args.push('-t', String(payload.duration));
      args.push('-movflags', '+faststart', output);
    }
    const operation = runInternal({ ...payload, script: probe ? 'probe' : 'video', args, timeoutMs: 300000 }, true); operations.add(operation); operation.finally(() => operations.delete(operation)).catch(() => {}); return operation;
  }
  return { status, verify, run, skillRoot,
    video: (payload) => media(payload), probe: (payload) => media(payload, true),
    volume(target, system) { if (!status().complete) throw new Error('请选择目录前先准备 Windows 固定组件；不能猜测系统卷'); return JSON.parse(require('node:child_process').execFileSync(sandbox, ['--volume', target, system], { windowsHide: true, encoding: 'utf8' })); },
    async guard(projectRoot, signal) { return run({ script: 'attribution_guard.py', projectRoot, signal }); },
    async close() { closed = true; [...pending].forEach((child) => child.cancel()); await Promise.allSettled([...operations]); } };
}
module.exports = { createPptRuntimeService, SCRIPTS };
