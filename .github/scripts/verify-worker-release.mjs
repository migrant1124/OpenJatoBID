import crypto from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function encodeLicenseHeader(license) {
  return Buffer.from(JSON.stringify(license), 'utf8').toString('base64url');
}

async function responseSha256(response) {
  const hash = crypto.createHash('sha256');
  let size = 0;
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Worker download response has no body.');
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    hash.update(value);
  }
  return { size, sha256: hash.digest('hex') };
}

export async function verifyWorkerRelease({ baseUrl, license, version, fetchImpl = fetch }) {
  const origin = String(baseUrl || '').replace(/\/+$/, '');
  const health = await fetchImpl(`${origin}/health`, { headers: { 'User-Agent': 'jatobid-release-check' } });
  if (!health.ok) throw new Error(`Worker health check failed: ${health.status}`);

  const latestResponse = await fetchImpl(`${origin}/updates/latest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'jatobid-release-check' },
    body: JSON.stringify({ license }),
  });
  if (!latestResponse.ok) throw new Error(`Worker latest check failed: ${latestResponse.status}`);
  const latest = await latestResponse.json();
  const release = latest?.release;
  if (release?.version !== version || !Array.isArray(release?.files) || release.files.length !== 3) {
    throw new Error(`Worker latest version does not match ${version}.`);
  }
  const exe = release.files.find((file) => file.name === `Jato-AI-BID-${version}-win-x64.exe`);
  if (!exe || !/^[0-9a-f]{64}$/i.test(String(exe.sha256 || '')) || Number(exe.size) <= 0) {
    throw new Error('Worker latest response is missing valid EXE size or SHA-256 metadata.');
  }
  const downloadUrl = new URL(exe.url);
  if (downloadUrl.origin !== new URL(origin).origin || downloadUrl.searchParams.has('license')) {
    throw new Error('Worker download URL must stay on the Worker origin and must not contain a license parameter.');
  }

  const downloadResponse = await fetchImpl(downloadUrl, {
    headers: {
      'User-Agent': 'jatobid-release-check',
      'X-Jato-License': encodeLicenseHeader(license),
    },
  });
  if (!downloadResponse.ok) throw new Error(`Worker download check failed: ${downloadResponse.status}`);
  const downloaded = await responseSha256(downloadResponse);
  if (downloaded.size !== Number(exe.size) || downloaded.sha256 !== exe.sha256.toLowerCase()) {
    throw new Error('Worker download does not match latest size and SHA-256 metadata.');
  }
  return { version, fileName: exe.name, ...downloaded };
}

async function main() {
  const baseUrl = String(process.env.UPDATE_WORKER_BASE_URL || 'https://bidupdat.migrant1124.workers.dev').trim();
  const version = String(process.env.RELEASE_VERSION || '').trim();
  const licenseText = String(process.env.JATOBID_UPDATE_TEST_LICENSE_JSON || '').trim();
  if (!version) throw new Error('RELEASE_VERSION is required.');
  if (!licenseText) throw new Error('JATOBID_UPDATE_TEST_LICENSE_JSON is required for Worker release verification.');
  const result = await verifyWorkerRelease({ baseUrl, version, license: JSON.parse(licenseText) });
  console.log(`Verified Worker release ${result.version}: ${result.fileName}, ${result.size} bytes, SHA-256 ${result.sha256}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exit(1);
  });
}
