const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const DEFAULT_OUTPUT_PATH = path.join(projectRoot, 'initial-admin.private.json');

function writeInitialAdminCredential({
  credentialJson = process.env.MANAGEMENT_INITIAL_ADMIN_CREDENTIAL_JSON,
  outputPath = DEFAULT_OUTPUT_PATH,
} = {}) {
  if (!credentialJson) {
    throw new Error('MANAGEMENT_INITIAL_ADMIN_CREDENTIAL_JSON_REQUIRED');
  }

  try {
    JSON.parse(credentialJson);
  } catch {
    throw new Error('MANAGEMENT_INITIAL_ADMIN_CREDENTIAL_JSON_INVALID');
  }

  fs.writeFileSync(outputPath, credentialJson, 'utf8');
  return outputPath;
}

if (require.main === module) {
  try {
    writeInitialAdminCredential();
    console.log('Temporary initial administrator credential created.');
  } catch (error) {
    console.error(`Temporary initial administrator credential creation failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  DEFAULT_OUTPUT_PATH,
  writeInitialAdminCredential,
};
