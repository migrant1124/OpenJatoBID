// 真实 Windows AppContainer 探针；不加载 Python 审计钩子，直接检查操作系统边界。
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '../.tmp/ppt184-resource-center/sandbox-probe');
fs.mkdirSync(root, { recursive: true });
const runtime = path.resolve(__dirname, '../vendor/ppt-runtime/win32-x64');
const outside = path.join(path.dirname(root), 'outside-sandbox.txt');
fs.writeFileSync(outside, '隔离测试数据', 'utf8');
process.env.JATO_PROBE_SECRET = '只用于探针的合成值';
let requests = 0;
const server = http.createServer((_req, res) => { requests++; res.end('探针'); });
server.listen(0, '127.0.0.1', async () => {
  const port = server.address().port;
  await fetch(`http://127.0.0.1:${port}`); requests = 0;
  const launcher = path.join(root, 'probe.py'), resultFile = path.join(root, 'result.json');
  fs.rmSync(resultFile, { force: true });
  fs.writeFileSync(launcher, `import os,sys,json,socket,subprocess,ctypes
checks={};errors={}
try:
 open(${JSON.stringify(outside)}).read();checks['file']=False
except OSError as e:checks['file']=True;errors['file']=str(e)
try:
 s=socket.create_connection(('127.0.0.1',${port}),timeout=2);s.close();checks['loopback']=False
except OSError as e:checks['loopback']=True;errors['loopback']=str(e)
try:
 s=socket.create_connection(('1.1.1.1',443),timeout=2);s.close();checks['network']=False
except OSError as e:checks['network']=getattr(e,'winerror',None)==10013;errors['network']=str(e)
try:
 p=subprocess.Popen([sys.executable,'-S','-c','import time;time.sleep(60)']);checks['process']=False
except OSError as e:checks['process']=True;errors['process']=str(e)
checks['env']='JATO_PROBE_SECRET' not in os.environ
checks['write']=True
open('result.json','w',encoding='utf-8').write(json.dumps({'checks':checks,'errors':errors}))
print(json.dumps(checks),flush=True)
sys.exit(0 if all(checks.values()) else 1)
`, 'utf8');
  const policy = path.join(root, 'sandbox.json');
  fs.writeFileSync(policy, JSON.stringify({ executable: path.join(runtime, 'python/python.exe'), launcher, policy, writeRoot: root, readRoots: [runtime] }), 'utf8');
  const child = spawn(path.join(runtime, 'host-tools/pptSandbox.exe'), [policy], { cwd: root, windowsHide: true,
    env: { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, LOCALAPPDATA: process.env.LOCALAPPDATA, USERPROFILE: process.env.USERPROFILE, TEMP: root, TMP: root, PYTHONIOENCODING: 'utf-8', PATH: path.join(runtime, 'python') }, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr); child.stdin.on('error', () => {});
  child.on('spawn', () => console.log(`隔离探针宿主 PID：${child.pid}`));
  child.on('error', console.error);
  let fallback;
  const timer = setTimeout(() => { child.stdin.write('cancel\n'); fallback = setTimeout(() => child.kill(), 5000); }, 60000);
  child.on('close', (code, signal) => {
    clearTimeout(timer); clearTimeout(fallback); server.close();
    const result = fs.existsSync(resultFile) ? JSON.parse(fs.readFileSync(resultFile, 'utf8')) : null;
    const evidence = { code, signal, result, loopbackRequests: requests, layer: '真实 Windows AppContainer；无 Python 审计钩子' };
    fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify(evidence, null, 2), 'utf8');
    console.log(JSON.stringify(evidence));
    process.exitCode = code === 0 && result && Object.values(result.checks).every(Boolean) && requests === 0 ? 0 : 1;
  });
});
