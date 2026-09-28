import { assertCurrentRecoveryBinding, resolveRouteEffort } from './model-profiles.mjs';
import { assertValidTaskEnvelope } from '../common/intake-policy.mjs';
import { createHash } from 'node:crypto';
import { normalizeModelRequest, selectAgentRoute } from './routing-policy.mjs';

const HARD_CHILD_LIMIT = 6;
const PROACTIVE_NORMAL_LIMIT = 2;
const PROACTIVE_EVIDENCE_BACKED_LIMIT = 3;
const PRIORITIES = new Set(['low', 'medium', 'high']);
const IMPACT_RISKS = new Set(['low', 'medium', 'high']);
const TASK_KINDS = new Set([
  'lookup',
  'analysis',
  'implementation',
  'debugging',
  'test',
  'research',
  'verification',
  'architecture',
  'review',
]);
const BENEFIT_KINDS = new Set(['completeness', 'latency', 'specialist-evidence', 'risk-review']);
const BENEFIT_VALUES = new Set(['low', 'standard', 'high']);
const ALLOWED_EVIDENCE = new Set(['repo', 'test', 'official-current', 'external-owner']);
const ALLOWED_TOOLS = new Set([
  'repository-read',
  'official-web-read',
  'test-runner',
  'workspace-edit',
]);
const LANE_FIELDS = new Set([
  'modelRequest',
  'id',
  'domain',
  'taskKind',
  'priority',
  'impactRisk',
  'objective',
  'question',
  'allowedEvidence',
  'allowedTools',
  'readScope',
  'writeOwnership',
  'dependencies',
  'nonGoals',
  'prohibitedAssumptions',
  'expectedOutputFields',
  'verification',
  'stopCondition',
  'handoffCondition',
  'benefit',
  'pass2Evidence',
]);

export function recommendDelegation({
  envelope,
  contextPack,
  laneCandidates = [],
  ownerDirectedChildLimit = null,
  deliveryByLane = {},
} = {}) {
  assertValidTaskEnvelope(envelope);
  assertContextPack(contextPack, envelope.requestId);
  validateOwnerDirectedChildLimit(ownerDirectedChildLimit);

  if (!Array.isArray(laneCandidates)) throw new TypeError('laneCandidates must be an array.');
  if (laneCandidates.length > HARD_CHILD_LIMIT) {
    throw new TypeError(`laneCandidates cannot exceed the hard limit of ${HARD_CHILD_LIMIT}.`);
  }

  const lanes = laneCandidates.map((lane) => normalizeLane(lane, envelope));
  assertUniqueLaneIds(lanes);
  const deliveries = normalizeDeliveryRequests(deliveryByLane, lanes);
  const assessments = lanes.map((lane) => assessNormalizedLane(lane, lanes));
  const baseGate = delegationGate(envelope, contextPack);

  if (baseGate) {
    return recommendation({
      envelope,
      execution: baseGate.execution,
      reason: baseGate.reason,
      ownerDirectedChildLimit,
      recommendedChildren: [],
      deferredLanes: assessments.map(deferredAssessment),
      gaps: baseGate.gaps,
    });
  }

  const routed = assessments.map((assessment) => ({
    ...assessment,
    route: selectAgentRoute({
      pass1: {
        taskKind: assessment.lane.taskKind,
        executionShape: 'bounded-child',
        impactRisk: assessment.lane.impactRisk,
        candidateRole: null,
        requiredEvidence: assessment.lane.allowedEvidence,
        confidence: envelope.confidence,
      },
      contextPack,
      pass2Evidence: assessment.lane.pass2Evidence,
      independent: assessment.independent,
      childBenefit: assessment.lane.benefit.value !== 'low',
      ...(assessment.lane.modelRequest ? { modelRequest: assessment.lane.modelRequest } : {}),
    }),
  }));
  const eligible = routed
    .filter(({ independent, route }) => independent && route.spawn)
    .sort(compareLanePriority);

  if (eligible.length === 0) {
    return recommendation({
      envelope,
      execution: 'single-sequential',
      reason: 'No independently valuable lane has validated Pass 2 evidence for bounded routing.',
      ownerDirectedChildLimit,
      recommendedChildren: [],
      deferredLanes: routed.map((assessment) =>
        deferredAssessment(assessment, assessment.route.reason),
      ),
      gaps: unique(routed.flatMap(({ route }) => route.gaps ?? [])),
    });
  }

  const selection = selectEligibleLanes(eligible, ownerDirectedChildLimit);
  const selected = selection.selected;
  const selectedIds = new Set(selected.map(({ lane }) => lane.id));
  const recommendedChildren = selected.map((assessment) => {
    const contract = composeChildContract(assessment);
    const delivery = deliveries.get(assessment.lane.id);
    if (delivery) {
      contract.contextDelivery = composeContextDelivery(
        contract,
        delivery,
        assessment.lane.taskKind,
      );
    }
    if (contract.routeRecommendation.modelRecommendation) {
      contract.modelTaskId = envelope.requestId;
      contract.modelScopeDigest = createModelScopeDigest(contract);
    }
    return contract;
  });
  const deferredLanes = routed
    .filter(({ lane }) => !selectedIds.has(lane.id))
    .map((assessment) =>
      deferredAssessment(
        assessment,
        selection.deferredReasons.get(assessment.lane.id) ?? assessment.route.reason,
      ),
    );

  return recommendation({
    envelope,
    execution: 'bounded-lanes',
    reason: `${recommendedChildren.length} independent lane(s) have validated semantic evidence, bounded outputs, and explicit integration value.`,
    ownerDirectedChildLimit,
    recommendedChildren,
    deferredLanes,
    gaps: selection.gaps,
  });
}

export function assessLaneIndependence({ lane, peerLanes = [], envelope } = {}) {
  assertValidTaskEnvelope(envelope);
  if (!Array.isArray(peerLanes)) throw new TypeError('peerLanes must be an array.');
  const normalizedLane = normalizeLane(lane, envelope);
  const normalizedPeers = peerLanes.map((peer) => normalizeLane(peer, envelope));
  assertUniqueLaneIds([normalizedLane, ...normalizedPeers]);
  return deepFreeze(assessNormalizedLane(normalizedLane, [normalizedLane, ...normalizedPeers]));
}

// Fresh scoped rescue, preserving semantic risk and all original ownership constraints.
// Invocation effort is bound separately; ordinary delivery low/inheritance stays unsupported.
export function createRecoveryChildContract({ primaryContract, sourceSnapshot }) {
  requireString(sourceSnapshot, 'recovery source snapshot', 300);
  if (!primaryContract?.routeRecommendation?.modelRecommendation || !primaryContract.modelTaskId)
    throw new TypeError('Recovery requires a model-bound primary contract.');
  const contract = structuredClone(primaryContract);
  delete contract.routeRecommendation.modelRecommendation;
  if (
    !contract.contextDelivery ||
    contract.contextDelivery.mode !== 'scoped' ||
    contract.contextDelivery.effortMode !== 'explicit'
  )
    throw new TypeError('Recovery requires fresh scoped explicit context.');
  contract.contextDelivery.snapshot = sourceSnapshot;
  contract.modelScopeDigest = createModelScopeDigest(contract);
  return contract;
}

export function assertRecoveryChildContract(contract, recoveryBinding) {
  const binding = assertCurrentRecoveryBinding(recoveryBinding);
  const delivery = contract.contextDelivery;
  if (
    contract.routeRecommendation.modelRecommendation !== undefined ||
    contract.routeRecommendation.role !== binding.rescue.role ||
    contract.routeRecommendation.effort !== binding.rescue.semanticEffort ||
    contract.routeRecommendation.impactRisk !== binding.rescue.impactRisk ||
    contract.modelTaskId !== binding.rescue.taskId ||
    contract.laneId !== binding.rescue.laneId ||
    contract.modelScopeDigest !== binding.rescue.scopeDigest ||
    createModelScopeDigest(contract) !== binding.rescue.scopeDigest ||
    createModelScopeDigest({ boundary: contract.boundary, allowed: contract.allowed }) !==
      binding.primary.ownershipDigest ||
    !delivery ||
    delivery.purpose !== 'task' ||
    delivery.mode !== 'scoped' ||
    delivery.effortMode !== 'explicit' ||
    delivery.compatible !== true ||
    delivery.applied !== false ||
    delivery.gaps.length !== 0 ||
    delivery.failures.length !== 0
  )
    throw new TypeError('Recovery contract/context must match its exact selection.');
}

// Binding for reported admission, not authentication or a live filesystem observation.
export function createModelScopeDigest(contract) {
  const { modelScopeDigest: _digest, ...scope } = contract;
  return `sha256:${createHash('sha256').update(JSON.stringify(scope)).digest('hex')}`;
}

function assessNormalizedLane(lane, allLanes) {
  const reasons = [];
  if (lane.dependencies.length > 0) reasons.push('lane-has-result-dependencies');
  if (lane.taskKind === 'implementation' && lane.writeOwnership.length === 0) {
    reasons.push('implementation-write-owner-missing');
  }

  const conflictingLaneIds = allLanes
    .filter((peer) => peer.id !== lane.id && writeScopesOverlap(lane, peer))
    .map(({ id }) => id)
    .sort();
  if (conflictingLaneIds.length > 0) {
    reasons.push(`shared-write-ownership:${conflictingLaneIds.join(',')}`);
  }

  return {
    lane,
    independent: reasons.length === 0,
    reasons,
  };
}

function normalizeLane(lane, envelope) {
  if (!lane || typeof lane !== 'object' || Array.isArray(lane)) {
    throw new TypeError('lane candidate must be an object.');
  }
  for (const field of Object.keys(lane)) {
    if (!LANE_FIELDS.has(field)) throw new TypeError(`Unsupported lane field: ${field}`);
  }

  const taskKind = requireEnum(lane.taskKind, TASK_KINDS, 'taskKind');
  const impactRisk = requireEnum(
    lane.impactRisk ?? normalizeEnvelopeRisk(envelope.risk),
    IMPACT_RISKS,
    'impactRisk',
  );
  const readScope = normalizeScopeArray(lane.readScope, 'readScope');
  const writeOwnership = normalizeScopeArray(lane.writeOwnership ?? [], 'writeOwnership', {
    allowHttps: false,
    allowEmpty: true,
  });
  const allowedEvidence = normalizeEnumArray(
    lane.allowedEvidence ?? envelope.requiredEvidence,
    ALLOWED_EVIDENCE,
    'allowedEvidence',
  );
  const allowedTools = normalizeEnumArray(
    lane.allowedTools ?? defaultTools(taskKind, writeOwnership.length > 0),
    ALLOWED_TOOLS,
    'allowedTools',
  );
  if (allowedTools.includes('workspace-edit') && writeOwnership.length === 0) {
    throw new TypeError('workspace-edit requires explicit writeOwnership.');
  }

  return {
    id: requireIdentifier(lane.id, 'lane id'),
    domain: requireIdentifier(lane.domain, 'lane domain'),
    taskKind,
    priority: requireEnum(lane.priority ?? 'medium', PRIORITIES, 'priority'),
    impactRisk,
    objective: requireString(lane.objective, 'objective', 300),
    question: requireString(lane.question, 'question', 300),
    allowedEvidence,
    allowedTools,
    readScope,
    writeOwnership,
    dependencies: normalizeIdentifierArray(lane.dependencies ?? [], 'dependencies'),
    nonGoals: normalizeStringArray(
      lane.nonGoals ?? ['Do not rewrite the global plan or final user response.'],
      'nonGoals',
    ),
    prohibitedAssumptions: normalizeStringArray(
      lane.prohibitedAssumptions ?? [
        'Do not fill missing authority, policy, or evidence by assumption.',
      ],
      'prohibitedAssumptions',
    ),
    expectedOutputFields: normalizeStringArray(lane.expectedOutputFields, 'expectedOutputFields'),
    verification: normalizeStringArray(lane.verification, 'verification'),
    stopCondition: requireString(
      lane.stopCondition ??
        'Stop after the bounded output and its verification evidence are complete.',
      'stopCondition',
      300,
    ),
    handoffCondition: requireString(
      lane.handoffCondition ??
        'Return gaps, conflicts, or scope expansion to the leader without widening ownership.',
      'handoffCondition',
      300,
    ),
    benefit: normalizeBenefit(lane.benefit),
    pass2Evidence: lane.pass2Evidence,
    ...(lane.modelRequest !== undefined
      ? { modelRequest: normalizeModelRequest(lane.modelRequest) }
      : {}),
  };
}

function composeChildContract({ lane, route }) {
  return {
    schemaVersion: 1,
    laneId: lane.id,
    domain: lane.domain,
    objective: lane.objective,
    question: lane.question,
    allowed: {
      evidence: lane.allowedEvidence,
      tools: lane.allowedTools,
    },
    boundary: {
      readScope: lane.readScope,
      writeOwnership: lane.writeOwnership,
      readOnly: lane.writeOwnership.length === 0,
    },
    nonGoals: lane.nonGoals,
    prohibitedAssumptions: lane.prohibitedAssumptions,
    expectedOutputSchema: {
      required: unique([...lane.expectedOutputFields, 'facts', 'inferences', 'gaps', 'confidence']),
      evidenceLabels: ['fact', 'inference', 'gap'],
    },
    verification: lane.verification,
    stopCondition: lane.stopCondition,
    handoffCondition: lane.handoffCondition,
    benefit: lane.benefit,
    routeRecommendation: {
      role: route.role,
      effort: route.effort,
      execution: route.execution,
      reason: route.reason,
      pass2Applied: route.pass2Applied,
      impactRisk: route.impactRisk,
      evidenceIds: route.evidenceIds,
      assessment: route.assessment,
      gaps: route.gaps,
      confidence: route.confidence,
      runtimeApplication: route.runtimeApplication,
      ...(route.modelRecommendation ? { modelRecommendation: route.modelRecommendation } : {}),
    },
    leaderOwnership: {
      finalDecision: true,
      finalUserResponse: true,
      integration: true,
      finalVerification: true,
    },
  };
}

function composeContextDelivery(contract, request, taskKind) {
  const { purpose, runtime, previous, effortMode } = request;
  const { role } = contract.routeRecommendation;
  const effort = resolveRouteEffort(contract.routeRecommendation);
  const gaps = [];
  let mode = request.mode;
  if (['review', 'verification'].includes(taskKind) && purpose === 'task') {
    gaps.push('review-purpose-required');
  }
  if (purpose !== 'task' && role !== 'repo_reviewer') gaps.push('independent-review-role-required');
  if (purpose === 'initial-review' && mode !== 'scoped') {
    mode = 'scoped';
    gaps.push('initial-review-requires-fresh-scoped-context');
  }
  if (purpose === 'review-delta' && mode === 'full-history') {
    mode = 'scoped';
    gaps.push('review-delta-requires-scoped-or-reused-context');
  }
  if (
    mode === 'reuse' &&
    (!previous ||
      previous.laneId !== contract.laneId ||
      previous.role !== role ||
      previous.sameOutcome !== true ||
      previous.scopeUnchanged !== true ||
      previous.revalidatedForSnapshot !== request.snapshot ||
      (purpose === 'review-delta' && previous.independentReview !== true))
  ) {
    mode = 'scoped';
    gaps.push('reuse-context-incompatible');
  }
  if (mode === 'full-history' && !request.rationale) gaps.push('full-history-rationale-required');
  if (!runtime || runtime.freshness !== 'current-turn') {
    gaps.push('delivery-runtime-unverified');
  } else {
    const capability = {
      scoped: 'scopedFork',
      'full-history': 'fullHistoryFork',
      reuse: 'followup',
    }[mode];
    if (runtime[capability] !== true)
      gaps.push(`${mode === 'scoped' ? 'scoped-fork' : mode}-unsupported`);
    if (effortMode === 'explicit') {
      if (mode === 'reuse') gaps.push('reuse-effort-override-unsupported');
      if (runtime.explicitEffort !== true) gaps.push('explicit-effort-unsupported');
      if (mode === 'full-history' && runtime.fullHistoryWithExplicitEffort !== true) {
        gaps.push('full-history-explicit-effort-unsupported');
      }
    } else if (runtime.effectiveEffort !== effort) {
      gaps.push('inherited-effort-mismatch');
    }
  }

  return {
    schemaVersion: 1,
    purpose,
    requestedMode: request.mode,
    mode,
    effortMode,
    rationale: request.rationale,
    snapshot: request.snapshot,
    instructionSources: [
      'AGENTS.md',
      'docs/development/agent-workflows/agent-execution-contract.md',
    ],
    evidencePointers: request.evidencePointers,
    findings: request.findings,
    failures: request.failures,
    reuseTarget: mode === 'reuse' && gaps.length === 0 ? previous.childId : null,
    compatible: gaps.length === 0,
    // Pure advice cannot assert applied settings, ownership, or native permission.
    applied: false,
    authority: 'leader-reported-not-host-authenticated',
    requiresLeaderRuntimeConfirmation: true,
    requiresLifecycleConfirmation: mode === 'reuse',
    gaps,
  };
}

function normalizeDeliveryRequests(value, lanes) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError('deliveryByLane must be an object.');
  }
  const byId = new Map(lanes.map((lane) => [lane.id, lane]));
  return new Map(
    Object.entries(value).map(([id, request]) => {
      const lane = byId.get(id);
      if (!lane) throw new TypeError(`Unknown delivery lane: ${id}`);
      requireDeliveryRecord(request, [
        'purpose',
        'mode',
        'effortMode',
        'rationale',
        'snapshot',
        'evidencePointers',
        'findings',
        'failures',
        'previous',
        'runtime',
      ]);
      const normalized = {
        purpose: requireEnum(
          request.purpose,
          new Set(['task', 'initial-review', 'review-delta']),
          'delivery purpose',
        ),
        mode: requireEnum(
          request.mode,
          new Set(['scoped', 'full-history', 'reuse']),
          'delivery mode',
        ),
        effortMode: requireEnum(
          request.effortMode,
          new Set(['explicit', 'inherit']),
          'delivery effortMode',
        ),
        rationale:
          request.rationale === null
            ? null
            : requireString(request.rationale, 'delivery rationale', 300),
        snapshot: requireString(request.snapshot, 'delivery snapshot', 300),
        evidencePointers: normalizeScopeArray(
          request.evidencePointers,
          'delivery evidencePointers',
        ),
        findings: normalizeStringArray(request.findings, 'delivery findings', { allowEmpty: true }),
        failures: normalizeStringArray(request.failures, 'delivery failures', { allowEmpty: true }),
        previous: normalizePreviousContext(request.previous),
        runtime: normalizeDeliveryRuntime(request.runtime),
      };
      for (const pointer of normalized.evidencePointers) {
        if (!lane.readScope.some((scope) => deliveryPointerWithinScope(pointer, scope))) {
          throw new TypeError('Delivery evidence cannot expand the lane readScope.');
        }
      }
      return [id, normalized];
    }),
  );
}

function deliveryPointerWithinScope(pointer, scope) {
  if (pointer.startsWith('https://') || scope.startsWith('https://')) {
    if (!pointer.startsWith('https://') || !scope.startsWith('https://')) return false;
    try {
      const target = new URL(pointer);
      const root = new URL(scope);
      if (
        target.origin !== root.origin ||
        target.username ||
        target.password ||
        root.username ||
        root.password
      )
        return false;
      // WHATWG URL resolves literal/encoded dot segments. Reject encoded path
      // separators rather than guessing a provider's additional decoding rules.
      if (/%2f|%5c/iu.test(`${target.pathname}${root.pathname}`)) return false;
      if (root.search || root.hash) return target.href === root.href;
      pointer = target.pathname;
      scope = root.pathname;
    } catch {
      return false;
    }
  }
  return pointer === scope || pointer.startsWith(`${scope.replace(/\/$/u, '')}/`);
}

function normalizePreviousContext(value) {
  if (value === null) return null;
  requireDeliveryRecord(value, [
    'childId',
    'laneId',
    'role',
    'sourceSnapshot',
    'revalidatedForSnapshot',
    'sameOutcome',
    'scopeUnchanged',
    'independentReview',
  ]);
  const result = {};
  for (const field of ['childId', 'laneId', 'role', 'sourceSnapshot', 'revalidatedForSnapshot']) {
    result[field] = requireString(value[field], `delivery previous.${field}`, 300);
    if (result[field] !== value[field]) throw new TypeError('Delivery context IDs must be exact.');
  }
  for (const field of ['sameOutcome', 'scopeUnchanged', 'independentReview']) {
    if (typeof value[field] !== 'boolean')
      throw new TypeError(`delivery previous.${field} must be boolean.`);
    result[field] = value[field];
  }
  return result;
}

function normalizeDeliveryRuntime(value) {
  if (value === null) return null;
  const flags = [
    'scopedFork',
    'fullHistoryFork',
    'followup',
    'explicitEffort',
    'fullHistoryWithExplicitEffort',
  ];
  requireDeliveryRecord(value, ['freshness', 'effectiveEffort', ...flags]);
  const result = {
    freshness: requireEnum(
      value.freshness,
      new Set(['current-turn', 'stale', 'unknown']),
      'delivery freshness',
    ),
    effectiveEffort:
      value.effectiveEffort === null
        ? null
        : requireEnum(
            value.effectiveEffort,
            new Set(['medium', 'high', 'xhigh']),
            'delivery effectiveEffort',
          ),
  };
  for (const field of flags) {
    if (value[field] !== null && typeof value[field] !== 'boolean') {
      throw new TypeError(`delivery runtime.${field} must be boolean or null.`);
    }
    result[field] = value[field];
  }
  return result;
}

function requireDeliveryRecord(value, fields) {
  if (
    !value ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.keys(value).length !== fields.length ||
    fields.some((field) => !Object.hasOwn(value, field))
  ) {
    throw new TypeError(`Delivery record must contain exactly: ${fields.join(', ')}.`);
  }
}

function delegationGate(envelope, contextPack) {
  if (envelope.recommendedPath === 'direct' || envelope.intent === 'answer') {
    return {
      execution: 'direct',
      reason: 'The request is answerable on the direct path without child coordination.',
      gaps: [],
    };
  }
  if (
    ['clarify', 'oq-handoff'].includes(envelope.recommendedPath) ||
    envelope.ambiguities.some(({ disposition }) => disposition === 'clarify-now')
  ) {
    return {
      execution: 'single-sequential',
      reason: 'Unresolved authority or ambiguity must be handled before delegation.',
      gaps: ['delegation-blocked-by-ambiguity-or-authority'],
    };
  }
  if (
    envelope.intent === 'plan' &&
    contextPack.gaps.some((gap) => gap.startsWith('primary-domain-conflict'))
  ) {
    return {
      execution: 'single-sequential',
      reason:
        'The primary plan owner is unresolved; delegation cannot choose ownership by assumption.',
      gaps: ['delegation-blocked-by-primary-owner-conflict'],
    };
  }
  return null;
}

function recommendation({
  envelope,
  execution,
  reason,
  ownerDirectedChildLimit,
  recommendedChildren,
  deferredLanes,
  gaps,
}) {
  return deepFreeze({
    schemaVersion: 1,
    requestId: envelope.requestId,
    execution,
    reason,
    recommendedChildren,
    deferredLanes,
    gaps: unique(gaps),
    limits: {
      defaultChildren: 0,
      proactiveChildren: {
        normalMax: PROACTIVE_NORMAL_LIMIT,
        evidenceBackedMax: PROACTIVE_EVIDENCE_BACKED_LIMIT,
      },
      ownerDirectedMax: HARD_CHILD_LIMIT,
      mode: ownerDirectedChildLimit === null ? 'proactive' : 'owner-directed',
      applied: ownerDirectedChildLimit ?? PROACTIVE_EVIDENCE_BACKED_LIMIT,
    },
    leaderOwnership: {
      dispatchDecision: true,
      finalDecision: true,
      finalUserResponse: true,
      integration: true,
      finalVerification: true,
    },
  });
}

function deferredAssessment(assessment, routeReason) {
  return {
    laneId: assessment.lane.id,
    reasons:
      assessment.reasons.length > 0
        ? assessment.reasons
        : [routeReason ?? 'Delegation is not authorized on the current path.'],
  };
}

function selectEligibleLanes(eligible, ownerDirectedChildLimit) {
  const selected = [];
  const deferredReasons = new Map();
  const gaps = [];
  const appliedLimit = ownerDirectedChildLimit ?? PROACTIVE_EVIDENCE_BACKED_LIMIT;

  for (const assessment of eligible) {
    const { lane, route } = assessment;
    if (selected.length >= appliedLimit) {
      deferSelection(
        deferredReasons,
        gaps,
        lane.id,
        `Deferred by the applied child limit of ${appliedLimit}.`,
        'lane-consolidation-required',
      );
      continue;
    }

    if (
      lane.writeOwnership.length > 0 &&
      selected.some(({ lane: selectedLane }) => selectedLane.writeOwnership.length > 0)
    ) {
      deferSelection(
        deferredReasons,
        gaps,
        lane.id,
        'Only one write-capable child lane may be selected.',
        'write-child-limit-exceeded',
      );
      continue;
    }

    if (ownerDirectedChildLimit === null && selected.length >= PROACTIVE_NORMAL_LIMIT) {
      const boundHighValue =
        lane.benefit.value === 'high' &&
        lane.benefit.evidenceIds.every((evidenceId) => route.evidenceIds.includes(evidenceId));
      if (!boundHighValue) {
        deferSelection(
          deferredReasons,
          gaps,
          lane.id,
          lane.benefit.value === 'high'
            ? 'The claimed high-value benefit is not bound to the lane Pass 2 evidence.'
            : 'A third proactive child requires explicit high-value semantic evidence.',
          lane.benefit.value === 'high'
            ? 'high-value-benefit-evidence-unbound'
            : 'third-proactive-child-requires-high-value-evidence',
        );
        continue;
      }
    }

    selected.push(assessment);
  }

  return {
    selected,
    deferredReasons,
    gaps: unique([
      ...gaps,
      ...(eligible.length > selected.length
        ? [
            `lane-consolidation-required: ${eligible.length - selected.length} eligible lane(s) deferred.`,
          ]
        : []),
    ]),
  };
}

function deferSelection(deferredReasons, gaps, laneId, reason, gap) {
  deferredReasons.set(laneId, reason);
  gaps.push(gap);
}

function compareLanePriority(left, right) {
  return (
    priorityWeight(right.lane.priority) - priorityWeight(left.lane.priority) ||
    left.lane.id.localeCompare(right.lane.id)
  );
}

function priorityWeight(priority) {
  return { low: 1, medium: 2, high: 3 }[priority];
}

function writeScopesOverlap(left, right) {
  return left.writeOwnership.some((leftPath) =>
    right.writeOwnership.some((rightPath) => pathsOverlap(leftPath, rightPath)),
  );
}

function pathsOverlap(left, right) {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function assertContextPack(contextPack, requestId) {
  if (!contextPack || typeof contextPack !== 'object' || Array.isArray(contextPack)) {
    throw new TypeError('ContextPack must be an object.');
  }
  if (contextPack.schemaVersion !== 1 || contextPack.requestId !== requestId) {
    throw new TypeError('ContextPack must match the TaskEnvelope request and schema.');
  }
  for (const field of ['domainCandidates', 'selectedGuides', 'sources', 'gaps']) {
    if (!Array.isArray(contextPack[field]))
      throw new TypeError(`ContextPack ${field} must be an array.`);
  }
}

function assertUniqueLaneIds(lanes) {
  const ids = lanes.map(({ id }) => id);
  if (new Set(ids).size !== ids.length) throw new TypeError('lane ids must be unique.');
}

function normalizeBenefit(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('lane benefit is required.');
  }
  const normalized = {
    kind: requireEnum(value.kind, BENEFIT_KINDS, 'benefit kind'),
    rationale: requireString(value.rationale, 'benefit rationale', 300),
    value: requireEnum(value.value ?? 'standard', BENEFIT_VALUES, 'benefit value'),
    evidenceIds: normalizeStringArray(value.evidenceIds ?? [], 'benefit evidenceIds', {
      allowEmpty: true,
    }),
  };
  if (normalized.value === 'high' && normalized.evidenceIds.length === 0) {
    throw new TypeError('high-value child benefit requires semantic evidenceIds.');
  }
  return normalized;
}

function defaultTools(taskKind, hasWriteOwnership) {
  if (taskKind === 'research') return ['official-web-read'];
  if (hasWriteOwnership && ['implementation', 'debugging'].includes(taskKind)) {
    return ['repository-read', 'workspace-edit'];
  }
  if (taskKind === 'test') {
    return hasWriteOwnership
      ? ['repository-read', 'test-runner', 'workspace-edit']
      : ['repository-read', 'test-runner'];
  }
  return ['repository-read'];
}

function normalizeScopeArray(values, field, { allowHttps = true, allowEmpty = false } = {}) {
  if (!Array.isArray(values) || (!allowEmpty && values.length === 0)) {
    throw new TypeError(`${field} must be ${allowEmpty ? 'an' : 'a non-empty'} array.`);
  }
  const normalized = values
    .map((value) => requireString(value, field, 300))
    .map((value) => normalizeScope(value, allowHttps));
  return unique(normalized);
}

function normalizeScope(value, allowHttps) {
  const normalized = value.replaceAll('\\', '/');
  if (allowHttps && normalized.startsWith('https://')) return normalized;
  if (/^[a-z][a-z\d+.-]*:\/\//iu.test(normalized)) {
    throw new TypeError('lane scope external URLs must use HTTPS.');
  }
  if (normalized.startsWith('/') || normalized.split('/').includes('..')) {
    throw new TypeError('lane scope must stay inside the repository.');
  }
  return normalized.replace(/\/$/u, '').replace(/^\.\//u, '');
}

function normalizeEnumArray(values, allowed, field) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new TypeError(`${field} must be a non-empty array.`);
  }
  return unique(values.map((value) => requireEnum(value, allowed, field)));
}

function normalizeIdentifierArray(values, field) {
  if (!Array.isArray(values)) throw new TypeError(`${field} must be an array.`);
  return unique(values.map((value) => requireIdentifier(value, field)));
}

function normalizeStringArray(values, field, { allowEmpty = false } = {}) {
  if (!Array.isArray(values) || (!allowEmpty && values.length === 0)) {
    throw new TypeError(`${field} must be ${allowEmpty ? 'an' : 'a non-empty'} array.`);
  }
  return unique(values.map((value) => requireString(value, field, 300)));
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

function validateOwnerDirectedChildLimit(value) {
  if (value === null) return;
  if (!Number.isInteger(value) || value < 1 || value > HARD_CHILD_LIMIT) {
    throw new TypeError(`ownerDirectedChildLimit must be between 1 and ${HARD_CHILD_LIMIT}.`);
  }
}

function normalizeEnvelopeRisk(value) {
  return value === 'critical' ? 'high' : value;
}

function unique(values) {
  return [...new Set(values)];
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}
