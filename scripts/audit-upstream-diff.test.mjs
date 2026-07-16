import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAuditReport, isProtectedPath } from './audit-upstream-diff.mjs';

const manifest = {
  protected_paths: [{ path: 'client/electron/services/licenseService.cjs', reason: '授权', owner: 'client', required_adr: 'ADR-0002' }],
  capabilities: { adopted: [{ id: 'runtime', local_files: ['client/electron/preload.cjs'] }] },
};

test('受保护路径命中要求人工审查', () => {
  const report = buildAuditReport({
    base: 'main', head: 'upstream-main', mergeBase: 'abc', counts: { base: 1, head: 2 },
    files: [{ status: 'M', file: 'client/electron/services/licenseService.cjs' }], manifest,
  });
  assert.equal(report.protected_path_hits.length, 1);
  assert.equal(report.recommended_action, 'review');
  assert.equal(isProtectedPath('client/electron/services/licenseService.cjs', manifest.protected_paths), true);
});

test('非保护路径作为候选能力报告', () => {
  const report = buildAuditReport({
    base: 'main', head: 'upstream-main', mergeBase: 'abc', counts: { base: 0, head: 1 },
    files: [{ status: 'A', file: 'client/electron/preload.cjs' }], manifest,
  });
  assert.deepEqual(report.adopted_capability_changes, ['runtime']);
  assert.deepEqual(report.new_capability_candidates, ['client/electron/preload.cjs']);
});
