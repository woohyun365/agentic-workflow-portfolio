const STATUSES = new Set(['draft', 'proposed', 'implementation-ready', 'blocked', 'completed']);
const EVIDENCE_SURFACES = new Set(['tracked-only', 'local-verified', 'mixed']);
const WORKING_TREE_STATES = new Set(['unknown', 'inspected']);
const RUNTIME_STATES = new Set(['unverified', 'verified', 'unavailable']);
const TRACKING_STATES = new Set(['tracked', 'allowlisted', 'ignored', 'unknown']);
const ACCEPTANCE_STATES = new Set(['required', 'passed', 'blocked']);
const QUESTION_STATES = new Set(['open', 'decided', 'handed-off']);
const ENFORCEMENT_STRENGTHS = new Set([
  'deterministic-static',
  'advisory-policy',
  'model-mediated',
  'native-runtime',
]);
const EXECUTION_OWNERS = new Set([
  'deterministic-static',
  'advisory-policy',
  'model-mediated',
  'native-runtime',
]);
const TOP_LEVEL_FIELDS = new Set([
  'schemaVersion',
  'planId',
  'status',
  'evidenceSurface',
  'baseline',
  'targetPaths',
  'configuration',
  'enforcementClaims',
  'phases',
  'acceptance',
  'openQuestions',
]);
const REQUIRED_CHECKPOINT_FIELDS = [
  'branch',
  'head',
  'changedFiles',
  'verification',
  'nextAction',
  'blocker',
];

export function assessPlanReadiness(input) {
  assertRecord(input, 'plan readiness input');
  if (input.schemaVersion !== 1) throw new TypeError('schemaVersion must equal 1');
  rejectUnknownFields(input, TOP_LEVEL_FIELDS, 'plan readiness input');

  const planId = requireString(input.planId, 'planId');
  const status = requireEnum(input.status, STATUSES, 'status');
  const evidenceSurface = requireEnum(input.evidenceSurface, EVIDENCE_SURFACES, 'evidenceSurface');
  const baseline = normalizeBaseline(input.baseline);
  const targetPaths = normalizeTargetPaths(input.targetPaths ?? []);
  const configuration = normalizeConfiguration(input.configuration);
  const enforcementClaims = normalizeEnforcementClaims(input.enforcementClaims ?? []);
  const phases = normalizePhases(input.phases ?? []);
  const acceptance = normalizeAcceptance(input.acceptance ?? []);
  const openQuestions = normalizeOpenQuestions(input.openQuestions ?? []);

  const blockingFindings = [];
  const warnings = [];
  const addBlocking = findingCollector(blockingFindings);
  const addWarning = findingCollector(warnings);

  if (baseline.workingTree.state !== 'inspected') {
    addBlocking(
      'working-tree-unverified',
      'baseline.workingTree',
      'Implementation readiness requires an inspected working tree and protected path inventory.',
    );
  }

  if (
    status === 'implementation-ready' &&
    baseline.localRuntime.requiredEvidence.length > 0 &&
    baseline.localRuntime.state !== 'verified'
  ) {
    addBlocking(
      'local-runtime-gap',
      'baseline.localRuntime',
      'Tool-specific implementation readiness requires verified local runtime evidence.',
    );
  } else if (
    status !== 'implementation-ready' &&
    baseline.localRuntime.state !== 'verified' &&
    baseline.localRuntime.requiredEvidence.length > 0
  ) {
    addWarning(
      'local-runtime-gap',
      'baseline.localRuntime',
      'Local runtime evidence remains required before implementation-ready promotion.',
    );
  }

  for (const target of targetPaths) {
    if (
      target.intendedState === 'tracked' &&
      !['tracked', 'allowlisted'].includes(target.trackingState)
    ) {
      if (target.trackingMigration == null) {
        addBlocking(
          'ignored-target-path',
          `targetPaths.${target.path}`,
          `Tracked target ${target.path} is ${target.trackingState}; the plan must own its tracking migration.`,
        );
      } else {
        const ownerPhase = phases.find(({ id }) => id === target.trackingMigration.phaseId);
        if (
          !ownerPhase?.mutatesTrackedSource ||
          !ownerPhase.ownedPaths.includes(target.trackingMigration.policyPath) ||
          !ownerPhase.tests.includes(target.trackingMigration.verification)
        ) {
          addBlocking(
            'incomplete-tracking-migration',
            `targetPaths.${target.path}.trackingMigration`,
            `Tracking migration for ${target.path} must reference a mutating Phase that owns the policy path and exact verification.`,
          );
        } else {
          addWarning(
            'tracking-migration-required',
            `targetPaths.${target.path}`,
            `Tracked target ${target.path} remains ${target.trackingState} until ${ownerPhase.id} completes the declared migration.`,
          );
        }
      }
    }
    if (
      target.intendedState === 'local-only' &&
      ['tracked', 'allowlisted'].includes(target.trackingState)
    ) {
      addBlocking(
        'local-only-target-tracked',
        `targetPaths.${target.path}`,
        `Local-only target ${target.path} is ${target.trackingState}; remove it from tracking or change the declared ownership.`,
      );
    }
  }

  if (configuration) {
    if (
      configuration.proactiveChildCap > configuration.nativeChildCap ||
      configuration.explicitManualChildMax > configuration.nativeChildCap
    ) {
      addBlocking(
        'concurrency-contract-conflict',
        'configuration',
        'Repository proactive/manual child claims cannot exceed the native child cap.',
      );
    }
    if (status === 'implementation-ready' && configuration.precedenceEvidence !== 'verified') {
      addBlocking(
        'local-runtime-gap',
        'configuration.precedenceEvidence',
        'Tool-specific config precedence must be verified before implementation.',
      );
    }
  }

  for (const [index, claim] of enforcementClaims.entries()) {
    if (
      claim.claimedStrength === 'deterministic-static' &&
      claim.executionOwner !== 'deterministic-static'
    ) {
      addBlocking(
        'enforcement-strength-conflict',
        `enforcementClaims[${index}]`,
        'A deterministic-static claim requires a deterministic-static execution owner.',
      );
    }
  }

  for (const [index, phase] of phases.entries()) {
    if (phase.mutatesTrackedSource && !isCompleteMutatingPhase(phase)) {
      addBlocking(
        'incomplete-phase-contract',
        `phases[${index}]`,
        `Mutating phase ${phase.id} is missing an execution, ownership, verification, rollback, or checkpoint boundary.`,
      );
    }
  }

  for (const [index, item] of acceptance.entries()) {
    if (item.status === 'passed' && item.evidence.length === 0) {
      addBlocking(
        'achieved-acceptance-without-evidence',
        `acceptance[${index}]`,
        `Acceptance ${item.id} is marked passed without evidence.`,
      );
    }
    if (['draft', 'proposed', 'blocked'].includes(status) && item.status === 'passed') {
      addBlocking(
        'premature-acceptance-state',
        `acceptance[${index}]`,
        `Acceptance ${item.id} cannot be marked passed while the plan status is ${status}.`,
      );
    }
  }

  for (const [index, question] of openQuestions.entries()) {
    if (question.blocking && question.status === 'open') {
      addBlocking(
        'blocking-open-question',
        `openQuestions[${index}]`,
        `Blocking question ${question.id} remains open.`,
      );
    }
  }

  return deepFreeze({
    schemaVersion: 1,
    planId,
    status,
    evidenceSurface,
    ready: status === 'implementation-ready' && blockingFindings.length === 0,
    facts: [
      { code: 'target-path-count', value: targetPaths.length },
      { code: 'phase-count', value: phases.length },
      { code: 'blocking-finding-count', value: blockingFindings.length },
    ],
    blockingFindings: sortFindings(blockingFindings),
    warnings: sortFindings(warnings),
    confidence: 'high',
  });
}

function normalizeBaseline(value) {
  assertRecord(value, 'baseline');
  const workingTree = value.workingTree;
  const localRuntime = value.localRuntime;
  assertRecord(workingTree, 'baseline.workingTree');
  assertRecord(localRuntime, 'baseline.localRuntime');
  return {
    branch: requireString(value.branch, 'baseline.branch'),
    head: requireSha(value.head, 'baseline.head'),
    workingTree: {
      state: requireEnum(workingTree.state, WORKING_TREE_STATES, 'baseline.workingTree.state'),
      protectedPaths: normalizeStringArray(
        workingTree.protectedPaths,
        'baseline.workingTree.protectedPaths',
      ),
    },
    localRuntime: {
      state: requireEnum(localRuntime.state, RUNTIME_STATES, 'baseline.localRuntime.state'),
      requiredEvidence: normalizeStringArray(
        localRuntime.requiredEvidence,
        'baseline.localRuntime.requiredEvidence',
      ),
    },
  };
}

function normalizeTargetPaths(values) {
  if (!Array.isArray(values)) throw new TypeError('targetPaths must be an array');
  return values.map((value, index) => {
    assertRecord(value, `targetPaths[${index}]`);
    return {
      path: requireString(value.path, `targetPaths[${index}].path`),
      intendedState: requireEnum(
        value.intendedState,
        new Set(['tracked', 'local-only']),
        `targetPaths[${index}].intendedState`,
      ),
      trackingState: requireEnum(
        value.trackingState,
        TRACKING_STATES,
        `targetPaths[${index}].trackingState`,
      ),
      trackingEvidence: requireString(
        value.trackingEvidence,
        `targetPaths[${index}].trackingEvidence`,
      ),
      trackingMigration: normalizeTrackingMigration(
        value.trackingMigration,
        `targetPaths[${index}].trackingMigration`,
      ),
    };
  });
}

function normalizeTrackingMigration(value, path) {
  if (value == null) return null;
  assertRecord(value, path);
  return {
    phaseId: requireString(value.phaseId, `${path}.phaseId`),
    policyPath: requireString(value.policyPath, `${path}.policyPath`),
    verification: requireString(value.verification, `${path}.verification`),
  };
}

function normalizeConfiguration(value) {
  if (value == null) return null;
  assertRecord(value, 'configuration');
  return {
    nativeChildCap: requirePositiveInteger(value.nativeChildCap, 'configuration.nativeChildCap'),
    proactiveChildCap: requirePositiveInteger(
      value.proactiveChildCap,
      'configuration.proactiveChildCap',
    ),
    explicitManualChildMax: requirePositiveInteger(
      value.explicitManualChildMax,
      'configuration.explicitManualChildMax',
    ),
    precedenceEvidence: requireEnum(
      value.precedenceEvidence,
      new Set(['verified', 'unverified', 'not-applicable']),
      'configuration.precedenceEvidence',
    ),
  };
}

function normalizeEnforcementClaims(values) {
  if (!Array.isArray(values)) throw new TypeError('enforcementClaims must be an array');
  return values.map((value, index) => {
    assertRecord(value, `enforcementClaims[${index}]`);
    return {
      claim: requireString(value.claim, `enforcementClaims[${index}].claim`),
      claimedStrength: requireEnum(
        value.claimedStrength,
        ENFORCEMENT_STRENGTHS,
        `enforcementClaims[${index}].claimedStrength`,
      ),
      executionOwner: requireEnum(
        value.executionOwner,
        EXECUTION_OWNERS,
        `enforcementClaims[${index}].executionOwner`,
      ),
    };
  });
}

function normalizePhases(values) {
  if (!Array.isArray(values)) throw new TypeError('phases must be an array');
  return values.map((value, index) => {
    assertRecord(value, `phases[${index}]`);
    return {
      id: requireString(value.id, `phases[${index}].id`),
      mutatesTrackedSource: requireBoolean(
        value.mutatesTrackedSource,
        `phases[${index}].mutatesTrackedSource`,
      ),
      preconditions: normalizeStringArray(value.preconditions, `phases[${index}].preconditions`),
      branch: value.branch == null ? null : requireString(value.branch, `phases[${index}].branch`),
      prTarget:
        value.prTarget == null ? null : requireString(value.prTarget, `phases[${index}].prTarget`),
      ownedPaths: normalizeStringArray(value.ownedPaths, `phases[${index}].ownedPaths`),
      nonOwnedPaths: normalizeStringArray(value.nonOwnedPaths, `phases[${index}].nonOwnedPaths`),
      work: normalizeStringArray(value.work, `phases[${index}].work`),
      tests: normalizeStringArray(value.tests, `phases[${index}].tests`),
      acceptance: normalizeStringArray(value.acceptance, `phases[${index}].acceptance`),
      excludedWork: normalizeStringArray(value.excludedWork, `phases[${index}].excludedWork`),
      rollback:
        value.rollback == null ? null : requireString(value.rollback, `phases[${index}].rollback`),
      checkpointFields: normalizeStringArray(
        value.checkpointFields,
        `phases[${index}].checkpointFields`,
      ),
    };
  });
}

function normalizeAcceptance(values) {
  if (!Array.isArray(values)) throw new TypeError('acceptance must be an array');
  return values.map((value, index) => {
    assertRecord(value, `acceptance[${index}]`);
    return {
      id: requireString(value.id, `acceptance[${index}].id`),
      status: requireEnum(value.status, ACCEPTANCE_STATES, `acceptance[${index}].status`),
      evidence: normalizeStringArray(value.evidence, `acceptance[${index}].evidence`),
    };
  });
}

function normalizeOpenQuestions(values) {
  if (!Array.isArray(values)) throw new TypeError('openQuestions must be an array');
  return values.map((value, index) => {
    assertRecord(value, `openQuestions[${index}]`);
    return {
      id: requireString(value.id, `openQuestions[${index}].id`),
      status: requireEnum(value.status, QUESTION_STATES, `openQuestions[${index}].status`),
      blocking: requireBoolean(value.blocking, `openQuestions[${index}].blocking`),
      owner: requireString(value.owner, `openQuestions[${index}].owner`),
      requiredEvidence: normalizeStringArray(
        value.requiredEvidence,
        `openQuestions[${index}].requiredEvidence`,
      ),
    };
  });
}

function isCompleteMutatingPhase(phase) {
  return (
    phase.preconditions.length > 0 &&
    phase.branch !== null &&
    phase.prTarget !== null &&
    phase.ownedPaths.length > 0 &&
    phase.nonOwnedPaths.length > 0 &&
    phase.work.length > 0 &&
    phase.tests.length > 0 &&
    phase.acceptance.length > 0 &&
    phase.excludedWork.length > 0 &&
    phase.rollback !== null &&
    REQUIRED_CHECKPOINT_FIELDS.every((field) => phase.checkpointFields.includes(field))
  );
}

function findingCollector(target) {
  const codes = new Set();
  return (code, path, message) => {
    if (codes.has(code)) return;
    codes.add(code);
    target.push({ code, path, message });
  };
}

function sortFindings(findings) {
  return [...findings].sort((left, right) => left.code.localeCompare(right.code));
}

function rejectUnknownFields(value, allowed, path) {
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) throw new TypeError(`${path} has unsupported field: ${field}`);
  }
}

function assertRecord(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object`);
  }
}

function requireString(value, path) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${path} must be a non-empty string`);
  }
  return value.trim();
}

function requireSha(value, path) {
  if (typeof value !== 'string' || !/^[a-f0-9]{40}$/u.test(value)) {
    throw new TypeError(`${path} must be a lowercase 40-character SHA`);
  }
  return value;
}

function requireEnum(value, allowed, path) {
  if (!allowed.has(value)) throw new TypeError(`${path} has an unsupported value: ${value}`);
  return value;
}

function requireBoolean(value, path) {
  if (typeof value !== 'boolean') throw new TypeError(`${path} must be a boolean`);
  return value;
}

function requirePositiveInteger(value, path) {
  if (!Number.isInteger(value) || value < 1) {
    throw new TypeError(`${path} must be a positive integer`);
  }
  return value;
}

function normalizeStringArray(value, path) {
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array`);
  return value.map((item, index) => requireString(item, `${path}[${index}]`));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
