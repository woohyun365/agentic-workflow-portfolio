import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import {
  createStatusCase,
  expectedPaths,
  statusCases,
} from '../agents/fixtures/codex-preflight/status-cases.mjs';
import { discoverScriptTests } from './repo-policy-test-files.mjs';

// Every real-Git oracle also verifies the actual CLI contract and read-only behavior.
for (const row of statusCases) {
  test(`Codex real Git status oracle: ${row.id}`, (t) => {
    const f = createStatusCase(t, row);
    const raw = f.git(['status', '--porcelain=v1', '-z', '--untracked-files=all']);
    assert.equal(raw, row.raw);
    const before = f.git(['diff', '--binary', 'HEAD']);
    const repository = f.summary().repository;
    assert.equal(repository.branch, 'fixture', 'scalar branch retains trim semantics');
    assert.equal(repository.head, f.git(['rev-parse', 'HEAD']).trim(), 'scalar SHA remains exact');
    assert.equal(repository.dirty, row.action !== 'clean');
    assert.equal(
      f.git(['status', '--porcelain=v1', '-z', '--untracked-files=all']),
      raw,
      'read-only CLI preserves status',
    );
    assert.equal(f.git(['diff', '--binary', 'HEAD']), before, 'read-only CLI preserves content');
    const actual = Object.fromEntries(
      Object.keys(expectedPaths(row)).map((key) => [key, repository[key]]),
    );
    assert.deepEqual(actual, expectedPaths(row));
    assert.deepEqual(repository.changes, row.raw ? [row.raw.split('\0')[0]] : []);
    assert.equal(repository.omittedChangeCount, 0);
  });
}

test('status regressions run in normal CI without duplicate fixture discovery', () => {
  const discovered = discoverScriptTests(resolve(import.meta.dirname, '../..'));
  assert.ok(discovered.some((file) => file.endsWith('codex-git-status.test.mjs')));
  assert.ok(!discovered.some((file) => file.startsWith('scripts/agents/fixtures/')));
});
