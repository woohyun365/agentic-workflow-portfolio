import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  assessCodexReviewAdmission,
  buildCodexReviewCommand,
  createCodexReviewBinding,
} from '../agents/codex/review-bridge.mjs';

const corpus = JSON.parse(
  readFileSync(resolve(import.meta.dirname, 'fixtures/cross-model-handoff-cases.json'), 'utf8'),
);
const cwd = resolve(import.meta.dirname, '../..');
const digests = {
  sourceDigest: `sha256:${'a'.repeat(64)}`,
  configDigest: `sha256:${'b'.repeat(64)}`,
  roleDigest: `sha256:${'c'.repeat(64)}`,
};

function codexPacket() {
  const packet = structuredClone(corpus.basePacket);
  packet.intent.direction = 'claude-maker-codex-checker';
  packet.lifecycle.transport = 'cli';
  packet.lifecycle.support = 'unknown';
  return packet;
}

function bindingFor(packet = codexPacket()) {
  return createCodexReviewBinding({
    invocationId: 'invoke-h3p-codex-001',
    packet,
    cwd,
    executable: 'codex',
    ...digests,
  });
}

function admissionFor(packet = codexPacket(), binding = bindingFor(packet), patch = {}) {
  return assessCodexReviewAdmission({
    packet,
    binding,
    currentSnapshot: structuredClone(packet.snapshot),
    currentSourceDigest: digests.sourceDigest,
    currentConfigDigest: digests.configDigest,
    currentRoleDigest: digests.roleDigest,
    seenInvocationIds: [],
    ambientCredentialKeys: [],
    providerDispatchEnabled: false,
    ...patch,
  });
}

test('Codex CLI review binding is immutable, exact-model, read-only and live-unqualified', () => {
  const packet = codexPacket();
  const binding = bindingFor(packet);

  assert.equal(binding.schemaVersion, 'cross-host-review-binding/v1');
  assert.equal(binding.packetId, packet.packetId);
  assert.equal(binding.dispatchId, packet.lifecycle.dispatchId);
  assert.equal(binding.host, 'codex');
  assert.equal(binding.transport, 'direct-cli');
  assert.equal(binding.role, 'top-level-read-only-reviewer');
  assert.equal(binding.projectRoleClaim, 'unqualified');
  assert.equal(binding.requestedModel, 'gpt-6-astra');
  assert.equal(binding.expectedResolvedModel, 'unknown');
  assert.equal(binding.sandbox, 'read-only');
  assert.deepEqual(binding.allowedTools, ['repository-read', 'test-result-read']);
  assert.equal(binding.fallback, 'none');
  assert.equal(binding.applied, false);
  assert.equal(binding.runtimeQualification, 'not-run');
  assert.match(binding.bindingDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(Object.isFrozen(binding), true);
  assert.equal(Object.isFrozen(binding.allowedTools), true);

  const admission = admissionFor(packet, binding);
  assert.deepEqual(admission, {
    valid: true,
    decision: 'candidate',
    dispatchAllowed: false,
    bindingDigest: binding.bindingDigest,
    invocationId: binding.invocationId,
    host: 'codex',
    errors: [],
    liveChecks: [
      'context-isolation-observed',
      'transport-support-resolved',
      'codex-cli-authenticated',
      'codex-role-model-tools-observed',
      'real-provider-dispatch-qualified',
    ],
  });
  assert.equal(Object.isFrozen(admission), true);
  assert.equal(Object.isFrozen(admission.liveChecks), true);
});

test('Codex command is structured stdin, never shell text, and pins non-interactive denial controls', () => {
  const packet = codexPacket();
  const binding = bindingFor(packet);
  const built = buildCodexReviewCommand({ packet, binding });

  assert.equal(built.valid, true);
  assert.deepEqual(built.errors, []);
  assert.deepEqual(built.command, {
    executionClass: 'provider-cli',
    enabled: false,
    file: 'codex',
    args: [
      '-a',
      'never',
      '--no-daemon',
      'exec',
      '--model',
      'gpt-6-astra',
      '--sandbox',
      'read-only',
      '--cd',
      cwd,
      '--ephemeral',
      '--ignore-user-config',
      '--strict-config',
      '--json',
      '-',
    ],
    cwd,
    env: null,
    executableQualification: 'not-run',
    environmentQualification: 'not-run',
    shell: false,
    stdin: JSON.stringify({
      schemaVersion: 'cross-host-review-request/v1',
      mode: 'independent-read-only-review',
      constraints: {
        mutateWorkspace: false,
        delegateProvider: false,
        readCredentials: false,
        discloseRawTranscript: false,
        finalResultOnly: true,
      },
      packet,
    }),
  });
  assert.equal(Object.isFrozen(built), true);
  assert.equal(Object.isFrozen(built.command), true);
  assert.equal(Object.isFrozen(built.command.args), true);
  assert.equal(Object.isFrozen(built.command.env), true);
  assert.equal(built.command.args.includes('--dangerously-bypass-approvals-and-sandbox'), false);
  assert.equal(built.command.args.includes('--approve-for-me'), false);
  assert.equal(built.command.args.includes('--ignore-rules'), false);
  assert.equal(built.command.args.includes('--search'), false);
  assert.equal(built.command.args.includes(JSON.stringify(packet)), false);
});

test('Codex binding construction rejects the wrong host direction and unsafe or unknown identity', () => {
  const base = codexPacket();
  for (const mutate of [
    (packet, input) => {
      packet.intent.direction = 'codex-maker-claude-checker';
    },
    (packet) => {
      packet.lifecycle.transport = 'native';
      packet.lifecycle.support = 'supported';
    },
    (packet) => {
      packet.lifecycle.support = 'supported';
    },
    (packet) => {
      packet.boundaries.allowedTools.push('workspace-edit');
    },
    (packet, input) => {
      input.executable = '/tmp/unknown-codex';
    },
    (packet, input) => {
      input.cwd = 'relative/worktree';
    },
    (packet, input) => {
      input.roleDigest = 'unknown';
    },
    (packet, input) => {
      input.model = 'gpt-6-sol';
    },
  ]) {
    const packet = structuredClone(base);
    const input = {
      invocationId: 'invoke-h3p-codex-001',
      packet,
      cwd,
      executable: 'codex',
      ...digests,
    };
    mutate(packet, input);
    assert.throws(() => createCodexReviewBinding(input), TypeError);
  }
});

test('Codex static admission fails closed on forged, stale, duplicate, unknown or live-enabled state', () => {
  const packet = codexPacket();
  const binding = bindingFor(packet);
  const cases = [
    {
      name: 'forged-model',
      binding: { ...binding, requestedModel: 'gpt-6-sol' },
    },
    {
      name: 'forged-role',
      binding: { ...binding, role: 'repo_reviewer' },
    },
    {
      name: 'forged-sandbox',
      binding: { ...binding, sandbox: 'workspace-write' },
    },
    {
      name: 'fallback',
      binding: { ...binding, fallback: 'best-available' },
    },
    {
      name: 'claimed-applied',
      binding: { ...binding, applied: true },
    },
    {
      name: 'stale-snapshot',
      patch: { currentSnapshot: { ...packet.snapshot, headSHA: '9'.repeat(64) } },
    },
    {
      name: 'missing-snapshot',
      patch: { currentSnapshot: undefined },
    },
    {
      name: 'stale-source',
      patch: { currentSourceDigest: `sha256:${'d'.repeat(64)}` },
    },
    {
      name: 'stale-config',
      patch: { currentConfigDigest: `sha256:${'d'.repeat(64)}` },
    },
    {
      name: 'stale-role',
      patch: { currentRoleDigest: `sha256:${'d'.repeat(64)}` },
    },
    {
      name: 'duplicate',
      patch: { seenInvocationIds: [binding.invocationId] },
    },
    {
      name: 'missing-current-identity',
      patch: { currentRoleDigest: undefined },
    },
    {
      name: 'real-provider-toggle-cannot-qualify-H3P',
      patch: { providerDispatchEnabled: true },
    },
    {
      name: 'ambient-openai-api-key',
      patch: { ambientCredentialKeys: ['PATH', 'OPENAI_API_KEY'] },
    },
    {
      name: 'ambient-claude-token',
      patch: { ambientCredentialKeys: ['CLAUDE_CODE_OAUTH_TOKEN'] },
    },
    {
      name: 'credential-values-not-accepted',
      patch: { ambientCredentialKeys: ['OPENAI_API_KEY=secret'] },
    },
  ];

  for (const fixture of cases) {
    const result = admissionFor(packet, fixture.binding ?? binding, fixture.patch);
    assert.equal(result.valid, false, fixture.name);
    assert.equal(result.decision, 'refuse', fixture.name);
    assert.equal(result.dispatchAllowed, false, fixture.name);
    assert.equal(result.bindingDigest, null, fixture.name);
    assert.equal(result.invocationId, null, fixture.name);
    assert.equal(result.host, null, fixture.name);
    assert.ok(result.errors.length > 0, fixture.name);
  }
});

test('Codex command builder refuses packet/binding substitution and unknown fields', () => {
  const packet = codexPacket();
  const binding = bindingFor(packet);
  const substituted = structuredClone(packet);
  substituted.packetId = 'another-packet';
  const forged = { ...binding, packetId: 'another-packet' };

  for (const input of [
    { packet: substituted, binding },
    { packet, binding: forged },
    { packet, binding: { ...binding, bypass: true } },
  ]) {
    const result = buildCodexReviewCommand(input);
    assert.equal(result.valid, false);
    assert.equal(result.command, null);
    assert.ok(result.errors.length > 0);
  }
});
