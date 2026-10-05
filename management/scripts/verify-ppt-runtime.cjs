const path = require('node:path');
async function verify(context) {
  if (context && context.electronPlatformName !== 'win32') return;
  const root = path.join(context?.appDir || path.resolve(__dirname, '..'), 'vendor/ppt-runtime/win32-x64');
  const runtime = require(path.join(root, 'host-tools/pptRuntimeService.cjs')).createPptRuntimeService({ app: { isPackaged: false }, rootOverride: root });
  await runtime.verify();
  console.log('管理端独立 PPT 预览组件完整性校验通过');
}
module.exports = verify;
if (require.main === module) verify().catch((error) => { console.error(error.message); process.exitCode = 1; });
