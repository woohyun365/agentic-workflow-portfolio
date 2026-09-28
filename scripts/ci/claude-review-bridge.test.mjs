import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  assessClaudeReviewAdmission,
  buildClaudeReviewCommand,
  createClaudeReviewBinding,
} from '../agents/claude/review-bridge.mjs';

const root = resolve(import.meta.dirname, '../..');
const fixtures = JSON.parse(
  readFileSync(resolve(root, 'scripts/ci/fixtures/cross-model-handoff-cases.json'), 'utf8'),
);
const digest = (character) => `sha256:${character.repeat(64)}`;

function packet() {
  const value = structuredClone(fixtures.basePacket);
  value.lifecycle.transport = 'cli';
  value.lifecycle.support = 'unknown';
  value.intent.direction = 'codex-maker-claude-checker';
  value.intent.modelIntent = 'claude-opus-independent-read-only-reviewer';
  return value;
}

function input() {
  return {
    invocationId: 'invocation-h3p-claude-001',
    packet: packet(),
    cwd: root,
    executable: 'claude',
    sourceDigest: digest('a'),
    configDigest: digest('b'),
    roleDigest: digest('c'),
  };
}

function binding() {
  const created = createClaudeReviewBinding(input());
  assert.equal(created.valid, true, created.errors.join('\n'));
  return created.binding;
}

test('Claude review binding is a finite default-off Opus project-reviewer candidate', () => {
  const created = createClaudeReviewBinding(input());

  assert.equal(created.valid, true, created.errors.join('\n'));
  assert.deepEqual(
    {
      host: created.binding.host,
      transport: created.binding.transport,
      role: created.binding.role,
      requestedModel: created.binding.requestedModel,
      expectedResolvedModel: created.binding.expectedResolvedModel,
      allowedTools: created.binding.allowedTools,
      mcpServers: created.binding.mcpServers,
      fallback: created.binding.fallback,
      applied: created.binding.applied,
      runtimeQualification: created.binding.runtimeQualification,
      restrictedProjectAgentLoading: created.binding.restrictedProjectAgentLoading,
    },
    {
      host: 'claude',
      transport: 'direct-cli',
      role: 'repo_reviewer',
      requestedModel: 'opus',
      expectedResolvedModel: 'unknown',
      allowedTools: ['Read', 'Grep', 'Glob'],
      mcpServers: [],
      fallback: 'none',
      applied: false,
      runtimeQualification: 'not-run',
      restrictedProjectAgentLoading: 'unresolved',
    },
  );
  assert.match(created.binding.bindingDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(Object.isFrozen(created.binding), true);
  assert.equal(Object.isFrozen(created.binding.allowedTools), true);
});

test('binding rejects non-CLI/wrong-direction packets, free-form execution and malformed identity', () => {
  const cases = [
    (value) => {
      value.packet.lifecycle.transport = 'native';
    },
    (value) => {
      value.packet.lifecycle.support = 'supported';
    },
    (value) => {
      value.packet.intent.direction = 'claude-maker-codex-checker';
    },
    (value) => {
      value.executable = 'claude --dangerously-skip-permissions';
    },
    (value) => {
      value.cwd = 'relative/repo';
    },
    (value) => {
      value.sourceDigest = 'unknown';
    },
    (value) => {
      value.model = 'sonnet';
    },
  ];

  for (const mutate of cases) {
    const value = input();
    mutate(value);
    const result = createClaudeReviewBinding(value);
    assert.equal(result.valid, false, JSON.stringify(value));
    assert.equal(result.binding, null);
  }
});

test('admission binds the current snapshot and rejects duplicates, stale facts and tampering', () => {
  const originalPacket = packet();
  const originalBinding = binding();
  const admitted = assessClaudeReviewAdmission({
    packet: originalPacket,
    binding: originalBinding,
    currentSnapshot: originalPacket.snapshot,
    currentSourceDigest: digest('a'),
    currentConfigDigest: digest('b'),
    currentRoleDigest: digest('c'),
    seenInvocationIds: [],
    ambientCredentialKeys: [],
  });

  assert.equal(admitted.valid, true, admitted.errors.join('\n'));
  assert.equal(admitted.admission.decision, 'candidate');
  assert.equal(admitted.admission.executed, false);
  assert.equal(admitted.admission.invocationId, originalBinding.invocationId);
  assert.equal(admitted.admission.bindingDigest, originalBinding.bindingDigest);
  assert.equal(admitted.admission.host, 'claude');
  assert.deepEqual(admitted.admission.liveChecks, [
    'claude-cli-authenticated',
    'opus-model-identity-observed',
    'repo-reviewer-role-loaded',
    'restricted-project-agent-loading-observed',
    'read-only-tool-boundary-observed',
  ]);

  for (const change of [
    { seenInvocationIds: [originalBinding.invocationId] },
    { seenInvocationIds: null },
    { seenInvocationIds: originalBinding.invocationId },
    { currentSourceDigest: digest('d') },
    { currentConfigDigest: digest('d') },
    { currentRoleDigest: digest('d') },
    {
      currentSnapshot: { ...originalPacket.snapshot, headSHA: 'f'.repeat(64) },
    },
    { currentSnapshot: undefined },
    {
      binding: { ...originalBinding, requestedModel: 'sonnet' },
    },
    {
      binding: { ...originalBinding, bindingDigest: digest('d') },
    },
    {
      binding: { ...originalBinding, invocationId: 'invocation-h3p-claude-tampered' },
    },
    {
      binding: { ...originalBinding, host: 'codex' },
    },
    { ambientCredentialKeys: ['ANTHROPIC_API_KEY'] },
    { ambientCredentialKeys: ['ANTHROPIC_AUTH_TOKEN'] },
    { ambientCredentialKeys: ['CLAUDE_CODE_OAUTH_TOKEN'] },
    { ambientCredentialKeys: 'ANTHROPIC_API_KEY' },
  ]) {
    const result = assessClaudeReviewAdmission({
      packet: originalPacket,
      binding: originalBinding,
      currentSnapshot: originalPacket.snapshot,
      currentSourceDigest: digest('a'),
      currentConfigDigest: digest('b'),
      currentRoleDigest: digest('c'),
      seenInvocationIds: [],
      ambientCredentialKeys: [],
      ...change,
    });
    assert.equal(result.valid, false, JSON.stringify(change));
    assert.equal(result.admission, null);
  }
});

test('command is structured argv/stdin, locked read-only, empty-MCP and never runtime-qualified', () => {
  const originalPacket = packet();
  const originalBinding = binding();
  const result = buildClaudeReviewCommand({ packet: originalPacket, binding: originalBinding });

  assert.equal(result.valid, true, result.errors.join('\n'));
  assert.equal(result.command.file, 'claude');
  assert.equal(result.command.cwd, root);
  assert.equal(result.command.shell, false);
  assert.equal(result.command.env, null);
  assert.equal(result.command.executableQualification, 'not-run');
  assert.equal(result.command.environmentQualification, 'not-run');
  assert.equal(result.command.stdin, `${JSON.stringify(originalPacket)}\n`);
  assert.deepEqual(result.command.args, [
    '--print',
    '--agent',
    'repo_reviewer',
    '--model',
    'opus',
    '--tools',
    'Read,Grep,Glob',
    '--allowedTools',
    'Read,Grep,Glob',
    '--restricted',
    '--strict-mcp-config',
    '--mcp-config',
    '{"mcpServers":{}}',
    '--permission-mode',
    'dontAsk',
    '--permission-prompts',
    'none',
    '--no-session-persistence',
    '--output-format',
    'json',
  ]);
  assert.equal(result.command.runtimeQualification, 'not-run');
  assert.equal(result.command.executionClass, 'provider-cli');
  assert.equal(result.command.enabled, false);
  assert.equal(result.command.applied, false);
  assert.equal(result.command.args.includes('--dangerously-skip-permissions'), false);
  assert.equal(result.command.args.includes('default'), false);
});

test('command build fails closed for a modified binding or packet', () => {
  const originalPacket = packet();
  const originalBinding = binding();
  for (const value of [
    { packet: { ...originalPacket, packetId: 'other-packet' }, binding: originalBinding },
    { packet: originalPacket, binding: { ...originalBinding, allowedTools: ['Read', 'Bash'] } },
    { packet: originalPacket, binding: { ...originalBinding, applied: true } },
  ]) {
    const result = buildClaudeReviewCommand(value);
    assert.equal(result.valid, false);
    assert.equal(result.command, null);
  }
});
