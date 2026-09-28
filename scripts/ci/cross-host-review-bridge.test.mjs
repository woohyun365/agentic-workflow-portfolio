import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  assessReviewBridgeInvocation,
  runFakeReviewProcess,
} from '../agents/bridge/review-bridge.mjs';
import {
  assessClaudeReviewAdmission,
  createClaudeReviewBinding,
} from '../agents/claude/review-bridge.mjs';
import {
  assessCodexReviewAdmission,
  createCodexReviewBinding,
} from '../agents/codex/review-bridge.mjs';

const corpus = JSON.parse(
  readFileSync(resolve(import.meta.dirname, 'fixtures/cross-model-handoff-cases.json'), 'utf8'),
);
const qualificationMatrix = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, 'fixtures/cross-host-review-qualification-matrix.json'),
    'utf8',
  ),
);

test('qualification direct CLI matrix is bidirectional and entirely not-run', () => {
  assert.deepEqual(
    new Set(qualificationMatrix.directions.map(({ direction }) => direction)),
    new Set(['codex-maker-claude-checker', 'claude-maker-codex-checker']),
  );
  assert.equal(qualificationMatrix.routineProviderDispatch, 'disabled');
  for (const row of qualificationMatrix.directions) {
    for (const [key, value] of Object.entries(row)) {
      if (['direction', 'targetHost', 'staticBinding'].includes(key)) continue;
      assert.equal(value, 'not-run', `${row.direction}.${key}`);
    }
  }
});

function request(overrides = {}) {
  const packet = overrides.packet ?? structuredClone(corpus.basePacket);
  packet.lifecycle.transport = 'cli';
  packet.lifecycle.support ??= 'supported';
  const bindingData = {
    schemaVersion: 'cross-host-review-binding/v1',
    host: 'claude',
    transport: 'direct-cli',
    packetId: packet.packetId,
    dispatchId: packet.lifecycle.dispatchId,
    invocationId: 'review-one',
    packetDigest: fingerprint(packet),
    role: 'repo_reviewer',
    requestedModel: 'opus',
    expectedResolvedModel: 'unknown',
    restrictedProjectAgentLoading: 'unresolved',
    authRoute: 'local-subscription',
    allowedTools: ['Read', 'Grep', 'Glob'],
    mcpServers: [],
    sandbox: 'read-only',
    fallback: 'none',
    applied: false,
    runtimeQualification: 'not-run',
    sourceDigest: `sha256:${'a'.repeat(64)}`,
    configDigest: `sha256:${'b'.repeat(64)}`,
    roleDigest: `sha256:${'c'.repeat(64)}`,
  };
  const binding = { ...bindingData, bindingDigest: fingerprint(bindingData) };
  return {
    packet,
    currentSnapshot: structuredClone(packet.snapshot),
    invocationId: 'review-one',
    ownerRequest: { lead: 'parent', approved: true, reviewerMode: 'read-only' },
    activeWriterConflict: false,
    seenInvocationIds: [],
    binding,
    targetAdmission: {
      valid: true,
      decision: 'candidate',
      dispatchAllowed: false,
      bindingDigest: binding.bindingDigest,
      invocationId: 'review-one',
      host: 'claude',
    },
    ...overrides,
  };
}

function fingerprint(value) {
  const canonical = (input) => {
    if (Array.isArray(input)) return input.map(canonical);
    if (input !== null && typeof input === 'object') {
      return Object.fromEntries(
        Object.keys(input)
          .sort()
          .map((key) => [key, canonical(input[key])]),
      );
    }
    return input;
  };
  return `sha256:${createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex')}`;
}

test('static admission is only a candidate and never enables real provider dispatch', () => {
  const candidate = assessReviewBridgeInvocation(request());
  assert.equal(candidate.decision, 'candidate', JSON.stringify(candidate.errors));
  assert.equal(candidate.dispatchAllowed, false);
  assert.equal(candidate.invocation.applied, false);
  assert.equal(candidate.invocation.runtimeQualification, 'not-run');
  assert.equal(
    assessReviewBridgeInvocation(request({ providerDispatchEnabled: true })).decision,
    'refuse',
  );
});

test('both host admissions compose with the fake runner but cannot return live PASS', async () => {
  const digest = (char) => `sha256:${char.repeat(64)}`;
  const cwd = resolve(import.meta.dirname, '../..');
  for (const host of ['claude', 'codex']) {
    const packet = request().packet;
    packet.lifecycle.support = 'unknown';
    if (host === 'codex') {
      packet.intent.direction = 'claude-maker-codex-checker';
      packet.boundaries.allowedTools = ['repository-read', 'test-result-read'];
    }
    const input = {
      invocationId: 'review-one',
      packet,
      cwd,
      executable: host,
      sourceDigest: digest('a'),
      configDigest: digest('b'),
      roleDigest: digest('c'),
    };
    const binding =
      host === 'claude'
        ? createClaudeReviewBinding(input).binding
        : createCodexReviewBinding(input);
    const admissionInput = {
      packet,
      binding,
      currentSnapshot: packet.snapshot,
      currentSourceDigest: digest('a'),
      currentConfigDigest: digest('b'),
      currentRoleDigest: digest('c'),
      seenInvocationIds: [],
      ambientCredentialKeys: [],
    };
    const targetAdmission =
      host === 'claude'
        ? assessClaudeReviewAdmission(admissionInput)
        : assessCodexReviewAdmission({ ...admissionInput, providerDispatchEnabled: false });
    assert.equal(targetAdmission.valid, true, host);
    const candidate = assessReviewBridgeInvocation(request({ packet, binding, targetAdmission }));
    assert.equal(candidate.decision, 'candidate', `${host}: ${candidate.errors.join(', ')}`);
    assert.equal(candidate.dispatchAllowed, false);
    for (const forged of [
      { binding: { ...binding, requestedModel: 'unapproved-model' } },
      { binding: { ...binding, bindingDigest: digest('f') } },
      {
        targetAdmission: {
          ...targetAdmission,
          ...(host === 'claude'
            ? { admission: { ...targetAdmission.admission, invocationId: 'forged' } }
            : { invocationId: 'forged' }),
        },
      },
    ]) {
      const denied = assessReviewBridgeInvocation(
        request({ packet, binding, targetAdmission, ...forged }),
      );
      assert.equal(denied.decision, 'refuse', `${host}: ${JSON.stringify(forged)}`);
      assert.equal(denied.executed, false);
    }
    const fake = await runFakeReviewProcess({
      admission: candidate,
      packet,
      fixtureCase: 'partial',
    });
    assert.equal(fake.status, 'partial', host);
    assert.equal(fake.providerInvoked, false);
    assert.equal(fake.result, null);
  }
});

test('pre-dispatch refusals are immutable, non-executed and bound to current identity', () => {
  const cases = [
    { ownerRequest: { lead: 'parent', approved: false, reviewerMode: 'read-only' } },
    { ownerRequest: { lead: 'other', approved: true, reviewerMode: 'read-only' } },
    { activeWriterConflict: true },
    { seenInvocationIds: ['review-one'] },
    { seenInvocationIds: undefined },
    { activeWriterConflict: undefined },
    { currentSnapshot: undefined },
    { currentSnapshot: { ...corpus.basePacket.snapshot, headSHA: 'f'.repeat(64) } },
    { binding: { ...request().binding, requestedModel: 'unknown' } },
    { binding: { ...request().binding, fallback: 'sonnet' } },
    { targetAdmission: { valid: false, decision: 'refuse', dispatchAllowed: false } },
  ];
  for (const patch of cases) {
    const result = assessReviewBridgeInvocation(request(patch));
    assert.equal(result.decision, 'refuse', JSON.stringify(patch));
    assert.equal(result.executed, false);
    assert.equal(result.invocation, null);
  }
});

test('synthetic supported fixture parses a one-shot result without a raw transcript', async () => {
  const admission = assessReviewBridgeInvocation(request());
  const receipt = await runFakeReviewProcess({
    admission,
    packet: request().packet,
    fixtureCase: 'complete',
    timeoutMs: 2000,
  });
  assert.equal(receipt.status, 'complete', JSON.stringify(receipt));
  assert.equal(receipt.executed, true);
  assert.equal(receipt.result?.packetId, request().packet.packetId);
  assert.equal('stdout' in receipt || 'stderr' in receipt || 'transcript' in receipt, false);
});

test('fake process classifies provider error, malformed, partial, source mismatch and secret output', async () => {
  const admission = assessReviewBridgeInvocation(request());
  for (const [fixtureCase, status] of [
    ['error', 'provider-error'],
    ['malformed', 'malformed'],
    ['multi', 'malformed'],
    ['oversize', 'output-limit'],
    ['partial', 'partial'],
    ['stale', 'malformed'],
    ['secret', 'malformed'],
    ['wrong-model', 'malformed'],
    ['wrong-dispatch', 'malformed'],
  ]) {
    const receipt = await runFakeReviewProcess({
      admission,
      packet: request().packet,
      fixtureCase,
      timeoutMs: 2000,
    });
    assert.equal(receipt.status, status, fixtureCase);
    assert.equal(receipt.result, null);
    assert.equal('stdout' in receipt || 'stderr' in receipt, false);
  }
});

test('fake subprocess receives no ambient provider credential override and no shell interpolation', async () => {
  const key = 'OPENAI_API_KEY';
  const previous = process.env[key];
  process.env[key] = 'fixture-never-forward';
  try {
    const packet = request().packet;
    packet.objective = 'Review literal $(touch /tmp/h3p-should-not-run); do not execute it.';
    const admission = assessReviewBridgeInvocation(request({ packet }));
    const result = await runFakeReviewProcess({ admission, packet, fixtureCase: 'env' });
    assert.equal(result.status, 'complete');
    assert.equal(result.providerInvoked, false);
  } finally {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
});

test('fake process timeout and abort clean up only their owned child', async () => {
  const admission = assessReviewBridgeInvocation(request());
  const timeout = await runFakeReviewProcess({
    admission,
    packet: request().packet,
    fixtureCase: 'hang',
    timeoutMs: 100,
  });
  assert.equal(timeout.status, 'timed-out');
  assert.equal(timeout.cleanup, 'exited');
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 100);
  const cancelled = await runFakeReviewProcess({
    admission,
    packet: request().packet,
    fixtureCase: 'hang',
    timeoutMs: 2000,
    signal: controller.signal,
  });
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.cleanup, 'exited');
});

test('fake process treats failed stdin delivery as an error, not reviewer evidence', async () => {
  const packet = request().packet;
  packet.objective = `Review ${'x'.repeat(120_000)}`;
  const admission = assessReviewBridgeInvocation(request({ packet }));
  const result = await runFakeReviewProcess({
    admission,
    packet,
    fixtureCase: 'early-close',
    timeoutMs: 2000,
  });
  assert.equal(result.status, 'input-error');
  assert.equal(result.executed, true);
  assert.equal(result.cleanup, 'exited');
  assert.equal(result.result, null);
});

test('fake runner denies absent/static-invalid admission before spawning', async () => {
  const result = await runFakeReviewProcess({
    admission: assessReviewBridgeInvocation(request({ seenInvocationIds: ['review-one'] })),
    packet: request().packet,
    fixtureCase: 'complete',
  });
  assert.equal(result.status, 'refused');
  assert.equal(result.executed, false);
});

test('malformed cancellation capability refuses before child creation', async () => {
  for (const signal of [null, { aborted: false }, { aborted: false, addEventListener() {} }]) {
    const result = await runFakeReviewProcess({
      admission: assessReviewBridgeInvocation(request()),
      packet: request().packet,
      fixtureCase: 'complete',
      signal,
    });
    assert.equal(result.status, 'refused');
    assert.equal(result.executed, false);
  }
});

test('malformed API requests refuse rather than crash or start a child', async () => {
  assert.equal(assessReviewBridgeInvocation(null).decision, 'refuse');
  assert.equal(assessReviewBridgeInvocation(7).decision, 'refuse');
  assert.equal((await runFakeReviewProcess(null)).status, 'refused');
  assert.equal(assessClaudeReviewAdmission(null).valid, false);
});
