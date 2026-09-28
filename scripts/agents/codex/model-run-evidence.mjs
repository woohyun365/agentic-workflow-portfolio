import { isDeepStrictEqual } from 'node:util';
import { resolve, relative, isAbsolute } from 'node:path';
import { resolveArtifactPath } from '../../artifacts/paths.mjs';
import {
  assertCurrentModelProfileBinding,
  assertCurrentRecoveryBinding,
  BASELINE_CHILD_MODEL,
} from './model-profiles.mjs';
import { evaluateRecovery } from './orchestration-policy.mjs';

// Caller-sanitized references only: no prompt, transcript, environment or hidden reasoning.
const CAUSES = [
  'unknown',
  'context-missing',
  'task-model-mismatch',
  'code-defect',
  'host-support',
  'tool-fixture-environment',
  'permission',
  'quota',
  'capacity',
  'reasoning-miss',
  'controlled-injection',
];
const ACTIONS = [
  'repair-context',
  'repair-oracle-environment',
  'verify-host',
  'astra-handoff',
  'rescope-task',
  'redesign-task-context',
  'stop',
];
const DISPOSITIONS = ['success', 'failure', 'blocked', 'not-executed'];
const STOP_FAILURES = [
  'role-routing-unavailable',
  'scope-conflict',
  'missing-authority',
  'credential-required',
  'external-production',
  'quota-exhausted',
  'capacity-denied',
];
const FAILURES = [
  ...STOP_FAILURES,
  'official-source-unavailable',
  'repository-evidence-missing',
  'tool-unavailable',
  'verification-failed',
  'unknown',
];

export function createModelRunEvidence(input) {
  validateModelRunEvidence(input);
  return freeze(structuredClone(input));
}

// This validates attribution/consistency, never grants dispatch or recovery authority.
export function validateModelRunEvidence(record) {
  exact(record, [
    'schemaVersion',
    'runId',
    'taskId',
    'laneId',
    'profileBinding',
    'sourceDigest',
    'configDigest',
    'scopeDigest',
    'selectionRefs',
    'writerClearance',
    'attempts',
    'finalDisposition',
    ...(record.recoveryBinding !== undefined ? ['recoveryBinding'] : []),
  ]);
  require(record.schemaVersion === 1);
  for (const field of ['runId', 'taskId', 'laneId']) identifier(record[field]);
  for (const field of ['sourceDigest', 'configDigest', 'scopeDigest']) digest(record[field]);
  const binding = assertCurrentModelProfileBinding(record.profileBinding);
  refs(record.selectionRefs, true);
  oneOf(record.writerClearance, ['cleared', 'pending', 'unknown']);
  oneOf(record.finalDisposition, DISPOSITIONS);
  require(
    Array.isArray(record.attempts) && record.attempts.length >= 1 && record.attempts.length <= 2,
  );
  record.attempts.forEach((attempt, index) => validateAttempt(attempt, index, record, binding));
  require(record.finalDisposition === record.attempts.at(-1).disposition);
  const primary = record.attempts[0];
  if (record.recoveryBinding !== undefined) {
    const recoveryBinding = assertCurrentRecoveryBinding(record.recoveryBinding);
    require(recoveryBinding.assessment.cause === primary.hypothesis.cause);
    require(
      isDeepStrictEqual(recoveryBinding.primary, {
        profileBinding: binding,
        failureCategory: primary.failureCategory,
        ownershipDigest: recoveryBinding.primary.ownershipDigest,
        attemptId: primary.attemptId,
        taskId: record.taskId,
        laneId: record.laneId,
        childId: primary.childId,
        sourceDigest: primary.sourceDigest,
        scopeDigest: primary.scopeDigest,
      }),
    );
  }
  if (record.attempts.length === 2) {
    // Recording a support mismatch is not evidence of an eligible primary model.
    require(matchingPairs(primary));
    const selection = assertCurrentRecoveryBinding(record.recoveryBinding);
    const rescue = record.attempts[1];
    require(
      selection.rescue.attemptId === rescue.attemptId &&
        selection.rescue.taskId === rescue.taskId &&
        selection.rescue.laneId === rescue.laneId,
    );
    for (const field of ['sourceDigest', 'configDigest', 'scopeDigest'])
      require(selection.rescue[field] === rescue[field]);
    require(
      rescue.requested.model === selection.model &&
        rescue.requested.effort === selection.resolvedEffort,
    );
    require(
      primary.executed && primary.disposition === 'failure' && record.writerClearance === 'cleared',
    );
    const recovery = evaluateRecovery({
      laneId: record.laneId,
      attempts: [
        {
          approachId: primary.attemptId,
          outcome: 'failure',
          failureCategory: primary.failureCategory,
          evidence: primary.factRefs[0],
          model: binding.model,
        },
      ],
      modelRecovery: { profileBinding: binding, pendingWriter: record.writerClearance },
    });
    require(recovery.action === 'alternate-once' && recovery.nextModel === BASELINE_CHILD_MODEL);
  }
  return true;
}

function validateAttempt(a, index, record, binding) {
  exact(a, [
    'attemptId',
    'alternateOf',
    'taskId',
    'laneId',
    'sourceDigest',
    'configDigest',
    'scopeDigest',
    'requested',
    'resolved',
    'hostObserved',
    'stage',
    'executed',
    'childId',
    'case',
    'disposition',
    'failureCategory',
    'checks',
    'factRefs',
    'hypothesis',
    'remediation',
    'metrics',
    'usage',
  ]);
  identifier(a.attemptId);
  require(a.taskId === record.taskId && a.laneId === record.laneId);
  for (const field of ['sourceDigest', 'configDigest', 'scopeDigest']) {
    digest(a[field]);
    if (index === 0) require(a[field] === record[field]);
  }
  const recovery = index === 1 ? assertCurrentRecoveryBinding(record.recoveryBinding) : null;
  pair(a.requested, recovery?.resolvedEffort === 'low' ? ['low'] : undefined);
  require(a.requested.model === (index === 0 ? binding.model : BASELINE_CHILD_MODEL));
  if (index === 0) {
    require(a.alternateOf === null && a.requested.effort === binding.resolvedEffort);
  } else {
    require(a.alternateOf === record.attempts[0].attemptId && a.attemptId !== a.alternateOf);
    require(a.childId === null || a.childId !== record.attempts[0].childId);
  }
  if (a.resolved !== null) observedPair(a.resolved);
  if (a.hostObserved !== null) observedPair(a.hostObserved);
  // Preserve known failure facts without accepting that configuration for success.
  if (!matchingPairs(a)) require(['failure', 'blocked'].includes(a.disposition));
  oneOf(a.case, ['live', 'approved-baseline', 'controlled-failure']);
  oneOf(a.disposition, DISPOSITIONS);
  oneOf(a.stage, ['pre-dispatch', 'completed']);
  require(typeof a.executed === 'boolean');
  if (a.executed) {
    require(a.stage === 'completed' && a.resolved !== null && a.disposition !== 'not-executed');
    require(
      typeof a.childId === 'string' &&
        a.childId.length <= 160 &&
        /^\/?[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(a.childId),
    );
  } else {
    require(a.stage === 'pre-dispatch' && a.childId === null && a.hostObserved === null);
    require(['blocked', 'not-executed'].includes(a.disposition));
  }
  if (a.disposition === 'success') require(a.failureCategory === null);
  else oneOf(a.failureCategory, FAILURES);
  refs(a.factRefs, true);
  require(Array.isArray(a.checks) && a.checks.length <= 16);
  for (const c of a.checks) {
    exact(c, ['kind', 'commandRef', 'resultRef', 'status']);
    oneOf(c.kind, ['acceptance', 'quality', 'canary', 'independent-qa', 'remediation']);
    reference(c.commandRef);
    reference(c.resultRef);
    oneOf(c.status, ['passed', 'failed', 'not-run']);
    if (!a.executed) require(c.status === 'not-run');
  }
  require(new Set(a.checks.map((c) => c.resultRef)).size === a.checks.length);
  if (a.disposition === 'success') {
    require(a.checks.every((c) => c.status === 'passed'));
    for (const kind of ['acceptance', 'independent-qa'])
      require(a.checks.some((c) => c.kind === kind));
  }
  if (a.failureCategory === 'verification-failed')
    require(a.checks.some((c) => c.status === 'failed'));
  exact(a.hypothesis, ['cause', 'confidence', 'evidenceRefs']);
  oneOf(a.hypothesis.cause, CAUSES);
  oneOf(a.hypothesis.confidence, ['unknown', 'low', 'medium', 'high']);
  refs(a.hypothesis.evidenceRefs, a.hypothesis.cause !== 'unknown');
  if (a.hypothesis.cause === 'unknown') require(a.hypothesis.confidence === 'unknown');
  else require(a.hypothesis.confidence !== 'unknown');
  if (a.case === 'controlled-failure') {
    require(a.disposition === 'failure' && a.failureCategory === 'verification-failed');
    require(a.hypothesis.cause === 'controlled-injection');
    require(a.checks.some((c) => c.kind === 'canary' && c.status === 'failed'));
    require(
      a.checks.some((c) => ['quality', 'acceptance'].includes(c.kind) && c.status !== 'not-run'),
    );
  } else require(a.hypothesis.cause !== 'controlled-injection');
  if (a.remediation !== null) {
    exact(a.remediation, ['action', 'evidenceRefs', 'checkRefs']);
    oneOf(a.remediation.action, ACTIONS);
    if (STOP_FAILURES.includes(a.failureCategory)) require(a.remediation.action === 'stop');
    refs(a.remediation.evidenceRefs, true);
    refs(a.remediation.checkRefs, true);
    for (const ref of a.remediation.checkRefs) require(a.checks.some((c) => c.resultRef === ref));
  }
  exact(a.metrics, [
    'durationMs',
    'timeSource',
    'corrections',
    'revalidations',
    'scopeViolations',
    'qaFindings',
  ]);
  for (const field of [
    'durationMs',
    'corrections',
    'revalidations',
    'scopeViolations',
    'qaFindings',
  ])
    count(a.metrics[field]);
  if (a.metrics.durationMs === null) require(a.metrics.timeSource === null);
  else oneOf(a.metrics.timeSource, ['monotonic-clock', 'host-metadata']);
  exact(a.usage, ['tokens', 'cost', 'reference']);
  count(a.usage.tokens);
  require(a.usage.cost === null || (Number.isFinite(a.usage.cost) && a.usage.cost >= 0));
  if (a.usage.reference !== null) reference(a.usage.reference);
  if (a.usage.tokens !== null || a.usage.cost !== null) require(a.usage.reference !== null);
}

export function resolveModelRunEvidencePath(repoRoot, date, runId, environment = {}) {
  identifier(runId);
  require(typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date));
  require(Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date);
  const configured = environment.REPO_ARTIFACTS_DIR;
  if (configured !== undefined)
    require(typeof configured === 'string' && !configured.split(/[\\/]/).includes('..'));
  const root = resolve(repoRoot, 'artifacts/local');
  const path = resolveArtifactPath(
    repoRoot,
    ['agent-thread-lifecycle', date, 'model-activation', runId, 'attempts.json'],
    environment,
  );
  const rel = relative(root, path);
  require(rel !== '' && !isAbsolute(rel) && !rel.split(/[\\/]/).includes('..'));
  return path;
}

// Explicit opt-in I/O only. Caller owns directory creation, symlink checks and safe writer cleanup.
export async function writeModelRunEvidence({
  record,
  repoRoot,
  date,
  writeFile,
  environment = {},
}) {
  const validated = createModelRunEvidence(record);
  const path = resolveModelRunEvidencePath(repoRoot, date, validated.runId, environment);
  require(typeof writeFile === 'function');
  try {
    await writeFile(path, `${JSON.stringify(validated, null, 2)}\n`);
    return { status: 'written', reference: path, errorCode: null, recoveryBlocked: false };
  } catch {
    return {
      status: 'observability-gap',
      reference: null,
      errorCode: 'write-failed',
      recoveryBlocked: false,
    };
  }
}

function exact(value, fields) {
  require(
    value !== null &&
      typeof value === 'object' &&
      Object.getPrototypeOf(value) === Object.prototype,
  );
  require(
    Reflect.ownKeys(value).length === fields.length && fields.every((f) => Object.hasOwn(value, f)),
  );
}
function identifier(value) {
  require(typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,159}$/.test(value));
}
function digest(value) {
  require(typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value));
}
function reference(value) {
  require(
    typeof value === 'string' &&
      /^(evidence|artifact|command|source):[a-zA-Z0-9][a-zA-Z0-9_-]{0,159}$/.test(value),
  );
}
function refs(values, nonempty = false) {
  require(Array.isArray(values) && values.length <= 64 && (!nonempty || values.length > 0));
  for (const value of values) reference(value);
}
function pair(value, efforts = ['medium', 'high', 'xhigh']) {
  exact(value, ['model', 'effort']);
  oneOf(value.model, [BASELINE_CHILD_MODEL, 'gpt-6-sol', 'gpt-6-luna']);
  oneOf(value.effort, efforts);
}
function observedPair(value) {
  // Observed Astra low is a diagnostic fact, not permission for an unbound low request.
  pair(
    value,
    value?.model === BASELINE_CHILD_MODEL ? ['low', 'medium', 'high', 'xhigh'] : undefined,
  );
}
function matchingPairs(a) {
  return (
    (a.resolved === null || isDeepStrictEqual(a.requested, a.resolved)) &&
    (a.hostObserved === null || isDeepStrictEqual(a.resolved, a.hostObserved))
  );
}
function count(value) {
  require(value === null || (Number.isSafeInteger(value) && value >= 0));
}
function oneOf(value, choices) {
  require(choices.includes(value));
}
function require(condition) {
  if (!condition) throw new TypeError('Invalid bounded model-run evidence.');
}
function freeze(value) {
  for (const child of Object.values(value)) if (child && typeof child === 'object') freeze(child);
  return Object.freeze(value);
}
