import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { discoverScriptTests } from './repo-policy-test-files.mjs';

const root = resolve(import.meta.dirname, '../..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const manifest = JSON.parse(read('package.json'));
const neutral = [
  'intake-policy',
  'domain-guide-registry',
  'plan-readiness-policy',
  'cross-model-handoff',
];
const codexTests = [
  'child-task-contract',
  'model-profiles',
  'model-run-evidence',
  'orchestration-policy',
  'routing-policy',
  'session-contract',
  'session-preflight',
  'subagent-lifecycle-contract',
  'intake-baseline',
  'intake-integration',
  'fresh-session',
  'git-status',
];
function files(directory) {
  return readdirSync(resolve(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    return entry.isDirectory() ? files(path) : [path];
  });
}
test('package commands identify their host and do not preserve obsolete aliases', () => {
  assert.equal(
    manifest.scripts['codex:preflight'],
    'node scripts/agents/codex/session-preflight.mjs --json',
  );
  assert.equal(manifest.scripts['codex:workflow'], 'node scripts/agents/codex/workflow-entry.mjs');
  assert.equal(manifest.scripts[['agent', 'preflight'].join(':')], undefined);
  assert.equal(manifest.scripts[['agent', 'codex', 'workflow'].join(':')], undefined);
  for (const [name, command] of Object.entries(manifest.scripts)) {
    const host = command.match(/scripts\/agents\/(codex|claude)\//)?.[1];
    if (host) assert.ok(name.startsWith(`${host}:`), name);
  }
  for (const [name, command] of Object.entries(manifest.scripts)) {
    if (!name.startsWith('claude:')) continue;
    const entry = command.match(/scripts\/agents\/claude\/[^ ]+\.mjs/)?.[0];
    assert.ok(
      entry && existsSync(resolve(root, entry)),
      'do not advertise an unimplemented host entry',
    );
  }
});
test('neutral modules have one common owner and no root compatibility re-export', async () => {
  for (const name of neutral) {
    assert.equal(existsSync(resolve(root, `scripts/agents/${name}.mjs`)), false);
    const module = await import(`../agents/common/${name}.mjs`);
    assert.ok(Object.keys(module).length, name);
  }
});
test('Codex regressions remain discoverable under host-explicit filenames', () => {
  const discovered = discoverScriptTests(root);
  for (const name of codexTests)
    assert.ok(discovered.includes(`scripts/ci/codex-${name}.test.mjs`), name);
  assert.ok(discovered.includes('scripts/ci/claude-subagent-model-routing.test.mjs'));
  assert.ok(discovered.includes('scripts/ci/cross-host-review-bridge.test.mjs'));
});
test('fixture names identify contracts rather than temporary plan stages', () => {
  const paths = [...files('scripts/agents/fixtures'), ...files('scripts/ci/fixtures')];
  assert.deepEqual(
    paths.filter((path) => /(?:^|[/-])(?:phase\d+|h\d+)(?:[/.\-]|$)/iu.test(path)),
    [],
  );
  assert.ok(paths.includes('scripts/agents/fixtures/codex-preflight/disposable-preflight.mjs'));
  assert.ok(paths.includes('scripts/agents/fixtures/workflow-contract/graph-cases.json'));
  assert.ok(paths.includes('scripts/ci/fixtures/claude-subagent-model-qualification-matrix.json'));
  assert.ok(paths.includes('scripts/ci/fixtures/cross-host-review-qualification-matrix.json'));
  assert.deepEqual(
    paths.filter((path) => path.endsWith(['expected', 'red', 'probes.mjs'].join('-'))),
    [],
  );
});
test('tracked instruction callers use current host commands', () => {
  for (const path of ['AGENTS.md', ...files('docs/development')].filter((path) =>
    path.endsWith('.md'),
  )) {
    const source = read(path);
    for (const retired of [
      ['agent', 'preflight'].join(':'),
      ['agent', 'codex', 'workflow'].join(':'),
    ]) {
      assert.equal(source.includes(retired), false, `${path}: ${retired}`);
    }
  }
  assert.match(read('AGENTS.md'), /codex:preflight/);
  assert.match(read('docs/development/agent-workflows/session-continuity.md'), /codex:preflight/);
});
test('renamed workflow command forwards package arguments to the actual entry', () => {
  const [binary, ...args] = (manifest.scripts['codex:workflow'] ?? '').split(' ');
  assert.equal(binary, 'node');
  const result = spawnSync(
    process.execPath,
    [...args, '--', '--request', 'API 코드 역할을 설명해줘.', '--mode', 'fresh', '--json'],
    { cwd: root, encoding: 'utf8', timeout: 10000 },
  );
  assert.equal(result.status, 0, result.stderr);
  const workflow = JSON.parse(result.stdout);
  assert.equal(workflow.host, 'codex');
  assert.equal(workflow.dispatchAuthorized, false);
});
