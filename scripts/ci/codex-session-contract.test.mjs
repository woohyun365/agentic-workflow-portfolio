import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  parseContextContract,
  parsePriorityPointer,
  validateContextContract,
} from '../agents/codex/session-contract.mjs';

const repoRoot = resolve(import.meta.dirname, '../..');

test('tracked fixture satisfies the bounded resume contract used by local checkpoints', () => {
  const source = readFileSync(
    resolve(repoRoot, 'scripts/ci/fixtures/codex-session-context.valid.md'),
    'utf8',
  );
  const result = parseContextContract(source);

  assert.equal(result.valid, true, result.errors.join('\n'));
});

test('priority pointer stays compact and points to a bounded context snapshot', () => {
  const pointer = JSON.stringify({
    task: 'agent-guidance-phase7',
    branch: 'issue/example',
    head: 'de2e1be8',
    contextPath: '.omx/context/agent-guidance-phase7-20260813T013053Z.md',
    nextAction: 'Implement Phase 7-2.',
    blocker: null,
  });
  const result = parsePriorityPointer(pointer);

  assert.equal(result.valid, true, result.errors.join('\n'));
  assert.ok(Buffer.byteLength(pointer) <= 500);
});

test('checkpoint validation rejects forbidden, malformed, and expired state', () => {
  const base = {
    schemaVersion: 1,
    taskSlug: 'agent-guidance',
    objective: 'Resume safely',
    latestUserRequest: 'Continue the active phase',
    branch: 'issue/example',
    head: 'de2e1be8',
    workingTreeSummary: [],
    activePlan: '.omx/plans/example.md',
    currentPhase: 'Phase 1',
    planStatus: 'in-progress',
    completed: [],
    nextActions: [],
    blockers: [],
    decisions: [],
    rejectedAlternatives: [],
    relevantFiles: [],
    doNotTouch: [],
    verification: [],
    knownFailures: [],
    createdAt: '2026-08-13T00:00:00Z',
    expiresAt: '2026-08-14T00:00:00Z',
  };

  assert.equal(
    validateContextContract({ ...base, token: 'forbidden' }, new Date('2026-08-13T01:00:00Z'))
      .valid,
    false,
  );
  assert.equal(
    validateContextContract({ ...base, completed: 'done' }, new Date('2026-08-13T01:00:00Z')).valid,
    false,
  );
  assert.equal(validateContextContract({ ...base }, new Date('2026-08-15T01:00:00Z')).valid, false);
});

test('parsers reject non-object and wrong-type input without throwing or echoing values', () => {
  const source = readFileSync(
    resolve(repoRoot, 'scripts/ci/fixtures/codex-session-context.valid.md'),
    'utf8',
  );
  const base = parseContextContract(source).value;
  for (const value of [null, [], 12, true, 'value']) {
    assert.equal(validateContextContract(value).valid, false);
    assert.equal(parseContextContract(`\`\`\`json\n${JSON.stringify(value)}\n\`\`\``).valid, false);
    assert.equal(parsePriorityPointer(JSON.stringify(value)).valid, false);
  }
  for (const value of [12, {}, []]) {
    assert.equal(parsePriorityPointer(value).valid, false);
    assert.equal(parseContextContract(value).valid, false);
  }
  for (const patch of [
    { taskSlug: {} },
    { head: [] },
    { createdAt: 1 },
    { expiresAt: false },
    { activePlan: null },
    { relevantFiles: 'README.md' },
  ]) {
    assert.equal(validateContextContract({ ...base, ...patch }).valid, false);
  }
  assert.deepEqual(parsePriorityPointer(''), {
    exists: false,
    valid: true,
    value: null,
    errors: [],
  });
});

test('context parser uses injected time while preserving absolute expiry and structural task/path independence', () => {
  const source = readFileSync(
    resolve(repoRoot, 'scripts/ci/fixtures/codex-session-context.valid.md'),
    'utf8',
  );
  const value = { ...parseContextContract(source).value, expiresAt: '2026-08-14T00:00:00Z' };
  const markdown = `\`\`\`json\n${JSON.stringify(value)}\n\`\`\``;
  assert.equal(parseContextContract(markdown, new Date('2026-08-13T00:00:00Z')).valid, true);
  assert.equal(parseContextContract(markdown, new Date('2026-08-14T00:00:00Z')).valid, false);
  assert.equal(value.taskSlug, 'fixture-task');
  assert.equal(value.activePlan, '.omx/plans/fixture.md');
});
