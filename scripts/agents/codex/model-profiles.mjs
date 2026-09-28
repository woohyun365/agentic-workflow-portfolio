import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

export const BASELINE_CHILD_MODEL = 'gpt-6-astra';
// Bump for eligibility changes outside this data, too. Old grants never migrate implicitly.
const POLICY_REVISION = '2026-09-24.3';
const PROFILES = deepFreeze({
  'bounded-build': {
    profileId: 'bounded-build',
    policyRevision: POLICY_REVISION,
    model: 'gpt-6-sol',
    resolvedEffort: 'xhigh',
    cohort: 'bounded-implementation',
    taskKinds: ['implementation', 'test'],
    roles: ['repo_executor'],
    routineRoles: ['repo_executor'],
    impactRisks: ['low', 'medium'],
    verificationKeys: ['acceptance', 'regression', 'astraQa'],
    readOnly: false,
    allowedTools: ['repository-read', 'workspace-edit', 'test-runner'],
    requiredTools: ['workspace-edit', 'test-runner'],
  },
  'bounded-read': {
    profileId: 'bounded-read',
    policyRevision: POLICY_REVISION,
    model: 'gpt-6-sol',
    resolvedEffort: 'xhigh',
    cohort: 'bounded-read-only',
    taskKinds: ['lookup', 'analysis', 'research'],
    roles: ['repo_explorer', 'repo_researcher'],
    // Researcher remains pilot-only until independently validated for routine use.
    routineRoles: ['repo_explorer'],
    impactRisks: ['low', 'medium'],
    verificationKeys: ['acceptance', 'independentCheck'],
    readOnly: true,
    allowedTools: ['repository-read', 'official-web-read'],
    requiredTools: [],
  },
  'bounded-extract': {
    profileId: 'bounded-extract',
    policyRevision: POLICY_REVISION,
    model: 'gpt-6-luna',
    resolvedEffort: 'xhigh',
    cohort: 'bounded-extraction',
    taskKinds: ['lookup', 'analysis'],
    roles: ['repo_explorer'],
    routineRoles: ['repo_explorer'],
    impactRisks: ['low'],
    verificationKeys: [
      'acceptance',
      'fixedInput',
      'outputSchema',
      'singleStep',
      'independentCheck',
    ],
    readOnly: true,
    allowedTools: ['repository-read'],
    requiredTools: [],
  },
});

export function getModelProfile(profileId) {
  if (typeof profileId !== 'string' || !Object.hasOwn(PROFILES, profileId))
    throw new TypeError(`Unknown model profile: ${String(profileId)}`);
  return PROFILES[profileId];
}

// Pure fingerprint, not registry injection or authority. Runtime always checks installed data.
export function createModelProfileBinding(profile) {
  const { profileId, policyRevision, model, resolvedEffort, cohort } = profile;
  return deepFreeze({
    profileId,
    policyRevision,
    profileDigest: `sha256:${createHash('sha256')
      .update(JSON.stringify(canonical(profile)))
      .digest('hex')}`,
    model,
    resolvedEffort,
    cohort,
  });
}

export function assertCurrentModelProfileBinding(binding) {
  const expected = createModelProfileBinding(getModelProfile(binding?.profileId));
  if (!isDeepStrictEqual(binding, expected))
    throw new TypeError('Model profile binding must match the current installed policy.');
  return expected;
}

// A separate recovery policy: never an ordinary candidate or a raw effort override.
export function createRecoveryBinding({ primary, rescue, assessment, ...extra }) {
  recoveryAssert(Object.keys(extra).length === 0);
  recoveryExact(primary, [
    'profileBinding',
    'attemptId',
    'taskId',
    'laneId',
    'childId',
    'sourceDigest',
    'scopeDigest',
    'ownershipDigest',
    'failureCategory',
  ]);
  assertCurrentModelProfileBinding(primary.profileBinding);
  recoveryExact(rescue, [
    'attemptId',
    'taskId',
    'laneId',
    'sourceDigest',
    'scopeDigest',
    'configDigest',
    'role',
    'semanticEffort',
    'impactRisk',
  ]);
  recoveryExact(assessment, [
    'cause',
    'bounded',
    'contextComplete',
    'oracleAvailable',
    'identityVerified',
    'reasonRefs',
  ]);
  for (const identity of [primary, rescue]) {
    for (const field of ['attemptId', 'taskId', 'laneId'])
      recoveryAssert(
        typeof identity[field] === 'string' &&
          /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,159}$/.test(identity[field]),
      );
    for (const field of ['sourceDigest', 'scopeDigest']) recoveryDigest(identity[field]);
  }
  recoveryDigest(rescue.configDigest);
  recoveryDigest(primary.ownershipDigest);
  recoveryAssert(
    [
      'verification-failed',
      'tool-unavailable',
      'repository-evidence-missing',
      'official-source-unavailable',
      'unknown',
    ].includes(primary.failureCategory),
  );
  recoveryAssert(
    typeof primary.childId === 'string' &&
      /^\/?[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(primary.childId) &&
      primary.childId.length <= 160,
  );
  recoveryAssert(
    primary.taskId === rescue.taskId &&
      primary.laneId === rescue.laneId &&
      primary.attemptId !== rescue.attemptId,
  );
  recoveryAssert(['repo_executor', 'repo_explorer', 'repo_researcher'].includes(rescue.role));
  recoveryAssert(getModelProfile(primary.profileBinding.profileId).roles.includes(rescue.role));
  recoveryAssert(['medium', 'high', 'xhigh'].includes(rescue.semanticEffort));
  recoveryAssert(['low', 'medium', 'high'].includes(rescue.impactRisk));
  recoveryAssert(
    [
      'controlled-injection',
      'code-defect',
      'context-missing',
      'tool-fixture-environment',
      'task-model-mismatch',
      'reasoning-miss',
      'unknown',
    ].includes(assessment.cause),
  );
  for (const field of ['bounded', 'contextComplete', 'oracleAvailable', 'identityVerified'])
    recoveryAssert(typeof assessment[field] === 'boolean');
  recoveryAssert(
    assessment.identityVerified && assessment.contextComplete && assessment.oracleAvailable,
  );
  recoveryAssert(
    Array.isArray(assessment.reasonRefs) &&
      assessment.reasonRefs.length > 0 &&
      assessment.reasonRefs.length <= 16,
  );
  for (const ref of assessment.reasonRefs)
    recoveryAssert(
      typeof ref === 'string' && /^evidence:[a-zA-Z0-9][a-zA-Z0-9_-]{0,159}$/.test(ref),
    );
  const bounded =
    ['controlled-injection', 'code-defect', 'context-missing', 'tool-fixture-environment'].includes(
      assessment.cause,
    ) &&
    assessment.bounded &&
    assessment.contextComplete &&
    assessment.oracleAvailable &&
    rescue.impactRisk !== 'high' &&
    rescue.semanticEffort === 'medium';
  const data = {
    kind: 'model-recovery',
    policyRevision: POLICY_REVISION,
    policyId: bounded ? 'astra-bounded-recovery' : 'astra-standard-recovery',
    model: BASELINE_CHILD_MODEL,
    resolvedEffort: bounded ? 'low' : rescue.semanticEffort,
    primary,
    rescue,
    assessment,
  };
  return deepFreeze(
    structuredClone({
      ...data,
      selectionDigest: `sha256:${createHash('sha256')
        .update(JSON.stringify(canonical(data)))
        .digest('hex')}`,
    }),
  );
}

export function assertCurrentRecoveryBinding(binding) {
  const expected = createRecoveryBinding({
    primary: binding?.primary,
    rescue: binding?.rescue,
    assessment: binding?.assessment,
  });
  recoveryAssert(isDeepStrictEqual(binding, expected));
  return expected;
}
function recoveryAssert(valid) {
  if (!valid) throw new TypeError('Recovery binding must match the current bounded policy.');
}
function recoveryExact(value, keys) {
  recoveryAssert(
    value &&
      Object.getPrototypeOf(value) === Object.prototype &&
      Reflect.ownKeys(value).length === keys.length &&
      keys.every((key) => Object.hasOwn(value, key)),
  );
}
function recoveryDigest(value) {
  recoveryAssert(typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value));
}

// Semantic route effort classifies risk; a finite candidate profile resolves invocation effort.
export function resolveRouteEffort(route) {
  return route.modelRecommendation?.status === 'candidate'
    ? assertCurrentModelProfileBinding(route.modelRecommendation.profileBinding).resolvedEffort
    : route.effort;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}

function deepFreeze(value) {
  for (const child of Object.values(value))
    if (child && typeof child === 'object') deepFreeze(child);
  return Object.freeze(value);
}
