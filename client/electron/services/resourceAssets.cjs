const fs = require('node:fs');
const assets = new Map();
function registerResourceAsset(assetId, filePath) {
  if (!/^[a-f0-9]{64}$/.test(assetId)) throw new Error('受管资源ID无效');
  assets.set(assetId, fs.realpathSync(filePath));
  return `yibiao-asset://managed-resources/${assetId}`;
}
function resolveResourceAsset(assetId) { return assets.get(assetId) || null; }
module.exports = { registerResourceAsset, resolveResourceAsset };
