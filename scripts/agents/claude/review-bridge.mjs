import { createHash } from 'node:crypto';
import { isAbsolute, normalize, parse } from 'node:path';

import { validateCrossModelPacket } from '../common/index.mjs';

const SCHEMA_VERSION = 'cross-host-review-binding/v1';
const HOST = 'claude';
const TRANSPORT = 'direct-cli';
const ROLE = 'repo_reviewer';
const ROLE_DEFINITION = '.claude/agents/repo_reviewer.md';
const MODEL = 'opus';
const ALLOWED_TOOLS = Object.freeze(['Read', 'Grep', 'Glob']);
const LIVE_CHECKS = Object.freeze([
  'claude-cli-authenticated',
  'opus-model-identity-observed',
  'repo-reviewer-role-loaded',
  'restricted-project-agent-loading-observed',
  'read-only-tool-boundary-observed',
]);
const INPUT_FIELDS = new Set([
  'invocationId',
  'packet',
  'cwd',
  'executable',
  'sourceDigest',
  'configDigest',
  'roleDigest',
]);
const BINDING_FIELDS = new Set([
  'schemaVersion',
  'bindingDigest',
  'invocationId',
  'packetId',
  'dispatchId',
  'packetDigest',
  'host',
  'transport',
  'executableIdentity',
  'executable',
  'cwd',
  'role',
  'roleDefinition',
  'requestedModel',
  'expectedResolvedModel',
  'modelSource',
  'allowedTools',
  'mcpServers',
  'sandbox',
  'authRoute',
  'fallback',
  'sourceDigest',
  'configDigest',
  'roleDigest',
  'applied',
  'runtimeQualification',
  'restrictedProjectAgentLoading',
  'knownGaps',
]);
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const ID = /^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$/u;
const AUTH_ENV_OVERRIDES = new Set([
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN',
]);

export function createClaudeReviewBinding(input) {
  const errors = [];
  if (!isRecord(input)) return invalid('binding input must be an object.', 'binding');
  rejectUnknown(input, INPUT_FIELDS, 'binding input', errors);
  const { invocationId, packet, cwd, executable, sourceDigest, configDigest, roleDigest } = input;
  requireId(invocationId, 'invocationId', errors);
  validatePacket(packet, errors);
  requireCwd(cwd, errors);
  requireExecutable(executable, errors);
  requireDigest(sourceDigest, 'sourceDigest', errors);
  requireDigest(configDigest, 'configDigest', errors);
  requireDigest(roleDigest, 'roleDigest', errors);
  if (errors.length > 0) return outcome(errors, 'binding', null);

  const data = {
    schemaVersion: SCHEMA_VERSION,
    invocationId,
    packetId: packet.packetId,
    dispatchId: packet.lifecycle.dispatchId,
    packetDigest: hash(packet),
    host: HOST,
    transport: TRANSPORT,
    executableIdentity: 'claude',
    executable,
    cwd,
    role: ROLE,
    roleDefinition: ROLE_DEFINITION,
    requestedModel: MODEL,
    expectedResolvedModel: 'unknown',
    modelSource: 'lead-fixed-h3p-policy',
    allowedTools: [...ALLOWED_TOOLS],
    mcpServers: [],
    sandbox: 'read-only',
    authRoute: 'local-subscription',
    fallback: 'none',
    sourceDigest,
    configDigest,
    roleDigest,
    applied: false,
    runtimeQualification: 'not-run',
    restrictedProjectAgentLoading: 'unresolved',
    knownGaps: [
      'Claude CLI authentication has not been observed.',
      'The resolved Opus model identity has not been observed.',
      '--restricted project-agent loading has not been observed.',
      'Read-only tool enforcement has not been observed against a live provider process.',
    ],
  };
  return outcome([], 'binding', deepFreeze({ ...data, bindingDigest: hash(data) }));
}

export function assessClaudeReviewAdmission(input = {}) {
  const {
    packet,
    binding,
    currentSnapshot,
    currentSourceDigest,
    currentConfigDigest,
    currentRoleDigest,
    seenInvocationIds,
    ambientCredentialKeys,
  } = isRecord(input) ? input : {};
  const errors = [];
  validateBinding(binding, errors);
  if (!isRecord(currentSnapshot)) errors.push('currentSnapshot is required.');
  validatePacket(packet, errors, currentSnapshot);
  if (!Array.isArray(ambientCredentialKeys)) {
    errors.push('ambientCredentialKeys must be an array of environment variable names.');
  } else if (ambientCredentialKeys.some((key) => AUTH_ENV_OVERRIDES.has(key))) {
    errors.push('explicit Claude authentication environment override is forbidden.');
  }
  if (!Array.isArray(seenInvocationIds)) {
    errors.push('seenInvocationIds must be an array of invocation ids.');
  }
  if (isRecord(binding) && isRecord(packet)) {
    if (
      binding.packetId !== packet.packetId ||
      binding.dispatchId !== packet.lifecycle?.dispatchId
    ) {
      errors.push('binding packet identity does not match the packet.');
    }
    if (binding.packetDigest !== hash(packet)) errors.push('binding packet digest is stale.');
    if (Array.isArray(seenInvocationIds) && seenInvocationIds.includes(binding.invocationId)) {
      errors.push('invocationId has already been assessed.');
    }
    if (binding.sourceDigest !== currentSourceDigest) errors.push('sourceDigest is stale.');
    if (binding.configDigest !== currentConfigDigest) errors.push('configDigest is stale.');
    if (binding.roleDigest !== currentRoleDigest) errors.push('roleDigest is stale.');
  }
  if (errors.length > 0) return outcome(errors, 'admission', null);

  return outcome(
    [],
    'admission',
    deepFreeze({
      decision: 'candidate',
      executed: false,
      invocationId: binding.invocationId,
      bindingDigest: binding.bindingDigest,
      host: binding.host,
      runtimeQualification: 'not-run',
      liveChecks: [...LIVE_CHECKS],
    }),
  );
}

export function buildClaudeReviewCommand(input = {}) {
  const { packet, binding } = isRecord(input) ? input : {};
  const errors = [];
  validateBinding(binding, errors);
  validatePacket(packet, errors);
  if (isRecord(binding) && isRecord(packet)) {
    if (
      binding.packetId !== packet.packetId ||
      binding.dispatchId !== packet.lifecycle?.dispatchId
    ) {
      errors.push('binding packet identity does not match the packet.');
    }
    if (binding.packetDigest !== hash(packet)) errors.push('binding packet digest is stale.');
  }
  if (errors.length > 0) return outcome(errors, 'command', null);

  return outcome(
    [],
    'command',
    deepFreeze({
      file: binding.executable,
      args: [
        '--print',
        '--agent',
        binding.role,
        '--model',
        binding.requestedModel,
        '--tools',
        binding.allowedTools.join(','),
        '--allowedTools',
        binding.allowedTools.join(','),
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
      ],
      cwd: binding.cwd,
      stdin: `${JSON.stringify(packet)}\n`,
      env: null,
      executableQualification: 'not-run',
      environmentQualification: 'not-run',
      shell: false,
      executionClass: 'provider-cli',
      enabled: false,
      applied: false,
      runtimeQualification: 'not-run',
    }),
  );
}

function validatePacket(packet, errors, currentSnapshot) {
  const validation = validateCrossModelPacket(packet, {
    ...(currentSnapshot ? { currentSnapshot } : {}),
  });
  errors.push(...validation.errors.map((error) => `packet: ${error}`));
  if (!isRecord(packet)) return;
  if (packet.lifecycle?.transport !== 'cli') errors.push('packet transport must be cli.');
  if (packet.lifecycle?.support !== 'unknown') {
    errors.push('packet CLI support must remain unknown before live qualification.');
  }
  if (packet.intent?.direction !== 'codex-maker-claude-checker') {
    errors.push('packet direction must target the Claude checker.');
  }
}

function validateBinding(binding, errors) {
  if (!isRecord(binding)) {
    errors.push('binding must be an object.');
    return;
  }
  rejectUnknown(binding, BINDING_FIELDS, 'binding', errors);
  const { bindingDigest, ...data } = binding;
  requireDigest(bindingDigest, 'binding.bindingDigest', errors);
  if (DIGEST.test(bindingDigest ?? '') && hash(data) !== bindingDigest) {
    errors.push('binding digest does not match its contents.');
  }
  const expected = [
    ['schemaVersion', SCHEMA_VERSION],
    ['host', HOST],
    ['transport', TRANSPORT],
    ['executableIdentity', 'claude'],
    ['role', ROLE],
    ['roleDefinition', ROLE_DEFINITION],
    ['requestedModel', MODEL],
    ['expectedResolvedModel', 'unknown'],
    ['modelSource', 'lead-fixed-h3p-policy'],
    ['sandbox', 'read-only'],
    ['authRoute', 'local-subscription'],
    ['fallback', 'none'],
    ['applied', false],
    ['runtimeQualification', 'not-run'],
    ['restrictedProjectAgentLoading', 'unresolved'],
  ];
  for (const [field, value] of expected) {
    if (binding[field] !== value) errors.push(`binding.${field} must equal ${String(value)}.`);
  }
  requireId(binding.invocationId, 'binding.invocationId', errors);
  requireId(binding.packetId, 'binding.packetId', errors);
  requireId(binding.dispatchId, 'binding.dispatchId', errors);
  requireDigest(binding.packetDigest, 'binding.packetDigest', errors);
  requireDigest(binding.sourceDigest, 'binding.sourceDigest', errors);
  requireDigest(binding.configDigest, 'binding.configDigest', errors);
  requireDigest(binding.roleDigest, 'binding.roleDigest', errors);
  requireCwd(binding.cwd, errors, 'binding.cwd');
  requireExecutable(binding.executable, errors, 'binding.executable');
  if (!sameArray(binding.allowedTools, ALLOWED_TOOLS)) {
    errors.push('binding.allowedTools must be exactly Read, Grep, Glob.');
  }
  if (!Array.isArray(binding.mcpServers) || binding.mcpServers.length !== 0) {
    errors.push('binding.mcpServers must be empty.');
  }
  if (!Array.isArray(binding.knownGaps) || binding.knownGaps.length === 0) {
    errors.push('binding.knownGaps must record unresolved live qualification.');
  }
}

function rejectUnknown(value, fields, label, errors) {
  for (const key of Object.keys(value)) {
    if (!fields.has(key)) errors.push(`${label} contains unknown field: ${key}.`);
  }
}

function requireId(value, label, errors) {
  if (typeof value !== 'string' || !ID.test(value)) errors.push(`${label} must be a stable id.`);
}

function requireDigest(value, label, errors) {
  if (typeof value !== 'string' || !DIGEST.test(value)) {
    errors.push(`${label} must be a sha256 digest.`);
  }
}

function requireCwd(value, errors, label = 'cwd') {
  if (
    typeof value !== 'string' ||
    value.includes('\0') ||
    !isAbsolute(value) ||
    normalize(value) !== value ||
    parse(value).root === value
  ) {
    errors.push(`${label} must be a normalized absolute non-root path.`);
  }
}

function requireExecutable(value, errors, label = 'executable') {
  if (
    typeof value !== 'string' ||
    value.includes('\0') ||
    /\s/u.test(value) ||
    (value !== 'claude' && (!isAbsolute(value) || !value.endsWith('/claude')))
  ) {
    errors.push(`${label} must identify only the Claude CLI executable.`);
  }
}

function sameArray(value, expected) {
  return (
    Array.isArray(value) &&
    value.length === expected.length &&
    value.every((item, index) => item === expected[index])
  );
}

function hash(value) {
  return `sha256:${createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex')}`;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function invalid(error, key) {
  return outcome([error], key, null);
}

function outcome(errors, key, value) {
  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze([...errors]),
    [key]: value,
  });
}
