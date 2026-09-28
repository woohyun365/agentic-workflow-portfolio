import {
  BASELINE_CHILD_MODEL,
  getModelProfile,
  assertCurrentModelProfileBinding,
  resolveRouteEffort,
  createRecoveryBinding,
  assertCurrentRecoveryBinding,
} from './model-profiles.mjs';
import { isDeepStrictEqual } from 'node:util';
import { assertRecoveryChildContract, createModelScopeDigest } from './child-task-contract.mjs';
import { recommendModel } from './routing-policy.mjs';

const HARD_CHILD_LIMIT = 6;
const DEFAULT_CONCURRENCY_LIMIT = 3;
const REPOSITORY_CHILD_MODEL = BASELINE_CHILD_MODEL;
const MAX_REPORTED_ROLES = 24;
const EFFORTS = new Set(['medium', 'high', 'xhigh']);
const INSTALLED_ROLES = new Set(['repo_explorer', 'repo_researcher', 'repo_executor', 'repo_reviewer']);
const RUNTIME_SURFACES = new Set(['native', 'omx']);
const RUNTIME_OBSERVATION_SCOPES = new Set(['current-turn', 'current-session']);
const RUNTIME_PROVENANCE = new Set(['host-tool-schema', 'omx-runtime-overlay']);
const RUNTIME_DISPATCH_PERMISSIONS = new Set(['allowed', 'denied', 'unknown']);
const RUNTIME_EVIDENCE_FIELDS = new Set([
  'schemaVersion',
  'surfaceMode',
  'observationScope',
  'freshness',
  'provenance',
  'dispatchPermission',
  'roles',
]);
const RUNTIME_ROLE_FIELDS = new Set([
  'agentType',
  'available',
  'effectiveModel',
  'effectiveEffort',
  'explicitEffortSupport',
  'modelSelection',
  'configurationResolution',
]);
const RESULT_STATUSES = new Set(['completed', 'blocked', 'failed']);
const CONFIDENCE = new Set(['low', 'medium', 'high']);
const VERIFICATION_STATUSES = new Set(['passed', 'failed', 'not-run']);
const ATTEMPT_OUTCOMES = new Set(['success', 'failure']);
const DELEGATION_EXECUTIONS = new Set(['direct', 'single-sequential', 'bounded-lanes']);
const RECOVERY_STATUSES = new Set([
  'not-started',
  'complete',
  'alternate-available',
  'handoff-required',
]);
const RECOVERY_ACTIONS = new Set([
  'primary-attempt',
  'none',
  'alternate-once',
  'leader-sequential-fallback',
  'terminal-handoff',
]);
const RECOVERY_DISPOSITIONS = new Set([
  'plan-oq',
  'user-handoff',
  'evidence-gap',
  'leader-sequential',
  'blocker-handoff',
]);
const FAILURE_CATEGORIES = new Set([
  'official-source-unavailable',
  'repository-evidence-missing',
  'role-routing-unavailable',
  'tool-unavailable',
  'verification-failed',
  'scope-conflict',
  'missing-authority',
  'credential-required',
  'external-production',
  'unknown',
  'quota-exhausted',
  'capacity-denied',
]);
const NON_RETRYABLE_FAILURES = new Set([
  'quota-exhausted',
  'capacity-denied',
  'role-routing-unavailable',
  'scope-conflict',
  'missing-authority',
  'credential-required',
  'external-production',
]);
const CHILD_RESULT_FIELDS = new Set([
  'laneId',
  'status',
  'outputs',
  'facts',
  'inferences',
  'gaps',
  'confidence',
  'verification',
  'blocker',
]);

export function createDispatchRecommendation({
  delegation,
  reportedRuntimeEvidence = null,
  concurrencyLimit = DEFAULT_CONCURRENCY_LIMIT,
  modelUseByLane = {},
  recoveryDecision,
} = {}) {
  if (recoveryDecision !== undefined)
    return createRecoveryDispatch({
      delegation,
      reportedRuntimeEvidence,
      concurrencyLimit,
      modelUseByLane,
      recoveryDecision,
    });
  assertDelegationRecommendation(delegation);
  validateModelUses(modelUseByLane, delegation.recommendedChildren);
  const runtime = normalizeReportedRuntimeEvidence(reportedRuntimeEvidence);
  validateConcurrencyLimit(concurrencyLimit);

  if (delegation.execution !== 'bounded-lanes' || delegation.recommendedChildren.length < 1) {
    return dispatchRecommendation({
      delegation,
      execution: delegation.execution === 'direct' ? 'leader-direct' : 'leader-sequential',
      reason: 'The delegation recommendation does not authorize bounded child lanes.',
      dispatches: [],
      deferredLaneIds: delegation.recommendedChildren.map(({ laneId }) => laneId),
      runtime,
      concurrencyLimit,
      gaps: [],
    });
  }

  if (runtime.evidenceStatus !== 'accepted') {
    return dispatchRecommendation({
      delegation,
      execution: 'leader-sequential',
      reason: 'The reported runtime evidence is missing, stale, or incompatible with this policy.',
      dispatches: [],
      deferredLaneIds: delegation.recommendedChildren.map(({ laneId }) => laneId),
      runtime,
      concurrencyLimit,
      gaps: unique(['runtime-capability-fallback', ...runtime.gaps]),
    });
  }

  // The role-keyed roster cannot resolve concurrent same-role/different-model lanes.
  const hasCandidate = delegation.recommendedChildren.some(
    (contract) => contract.routeRecommendation.modelRecommendation?.status === 'candidate',
  );
  const batchLimit = hasCandidate ? 1 : concurrencyLimit;
  const selected = delegation.recommendedChildren.slice(0, batchLimit);
  const deferred = delegation.recommendedChildren.slice(batchLimit);
  const compatibility = assessRuntimeCompatibility(runtime, selected, modelUseByLane);
  if (!compatibility.compatible) {
    return dispatchRecommendation({
      delegation,
      execution: 'leader-sequential',
      reason: 'The current reported runtime cannot honor every selected child route safely.',
      dispatches: [],
      deferredLaneIds: delegation.recommendedChildren.map(({ laneId }) => laneId),
      runtime,
      concurrencyLimit,
      gaps: unique(['runtime-capability-fallback', ...compatibility.gaps]),
    });
  }

  const dispatches = selected.map((contract) => {
    const reportedRole = compatibility.rolesByAgentType.get(contract.routeRecommendation.role);
    return {
      laneId: contract.laneId,
      agentType: contract.routeRecommendation.role,
      effort: contract.routeRecommendation.effort,
      effectiveModel: reportedRole.effectiveModel,
      effectiveEffort: reportedRole.effectiveEffort,
      explicitEffortSupport: reportedRole.explicitEffortSupport,
      contract,
      dispatchOwner: 'leader',
      runtimeSurface: runtime.surfaceMode === 'omx' ? 'omx-native-child' : 'native-child',
      requiresLeaderRuntimeConfirmation: true,
      ...(usesOrdinaryScopedArguments(runtime, contract)
        ? {
            spawnArguments: {
              agent_type: contract.routeRecommendation.role,
              model: REPOSITORY_CHILD_MODEL,
              reasoning_effort: resolveRouteEffort(contract.routeRecommendation),
              fork_turns: 'none',
            },
            runtimeAction: false,
          }
        : {}),
      ...(contract.routeRecommendation.modelRecommendation
        ? {
            requestedModel: contract.routeRecommendation.modelRecommendation.profileBinding.model,
            recommendedModel: contract.routeRecommendation.modelRecommendation.recommendedModel,
            modelPurpose: contract.routeRecommendation.modelRecommendation.request.purpose,
            resolvedModel:
              reportedRole.configurationResolution?.model ?? reportedRole.effectiveModel,
            resolvedEffort:
              reportedRole.configurationResolution?.effort ?? reportedRole.effectiveEffort,
            ...(contract.routeRecommendation.modelRecommendation.status === 'candidate' &&
            reportedRole.configurationResolution
              ? {
                  spawnArguments: {
                    agent_type: contract.routeRecommendation.role,
                    model: contract.routeRecommendation.modelRecommendation.recommendedModel,
                    reasoning_effort: resolveRouteEffort(contract.routeRecommendation),
                    fork_turns: 'none',
                  },
                  configurationResolution: reportedRole.configurationResolution,
                }
              : {}),
            runtimeAction: false,
          }
        : {}),
    };
  });

  return dispatchRecommendation({
    delegation,
    execution: 'native-bounded-dispatch',
    reason: `${dispatches.length} typed lane(s) are ready for leader-controlled native dispatch.`,
    dispatches,
    deferredLaneIds: deferred.map(({ laneId }) => laneId),
    runtime,
    concurrencyLimit,
    gaps:
      deferred.length > 0
        ? [
            `${hasCandidate ? 'model-sequential-rollout' : 'runtime-concurrency-limit'}: ${deferred.length} lane(s) deferred.`,
          ]
        : [],
  });
}

// Reports are caller-supplied evidence, never authenticated execution or authority.
export function evaluateModelExecution({ dispatch, expectedChildId, reportedExecution } = {}) {
  if (dispatch?.kind === 'model-recovery')
    return evaluateRecoveryExecution({ dispatch, expectedChildId, reportedExecution });
  const gaps = [];
  let observation = null;
  try {
    requireString(expectedChildId, 'returned child identity', 160);
    const contract = dispatch.contract;
    assertSemanticRouteRecommendation(contract.routeRecommendation);
    assertCurrentModelRecommendation(contract);
    gaps.push(...assessModelContractBoundary(contract));
    normalizeConfigurationResolution(dispatch.configurationResolution);
    if (
      dispatch.runtimeAction !== false ||
      contract.routeRecommendation.modelRecommendation.status !== 'candidate' ||
      dispatch.resolvedModel !==
        contract.routeRecommendation.modelRecommendation.recommendedModel ||
      dispatch.resolvedEffort !== resolveRouteEffort(contract.routeRecommendation) ||
      contract.modelScopeDigest !== createModelScopeDigest(contract) ||
      !isDeepStrictEqual(dispatch.spawnArguments, {
        agent_type: contract.routeRecommendation.role,
        model: contract.routeRecommendation.modelRecommendation.recommendedModel,
        reasoning_effort: resolveRouteEffort(contract.routeRecommendation),
        fork_turns: 'none',
      }) ||
      dispatch.resolvedModel !== dispatch.configurationResolution.model ||
      dispatch.resolvedEffort !== dispatch.configurationResolution.effort
    )
      gaps.push('model-dispatch-resolution-invalid');
    requireExactRecord(
      reportedExecution,
      [
        'childId',
        'profileBinding',
        'taskId',
        'scopeDigest',
        'provenance',
        'accepted',
        'executed',
        'resultReference',
        'independentCheck',
        'hostMetadata',
        'usageReference',
      ],
      'model execution',
    );
    observation = reportedExecution;
    const profileBinding = assertCurrentModelProfileBinding(observation.profileBinding);
    if (
      !isDeepStrictEqual(
        profileBinding,
        contract.routeRecommendation.modelRecommendation.profileBinding,
      ) ||
      !isDeepStrictEqual(profileBinding, dispatch.configurationResolution.profileBinding)
    )
      gaps.push('model-execution-profile-mismatch');
    if (
      observation.childId !== expectedChildId ||
      observation.taskId !== contract.modelTaskId ||
      observation.scopeDigest !== contract.modelScopeDigest
    )
      gaps.push('model-execution-identity-mismatch');
    if (
      observation.provenance !== 'native-tool-result' ||
      observation.accepted !== true ||
      observation.executed !== true
    )
      gaps.push('model-execution-unverified');
    requireString(observation.resultReference, 'native result reference', 300);
    requireExactRecord(observation.independentCheck, ['status', 'reference'], 'independent check');
    requireString(observation.independentCheck.reference, 'independent check reference', 300);
    if (observation.independentCheck.status !== 'passed')
      gaps.push('model-independent-quality-not-passed');
    if (observation.hostMetadata !== null) {
      requireExactRecord(observation.hostMetadata, ['model', 'effort'], 'host model metadata');
      if (
        observation.hostMetadata.model !== dispatch.resolvedModel ||
        observation.hostMetadata.effort !== dispatch.resolvedEffort
      )
        gaps.push('model-host-metadata-mismatch');
    }
    if (observation.usageReference !== null)
      requireString(observation.usageReference, 'usage reference', 300);
  } catch {
    gaps.push('model-execution-evidence-invalid');
  }
  return deepFreeze({
    accepted: gaps.length === 0,
    evidenceKind: gaps.length
      ? 'unverified'
      : observation.hostMetadata
        ? 'host-reported-model'
        : 'runtime-contract-resolved',
    providerAttested: false,
    usageReference: gaps.length ? null : observation.usageReference,
    authority: 'leader-reported-not-host-authenticated',
    requiresLeaderRuntimeConfirmation: true,
    runtimeAction: false,
    gaps,
  });
}

// Separate from reported role evidence. Every observation remains leader-reported;
// this evaluator neither authenticates the host nor performs a lifecycle action.
export function createLifecycleRecommendation(input) {
  validateLifecycleEvidence(input);
  const { intent, observation, target, capabilities, result, retention, close, release } = input;
  const closeObserved = close.status !== 'not-attempted' || target.state === 'closed';
  let resultDisposition = 'unverified';
  let cleanupDisposition = 'unknown';
  let releaseDisposition = 'release-unverified';
  const decide = (recommendation, reason, closeDisposition) =>
    deepFreeze({
      schemaVersion: 1,
      intent,
      target: { parentId: target.parentId, childId: target.childId, taskId: target.taskId },
      recommendation,
      reason,
      gaps: [
        'close-eligible',
        'continue',
        'retained-for-followup',
        'status-only',
        'no-explicit-close-required',
      ].includes(reason)
        ? []
        : [reason],
      resultDisposition,
      cleanupDisposition,
      closeDisposition: closeDisposition ?? (closeObserved ? 'close-unverified' : 'not-attempted'),
      releaseDisposition,
      authority: 'leader-reported-not-host-authenticated',
      requiresLeaderRuntimeConfirmation: true,
    });

  if (
    observation.scope === 'unknown' ||
    observation.freshness !== 'current-turn' ||
    observation.provenance !== 'native-tools'
  )
    return decide('unsupported', 'observation-unverified');
  if (
    !target.parentId ||
    !target.childId ||
    !target.taskId ||
    target.ownerParentId !== target.parentId ||
    target.isRoot !== false ||
    target.childId === target.parentId ||
    target.observedTaskId !== target.taskId
  )
    return decide('unsupported', 'target-unverified');
  if (observation.actionPermission !== 'allowed') {
    return decide('unsupported', 'action-not-authorized');
  }

  const sameTarget = (event) => event.childId === target.childId && event.taskId === target.taskId;
  if (
    (close.status !== 'not-attempted' && !sameTarget(close)) ||
    (release.status === 'confirmed' && !sameTarget(release))
  )
    return decide('unsupported', 'lifecycle-observation-mismatch');

  // Collection of this task's final result does not prove a quiescent child.
  resultDisposition =
    result.collected === true && result.delivery === 'final' && result.taskId === target.taskId
      ? 'collected'
      : 'uncollected';
  if (target.pendingTasks !== 0 || target.pendingTools !== 0 || target.pendingMailbox !== 0)
    return decide('wait', 'pending-work');
  if (['running', 'waiting', 'unknown'].includes(target.state)) {
    return decide('wait', 'work-not-terminal');
  }
  if (resultDisposition !== 'collected') {
    return decide('retain', 'result-uncollected');
  }

  // An applicable contract is reported by the Parent, never inferred from a tool
  // name, local feature flag, source tag, or the absence of close alone.
  const runtimeManaged =
    input.lifecycleContract?.cleanup === 'runtime-managed' &&
    input.lifecycleContract.verification === 'current-host';
  if (runtimeManaged && capabilities.close !== false)
    return decide('unsupported', 'lifecycle-contract-conflict');

  // Resource release has its own correlated observation, even without close.
  releaseDisposition = release.status === 'confirmed' ? 'release-confirmed' : 'release-unverified';
  // A final task result is not proof of close. A successful close report also
  // needs the correlated fresh closed post-state.
  if (close.status === 'succeeded' && target.state === 'closed' && capabilities.close === true) {
    cleanupDisposition = 'satisfied';
    return decide('none', 'status-only', 'closed-confirmed');
  }
  if (close.status === 'failed') return decide('retain', 'close-failed', 'cleanup-failed');
  if (closeObserved) {
    return decide('retain', 'close-outcome-unverified', 'close-unverified');
  }
  if (intent === 'status') return decide('none', 'status-only');
  if (intent === 'continue') {
    if (release.status === 'confirmed')
      return decide('retain', 'released-target-requires-confirmation');
    return capabilities.startTurn === true
      ? decide('continue', 'continue')
      : decide('unsupported', 'start-turn-unsupported');
  }
  if (retention !== null) return decide('retain', 'retained-for-followup');
  if (runtimeManaged) {
    if (target.state !== 'completed') return decide('wait', 'work-not-terminal');
    cleanupDisposition = 'not-required';
    return decide('none', 'no-explicit-close-required');
  }
  if (capabilities.close !== true)
    return decide('unsupported', 'close-unsupported', 'cleanup-unavailable');
  if (target.state !== 'completed') return decide('wait', 'work-not-terminal');
  cleanupDisposition = 'required';
  if (release.status === 'confirmed')
    return decide('retain', 'released-target-requires-confirmation');
  return decide('close-eligible', 'close-eligible');
}

function validateLifecycleEvidence(value) {
  requireLifecycleRecord(
    value,
    [
      'schemaVersion',
      'intent',
      'observation',
      'target',
      'capabilities',
      'result',
      'retention',
      'close',
      'release',
    ],
    'input',
    ['lifecycleContract'],
  );
  if (value.schemaVersion !== 1) throw new TypeError('Unsupported lifecycle schemaVersion.');
  requireEnum(value.intent, new Set(['cleanup', 'continue', 'status']), 'lifecycle intent');
  requireLifecycleRecord(
    value.observation,
    ['scope', 'freshness', 'provenance', 'actionPermission'],
    'observation',
  );
  requireLifecycleRecord(
    value.target,
    [
      'parentId',
      'childId',
      'ownerParentId',
      'taskId',
      'observedTaskId',
      'isRoot',
      'state',
      'pendingTasks',
      'pendingTools',
    ],
    'target',
    ['pendingMailbox'],
  );
  requireLifecycleRecord(value.capabilities, ['close', 'startTurn'], 'capabilities');
  requireLifecycleRecord(value.result, ['taskId', 'collected', 'delivery'], 'result');
  requireLifecycleRecord(value.close, ['status', 'childId', 'taskId'], 'close');
  requireLifecycleRecord(value.release, ['status', 'childId', 'taskId'], 'release');

  for (const [field, choices] of Object.entries({
    scope: ['current-turn', 'current-session', 'unknown'],
    freshness: ['current-turn', 'stale', 'unknown'],
    provenance: ['native-tools', 'unknown'],
    actionPermission: ['allowed', 'denied', 'unknown'],
  }))
    requireEnum(value.observation[field], new Set(choices), `lifecycle observation.${field}`);
  for (const [field, entry, choices] of [
    [
      'target.state',
      value.target.state,
      ['running', 'waiting', 'idle', 'completed', 'closed', 'unknown'],
    ],
    ['result.delivery', value.result.delivery, ['final', 'queued', 'timeout', 'unknown']],
    ['close.status', value.close.status, ['not-attempted', 'succeeded', 'failed', 'unknown']],
    ['release.status', value.release.status, ['unknown', 'confirmed']],
  ])
    requireEnum(entry, new Set(choices), `lifecycle ${field}`);

  for (const [field, entry] of [
    ['parentId', value.target.parentId],
    ['childId', value.target.childId],
    ['ownerParentId', value.target.ownerParentId],
    ['taskId', value.target.taskId],
    ['observedTaskId', value.target.observedTaskId],
    ['result.taskId', value.result.taskId],
    ['close.childId', value.close.childId],
    ['close.taskId', value.close.taskId],
    ['release.childId', value.release.childId],
    ['release.taskId', value.release.taskId],
  ]) {
    if (entry === null) continue;
    // Native IDs may be UUIDs or paths; do not coerce/trim them into a match.
    if (requireString(entry, `lifecycle ${field}`, 256) !== entry) {
      throw new TypeError(`lifecycle ${field} must be an exact identifier.`);
    }
  }
  for (const [field, entry] of [
    ['isRoot', value.target.isRoot],
    ['close', value.capabilities.close],
    ['startTurn', value.capabilities.startTurn],
    ['collected', value.result.collected],
  ])
    if (entry !== null) requireBoolean(entry, `lifecycle ${field}`);
  for (const field of ['pendingTasks', 'pendingTools', 'pendingMailbox']) {
    if (field === 'pendingMailbox' && !Object.hasOwn(value.target, field)) continue;
    if (value.target[field] !== null) {
      requireBoundedInteger(value.target[field], `lifecycle ${field}`, 0, Number.MAX_SAFE_INTEGER);
    }
  }
  if (Object.hasOwn(value, 'lifecycleContract') && value.lifecycleContract !== null) {
    const contract = value.lifecycleContract;
    requireLifecycleRecord(contract, ['cleanup', 'verification', 'reference'], 'lifecycleContract');
    requireEnum(
      contract.cleanup,
      new Set(['explicit-close', 'runtime-managed', 'unknown']),
      'lifecycle contract.cleanup',
    );
    requireEnum(
      contract.verification,
      new Set(['current-host', 'unverified']),
      'lifecycle contract.verification',
    );
    if (contract.reference !== null || contract.verification === 'current-host') {
      requireString(contract.reference, 'lifecycle contract.reference', 500);
    }
  }
  if (value.retention !== null) {
    requireLifecycleRecord(value.retention, ['reason', 'revisit'], 'retention');
    requireString(value.retention.reason, 'lifecycle retention.reason', 500);
    requireString(value.retention.revisit, 'lifecycle retention.revisit', 500);
  }
}

function requireLifecycleRecord(value, fields, name, optionalFields = []) {
  requireExactRecord(value, fields, `lifecycle ${name}`, optionalFields);
}

function requireExactRecord(value, fields, name, optionalFields = []) {
  if (
    !value ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.keys(value).some(
      (field) => !fields.includes(field) && !optionalFields.includes(field),
    ) ||
    fields.some((field) => !Object.hasOwn(value, field))
  ) {
    throw new TypeError(
      `${name} must contain exactly: ${fields.join(', ')}; optional: ${optionalFields.join(', ')}.`,
    );
  }
}

export function evaluateRecovery({ laneId, attempts = [], modelRecovery } = {}) {
  const result = evaluateAttemptRecovery({ laneId, attempts });
  if (modelRecovery === undefined) {
    if (
      attempts.some(
        (attempt) =>
          Object.hasOwn(attempt, 'model') || attempt.recoveryBinding || attempt.effort === 'low',
      )
    )
      throw new TypeError('Explicit model recovery requires a current profile binding.');
    return result;
  }
  requireExactRecord(modelRecovery, ['profileBinding', 'pendingWriter'], 'model recovery', [
    'request',
  ]);
  const binding = assertCurrentModelProfileBinding(modelRecovery.profileBinding);
  if (
    modelRecovery.request === undefined &&
    attempts.some((a) => a.recoveryBinding || a.effort === 'low')
  )
    throw new TypeError('Bound invocation recovery requires its original selection request.');
  requireEnum(
    modelRecovery.pendingWriter,
    new Set(['cleared', 'pending', 'unknown']),
    'pending writer',
  );
  for (const [index, attempt] of attempts.entries()) {
    if (attempt.model !== (index === 0 ? binding.model : REPOSITORY_CHILD_MODEL))
      throw new TypeError('Model recovery requires the exact primary model then Astra only.');
  }
  if (attempts.length > 1 && NON_RETRYABLE_FAILURES.has(attempts[0].failureCategory))
    throw new TypeError('Model recovery cannot retry a non-retryable failure.');
  const waiting = result.action === 'alternate-once' && modelRecovery.pendingWriter !== 'cleared';
  let recoveryBinding;
  if (
    modelRecovery.request !== undefined &&
    attempts[0]?.outcome === 'failure' &&
    !NON_RETRYABLE_FAILURES.has(attempts[0].failureCategory) &&
    modelRecovery.pendingWriter === 'cleared'
  ) {
    const request = modelRecovery.request;
    requireExactRecord(
      request,
      [
        'primaryContract',
        'rescueContract',
        'sourceDigest',
        'configDigest',
        'attemptId',
        'assessment',
      ],
      'recovery request',
    );
    const { primaryContract: primary, rescueContract: rescue } = request;
    assertCurrentModelRecommendation(primary);
    assertSemanticRouteRecommendation(rescue.routeRecommendation);
    if (
      !isDeepStrictEqual(primary.routeRecommendation.modelRecommendation.profileBinding, binding) ||
      primary.laneId !== laneId ||
      rescue.laneId !== laneId ||
      primary.routeRecommendation.role !== rescue.routeRecommendation.role ||
      !isDeepStrictEqual(primary.boundary, rescue.boundary) ||
      !isDeepStrictEqual(primary.allowed, rescue.allowed)
    )
      throw new TypeError('Recovery cannot expand or change the authorized owner/role boundary.');
    const first = attempts[0];
    if (
      !first.executed ||
      first.effort !== binding.resolvedEffort ||
      first.identity?.taskId !== primary.modelTaskId ||
      first.identity.scopeDigest !== primary.modelScopeDigest ||
      primary.modelScopeDigest !== createModelScopeDigest(primary)
    )
      throw new TypeError('Recovery requires an executed, exact failed primary identity.');
    recoveryBinding = createRecoveryBinding({
      primary: {
        profileBinding: binding,
        failureCategory: first.failureCategory,
        attemptId: first.approachId,
        laneId,
        ...first.identity,
        ownershipDigest: createModelScopeDigest({
          boundary: primary.boundary,
          allowed: primary.allowed,
        }),
      },
      rescue: {
        attemptId: request.attemptId,
        taskId: rescue.modelTaskId,
        laneId,
        sourceDigest: request.sourceDigest,
        configDigest: request.configDigest,
        scopeDigest: createModelScopeDigest(rescue),
        role: rescue.routeRecommendation.role,
        semanticEffort: rescue.routeRecommendation.effort,
        impactRisk: rescue.routeRecommendation.impactRisk,
      },
      assessment: request.assessment,
    });
    assertRecoveryChildContract(rescue, recoveryBinding);
    assertRecoveryAttempts(attempts, recoveryBinding);
  }
  if (!recoveryBinding && attempts.some((a) => a.recoveryBinding || a.effort === 'low'))
    throw new TypeError('An attributed alternate requires cleared current recovery selection.');
  return deepFreeze({
    ...result,
    ...(recoveryBinding ? { recoveryBinding } : {}),
    ...(waiting
      ? {
          status: 'handoff-required',
          action: 'terminal-handoff',
          remainingAlternateAttempts: 0,
          blocker: 'model-pending-writer-not-cleared',
          disposition: 'blocker-handoff',
        }
      : {}),
    nextModel: !waiting && result.action === 'alternate-once' ? REPOSITORY_CHILD_MODEL : null,
    runtimeAction: false,
  });
}

function evaluateAttemptRecovery({ laneId, attempts = [] } = {}) {
  const normalizedLaneId = requireIdentifier(laneId, 'laneId');
  if (!Array.isArray(attempts)) throw new TypeError('attempts must be an array.');
  if (attempts.length > 2) {
    throw new TypeError('Recovery allows one primary attempt and at most one alternate attempt.');
  }
  const normalizedAttempts = attempts.map((attempt, index) => normalizeAttempt(attempt, index));
  validateAttemptSequence(normalizedAttempts);

  if (normalizedAttempts.length === 0) {
    return recoveryDecision({
      laneId: normalizedLaneId,
      attempts: normalizedAttempts,
      status: 'not-started',
      action: 'primary-attempt',
      remainingAlternateAttempts: 1,
      blocker: null,
      disposition: null,
      confidence: 'high',
    });
  }

  const latest = normalizedAttempts.at(-1);
  if (latest.outcome === 'success') {
    return recoveryDecision({
      laneId: normalizedLaneId,
      attempts: normalizedAttempts,
      status: 'complete',
      action: 'none',
      remainingAlternateAttempts: 0,
      blocker: null,
      disposition: null,
      confidence: 'high',
    });
  }

  if (normalizedAttempts.length === 1 && !NON_RETRYABLE_FAILURES.has(latest.failureCategory)) {
    return recoveryDecision({
      laneId: normalizedLaneId,
      attempts: normalizedAttempts,
      status: 'alternate-available',
      action: 'alternate-once',
      remainingAlternateAttempts: 1,
      blocker: latest.evidence,
      disposition: null,
      confidence: 'high',
      prohibitedApproachIds: [latest.approachId],
    });
  }

  const disposition = terminalDisposition(latest.failureCategory);
  return recoveryDecision({
    laneId: normalizedLaneId,
    attempts: normalizedAttempts,
    status: 'handoff-required',
    action:
      latest.failureCategory === 'role-routing-unavailable'
        ? 'leader-sequential-fallback'
        : 'terminal-handoff',
    remainingAlternateAttempts: 0,
    blocker: latest.evidence,
    disposition,
    confidence: latest.failureCategory === 'unknown' ? 'low' : 'high',
  });
}

export function prepareLeaderSynthesis({
  delegation,
  childResults = [],
  recoveryDecisions = [],
  conflicts = [],
} = {}) {
  assertDelegationRecommendation(delegation);
  if (delegation.execution !== 'bounded-lanes') {
    throw new TypeError('Leader child synthesis requires a bounded-lanes delegation.');
  }
  if (!Array.isArray(childResults)) throw new TypeError('childResults must be an array.');
  if (!Array.isArray(recoveryDecisions)) {
    throw new TypeError('recoveryDecisions must be an array.');
  }

  const contracts = new Map(
    delegation.recommendedChildren.map((contract) => [contract.laneId, contract]),
  );
  const results = childResults.map((result) => normalizeChildResult(result, contracts));
  assertUnique(
    results.map(({ laneId }) => laneId),
    'child result laneId',
  );
  const normalizedRecoveries = recoveryDecisions.map(normalizeRecoveryDecision);
  assertUnique(
    normalizedRecoveries.map(({ laneId }) => laneId),
    'recovery laneId',
  );
  for (const recovery of normalizedRecoveries) {
    if (!contracts.has(recovery.laneId)) {
      throw new TypeError(`Recovery references an unknown lane: ${recovery.laneId}`);
    }
    if (recovery.recoveryBinding) {
      if (delegation.requestId !== recovery.recoveryBinding.rescue.taskId)
        throw new TypeError('Recovery synthesis must match the current delegation task.');
      assertRecoveryChildContract(contracts.get(recovery.laneId), recovery.recoveryBinding);
    }
    const result = results.find(({ laneId }) => laneId === recovery.laneId);
    if (result?.status === 'completed' && recovery.action !== 'none') {
      throw new TypeError('A completed child result cannot have a pending or terminal recovery.');
    }
  }
  const normalizedConflicts = normalizeConflicts(conflicts, contracts);

  const resultByLane = new Map(results.map((result) => [result.laneId, result]));
  const missingLaneIds = [...contracts.keys()].filter((laneId) => !resultByLane.has(laneId));
  const facts = results.flatMap((result) =>
    result.facts.map((fact) => ({ laneId: result.laneId, ...fact })),
  );
  const inferences = results.flatMap((result) =>
    result.inferences.map((inference) => ({ laneId: result.laneId, ...inference })),
  );
  const gaps = results.flatMap((result) =>
    result.gaps.map((gap) => ({ laneId: result.laneId, ...gap })),
  );
  const verification = results.flatMap((result) =>
    result.verification.map((item) => ({ laneId: result.laneId, ...item })),
  );
  const blockingLaneIds = results
    .filter(
      (result) =>
        result.status !== 'completed' ||
        result.gaps.some(({ blocking }) => blocking) ||
        result.verification.some(({ status }) => status !== 'passed'),
    )
    .map(({ laneId }) => laneId);
  const pendingRecoveryLaneIds = normalizedRecoveries
    .filter(({ action }) => action === 'alternate-once')
    .map(({ laneId }) => laneId);
  const unresolvedConflicts = normalizedConflicts.filter(
    ({ resolution }) => resolution === 'unresolved',
  );
  const readyForLeaderDecision =
    missingLaneIds.length === 0 &&
    blockingLaneIds.length === 0 &&
    pendingRecoveryLaneIds.length === 0 &&
    unresolvedConflicts.length === 0;

  return deepFreeze({
    schemaVersion: 1,
    requestId: delegation.requestId,
    readyForLeaderDecision,
    facts,
    inferences,
    gaps,
    conflicts: normalizedConflicts,
    verification,
    laneSummaries: results.map(({ laneId, status, confidence, blocker }) => ({
      laneId,
      status,
      confidence,
      blocker,
    })),
    missingLaneIds,
    blockingLaneIds,
    pendingRecoveryLaneIds,
    recoveryDecisions: normalizedRecoveries,
    leaderOwnership: {
      finalDecision: true,
      finalUserResponse: true,
      integration: true,
      finalVerification: true,
    },
  });
}

function dispatchRecommendation({
  delegation,
  execution,
  reason,
  dispatches,
  deferredLaneIds,
  runtime,
  concurrencyLimit,
  gaps,
}) {
  return deepFreeze({
    schemaVersion: 1,
    requestId: delegation.requestId,
    execution,
    reason,
    dispatches,
    deferredLaneIds,
    gaps,
    reportedRuntimeEvidence: runtime,
    runtimeEvidenceAuthority: 'leader-reported-not-host-authenticated',
    requiresLeaderRuntimeConfirmation: dispatches.length > 0,
    limits: { hardMax: HARD_CHILD_LIMIT, appliedConcurrency: concurrencyLimit },
    leaderOwnership: {
      dispatchDecision: true,
      finalDecision: true,
      finalUserResponse: true,
      integration: true,
      finalVerification: true,
    },
  });
}

function recoveryDecision({
  laneId,
  attempts,
  status,
  action,
  remainingAlternateAttempts,
  blocker,
  disposition,
  confidence,
  prohibitedApproachIds = [],
}) {
  return deepFreeze({
    schemaVersion: 1,
    laneId,
    status,
    action,
    attempts,
    remainingAlternateAttempts,
    maxAlternateAttempts: 1,
    prohibitedApproachIds,
    blocker,
    disposition,
    confidence,
  });
}

function normalizeReportedRuntimeEvidence(value) {
  const gaps = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return rejectedRuntimeEvidence(['runtime-evidence-missing']);
  }

  for (const field of Object.keys(value)) {
    if (!RUNTIME_EVIDENCE_FIELDS.has(field))
      gaps.push(`runtime-evidence-field-unsupported:${field}`);
  }

  if (value.schemaVersion !== 1) gaps.push('runtime-evidence-schema-unsupported');
  const surfaceMode = optionalEnum(value.surfaceMode, RUNTIME_SURFACES);
  if (surfaceMode === null) gaps.push('runtime-surface-unrecognized');
  const observationScope = optionalEnum(value.observationScope, RUNTIME_OBSERVATION_SCOPES);
  if (observationScope === null) gaps.push('runtime-observation-scope-unrecognized');
  const freshness = optionalEnum(value.freshness, RUNTIME_OBSERVATION_SCOPES);
  if (freshness === null) gaps.push('runtime-freshness-unrecognized');
  const dispatchPermission = optionalEnum(value.dispatchPermission, RUNTIME_DISPATCH_PERMISSIONS);
  if (dispatchPermission === null) gaps.push('runtime-dispatch-permission-unrecognized');

  const provenance = normalizeRuntimeProvenance(value.provenance, gaps);
  validateRuntimeEvidenceOrigin({ surfaceMode, observationScope, freshness, provenance, gaps });
  const roles = normalizeRuntimeRoles(value.roles, gaps);

  if (gaps.length > 0) {
    return rejectedRuntimeEvidence(gaps, {
      surfaceMode,
      observationScope,
      freshness,
      provenance,
      dispatchPermission,
      roles,
    });
  }

  return deepFreeze({
    schemaVersion: 1,
    evidenceStatus: 'accepted',
    authority: 'leader-reported-not-host-authenticated',
    surfaceMode,
    observationScope,
    freshness,
    provenance,
    dispatchPermission,
    roles,
    gaps: [],
  });
}

function normalizeRuntimeProvenance(value, gaps) {
  if (!Array.isArray(value) || value.length === 0) {
    gaps.push('runtime-provenance-missing');
    return [];
  }
  const provenance = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || !RUNTIME_PROVENANCE.has(entry)) {
      gaps.push('runtime-provenance-unrecognized');
      continue;
    }
    provenance.push(entry);
  }
  if (new Set(provenance).size !== provenance.length) gaps.push('runtime-provenance-duplicate');
  return [...new Set(provenance)].sort();
}

function validateRuntimeEvidenceOrigin({
  surfaceMode,
  observationScope,
  freshness,
  provenance,
  gaps,
}) {
  if (surfaceMode === 'native') {
    if (observationScope !== 'current-turn' || freshness !== 'current-turn') {
      gaps.push('runtime-evidence-stale');
    }
    if (provenance.length !== 1 || provenance[0] !== 'host-tool-schema') {
      gaps.push('runtime-native-provenance-incomplete');
    }
  }
  if (surfaceMode === 'omx') {
    if (observationScope !== 'current-session' || freshness !== 'current-session') {
      gaps.push('runtime-evidence-stale');
    }
    if (
      provenance.length !== 2 ||
      !provenance.includes('host-tool-schema') ||
      !provenance.includes('omx-runtime-overlay')
    ) {
      gaps.push('runtime-omx-provenance-incomplete');
    }
  }
}

function normalizeRuntimeRoles(value, gaps) {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_REPORTED_ROLES) {
    gaps.push('runtime-role-roster-invalid');
    return [];
  }
  const roles = [];
  for (const [index, role] of value.entries()) {
    if (!role || typeof role !== 'object' || Array.isArray(role)) {
      gaps.push(`runtime-role-record-invalid:${index}`);
      continue;
    }
    for (const field of Object.keys(role)) {
      if (!RUNTIME_ROLE_FIELDS.has(field)) gaps.push(`runtime-role-field-unsupported:${field}`);
    }
    try {
      roles.push({
        agentType: requireRuntimeRole(role.agentType),
        available: requireBoolean(role.available, 'runtime role available'),
        effectiveModel:
          role.configurationResolution !== undefined && role.effectiveModel === null
            ? null
            : requireString(role.effectiveModel, 'runtime role effectiveModel', 80),
        effectiveEffort:
          role.configurationResolution !== undefined && role.effectiveEffort === null
            ? null
            : requireEnum(role.effectiveEffort, EFFORTS, 'runtime role effectiveEffort'),
        ...(role.configurationResolution !== undefined
          ? {
              configurationResolution: normalizeConfigurationResolution(
                role.configurationResolution,
              ),
            }
          : {}),
        explicitEffortSupport: requireBoolean(
          role.explicitEffortSupport,
          'runtime role explicitEffortSupport',
        ),
        ...(role.modelSelection !== undefined
          ? { modelSelection: normalizeModelSelection(role.modelSelection) }
          : {}),
      });
    } catch {
      gaps.push(`runtime-role-metadata-invalid:${index}`);
    }
  }
  if (new Set(roles.map(({ agentType }) => agentType)).size !== roles.length) {
    gaps.push('runtime-role-roster-duplicate');
  }
  return roles;
}

function usesOrdinaryScopedArguments(runtime, contract) {
  return (
    !contract.routeRecommendation.modelRecommendation &&
    runtime.surfaceMode === 'native' &&
    contract.contextDelivery?.mode === 'scoped' &&
    contract.contextDelivery?.effortMode === 'explicit'
  );
}

function assessRuntimeCompatibility(runtime, contracts, modelUseByLane) {
  const gaps = [];
  if (runtime.dispatchPermission !== 'allowed') {
    gaps.push(`runtime-dispatch-permission-${runtime.dispatchPermission}`);
  }
  const rolesByAgentType = new Map(runtime.roles.map((role) => [role.agentType, role]));
  for (const contract of contracts) {
    // Omitted optional context preserves legacy advice; supplied gaps must not be
    // lost between the context composer and its dispatch consumer.
    const delivery = contract.contextDelivery;
    if (
      delivery !== undefined &&
      (delivery?.compatible !== true ||
        delivery?.applied !== false ||
        !Array.isArray(delivery?.gaps) ||
        delivery.gaps.length !== 0)
    )
      gaps.push(`runtime-context-incompatible:${contract.laneId}`);
    const requestedRole = contract.routeRecommendation.role;
    const requestedEffort = resolveRouteEffort(contract.routeRecommendation);
    const reportedRole = rolesByAgentType.get(requestedRole);
    if (!reportedRole || !reportedRole.available) {
      gaps.push(`runtime-role-unavailable:${requestedRole}`);
      continue;
    }
    const model = contract.routeRecommendation.modelRecommendation;
    if (usesOrdinaryScopedArguments(runtime, contract)) {
      const selection = reportedRole.modelSelection;
      if (
        !selection?.explicitModelSupport ||
        !selection.supportedModels.includes(REPOSITORY_CHILD_MODEL) ||
        (selection.roleModel !== null && selection.roleModel !== REPOSITORY_CHILD_MODEL)
      )
        gaps.push(`runtime-scoped-model-unsupported:${requestedRole}`);
      if (!reportedRole.explicitEffortSupport)
        gaps.push(`runtime-scoped-effort-unsupported:${requestedRole}`);
    }
    const requestedModel = model?.recommendedModel ?? REPOSITORY_CHILD_MODEL;
    const resolution = reportedRole.configurationResolution;
    if (
      resolution &&
      (reportedRole.effectiveModel !== null || reportedRole.effectiveEffort !== null)
    )
      gaps.push(`runtime-mixed-resolution-observation:${requestedRole}`);
    if ((resolution?.model ?? reportedRole.effectiveModel) !== requestedModel) {
      gaps.push(`runtime-model-incompatible:${requestedRole}`);
    }
    if (resolution && model?.status !== 'candidate')
      gaps.push('model-resolution-requires-candidate');
    if (model?.status === 'candidate') {
      gaps.push(...assessModelUse(contract, reportedRole, modelUseByLane[contract.laneId]));
    }
    if ((resolution?.effort ?? reportedRole.effectiveEffort) !== requestedEffort) {
      gaps.push(
        reportedRole.explicitEffortSupport
          ? `runtime-effective-effort-mismatch:${requestedRole}`
          : `runtime-fixed-effort-conflict:${requestedRole}`,
      );
    }
  }
  return {
    compatible: gaps.length === 0,
    gaps,
    rolesByAgentType,
  };
}

function normalizeConfigurationResolution(value) {
  if (value?.kind === 'recovery') {
    requireExactRecord(
      value,
      ['kind', 'recoveryBinding', 'model', 'effort', 'configDigest', 'reference'],
      'recovery resolution',
    );
    const binding = assertCurrentRecoveryBinding(value.recoveryBinding);
    requireString(value.reference, 'recovery resolution reference', 300);
    if (
      value.model !== binding.model ||
      value.effort !== binding.resolvedEffort ||
      value.configDigest !== binding.rescue.configDigest
    )
      throw new TypeError('Recovery resolution must exactly match its selection.');
    return { ...value, recoveryBinding: binding };
  }

  requireExactRecord(
    value,
    ['profileBinding', 'model', 'effort', 'configDigest', 'reference'],
    'configuration resolution',
  );
  requireDigest(value.configDigest);
  return {
    profileBinding: assertCurrentModelProfileBinding(value.profileBinding),
    model: requireString(value.model, 'resolved model', 80),
    effort: requireEnum(value.effort, EFFORTS, 'resolved effort'),
    configDigest: value.configDigest,
    reference: requireString(value.reference, 'resolution reference', 300),
  };
}

function normalizeModelSelection(value) {
  requireExactRecord(
    value,
    ['supportedModels', 'roleModel', 'explicitModelSupport', 'reference'],
    'modelSelection',
  );
  if (
    !Array.isArray(value.supportedModels) ||
    value.supportedModels.length < 1 ||
    value.supportedModels.length > 24
  ) {
    throw new TypeError('modelSelection requires a bounded supportedModels roster.');
  }
  const supportedModels = value.supportedModels.map((model) =>
    requireString(model, 'supported model', 80),
  );
  assertUnique(supportedModels, 'supported model');
  return {
    supportedModels,
    roleModel:
      value.roleModel === null ? null : requireString(value.roleModel, 'role model pin', 80),
    explicitModelSupport: requireBoolean(value.explicitModelSupport, 'explicit model support'),
    reference: requireString(value.reference, 'model capability reference', 300),
  };
}

// Caller-reported observations are not authority. Native dispatch still needs the
// Parent to verify the original authorization, current bytes/config and budget.
function validateModelUses(value, contracts) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype)
    throw new TypeError('modelUseByLane must be an object.');
  const ids = new Set(contracts.map((contract) => contract.laneId));
  for (const [id, use] of Object.entries(value)) {
    if (!ids.has(id)) throw new TypeError(`Unknown model use lane: ${id}`);
    requireExactRecord(
      use,
      [
        'observedAt',
        'configDigest',
        'scopeDigest',
        'scopeStatus',
        'checks',
        'remainingBudget',
        'admission',
      ],
      'model use',
    );
    requireTimestamp(use.observedAt);
    requireDigest(use.configDigest);
    requireDigest(use.scopeDigest);
    requireEnum(use.scopeStatus, new Set(['current', 'changed', 'unknown']), 'model scope status');
    requireEnum(use.checks, new Set(['passed', 'failed', 'unknown']), 'model required checks');
    requireExactRecord(use.remainingBudget, ['children', 'minutes'], 'remaining model budget');
    requireBoundedInteger(use.remainingBudget.children, 'remaining children', 0, HARD_CHILD_LIMIT);
    requireBoundedInteger(use.remainingBudget.minutes, 'remaining minutes', 0, 60);
    const grant = use.admission;
    if (grant === null) continue;
    requireExactRecord(
      grant,
      [
        'kind',
        'reference',
        'quality',
        'model',
        'role',
        'effort',
        'cohort',
        'scopeDigest',
        'configDigest',
        'notBefore',
        'expiresAt',
        'budget',
        'cleanupReference',
        'profileBinding',
      ],
      'model admission',
    );
    assertCurrentModelProfileBinding(grant.profileBinding);
    requireEnum(grant.kind, new Set(['pilot', 'adoption']), 'admission kind');
    requireEnum(grant.quality, new Set(['unadopted', 'go', 'no-go']), 'quality decision');
    for (const field of ['reference', 'model', 'role', 'cohort', 'cleanupReference'])
      requireString(grant[field], field, 300);
    requireEnum(grant.effort, EFFORTS, 'admission effort');
    requireDigest(grant.scopeDigest);
    requireDigest(grant.configDigest);
    requireTimestamp(grant.notBefore);
    requireTimestamp(grant.expiresAt);
    requireExactRecord(grant.budget, ['maxChildren', 'maxMinutes'], 'model budget');
    requireBoundedInteger(grant.budget.maxChildren, 'model maxChildren', 1, HARD_CHILD_LIMIT);
    requireBoundedInteger(grant.budget.maxMinutes, 'model maxMinutes', 1, 60);
  }
}

// Same static cohort boundary before dispatch and after attributed execution.
// Rehashing a caller-supplied contract must not make an invalid profile valid.
function assessModelContractBoundary(contract) {
  assertChildWriteBoundary(contract);
  const gaps = [];
  const route = contract.routeRecommendation;
  const profile = getModelProfile(route.modelRecommendation.request.profileId);
  if (route.effort !== 'medium') gaps.push('model-effort-eligibility-mismatch');
  const delivery = contract.contextDelivery;
  if (
    !delivery ||
    delivery.compatible !== true ||
    delivery.applied !== false ||
    delivery.mode !== 'scoped' ||
    delivery.gaps.length !== 0 ||
    delivery.failures.length !== 0
  )
    gaps.push('model-context-incompatible');
  if (
    contract.boundary.readOnly !== profile.readOnly ||
    contract.allowed.tools.some((tool) => !profile.allowedTools.includes(tool)) ||
    profile.requiredTools.some((tool) => !contract.allowed.tools.includes(tool))
  )
    gaps.push('model-cohort-boundary-incompatible');
  return gaps;
}

function assessModelUse(contract, reportedRole, use) {
  const gaps = assessModelContractBoundary(contract);
  const route = contract.routeRecommendation;
  const { request, profileBinding } = route.modelRecommendation;
  const selection = reportedRole.modelSelection;
  if (
    !selection ||
    !selection.supportedModels.includes(profileBinding.model) ||
    (selection.roleModel !== profileBinding.model &&
      !(selection.roleModel === null && selection.explicitModelSupport))
  ) {
    gaps.push('model-pin-or-override-unverified');
  }
  const resolution = reportedRole.configurationResolution;
  if (
    resolution &&
    (!reportedRole.explicitEffortSupport ||
      !selection?.explicitModelSupport ||
      resolution.configDigest !== use?.configDigest ||
      !isDeepStrictEqual(resolution.profileBinding, profileBinding))
  )
    gaps.push('model-resolution-unverified');
  const digest = createModelScopeDigest(contract);
  if (contract.modelScopeDigest !== digest || !contract.modelTaskId)
    gaps.push('model-contract-snapshot-changed');
  if (!use || !use.admission) return [...gaps, 'model-admission-missing'];
  const grant = use.admission;
  if (
    use.remainingBudget.children < 1 ||
    use.remainingBudget.minutes < 1 ||
    use.remainingBudget.children > grant.budget.maxChildren ||
    use.remainingBudget.minutes > grant.budget.maxMinutes
  )
    gaps.push('model-budget-exhausted-or-incompatible');
  if (
    use.scopeStatus !== 'current' ||
    use.checks !== 'passed' ||
    use.scopeDigest !== digest ||
    grant.scopeDigest !== digest ||
    grant.configDigest !== use.configDigest
  ) {
    gaps.push('model-scope-config-or-checks-changed');
  }
  if (
    grant.model !== profileBinding.model ||
    grant.role !== route.role ||
    grant.effort !== resolveRouteEffort(route) ||
    grant.cohort !== profileBinding.cohort ||
    !isDeepStrictEqual(grant.profileBinding, profileBinding)
  )
    gaps.push('model-admission-route-mismatch');
  if (
    Date.parse(grant.notBefore) > Date.parse(use.observedAt) ||
    Date.parse(use.observedAt) >= Date.parse(grant.expiresAt)
  )
    gaps.push('model-admission-expired-or-not-started');
  if (
    request.purpose === 'pilot'
      ? grant.kind !== 'pilot' || grant.quality === 'no-go'
      : grant.kind !== 'adoption' || grant.quality !== 'go'
  )
    gaps.push('model-pilot-adoption-boundary');
  return gaps;
}

function requireTimestamp(value) {
  if (
    typeof value !== 'string' ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    throw new TypeError('Model observation requires an exact ISO timestamp.');
}

function requireDigest(value) {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(value))
    throw new TypeError('Model snapshot requires a SHA-256 digest.');
}

function rejectedRuntimeEvidence(gaps, partial = {}) {
  return deepFreeze({
    schemaVersion: 1,
    evidenceStatus: 'rejected',
    authority: 'leader-reported-not-host-authenticated',
    surfaceMode: partial.surfaceMode ?? null,
    observationScope: partial.observationScope ?? null,
    freshness: partial.freshness ?? null,
    provenance: partial.provenance ?? [],
    dispatchPermission: partial.dispatchPermission ?? null,
    roles: partial.roles ?? [],
    gaps: unique(gaps),
  });
}

function optionalEnum(value, allowed) {
  return typeof value === 'string' && allowed.has(value) ? value : null;
}

function requireRuntimeRole(value) {
  const normalized = requireString(value, 'runtime role agentType', 80);
  if (!/^[a-z][a-z\d_-]*$/u.test(normalized)) {
    throw new TypeError('runtime role agentType must use lowercase identifier syntax.');
  }
  return normalized;
}

function normalizeAttempt(attempt, index) {
  if (!attempt || typeof attempt !== 'object' || Array.isArray(attempt)) {
    throw new TypeError('attempt must be an object.');
  }
  const outcome = requireEnum(attempt.outcome, ATTEMPT_OUTCOMES, 'attempt outcome');
  return {
    ...(attempt.model !== undefined
      ? { model: requireString(attempt.model, 'attempt model', 80) }
      : {}),
    ...(attempt.effort !== undefined
      ? {
          effort: requireEnum(
            attempt.effort,
            attempt.recoveryBinding ? new Set(['low', ...EFFORTS]) : EFFORTS,
            'attempt effort',
          ),
        }
      : {}),
    ...(attempt.executed !== undefined
      ? { executed: requireBoolean(attempt.executed, 'attempt executed') }
      : {}),
    ...(attempt.identity !== undefined
      ? { identity: normalizeAttemptIdentity(attempt.identity) }
      : {}),
    ...(attempt.recoveryBinding !== undefined
      ? { recoveryBinding: assertCurrentRecoveryBinding(attempt.recoveryBinding) }
      : {}),
    number: index + 1,
    approachId: requireIdentifier(attempt.approachId, 'approachId'),
    alternateOf:
      attempt.alternateOf == null ? null : requireIdentifier(attempt.alternateOf, 'alternateOf'),
    outcome,
    failureCategory:
      outcome === 'failure'
        ? requireEnum(attempt.failureCategory, FAILURE_CATEGORIES, 'failure category')
        : null,
    evidence: requireString(attempt.evidence, 'attempt evidence', 500),
  };
}

function validateAttemptSequence(attempts) {
  if (attempts.length === 0) return;
  if (attempts[0].alternateOf !== null) {
    throw new TypeError('The primary attempt cannot declare alternateOf.');
  }
  if (attempts.length === 1) return;
  if (attempts[0].outcome !== 'failure') {
    throw new TypeError('An alternate attempt cannot follow a successful primary attempt.');
  }
  if (
    attempts[1].approachId === attempts[0].approachId ||
    attempts[1].alternateOf !== attempts[0].approachId
  ) {
    throw new TypeError('The second attempt must be one distinct alternate approach.');
  }
}

function terminalDisposition(category) {
  if (['missing-authority', 'scope-conflict'].includes(category)) return 'plan-oq';
  if (['credential-required', 'external-production'].includes(category)) return 'user-handoff';
  if (['official-source-unavailable', 'repository-evidence-missing'].includes(category)) {
    return 'evidence-gap';
  }
  if (category === 'role-routing-unavailable') return 'leader-sequential';
  return 'blocker-handoff';
}

function normalizeChildResult(result, contracts) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new TypeError('child result must be an object.');
  }
  for (const field of Object.keys(result)) {
    if (!CHILD_RESULT_FIELDS.has(field)) {
      throw new TypeError(`Unsupported child result field: ${field}`);
    }
  }
  const laneId = requireIdentifier(result.laneId, 'child result laneId');
  const contract = contracts.get(laneId);
  if (!contract) throw new TypeError(`Child result references an unknown lane: ${laneId}`);
  const status = requireEnum(result.status, RESULT_STATUSES, 'child result status');
  const blocker = result.blocker == null ? null : requireString(result.blocker, 'blocker', 500);
  if (status !== 'completed' && blocker === null) {
    throw new TypeError('Blocked or failed child results require a blocker.');
  }
  const verification = normalizeVerification(result.verification ?? []);
  if (status === 'completed' && verification.length === 0) {
    throw new TypeError('Completed child results require verification evidence.');
  }
  return {
    laneId,
    status,
    outputs: normalizeOutputs(result.outputs, contract.expectedOutputSchema.required),
    facts: normalizeFacts(result.facts ?? []),
    inferences: normalizeInferences(result.inferences ?? []),
    gaps: normalizeGaps(result.gaps ?? []),
    confidence: requireEnum(result.confidence, CONFIDENCE, 'child result confidence'),
    verification,
    blocker,
  };
}

function normalizeOutputs(outputs, requiredFields) {
  if (!outputs || typeof outputs !== 'object' || Array.isArray(outputs)) {
    throw new TypeError('child outputs must be an object.');
  }
  const missing = requiredFields.filter(
    (field) =>
      !['facts', 'inferences', 'gaps', 'confidence'].includes(field) && !(field in outputs),
  );
  if (missing.length > 0) {
    throw new TypeError(`child outputs are missing required fields: ${missing.join(', ')}`);
  }
  return normalizeJsonObject(outputs, 0);
}

function normalizeFacts(values) {
  return normalizeObjectArray(values, 'facts', (fact) => ({
    statement: requireString(fact.statement, 'fact statement', 500),
    source: requireString(fact.source, 'fact source', 500),
  }));
}

function normalizeInferences(values) {
  return normalizeObjectArray(values, 'inferences', (inference) => ({
    statement: requireString(inference.statement, 'inference statement', 500),
    confidence: requireEnum(inference.confidence, CONFIDENCE, 'inference confidence'),
  }));
}

function normalizeGaps(values) {
  return normalizeObjectArray(values, 'gaps', (gap) => ({
    statement: requireString(gap.statement, 'gap statement', 500),
    impact: requireString(gap.impact, 'gap impact', 500),
    blocking: requireBoolean(gap.blocking ?? false, 'gap blocking'),
  }));
}

function normalizeVerification(values) {
  return normalizeObjectArray(values, 'verification', (item) => ({
    claim: requireString(item.claim, 'verification claim', 500),
    evidence: requireString(item.evidence, 'verification evidence', 500),
    status: requireEnum(item.status, VERIFICATION_STATUSES, 'verification status'),
  }));
}

function normalizeRecoveryDecision(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('recovery decision must be an object.');
  }
  if (value.schemaVersion !== 1 || value.maxAlternateAttempts !== 1) {
    throw new TypeError('recovery decision must use the bounded schema.');
  }
  const status = requireEnum(value.status, RECOVERY_STATUSES, 'recovery status');
  const action = requireEnum(value.action, RECOVERY_ACTIONS, 'recovery action');
  const remainingAlternateAttempts = requireBoundedInteger(
    value.remainingAlternateAttempts,
    'remainingAlternateAttempts',
    0,
    1,
  );
  const blocker =
    value.blocker == null ? null : requireString(value.blocker, 'recovery blocker', 500);
  const disposition =
    value.disposition == null
      ? null
      : requireEnum(value.disposition, RECOVERY_DISPOSITIONS, 'recovery disposition');
  validateRecoveryShape({ status, action, remainingAlternateAttempts, blocker, disposition });
  const attempts = value.attempts.map(normalizeAttempt);
  validateAttemptSequence(attempts);
  if (!value.recoveryBinding && attempts.some((attempt) => attempt.recoveryBinding))
    throw new TypeError('Attributed recovery attempts require their decision-level binding.');
  if (value.recoveryBinding) {
    assertRecoveryAttempts(attempts, value.recoveryBinding);
    if (
      value.laneId !== value.recoveryBinding.rescue.laneId ||
      value.nextModel !== (action === 'alternate-once' ? value.recoveryBinding.model : null)
    )
      throw new TypeError('Recovery decision must preserve lane and next-model attribution.');
    const expected = evaluateAttemptRecovery({ laneId: value.laneId, attempts });
    for (const field of [
      'status',
      'action',
      'remainingAlternateAttempts',
      'blocker',
      'disposition',
    ])
      if (value[field] !== expected[field])
        throw new TypeError('Recovery decision must preserve its attempt outcomes.');
  }
  return deepFreeze({
    attempts,
    ...(value.recoveryBinding
      ? { recoveryBinding: assertCurrentRecoveryBinding(value.recoveryBinding) }
      : {}),
    ...(value.nextModel !== undefined ? { nextModel: value.nextModel } : {}),
    laneId: requireIdentifier(value.laneId, 'recovery laneId'),
    status,
    action,
    remainingAlternateAttempts,
    maxAlternateAttempts: 1,
    blocker,
    disposition,
  });
}

function validateRecoveryShape({
  status,
  action,
  remainingAlternateAttempts,
  blocker,
  disposition,
}) {
  const validPair =
    (status === 'not-started' && action === 'primary-attempt') ||
    (status === 'complete' && action === 'none') ||
    (status === 'alternate-available' && action === 'alternate-once') ||
    (status === 'handoff-required' &&
      ['leader-sequential-fallback', 'terminal-handoff'].includes(action));
  if (!validPair) throw new TypeError('recovery status and action are inconsistent.');
  if (['not-started', 'complete'].includes(status) && (blocker !== null || disposition !== null)) {
    throw new TypeError('non-failure recovery states cannot include blocker or disposition.');
  }
  if (['alternate-available', 'handoff-required'].includes(status) && blocker === null) {
    throw new TypeError('failure recovery states require a blocker.');
  }
  if (status === 'handoff-required' && disposition === null) {
    throw new TypeError('handoff-required recovery requires a disposition.');
  }
  const expectedRemaining = status === 'not-started' || status === 'alternate-available' ? 1 : 0;
  if (remainingAlternateAttempts !== expectedRemaining) {
    throw new TypeError('recovery remaining attempt count is inconsistent.');
  }
}

function normalizeConflicts(values, contracts) {
  return normalizeObjectArray(values, 'conflicts', (conflict) => {
    const laneIds = normalizeIdentifierArray(conflict.laneIds, 'conflict laneIds');
    if (laneIds.some((laneId) => !contracts.has(laneId))) {
      throw new TypeError('conflict references an unknown lane.');
    }
    return {
      statement: requireString(conflict.statement, 'conflict statement', 500),
      laneIds,
      resolution: requireEnum(
        conflict.resolution,
        new Set(['unresolved', 'leader-resolved']),
        'conflict resolution',
      ),
      evidence: requireString(conflict.evidence, 'conflict evidence', 500),
    };
  });
}

function assertDelegationRecommendation(delegation) {
  if (!delegation || typeof delegation !== 'object' || Array.isArray(delegation)) {
    throw new TypeError('delegation recommendation must be an object.');
  }
  if (delegation.schemaVersion !== 1 || !Array.isArray(delegation.recommendedChildren)) {
    throw new TypeError('delegation recommendation must use the supported schema.');
  }
  requireString(delegation.requestId, 'delegation requestId', 80);
  const execution = requireEnum(
    delegation.execution,
    DELEGATION_EXECUTIONS,
    'delegation execution',
  );
  if (delegation.recommendedChildren.length > HARD_CHILD_LIMIT) {
    throw new TypeError(`delegation exceeds the hard child limit of ${HARD_CHILD_LIMIT}.`);
  }
  if (
    (execution === 'bounded-lanes' && delegation.recommendedChildren.length < 1) ||
    (execution !== 'bounded-lanes' && delegation.recommendedChildren.length > 0)
  ) {
    throw new TypeError('delegation execution and recommended child count are inconsistent.');
  }
  if (
    !delegation.leaderOwnership ||
    [
      'dispatchDecision',
      'finalDecision',
      'finalUserResponse',
      'integration',
      'finalVerification',
    ].some((field) => delegation.leaderOwnership[field] !== true)
  ) {
    throw new TypeError('delegation must preserve leader-only ownership.');
  }
  let writeContractCount = 0;
  for (const contract of delegation.recommendedChildren) {
    requireIdentifier(contract.laneId, 'contract laneId');
    if (assertChildWriteBoundary(contract)) writeContractCount += 1;
    const role = requireString(contract.routeRecommendation?.role, 'route role', 80);
    if (!INSTALLED_ROLES.has(role)) throw new TypeError(`Unsupported native role route: ${role}`);
    requireEnum(contract.routeRecommendation?.effort, EFFORTS, 'route effort');
    if (contract.routeRecommendation?.execution !== 'bounded-child') {
      throw new TypeError('child route recommendation must use bounded-child execution.');
    }
    assertSemanticRouteRecommendation(contract.routeRecommendation);
    const model = contract.routeRecommendation.modelRecommendation;
    if (model !== undefined) {
      assertCurrentModelRecommendation(contract);
      if (contract.modelTaskId !== delegation.requestId)
        throw new TypeError('Model task identity must match the delegation.');
    }
    if (!Array.isArray(contract.expectedOutputSchema?.required)) {
      throw new TypeError('child contract requires an expected output schema.');
    }
    if (
      !contract.leaderOwnership ||
      ['finalDecision', 'finalUserResponse', 'integration', 'finalVerification'].some(
        (field) => contract.leaderOwnership[field] !== true,
      )
    ) {
      throw new TypeError('child contract must preserve leader-only ownership.');
    }
  }
  if (writeContractCount > 1) {
    throw new TypeError('delegation can select at most one write-capable child lane.');
  }
  assertUnique(
    delegation.recommendedChildren.map(({ laneId }) => laneId),
    'contract laneId',
  );
}

function assertChildWriteBoundary(contract) {
  const tools = contract.allowed?.tools;
  const boundary = contract.boundary;
  if (!Array.isArray(tools)) {
    throw new TypeError('child contract requires an allowed tools array.');
  }
  if (!boundary || typeof boundary !== 'object' || Array.isArray(boundary)) {
    throw new TypeError('child contract requires a boundary object.');
  }
  if (!Array.isArray(boundary.writeOwnership)) {
    throw new TypeError('child contract requires a write ownership array.');
  }
  if (typeof boundary.readOnly !== 'boolean') {
    throw new TypeError('child contract requires an explicit read-only boundary.');
  }

  const hasWriteOwnership = boundary.writeOwnership.length > 0;
  const requestsWorkspaceEdit = tools.includes('workspace-edit');
  if ((requestsWorkspaceEdit || boundary.readOnly === false) && !hasWriteOwnership) {
    throw new TypeError('child write capability requires explicit write ownership.');
  }
  if (boundary.readOnly === hasWriteOwnership) {
    throw new TypeError('child read-only boundary is inconsistent with write ownership.');
  }

  return hasWriteOwnership;
}

function assertSemanticRouteRecommendation(route) {
  if (route.pass2Applied !== true) {
    throw new TypeError('child route recommendation requires validated Pass 2 evidence.');
  }
  if (!Array.isArray(route.evidenceIds) || route.evidenceIds.length === 0) {
    throw new TypeError('child route recommendation requires semantic evidenceIds.');
  }
  assertUnique(route.evidenceIds, 'route evidenceId');
  if (
    !route.assessment ||
    typeof route.assessment !== 'object' ||
    Array.isArray(route.assessment)
  ) {
    throw new TypeError('child route recommendation requires a semantic assessment.');
  }
  requireEnum(route.impactRisk, new Set(['low', 'medium', 'high']), 'route impact risk');
  requireEnum(route.confidence, CONFIDENCE, 'route confidence');
  if (!Array.isArray(route.gaps) || !route.gaps.includes('runtime-role-evidence-deferred')) {
    throw new TypeError('child route recommendation must preserve the runtime evidence gap.');
  }
  const runtime = route.runtimeApplication;
  if (
    !runtime ||
    runtime.requested !== true ||
    runtime.supported !== 'unknown' ||
    runtime.applied !== false ||
    runtime.evidenceStatus !== 'deferred-to-runtime-compatibility'
  ) {
    throw new TypeError('child route recommendation has invalid transitional runtime evidence.');
  }
}

function normalizeObjectArray(values, field, mapper) {
  if (!Array.isArray(values)) throw new TypeError(`${field} must be an array.`);
  return values.map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new TypeError(`${field} entries must be objects.`);
    }
    return mapper(value);
  });
}

function normalizeJsonObject(value, depth) {
  if (depth > 4) throw new TypeError('child outputs exceed the supported nesting depth.');
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      requireOutputField(key),
      normalizeJsonValue(nested, depth + 1),
    ]),
  );
}

function normalizeJsonValue(value, depth) {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return requireString(value, 'output value', 1_000);
  if (Array.isArray(value)) return value.map((item) => normalizeJsonValue(item, depth + 1));
  if (value && typeof value === 'object') return normalizeJsonObject(value, depth + 1);
  throw new TypeError('child outputs must contain bounded JSON values.');
}

function normalizeIdentifierArray(values, field) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new TypeError(`${field} must be a non-empty array.`);
  }
  return [...new Set(values.map((value) => requireIdentifier(value, field)))];
}

function validateConcurrencyLimit(value) {
  if (!Number.isInteger(value) || value < 1 || value > HARD_CHILD_LIMIT) {
    throw new TypeError(`concurrencyLimit must be between 1 and ${HARD_CHILD_LIMIT}.`);
  }
}

function requireOutputField(value) {
  const normalized = requireString(value, 'output field', 80);
  if (!/^[a-z][a-zA-Z\d]*$/u.test(normalized)) {
    throw new TypeError('output field must use lower camelCase.');
  }
  return normalized;
}

function requireBoundedInteger(value, field, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${field} must be between ${minimum} and ${maximum}.`);
  }
  return value;
}

function requireIdentifier(value, field) {
  const normalized = requireString(value, field, 80);
  if (!/^[a-z][a-z\d-]*$/u.test(normalized)) {
    throw new TypeError(`${field} must use lowercase kebab-case.`);
  }
  return normalized;
}

function requireString(value, field, maxLength) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) {
    throw new TypeError(`${field} must be a bounded string.`);
  }
  return value.trim();
}

function requireEnum(value, allowed, field) {
  if (!allowed.has(value)) throw new TypeError(`Unsupported ${field}: ${value}`);
  return value;
}

function requireBoolean(value, field) {
  if (typeof value !== 'boolean') throw new TypeError(`${field} must be a boolean.`);
  return value;
}

function assertUnique(values, field) {
  if (new Set(values).size !== values.length)
    throw new TypeError(`${field} values must be unique.`);
}

function unique(values) {
  return [...new Set(values)];
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

function assertCurrentModelRecommendation(contract) {
  const model = contract.routeRecommendation.modelRecommendation;
  requireExactRecord(
    model,
    [
      'request',
      'profileBinding',
      'taskKind',
      'role',
      'recommendedModel',
      'status',
      'reason',
      'applied',
    ],
    'model recommendation',
  );
  const expected = recommendModel({
    modelRequest: model.request,
    taskKind: model.taskKind,
    impactRisk: contract.routeRecommendation.impactRisk,
    assessment: contract.routeRecommendation.assessment,
  });
  if (!isDeepStrictEqual(model, expected))
    throw new TypeError(
      'Model recommendation must preserve semantic eligibility and applied=false.',
    );
  if (model.role !== contract.routeRecommendation.role)
    throw new TypeError('Model task must preserve the semantic role.');
}

function normalizeAttemptIdentity(value) {
  requireExactRecord(
    value,
    ['taskId', 'childId', 'sourceDigest', 'scopeDigest'],
    'attempt identity',
  );
  requireIdentifier(value.taskId, 'attempt task');
  requireString(value.childId, 'attempt child', 160);
  requireDigest(value.sourceDigest);
  requireDigest(value.scopeDigest);
  return { ...value };
}

function assertRecoveryAttempts(attempts, binding) {
  assertCurrentRecoveryBinding(binding);
  if (attempts.length < 1 || attempts.length > 2)
    throw new TypeError('Recovery requires one primary and at most one alternate.');
  const [first, second] = attempts;
  const primary = binding.primary;
  if (
    first.outcome !== 'failure' ||
    first.failureCategory !== primary.failureCategory ||
    NON_RETRYABLE_FAILURES.has(first.failureCategory) ||
    first.executed !== true ||
    first.approachId !== primary.attemptId ||
    first.alternateOf != null ||
    first.model !== primary.profileBinding.model ||
    first.effort !== primary.profileBinding.resolvedEffort ||
    !isDeepStrictEqual(first.identity, {
      taskId: primary.taskId,
      childId: primary.childId,
      sourceDigest: primary.sourceDigest,
      scopeDigest: primary.scopeDigest,
    })
  )
    throw new TypeError('Recovery selection does not match the exact failed primary.');
  if (
    second &&
    (second.approachId !== binding.rescue.attemptId ||
      second.alternateOf !== first.approachId ||
      second.model !== binding.model ||
      second.effort !== binding.resolvedEffort ||
      second.executed !== true ||
      !isDeepStrictEqual(second.recoveryBinding, binding) ||
      second.identity?.taskId !== binding.rescue.taskId ||
      second.identity?.scopeDigest !== binding.rescue.scopeDigest ||
      second.identity?.sourceDigest !== binding.rescue.sourceDigest ||
      !second.identity?.childId ||
      second.identity.childId === primary.childId)
  )
    throw new TypeError('Only the exact once-bound Astra alternate can complete recovery.');
}

function assertRecoveryAdmission(use, binding) {
  requireExactRecord(
    use,
    [
      'observedAt',
      'configDigest',
      'scopeDigest',
      'scopeStatus',
      'checks',
      'remainingBudget',
      'admission',
    ],
    'recovery use',
  );
  requireTimestamp(use.observedAt);
  const grant = use.admission;
  requireExactRecord(
    grant,
    [
      'kind',
      'reference',
      'recoveryBinding',
      'notBefore',
      'expiresAt',
      'budget',
      'cleanupReference',
    ],
    'recovery admission',
  );
  assertCurrentRecoveryBinding(grant.recoveryBinding);
  for (const key of ['reference', 'cleanupReference']) requireString(grant[key], key, 300);
  requireTimestamp(grant.notBefore);
  requireTimestamp(grant.expiresAt);
  requireExactRecord(grant.budget, ['maxChildren', 'maxMinutes'], 'recovery budget');
  requireExactRecord(use.remainingBudget, ['children', 'minutes'], 'remaining recovery budget');
  requireBoundedInteger(grant.budget.maxMinutes, 'recovery minutes', 1, 60);
  requireBoundedInteger(
    use.remainingBudget.minutes,
    'remaining recovery minutes',
    1,
    grant.budget.maxMinutes,
  );
  if (
    grant.kind !== 'recovery' ||
    !isDeepStrictEqual(grant.recoveryBinding, binding) ||
    grant.budget.maxChildren !== 1 ||
    use.remainingBudget.children !== 1 ||
    use.configDigest !== binding.rescue.configDigest ||
    use.scopeDigest !== binding.rescue.scopeDigest ||
    use.scopeStatus !== 'current' ||
    use.checks !== 'passed' ||
    Date.parse(grant.notBefore) > Date.parse(use.observedAt) ||
    Date.parse(use.observedAt) >= Date.parse(grant.expiresAt)
  )
    throw new TypeError('A fresh exact once-only recovery admission is required.');
}

function createRecoveryDispatch({
  delegation,
  reportedRuntimeEvidence,
  concurrencyLimit,
  modelUseByLane,
  recoveryDecision: decision,
}) {
  assertDelegationRecommendation(delegation);
  validateConcurrencyLimit(concurrencyLimit);
  const runtime = normalizeReportedRuntimeEvidence(reportedRuntimeEvidence);
  const gaps = [];
  let dispatch;
  try {
    const binding = assertCurrentRecoveryBinding(decision.recoveryBinding);
    const contract = delegation.recommendedChildren[0];
    const normalized = normalizeRecoveryDecision(decision);
    if (
      delegation.recommendedChildren.length !== 1 ||
      delegation.requestId !== binding.rescue.taskId ||
      normalized.action !== 'alternate-once' ||
      normalized.attempts.length !== 1 ||
      decision.nextModel !== binding.model ||
      decision.laneId !== binding.rescue.laneId ||
      runtime.evidenceStatus !== 'accepted' ||
      runtime.dispatchPermission !== 'allowed'
    )
      throw new TypeError('Recovery is not dispatchable.');
    assertRecoveryChildContract(contract, binding);
    if (Object.keys(modelUseByLane).length !== 1)
      throw new TypeError('Recovery is one exact lane.');
    const use = modelUseByLane[contract.laneId];
    assertRecoveryAdmission(use, binding);
    const role = runtime.roles.find((r) => r.agentType === binding.rescue.role);
    const resolution = role?.configurationResolution;
    if (
      !role?.available ||
      role.effectiveModel !== null ||
      role.effectiveEffort !== null ||
      !role.explicitEffortSupport ||
      !role.modelSelection?.explicitModelSupport ||
      !role.modelSelection.supportedModels.includes(binding.model) ||
      ![null, binding.model].includes(role.modelSelection.roleModel) ||
      resolution?.kind !== 'recovery' ||
      !isDeepStrictEqual(resolution.recoveryBinding, binding)
    )
      throw new TypeError('Current host cannot resolve the exact recovery invocation.');
    dispatch = {
      kind: 'model-recovery',
      laneId: contract.laneId,
      agentType: binding.rescue.role,
      effort: contract.routeRecommendation.effort,
      effectiveModel: null,
      effectiveEffort: null,
      requestedModel: binding.model,
      resolvedModel: binding.model,
      resolvedEffort: binding.resolvedEffort,
      explicitEffortSupport: true,
      contract,
      recoveryBinding: binding,
      recoveryDecision: decision,
      recoveryUse: use,
      configurationResolution: resolution,
      spawnArguments: {
        agent_type: binding.rescue.role,
        model: binding.model,
        reasoning_effort: binding.resolvedEffort,
        fork_turns: 'none',
      },
      dispatchOwner: 'leader',
      runtimeSurface: runtime.surfaceMode === 'omx' ? 'omx-native-child' : 'native-child',
      requiresLeaderRuntimeConfirmation: true,
      runtimeAction: false,
    };
  } catch {
    gaps.push('model-recovery-incompatible-or-unadmitted');
  }
  return dispatchRecommendation({
    delegation,
    runtime,
    concurrencyLimit,
    execution: dispatch ? 'native-bounded-dispatch' : 'leader-sequential',
    reason: dispatch
      ? 'One exact recovery is ready for leader-controlled native dispatch.'
      : 'Recovery requires current selection, host and authorization evidence.',
    dispatches: dispatch ? [dispatch] : [],
    deferredLaneIds: dispatch ? [] : delegation.recommendedChildren.map((c) => c.laneId),
    gaps,
  });
}

function evaluateRecoveryExecution({ dispatch, expectedChildId, reportedExecution: observation }) {
  const gaps = [];
  try {
    const binding = assertCurrentRecoveryBinding(dispatch.recoveryBinding);
    assertRecoveryChildContract(dispatch.contract, binding);
    assertSemanticRouteRecommendation(dispatch.contract.routeRecommendation);
    assertRecoveryAdmission(dispatch.recoveryUse, binding);
    const decision = normalizeRecoveryDecision(dispatch.recoveryDecision);
    if (
      decision.action !== 'alternate-once' ||
      decision.attempts.length !== 1 ||
      !isDeepStrictEqual(decision.recoveryBinding, binding)
    )
      throw new TypeError('Recovery dispatch no longer matches the decision.');
    const resolution = normalizeConfigurationResolution(dispatch.configurationResolution);
    if (
      !isDeepStrictEqual(resolution.recoveryBinding, binding) ||
      dispatch.runtimeAction !== false ||
      dispatch.kind !== 'model-recovery' ||
      dispatch.agentType !== binding.rescue.role ||
      dispatch.requestedModel !== binding.model ||
      dispatch.effort !== binding.rescue.semanticEffort ||
      dispatch.resolvedModel !== binding.model ||
      dispatch.resolvedEffort !== binding.resolvedEffort ||
      !isDeepStrictEqual(dispatch.spawnArguments, {
        agent_type: binding.rescue.role,
        model: binding.model,
        reasoning_effort: binding.resolvedEffort,
        fork_turns: 'none',
      })
    )
      throw new TypeError('Recovery descriptor mismatch.');
    requireString(expectedChildId, 'actual returned rescue child', 160);
    requireExactRecord(
      observation,
      [
        'recoveryBinding',
        'childId',
        'taskId',
        'scopeDigest',
        'provenance',
        'accepted',
        'executed',
        'resultReference',
        'independentCheck',
        'hostMetadata',
        'usageReference',
      ],
      'recovery execution',
    );
    if (
      !isDeepStrictEqual(observation.recoveryBinding, binding) ||
      observation.childId !== expectedChildId ||
      observation.childId === binding.primary.childId ||
      observation.taskId !== binding.rescue.taskId ||
      observation.scopeDigest !== binding.rescue.scopeDigest ||
      observation.provenance !== 'native-tool-result' ||
      observation.accepted !== true ||
      observation.executed !== true
    )
      throw new TypeError('Recovery execution identity mismatch.');
    requireString(observation.resultReference, 'rescue result reference', 300);
    requireExactRecord(
      observation.independentCheck,
      ['status', 'reference'],
      'rescue independent check',
    );
    requireString(
      observation.independentCheck.reference,
      'rescue independent check reference',
      300,
    );
    if (observation.independentCheck.status !== 'passed')
      gaps.push('model-independent-quality-not-passed');
    if (
      observation.hostMetadata !== null &&
      !isDeepStrictEqual(observation.hostMetadata, {
        model: binding.model,
        effort: binding.resolvedEffort,
      })
    )
      gaps.push('model-host-metadata-mismatch');
    if (observation.usageReference !== null)
      requireString(observation.usageReference, 'usage reference', 300);
  } catch {
    gaps.push('model-recovery-execution-evidence-invalid');
  }
  return deepFreeze({
    accepted: gaps.length === 0,
    evidenceKind: gaps.length
      ? 'unverified'
      : observation.hostMetadata
        ? 'host-reported-model'
        : 'runtime-contract-resolved',
    providerAttested: false,
    usageReference: gaps.length ? null : observation.usageReference,
    authority: 'leader-reported-not-host-authenticated',
    requiresLeaderRuntimeConfirmation: true,
    runtimeAction: false,
    gaps,
  });
}
