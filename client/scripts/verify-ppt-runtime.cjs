const path = require('node:path');
async function verify(context) {
  if (context && context.electronPlatformName !== 'win32') return;
  const appDir = context?.appDir || path.resolve(__dirname, '..');
  const root = path.join(appDir, 'vendor/ppt-runtime/win32-x64');
  const runtime = require('../electron/services/pptRuntimeService.cjs').createPptRuntimeService({ app: { isPackaged: false }, rootOverride: root });
  await runtime.verify();
  console.log('Windows PPT 固定运行组件完整性校验通过');
}
module.exports = verify;
if (require.main === module) verify().catch((error) => { console.error(error.message); process.exitCode = 1; });
