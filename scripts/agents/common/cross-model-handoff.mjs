import { posix as path } from 'node:path';

export const CROSS_MODEL_HANDOFF_SCHEMA = 'cross-model-handoff/v1';

const PACKET_FIELDS = new Set([
  'schemaVersion',
  'packetId',
  'objective',
  'nonScope',
  'authority',
  'snapshot',
  'sources',
  'evidence',
  'boundaries',
  'review',
  'lifecycle',
  'intent',
]);
const RESULT_FIELDS = new Set([
  'schemaVersion',
  'packetId',
  'dispatchId',
  'resultId',
  'status',
  'reviewedSnapshot',
  'contextIsolationMethod',
  'identity',
  'acceptanceCoverage',
  'findings',
  'commandsActuallyRun',
  'notRun',
  'knownGaps',
  'confidence',
  'verdict',
  'blocker',
  'disposition',
  'cleanup',
  'handoff',
]);
const FORBIDDEN_KEYS = new Set([
  'apikey',
  'accesstoken',
  'authtoken',
  'clientsecret',
  'credential',
  'credentials',
  'expectedanswer',
  'hiddenoracle',
  'oracle',
  'password',
  'providerpayload',
  'rawproviderpayload',
  'rawtranscript',
  'secret',
  'secrets',
  'transcript',
]);
const REQUIRED_EXCLUSIONS = ['builder-transcript', 'self-pass', 'expected-answer', 'hidden-oracle'];
const REQUIRED_FORBIDDEN_MUTATIONS = ['workspace-write', 'provider-delegation', 'credential-read'];
const EVIDENCE_FIELDS = new Set([
  'environment',
  'prerequisites',
  'commands',
  'tests',
  'knownFailures',
  'knownGaps',
  'sanitizedLinks',
]);
const REVIEW_INPUTS = new Set([
  'requirements',
  'contracts',
  'source-identity',
  'known-failures',
  'boundaries',
  'stop-conditions',
]);
const READ_ONLY_TOOLS = new Set(['repository-read', 'test-result-read', 'official-web-read']);
const TERMINAL_STATUSES = new Set(['complete', 'partial', 'denied', 'timed-out', 'cancelled']);
const VERDICTS = new Set(['PASS', 'FAIL', 'BLOCKED']);
const TRANSPORTS = new Set(['manual', 'native', 'cli', 'unknown']);
const SUPPORT_STATES = new Set(['supported', 'unsupported', 'unknown']);
const DIRECTIONS = new Set([
  'same-host-independent-review',
  'claude-maker-codex-checker',
  'codex-maker-claude-checker',
  'lead-takeover',
]);
const CONFIDENCE_LEVELS = new Set(['low', 'medium', 'high']);
const FINDING_SEVERITIES = new Set(['critical', 'high', 'medium', 'low']);
const MAX_TIMEOUT_MS = 1_800_000;

export function validateCrossModelPacket(packet, options = {}) {
  const errors = [];
  const liveChecks = [];
  if (!isRecord(packet)) return outcome(['packet must be an object.'], []);

  rejectUnknownFields(packet, PACKET_FIELDS, 'packet', errors);
  rejectForbiddenContent(packet, 'packet', errors);
  requireExact(packet.schemaVersion, CROSS_MODEL_HANDOFF_SCHEMA, 'schemaVersion', errors);
  requireId(packet.packetId, 'packetId', errors);
  requireText(packet.objective, 'objective', errors);
  requireTextArray(packet.nonScope, 'nonScope', errors);

  const authority = requireRecord(packet.authority, 'authority', errors);
  if (authority) {
    requireId(authority.integrationOwner, 'authority.integrationOwner', errors);
    requireId(authority.writeOwner, 'authority.writeOwner', errors);
    requireId(authority.runnerOwner, 'authority.runnerOwner', errors);
    requireId(authority.parentClarificationOwner, 'authority.parentClarificationOwner', errors);
    requireExact(authority.reviewerMode, 'read-only', 'authority.reviewerMode', errors);
  }

  validateSnapshot(packet.snapshot, 'snapshot', errors);
  if (options.currentSnapshot && !sameSnapshot(packet.snapshot, options.currentSnapshot)) {
    errors.push('snapshot is stale relative to the current source identity.');
  } else if (!options.currentSnapshot) {
    liveChecks.push('source-identity-current');
  }

  const sources = requireRecord(packet.sources, 'sources', errors);
  if (sources) {
    const sourceFields = new Set(['requirements', 'contracts', 'owners']);
    for (const key of Object.keys(sources)) {
      if (!sourceFields.has(key)) errors.push(`sources contains untrusted field: ${key}.`);
    }
    requireTextArray(sources.requirements, 'sources.requirements', errors, { nonEmpty: true });
    requireTextArray(sources.contracts, 'sources.contracts', errors, { nonEmpty: true });
    requireTextArray(sources.owners, 'sources.owners', errors, { nonEmpty: true });
  }
  const evidence = requireRecord(packet.evidence, 'evidence', errors);
  if (evidence) {
    rejectUnknownFields(evidence, EVIDENCE_FIELDS, 'evidence', errors);
    requireText(evidence.environment, 'evidence.environment', errors);
    requireTextArray(evidence.prerequisites, 'evidence.prerequisites', errors);
    requireTextArray(evidence.commands, 'evidence.commands', errors, { nonEmpty: true });
    requireTextArray(evidence.tests, 'evidence.tests', errors);
    requireTextArray(evidence.knownFailures, 'evidence.knownFailures', errors);
    requireTextArray(evidence.knownGaps, 'evidence.knownGaps', errors);
    requireTextArray(evidence.sanitizedLinks, 'evidence.sanitizedLinks', errors);
  }

  const boundaries = requireRecord(packet.boundaries, 'boundaries', errors);
  if (boundaries) {
    const allowedReadPaths = requireTextArray(
      boundaries.allowedReadPaths,
      'boundaries.allowedReadPaths',
      errors,
      {
        nonEmpty: true,
      },
    );
    validateSafePaths(allowedReadPaths, 'boundaries.allowedReadPaths', errors);
    requireTextArray(boundaries.doNotTouch, 'boundaries.doNotTouch', errors);
    requireTextArray(
      boundaries.permittedReadsAndTests,
      'boundaries.permittedReadsAndTests',
      errors,
      { nonEmpty: true },
    );
    const forbidden = requireTextArray(
      boundaries.forbiddenMutations,
      'boundaries.forbiddenMutations',
      errors,
    );
    for (const required of REQUIRED_FORBIDDEN_MUTATIONS) {
      if (forbidden && !forbidden.includes(required)) {
        errors.push(`boundaries.forbiddenMutations must include ${required}.`);
      }
    }
    const permittedOutputPaths = requireTextArray(
      boundaries.permittedOutputPaths,
      'boundaries.permittedOutputPaths',
      errors,
      { nonEmpty: true },
    );
    validateSafePaths(permittedOutputPaths, 'boundaries.permittedOutputPaths', errors);
    const tools = requireTextArray(boundaries.allowedTools, 'boundaries.allowedTools', errors, {
      nonEmpty: true,
    });
    for (const tool of tools ?? []) {
      if (!READ_ONLY_TOOLS.has(tool))
        errors.push(`boundaries.allowedTools is not read-only: ${tool}.`);
    }
    requireExact(boundaries.disclosure, 'sanitized-only', 'boundaries.disclosure', errors);
  }

  const review = requireRecord(packet.review, 'review', errors);
  if (review) {
    requireExact(review.freshContext, true, 'review.freshContext', errors);
    requireText(review.contextIsolationMethod, 'review.contextIsolationMethod', errors);
    const excluded = requireTextArray(review.excludedInputs, 'review.excludedInputs', errors);
    for (const required of REQUIRED_EXCLUSIONS) {
      if (excluded && !excluded.includes(required)) {
        errors.push(`review.excludedInputs must include ${required}.`);
      }
    }
    const included = requireTextArray(review.includedInputs, 'review.includedInputs', errors, {
      nonEmpty: true,
    });
    for (const input of included ?? []) {
      if (!REVIEW_INPUTS.has(input)) errors.push(`review.includedInputs is untrusted: ${input}.`);
    }
    liveChecks.push('context-isolation-observed');
  }

  const lifecycle = requireRecord(packet.lifecycle, 'lifecycle', errors);
  if (lifecycle) {
    requireId(lifecycle.dispatchId, 'lifecycle.dispatchId', errors);
    requireEnum(lifecycle.transport, TRANSPORTS, 'lifecycle.transport', errors);
    requireEnum(lifecycle.support, SUPPORT_STATES, 'lifecycle.support', errors);
    if (lifecycle.transport === 'unknown' && lifecycle.support !== 'unknown') {
      errors.push('unknown lifecycle.transport requires unknown lifecycle.support.');
    }
    requireTextArray(lifecycle.stopConditions, 'lifecycle.stopConditions', errors, {
      nonEmpty: true,
    });
    requireId(lifecycle.cancelOwner, 'lifecycle.cancelOwner', errors);
    requireId(lifecycle.cleanupOwner, 'lifecycle.cleanupOwner', errors);
    if (
      !Number.isSafeInteger(lifecycle.timeoutMs) ||
      lifecycle.timeoutMs <= 0 ||
      lifecycle.timeoutMs > MAX_TIMEOUT_MS
    ) {
      errors.push(`lifecycle.timeoutMs must be between 1 and ${MAX_TIMEOUT_MS}.`);
    }
    if ((options.seenDispatchIds ?? []).includes(lifecycle.dispatchId)) {
      errors.push('lifecycle.dispatchId has already been dispatched.');
    }
    if (lifecycle.support === 'supported') liveChecks.push('transport-supported');
    if (lifecycle.support === 'unknown') liveChecks.push('transport-support-resolved');
  }

  const intent = requireRecord(packet.intent, 'intent', errors);
  if (intent) {
    requireEnum(intent.direction, DIRECTIONS, 'intent.direction', errors);
    requireText(intent.modelIntent, 'intent.modelIntent', errors);
  }
  return outcome(errors, liveChecks);
}

export function validateCrossModelResult(
  result,
  { packet, currentSnapshot, seenResultIds = [] } = {},
) {
  const errors = [];
  const liveChecks = [];
  if (!isRecord(result)) return outcome(['result must be an object.'], []);
  if (!isRecord(packet)) return outcome(['packet is required to validate a result.'], []);
  const packetValidation = validateCrossModelPacket(packet, { currentSnapshot });
  if (!packetValidation.valid) return packetValidation;

  rejectUnknownFields(result, RESULT_FIELDS, 'result', errors);
  rejectForbiddenContent(result, 'result', errors);
  requireExact(result.schemaVersion, CROSS_MODEL_HANDOFF_SCHEMA, 'schemaVersion', errors);
  requireExact(result.packetId, packet.packetId, 'packetId', errors);
  requireExact(result.dispatchId, packet.lifecycle?.dispatchId, 'dispatchId', errors);
  requireId(result.resultId, 'resultId', errors);
  if (seenResultIds.includes(result.resultId)) errors.push('resultId has already been accepted.');
  requireEnum(result.status, TERMINAL_STATUSES, 'status', errors);
  validateSnapshot(result.reviewedSnapshot, 'reviewedSnapshot', errors);
  if (!sameSnapshot(result.reviewedSnapshot, packet.snapshot)) {
    errors.push('reviewedSnapshot does not match the packet snapshot.');
  }
  if (currentSnapshot && !sameSnapshot(result.reviewedSnapshot, currentSnapshot)) {
    errors.push('reviewedSnapshot is stale relative to the current source identity.');
  } else if (!currentSnapshot) {
    liveChecks.push('source-identity-current');
  }
  requireExact(
    result.contextIsolationMethod,
    packet.review?.contextIsolationMethod,
    'contextIsolationMethod',
    errors,
  );

  const identity = requireRecord(result.identity, 'identity', errors);
  if (identity) {
    requireExact(
      identity.requestedModelIntent,
      packet.intent?.modelIntent,
      'identity.requestedModelIntent',
      errors,
    );
    requireText(identity.resolvedModel, 'identity.resolvedModel', errors);
    requireText(identity.observedModel, 'identity.observedModel', errors);
    if (identity.resolvedModel === 'unknown' || identity.observedModel === 'unknown') {
      liveChecks.push('model-identity-observed');
    }
  }

  validateCoverage(result.acceptanceCoverage, errors);
  validateFindings(result.findings, errors);
  validateCommands(result.commandsActuallyRun, packet, errors);
  requireTextArray(result.notRun, 'notRun', errors);
  requireTextArray(result.knownGaps, 'knownGaps', errors);
  requireEnum(result.confidence, CONFIDENCE_LEVELS, 'confidence', errors);
  requireEnum(result.verdict, VERDICTS, 'verdict', errors);
  if (result.blocker !== null) requireText(result.blocker, 'blocker', errors);

  const disposition = requireRecord(result.disposition, 'disposition', errors);
  if (disposition) {
    requireExact(
      disposition.owner,
      packet.authority?.integrationOwner,
      'disposition.owner',
      errors,
    );
    requireText(disposition.nextAction, 'disposition.nextAction', errors);
  }
  const cleanup = requireRecord(result.cleanup, 'cleanup', errors);
  if (cleanup) {
    requireExact(cleanup.owner, packet.lifecycle?.cleanupOwner, 'cleanup.owner', errors);
    requireEnum(
      cleanup.status,
      new Set(['complete', 'pending', 'not-started']),
      'cleanup.status',
      errors,
    );
    requireText(cleanup.handoff, 'cleanup.handoff', errors);
  }
  const handoff = requireRecord(result.handoff, 'handoff', errors);
  if (handoff) {
    requireExact(
      handoff.integrationOwner,
      packet.authority?.integrationOwner,
      'handoff.integrationOwner',
      errors,
    );
    if (handoff.requestedWriteOwner !== null) {
      errors.push(
        'handoff.requestedWriteOwner must be null; writer takeover requires a new packet.',
      );
    }
  }

  const coverageGaps = Array.isArray(result.acceptanceCoverage)
    ? result.acceptanceCoverage.filter((entry) => isRecord(entry) && entry.gap !== null)
    : [];
  const blockingFinding = Array.isArray(result.findings)
    ? result.findings.some((finding) =>
        ['critical', 'high', 'medium'].includes(isRecord(finding) ? finding.severity : ''),
      )
    : false;
  const reproducedFinding = Array.isArray(result.findings)
    ? result.findings.some(
        (finding) =>
          isRecord(finding) &&
          typeof finding.reproduction === 'string' &&
          finding.reproduction.trim() !== '' &&
          typeof finding.evidence === 'string' &&
          finding.evidence.trim() !== '',
      )
    : false;
  const knownFailures = packet.evidence?.knownFailures ?? [];
  const knownGaps = Array.isArray(result.knownGaps) ? result.knownGaps : [];
  const notRun = Array.isArray(result.notRun) ? result.notRun : [];
  const preservedFailures = new Set([...knownGaps, ...notRun]);
  for (const failure of knownFailures) {
    if (!preservedFailures.has(failure)) errors.push(`known failure was not preserved: ${failure}`);
  }
  if (
    result.verdict === 'PASS' &&
    (result.status !== 'complete' ||
      result.blocker !== null ||
      coverageGaps.length > 0 ||
      blockingFinding ||
      (result.knownGaps?.length ?? 0) > 0 ||
      (result.notRun?.length ?? 0) > 0 ||
      knownFailures.length > 0 ||
      identity?.resolvedModel === 'unknown' ||
      identity?.observedModel === 'unknown' ||
      result.cleanup?.status !== 'complete')
  ) {
    errors.push('PASS requires a complete result with no blocking finding or evidence gap.');
  }
  if (['partial', 'denied', 'timed-out', 'cancelled'].includes(result.status)) {
    if (result.verdict === 'PASS') errors.push(`${result.status} results cannot use PASS.`);
    if (result.verdict === 'FAIL' && !reproducedFinding) {
      errors.push(`${result.status} FAIL requires a reproduced finding with evidence.`);
    }
    if (!['FAIL', 'BLOCKED'].includes(result.verdict)) {
      errors.push(`${result.status} results must use FAIL or BLOCKED.`);
    }
    if (!result.blocker) errors.push(`${result.status} results must report a blocker.`);
  }
  if (
    packet.lifecycle?.support !== 'supported' &&
    (result.status === 'complete' || result.verdict === 'PASS')
  ) {
    errors.push('unsupported or unknown transport cannot produce a completed PASS result.');
  }
  if (['timed-out', 'cancelled'].includes(result.status))
    liveChecks.push('termination-and-cleanup-observed');
  if (result.status === 'denied') liveChecks.push('denial-had-no-unauthorized-fallback');
  liveChecks.push('evidence-reproduced-by-runner');
  return outcome(errors, liveChecks);
}

export function validateCrossModelExchange({
  packet,
  result,
  currentSnapshot,
  seenDispatchIds,
  seenResultIds,
} = {}) {
  const packetValidation = validateCrossModelPacket(packet, { currentSnapshot, seenDispatchIds });
  if (!packetValidation.valid) return packetValidation;
  const resultValidation = validateCrossModelResult(result, {
    packet,
    currentSnapshot,
    seenResultIds,
  });
  return outcome(resultValidation.errors, [
    ...packetValidation.liveChecks,
    ...resultValidation.liveChecks,
  ]);
}

function validateSnapshot(snapshot, label, errors) {
  if (!requireRecord(snapshot, label, errors)) return;
  requireCommitSHA(snapshot.baseSHA, `${label}.baseSHA`, errors);
  requireCommitSHA(snapshot.headSHA, `${label}.headSHA`, errors);
  if (snapshot.dirtyDiffDigest !== null)
    requireDigest(snapshot.dirtyDiffDigest, `${label}.dirtyDiffDigest`, errors);
  if (!Array.isArray(snapshot.untrackedInputDigests)) {
    errors.push(`${label}.untrackedInputDigests must be an array.`);
  } else {
    for (const [index, item] of snapshot.untrackedInputDigests.entries()) {
      if (!isRecord(item)) {
        errors.push(`${label}.untrackedInputDigests[${index}] must be an object.`);
        continue;
      }
      requireText(item.path, `${label}.untrackedInputDigests[${index}].path`, errors);
      if (!isSafeRelativePath(item.path)) {
        errors.push(
          `${label}.untrackedInputDigests[${index}].path must be canonical and relative.`,
        );
      }
      requireDigest(item.digest, `${label}.untrackedInputDigests[${index}].digest`, errors);
    }
  }
}

function validateCoverage(coverage, errors) {
  if (!Array.isArray(coverage) || coverage.length === 0) {
    errors.push('acceptanceCoverage must be a non-empty array.');
    return;
  }
  for (const [index, entry] of coverage.entries()) {
    if (!isRecord(entry)) {
      errors.push(`acceptanceCoverage[${index}] must be an object.`);
      continue;
    }
    requireText(entry.criterion, `acceptanceCoverage[${index}].criterion`, errors);
    requireTextArray(entry.sourceRefs, `acceptanceCoverage[${index}].sourceRefs`, errors, {
      nonEmpty: true,
    });
    requireTextArray(entry.evidenceRefs, `acceptanceCoverage[${index}].evidenceRefs`, errors);
    if (entry.gap !== null) requireText(entry.gap, `acceptanceCoverage[${index}].gap`, errors);
    if (entry.gap === null && entry.evidenceRefs?.length === 0) {
      errors.push(`acceptanceCoverage[${index}] must provide evidence or a gap.`);
    }
  }
}

function validateFindings(findings, errors) {
  if (!Array.isArray(findings)) {
    errors.push('findings must be an array.');
    return;
  }
  for (const [index, finding] of findings.entries()) {
    if (!isRecord(finding)) {
      errors.push(`findings[${index}] must be an object.`);
      continue;
    }
    requireEnum(finding.severity, FINDING_SEVERITIES, `findings[${index}].severity`, errors);
    for (const field of ['location', 'impact', 'reproduction', 'evidence']) {
      requireText(finding[field], `findings[${index}].${field}`, errors);
    }
  }
}

function validateCommands(commands, packet, errors) {
  if (!Array.isArray(commands)) {
    errors.push('commandsActuallyRun must be an array.');
    return;
  }
  for (const [index, command] of commands.entries()) {
    if (!isRecord(command)) {
      errors.push(`commandsActuallyRun[${index}] must be an object.`);
      continue;
    }
    requireExact(
      command.runner,
      packet.authority?.runnerOwner,
      `commandsActuallyRun[${index}].runner`,
      errors,
    );
    if (!Number.isSafeInteger(command.exit))
      errors.push(`commandsActuallyRun[${index}].exit must be an integer.`);
    requireText(command.observedResult, `commandsActuallyRun[${index}].observedResult`, errors);
    requireText(command.environment, `commandsActuallyRun[${index}].environment`, errors);
    const outputPaths = requireTextArray(
      command.outputPaths,
      `commandsActuallyRun[${index}].outputPaths`,
      errors,
    );
    for (const outputPath of outputPaths ?? []) {
      if (!isWithinAny(outputPath, packet.boundaries?.permittedOutputPaths ?? [])) {
        errors.push(
          `commandsActuallyRun[${index}] output is outside permittedOutputPaths: ${outputPath}`,
        );
      }
    }
  }
}

function sameSnapshot(left, right) {
  if (!isRecord(left) || !isRecord(right)) return false;
  return (
    left.baseSHA === right.baseSHA &&
    left.headSHA === right.headSHA &&
    left.dirtyDiffDigest === right.dirtyDiffDigest &&
    sameUntrackedInputs(left.untrackedInputDigests, right.untrackedInputDigests)
  );
}

function sameUntrackedInputs(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  const identity = (entry) => `${entry?.path ?? ''}\0${entry?.digest ?? ''}`;
  const leftIdentities = left.map(identity).sort();
  const rightIdentities = right.map(identity).sort();
  return leftIdentities.every((value, index) => value === rightIdentities[index]);
}

function isWithinAny(candidate, roots) {
  if (!isSafeRelativePath(candidate)) return false;
  const normalized = path.normalize(candidate);
  return roots.some((root) => {
    const normalizedRoot = path.normalize(root).replace(/\/$/u, '');
    return normalized === normalizedRoot || normalized.startsWith(`${normalizedRoot}/`);
  });
}

function isSafeRelativePath(candidate) {
  if (typeof candidate !== 'string' || candidate.startsWith('/') || candidate.includes('\\'))
    return false;
  const normalized = path.normalize(candidate);
  return (
    candidate === normalized &&
    normalized !== '.' &&
    normalized !== '..' &&
    !normalized.startsWith('../')
  );
}

function validateSafePaths(paths, label, errors) {
  for (const candidate of paths ?? []) {
    if (!isSafeRelativePath(candidate)) {
      errors.push(`${label} is not a canonical repository-relative path: ${candidate}.`);
    }
  }
}

function rejectUnknownFields(value, allowed, label, errors) {
  for (const key of Object.keys(value))
    if (!allowed.has(key)) errors.push(`${label} has unsupported field: ${key}.`);
}

function rejectForbiddenContent(value, label, errors) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectForbiddenContent(item, `${label}[${index}]`, errors));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = key.replace(/[^a-z]/giu, '').toLowerCase();
    if (FORBIDDEN_KEYS.has(normalizedKey)) {
      errors.push(`${label}.${key} is forbidden disclosure content.`);
    }
    rejectForbiddenContent(child, `${label}.${key}`, errors);
  }
}

function requireRecord(value, label, errors) {
  if (!isRecord(value)) {
    errors.push(`${label} must be an object.`);
    return null;
  }
  return value;
}

function requireText(value, label, errors) {
  if (typeof value !== 'string' || value.trim() === '')
    errors.push(`${label} must be a non-empty string.`);
}

function requireTextArray(value, label, errors, { nonEmpty = false } = {}) {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== 'string' || item.trim() === '')
  ) {
    errors.push(`${label} must be an array of non-empty strings.`);
    return null;
  }
  if (nonEmpty && value.length === 0) errors.push(`${label} must not be empty.`);
  if (new Set(value).size !== value.length) errors.push(`${label} must not contain duplicates.`);
  return value;
}

function requireId(value, label, errors) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u.test(value)) {
    errors.push(`${label} must be a bounded identifier.`);
  }
}

function requireDigest(value, label, errors) {
  if (typeof value !== 'string' || !/^(?:sha256:)?[a-f0-9]{64}$/u.test(value)) {
    errors.push(`${label} must be a SHA-256 identity.`);
  }
}

function requireCommitSHA(value, label, errors) {
  if (typeof value !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(value)) {
    errors.push(`${label} must be a Git commit identity.`);
  }
}

function requireExact(value, expected, label, errors) {
  if (value !== expected) errors.push(`${label} must equal ${String(expected)}.`);
}

function requireEnum(value, allowed, label, errors) {
  if (!allowed.has(value)) errors.push(`${label} has an unsupported value.`);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function outcome(errors, liveChecks) {
  const uniqueErrors = [...new Set(errors)];
  const uniqueLiveChecks = [...new Set(liveChecks)];
  return Object.freeze({
    valid: uniqueErrors.length === 0,
    decision: uniqueErrors.length === 0 ? 'accept' : 'reject',
    verificationClass:
      uniqueErrors.length > 0
        ? 'static-reject'
        : uniqueLiveChecks.length > 0
          ? 'runner-live-required'
          : 'static-accept',
    errors: Object.freeze(uniqueErrors),
    liveChecks: Object.freeze(uniqueLiveChecks),
  });
}
