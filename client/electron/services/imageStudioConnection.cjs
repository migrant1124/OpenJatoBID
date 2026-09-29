const BASE_URL = 'https://img-api.jlaudeapi.com/v1';

function createImageStudioConnection(configStore) {
  function readKey() {
    return String(configStore.load().image_model_profiles?.jinlong?.api_key || '').trim();
  }
  function status() {
    return { provider: 'jinlong', baseUrl: BASE_URL, configured: Boolean(readKey()), channelVerified: false };
  }
  return { readKey, status };
}

module.exports = { BASE_URL, createImageStudioConnection };
