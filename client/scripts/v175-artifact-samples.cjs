const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, nativeImage } = require('electron');
const { initLocalImageRenderService } = require('../electron/services/localImageRenderService.cjs');

const output = path.resolve(__dirname, '../../docs/secondary-development/changes/v1.7.5-workspace-flow-enhancement/artifacts');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'jato-v175-samples-'));
app.setPath('userData', scratch);
app.on('window-all-closed', () => {});

function chart(chartType, nodes, edges) {
  return { schema_version: 1, chart_type: chartType, title: chartType === 'process' ? '合成项目流程示例' : '合成项目组织示例',
    theme: 'jato-business', layout: { width: 1240, density: 'normal', orientation: 'landscape' }, data: { nodes, edges } };
}

app.whenReady().then(async () => {
  const renderer = initLocalImageRenderService({ app, configStore: { load: () => ({ local_rendering: {} }) } });
  try {
    fs.mkdirSync(output, { recursive: true });
    const samples = [
      ['synthetic-process-16x9.png', chart('process', [
        { id: 'start', label: '资料核对' }, { id: 'a', label: '技术复核' }, { id: 'b', label: '商务复核' },
      ], [{ from: 'start', to: 'a', label: '分支一' }, { from: 'start', to: 'b', label: '分支二' }]), 720],
      ['synthetic-organization-4x3.png', chart('organization', [
        { id: 'leader', label: '项目负责人' }, { id: 'tech', label: '技术组' }, { id: 'quality', label: '质量组' },
      ], [{ from: 'leader', to: 'tech' }, { from: 'leader', to: 'quality' }]), 960],
    ];
    for (const [fileName, spec, height] of samples) {
      const result = await renderer.renderChartToPng(spec, { width: 1280, fixedHeight: height });
      if (!result.buffer || result.layout_issues?.length) throw new Error(`${fileName}: ${(result.layout_issues || []).join('；')}`);
      const size = nativeImage.createFromBuffer(result.buffer).getSize();
      if (size.width !== 2560 || size.height !== height * 2) throw new Error(`${fileName}: ${size.width}×${size.height}`);
      fs.writeFileSync(path.join(output, fileName), result.buffer);
      process.stdout.write(`${fileName}: ${size.width}x${size.height}\n`);
    }
  } finally {
    renderer.dispose();
    app.quit();
  }
}).catch((error) => { process.stderr.write(`${error.stack || error}\n`); app.exit(1); });
