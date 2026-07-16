const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { validateChartDsl } = require('./chartDslValidator.cjs');

const DIAGNOSTIC_IDS = ['app-version', 'build-attestation', 'workspace-db', 'lan-license', 'lan-server', 'update-latest', 'update-download-auth', 'text-model', 'image-model', 'local-parser', 'mineru', 'opencode', 'agent-tools', 'agent-run', 'mermaid-render', 'chart-dsl', 'legacy-html', 'word-export', 'system-fonts', 'storage', 'network'];
const SKIPPED_IDS = new Set(['build-attestation', 'workspace-db', 'lan-license', 'lan-server', 'update-latest', 'update-download-auth', 'text-model', 'image-model', 'local-parser', 'mineru', 'opencode', 'agent-tools', 'agent-run', 'legacy-html', 'word-export', 'system-fonts', 'network']);

function result(id, status, message, impact = '', action = '') {
  return { id, status, message, impact, action, checked_at: new Date().toISOString(), duration_ms: 0 };
}

function createSystemDiagnosticsService({ app, configStore, localImageRenderService }) {
  const subscribers = new Set();
  let last = { status: 'idle', checked_at: '', results: [] };
  let cancelled = false;
  const emit = () => { for (const subscriber of subscribers) subscriber(last); };

  async function runOne(id, options = {}) {
    if (!DIAGNOSTIC_IDS.includes(id)) throw new Error(`未知诊断项：${id}`);
    const started = Date.now();
    let item;
    if (cancelled) item = result(id, 'cancelled', '诊断已取消');
    else if (id === 'app-version') item = result(id, app?.getVersion?.() ? 'ok' : 'error', app?.getVersion?.() ? `运行时版本：${app.getVersion()}` : '无法读取应用版本', '版本信息不可核验', '重新启动应用后重试');
    else if (id === 'mermaid-render') {
      try {
        if (!localImageRenderService?.renderMermaidToPng) throw new Error('本地渲染组件未初始化');
        const rendered = await localImageRenderService.renderMermaidToPng('flowchart TD\nA[开始] --> B[完成]', { timeoutMs: 30000 });
        item = result(id, rendered.buffer?.length ? 'ok' : 'error', `本地 Mermaid 渲染成功：${rendered.width}×${rendered.height}`);
      } catch (error) { item = result(id, 'error', `本地 Mermaid 渲染失败：${String(error.message || error).slice(0, 180)}`, 'Mermaid 图片与 Word 导出可能失败', '检查本地转图组件与系统资源'); }
    } else if (id === 'chart-dsl') {
      const spec = { schema_version: 1, chart_type: 'table', title: '诊断图表', theme: 'jato-business', layout: { width: 1240, density: 'normal', orientation: 'landscape' }, data: { columns: ['状态'], rows: [['正常']] } };
      item = result(id, validateChartDsl(spec).valid ? 'ok' : 'error', validateChartDsl(spec).valid ? '结构化图表 DSL Schema 有效' : '结构化图表 DSL Schema 无效', '新图表无法生成', '检查 DSL Schema 与编译器');
    } else if (id === 'storage') {
      try {
        const directory = app?.getPath?.('userData') || os.tmpdir();
        const stat = fs.statfsSync(directory);
        item = result(id, 'ok', `用户数据盘可用空间约 ${Math.floor((stat.bavail * stat.bsize) / 1024 / 1024)} MiB`);
      } catch { item = result(id, 'warning', '无法读取本地存储空间', '空间不足时导出或转图可能失败', '检查磁盘状态'); }
    } else if (id === 'legacy-html') item = result(id, 'skipped', '仅在检测到历史 HTML 配图时执行沙箱渲染');
    else if (SKIPPED_IDS.has(id)) item = result(id, options.full ? 'not-configured' : 'skipped', options.full ? '该能力需要单独配置或人工确认' : '快速诊断不执行外部或收费检查');
    else item = result(id, 'skipped', '未配置诊断实现');
    item.duration_ms = Date.now() - started;
    return item;
  }

  async function runAll(options = {}) {
    cancelled = false;
    last = { status: 'running', checked_at: new Date().toISOString(), results: [] };
    emit();
    for (const id of DIAGNOSTIC_IDS) {
      const item = await runOne(id, options);
      last = { ...last, results: [...last.results, item] };
      emit();
      if (cancelled) break;
    }
    const statuses = last.results.map((item) => item.status);
    last = { ...last, status: statuses.includes('error') ? 'error' : statuses.includes('warning') ? 'warning' : 'ok', checked_at: new Date().toISOString() };
    emit();
    return last;
  }

  function exportReport(format = 'json') {
    const report = { ...last, app_version: app?.getVersion?.() || '', platform: process.platform, renderer: localImageRenderService?.getDiagnostics?.() || {} };
    const directory = app?.getPath?.('downloads') || os.tmpdir();
    fs.mkdirSync(directory, { recursive: true });
    const extension = format === 'markdown' ? 'md' : 'json';
    const filePath = path.join(directory, `jato-system-diagnostics-${Date.now()}.${extension}`);
    const content = format === 'markdown'
      ? `# Jato 系统诊断\n\n- 总体状态：${report.status}\n- 应用版本：${report.app_version || '未知'}\n\n${report.results.map((item) => `- **${item.id}**：${item.status}，${item.message}`).join('\n')}\n`
      : JSON.stringify(report, null, 2);
    fs.writeFileSync(filePath, content, 'utf8');
    return { success: true, path: filePath };
  }

  return { getLast: () => last, runAll, runOne: async (id, options) => { const item = await runOne(id, options); last = { status: item.status, checked_at: item.checked_at, results: [item] }; emit(); return last; }, cancel: () => { cancelled = true; }, exportReport, subscribe: (callback) => { subscribers.add(callback); return () => subscribers.delete(callback); } };
}

module.exports = { DIAGNOSTIC_IDS, createSystemDiagnosticsService };
