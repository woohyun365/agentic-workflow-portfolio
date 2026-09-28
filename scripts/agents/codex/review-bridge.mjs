import { createHash } from 'node:crypto';
import { isAbsolute, normalize } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { validateCrossModelPacket } from '../common/index.mjs';

const SCHEMA_VERSION = 'cross-host-review-binding/v1';
const REQUEST_SCHEMA_VERSION = 'cross-host-review-request/v1';
const TARGET_DIRECTION = 'claude-maker-codex-checker';
const HOST = 'codex';
const TRANSPORT = 'direct-cli';
const EXECUTABLE = 'codex';
const ROLE = 'top-level-read-only-reviewer';
const MODEL = 'gpt-6-astra';
const SANDBOX = 'read-only';
const ALLOWED_TOOLS = deepFreeze(['repository-read', 'test-result-read']);
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,159}$/u;

const INPUT_FIELDS = [
  'invocationId',
  'packet',
  'cwd',
  'executable',
  'sourceDigest',
  'configDigest',
  'roleDigest',
];
const BINDING_FIELDS = [
  'schemaVersion',
  'bindingDigest',
  'invocationId',
  'packetId',
  'dispatchId',
  'packetDigest',
  'host',
  'transport',
  'executableIdentity',
  'cwd',
  'role',
  'projectRoleClaim',
  'requestedModel',
  'expectedResolvedModel',
  'allowedTools',
  'sandbox',
  'authRoute',
  'fallback',
  'sourceDigest',
  'configDigest',
  'roleDigest',
  'applied',
  'runtimeQualification',
];
const ADMISSION_FIELDS = [
  'packet',
  'binding',
  'currentSnapshot',
  'currentSourceDigest',
  'currentConfigDigest',
  'currentRoleDigest',
  'seenInvocationIds',
  'ambientCredentialKeys',
  'providerDispatchEnabled',
];
const CREDENTIAL_OVERRIDE =
  /^(?:OPENAI|ANTHROPIC|CLAUDE_CODE|CODEX)_(?:API_KEY|AUTH_TOKEN|OAUTH_TOKEN|ACCESS_TOKEN)$/u;

/**
 * Build a static Codex top-level CLI candidate. This is deliberately separate
 * from native `.codex/agents/repo_reviewer.toml` admission: `codex exec` has no
 * project-agent selector, so static readiness must not claim that native role was loaded.
 */
export function createCodexReviewBinding(input) {
  assertExactObject(input, INPUT_FIELDS, 'input');
  assertIdentifier(input.invocationId, 'invocationId');
  assertCodexPacket(input.packet);
  assertSafeCwd(input.cwd);
  require(input.executable === EXECUTABLE, 'executable must be codex.');
  for (const field of ['sourceDigest', 'configDigest', 'roleDigest']) {
    assertDigest(input[field], field);
  }

  const descriptor = {
    schemaVersion: SCHEMA_VERSION,
    invocationId: input.invocationId,
    packetId: input.packet.packetId,
    dispatchId: input.packet.lifecycle.dispatchId,
    packetDigest: hash(input.packet),
    host: HOST,
    transport: TRANSPORT,
    executableIdentity: EXECUTABLE,
    cwd: normalize(input.cwd),
    role: ROLE,
    projectRoleClaim: 'unqualified',
    requestedModel: MODEL,
    expectedResolvedModel: 'unknown',
    allowedTools: [...ALLOWED_TOOLS],
    sandbox: SANDBOX,
    authRoute: 'local-subscription',
    fallback: 'none',
    sourceDigest: input.sourceDigest,
    configDigest: input.configDigest,
    roleDigest: input.roleDigest,
    applied: false,
    runtimeQualification: 'not-run',
  };
  return deepFreeze({
    ...descriptor,
    bindingDigest: hash(descriptor),
  });
}

/**
 * Assess only static readiness. A candidate is never dispatch authority;
 * live auth, role/model/tool observation and provider execution require separate live qualification.
 */
export function assessCodexReviewAdmission(input) {
  const errors = [];
  const liveChecks = [];
  try {
    assertExactObject(input, ADMISSION_FIELDS, 'admission');
    const packetValidation = validateCrossModelPacket(input.packet, {
      currentSnapshot: input.currentSnapshot,
    });
    errors.push(...packetValidation.errors);
    if (
      input.currentSnapshot === null ||
      typeof input.currentSnapshot !== 'object' ||
      Array.isArray(input.currentSnapshot)
    ) {
      errors.push('currentSnapshot is required.');
    }
    liveChecks.push(...packetValidation.liveChecks);
    validateBinding(input.binding, input.packet, errors);

    for (const [currentField, bindingField] of [
      ['currentSourceDigest', 'sourceDigest'],
      ['currentConfigDigest', 'configDigest'],
      ['currentRoleDigest', 'roleDigest'],
    ]) {
      if (!DIGEST.test(input[currentField] ?? '')) {
        errors.push(`${currentField} must be a sha256 digest.`);
      } else if (input[currentField] !== input.binding?.[bindingField]) {
        errors.push(`${currentField} does not match the binding.`);
      }
    }

    if (!Array.isArray(input.seenInvocationIds)) {
      errors.push('seenInvocationIds must be an array.');
    } else if (!input.seenInvocationIds.every((value) => ID.test(value))) {
      errors.push('seenInvocationIds contains an invalid identity.');
    } else if (input.seenInvocationIds.includes(input.binding?.invocationId)) {
      errors.push('invocationId has already been dispatched.');
    }
    if (input.providerDispatchEnabled !== false) {
      errors.push('real provider dispatch is not qualified by static readiness.');
    }
    if (
      !Array.isArray(input.ambientCredentialKeys) ||
      !input.ambientCredentialKeys.every(
        (key) => typeof key === 'string' && /^[A-Z_][A-Z0-9_]{0,127}$/u.test(key),
      )
    ) {
      errors.push('ambientCredentialKeys must contain environment variable names only.');
    } else if (input.ambientCredentialKeys.some((key) => CREDENTIAL_OVERRIDE.test(key))) {
      errors.push('ambient provider credential override is forbidden.');
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : 'invalid admission input.');
  }

  liveChecks.push(
    'codex-cli-authenticated',
    'codex-role-model-tools-observed',
    'real-provider-dispatch-qualified',
  );
  const uniqueErrors = [...new Set(errors)];
  const candidate = uniqueErrors.length === 0;
  return deepFreeze({
    valid: candidate,
    decision: candidate ? 'candidate' : 'refuse',
    dispatchAllowed: false,
    bindingDigest: candidate ? input.binding.bindingDigest : null,
    invocationId: candidate ? input.binding.invocationId : null,
    host: candidate ? input.binding.host : null,
    errors: uniqueErrors,
    liveChecks: [...new Set(liveChecks)],
  });
}

/**
 * Return structured process data. The packet is sent through stdin rather than
 * interpolated into a shell command, and no credential-bearing environment is
 * accepted or copied here.
 */
export function buildCodexReviewCommand(input) {
  const errors = [];
  try {
    assertExactObject(input, ['packet', 'binding'], 'command input');
    assertCodexPacket(input.packet);
    validateBinding(input.binding, input.packet, errors);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : 'invalid command input.');
  }
  if (errors.length > 0) {
    return deepFreeze({ valid: false, errors: [...new Set(errors)], command: null });
  }

  const request = {
    schemaVersion: REQUEST_SCHEMA_VERSION,
    mode: 'independent-read-only-review',
    constraints: {
      mutateWorkspace: false,
      delegateProvider: false,
      readCredentials: false,
      discloseRawTranscript: false,
      finalResultOnly: true,
    },
    packet: structuredClone(input.packet),
  };
  const command = {
    executionClass: 'provider-cli',
    enabled: false,
    file: input.binding.executableIdentity,
    args: [
      '-a',
      'never',
      '--no-daemon',
      'exec',
      '--model',
      input.binding.requestedModel,
      '--sandbox',
      input.binding.sandbox,
      '--cd',
      input.binding.cwd,
      '--ephemeral',
      '--ignore-user-config',
      '--strict-config',
      '--json',
      '-',
    ],
    cwd: input.binding.cwd,
    env: null,
    executableQualification: 'not-run',
    environmentQualification: 'not-run',
    shell: false,
    stdin: JSON.stringify(request),
  };
  return deepFreeze({ valid: true, errors: [], command });
}

function assertCodexPacket(packet) {
  const validation = validateCrossModelPacket(packet);
  require(validation.valid, `packet is invalid: ${validation.errors.join(' ')}`);
  require(packet.intent.direction ===
    TARGET_DIRECTION, `packet direction must be ${TARGET_DIRECTION}.`);
  require(packet.lifecycle.transport === 'cli', 'packet transport must be cli.');
  require(packet.lifecycle.support ===
    'unknown', 'packet CLI support must remain unknown before live qualification.');
  require(isDeepStrictEqual(
    packet.boundaries.allowedTools,
    ALLOWED_TOOLS,
  ), 'packet tools must match the bounded Codex read-only tool set.');
}

function validateBinding(binding, packet, errors) {
  try {
    assertExactObject(binding, BINDING_FIELDS, 'binding');
    const { bindingDigest, ...descriptor } = binding;
    assertDigest(bindingDigest, 'binding.bindingDigest');
    require(bindingDigest === hash(descriptor), 'binding digest does not match its descriptor.');
    const expected = {
      schemaVersion: SCHEMA_VERSION,
      packetId: packet.packetId,
      dispatchId: packet.lifecycle.dispatchId,
      packetDigest: hash(packet),
      host: HOST,
      transport: TRANSPORT,
      executableIdentity: EXECUTABLE,
      role: ROLE,
      projectRoleClaim: 'unqualified',
      requestedModel: MODEL,
      expectedResolvedModel: 'unknown',
      allowedTools: ALLOWED_TOOLS,
      sandbox: SANDBOX,
      authRoute: 'local-subscription',
      fallback: 'none',
      applied: false,
      runtimeQualification: 'not-run',
    };
    for (const [field, value] of Object.entries(expected)) {
      require(isDeepStrictEqual(binding[field], value), `binding.${field} is not current policy.`);
    }
    assertIdentifier(binding.invocationId, 'binding.invocationId');
    assertSafeCwd(binding.cwd);
    for (const field of ['sourceDigest', 'configDigest', 'roleDigest', 'packetDigest']) {
      assertDigest(binding[field], `binding.${field}`);
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : 'invalid binding.');
  }
}

function assertExactObject(value, fields, label) {
  require(value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value), `${label} must be an object.`);
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  require(isDeepStrictEqual(actual, expected), `${label} fields must match the current schema.`);
}

function assertSafeCwd(value) {
  require(typeof value === 'string' &&
    value.length > 1 &&
    value.length <= 4096 &&
    isAbsolute(value) &&
    normalize(value) === value &&
    !/[\0\r\n]/u.test(value), 'cwd must be a normalized absolute path.');
}

function assertIdentifier(value, label) {
  require(typeof value === 'string' && ID.test(value), `${label} must be a bounded identifier.`);
}

function assertDigest(value, label) {
  require(typeof value === 'string' && DIGEST.test(value), `${label} must be a sha256 digest.`);
}

function hash(value) {
  return `sha256:${createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex')}`;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
}

function require(condition, message) {
  if (!condition) throw new TypeError(message);
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
