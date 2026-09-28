import {
  BASELINE_CHILD_MODEL,
  getModelProfile,
  createModelProfileBinding,
} from './model-profiles.mjs';
import { createHash } from 'node:crypto';

const TASK_ROLES = new Map([
  ['lookup', 'repo_explorer'],
  ['analysis', 'repo_explorer'],
  ['implementation', 'repo_executor'],
  ['debugging', 'repo_executor'],
  ['test', 'repo_executor'],
  ['research', 'repo_researcher'],
  ['verification', 'repo_reviewer'],
  ['architecture', 'repo_reviewer'],
  ['review', 'repo_reviewer'],
]);
const EXECUTION_SHAPES = new Set(['direct', 'leader-sequential', 'bounded-child']);
const IMPACT_RISKS = new Set(['low', 'medium', 'high']);
const CONFIDENCE_LEVELS = new Set(['low', 'medium', 'high']);
const OUTCOMES = new Set(['confirmed', 'rejected', 'unknown']);
const ROUTING_INPUT_FIELDS = new Set([
  'pass1',
  'contextPack',
  'pass2Evidence',
  'independent',
  'childBenefit',
  'modelRequest',
]);
const PASS1_FIELDS = new Set([
  'taskKind',
  'executionShape',
  'impactRisk',
  'candidateRole',
  'requiredEvidence',
  'confidence',
]);
const PASS2_FIELDS = new Set([
  'sources',
  'facts',
  'predicateClaims',
  'inferences',
  'gaps',
  'confidence',
]);
const SOURCE_FIELDS = new Set([
  'sourceId',
  'path',
  'locator',
  'kind',
  'observedAt',
  'contentDigest',
]);
const FACT_FIELDS = new Set(['factId', 'statement', 'sourceIds', 'confidence']);
const CLAIM_FIELDS = new Set([
  'evidenceId',
  'predicateId',
  'outcome',
  'factIds',
  'semanticMatch',
  'compositeCategory',
]);
const MEDIUM_PREDICATES = new Set(
  Array.from({ length: 15 }, (_, index) => `M-${String(index + 1).padStart(2, '0')}`),
);
const XHIGH_PREDICATES = new Set(
  Array.from({ length: 10 }, (_, index) => `X-${String(index + 1).padStart(2, '0')}`),
);
const DOMAIN_PREDICATES = new Set([
  'FE-01-public-contract-crossing',
  'FE-02-server-client-bff-boundary',
  'FE-03-async-conflict',
  'FE-04-cross-surface-state-machine',
  'FE-05-browser-runtime',
  'FE-06-auth-browser-trust',
  'FE-07-a11y-responsive',
  'FE-08-performance-causal',
  'BE-01-concurrency-transaction',
  'BE-02-migration-backfill',
  'BE-03-multi-lifecycle',
  'BE-04-contract-persistence',
  'BE-05-side-effect-commit',
  'BE-06-auth-session',
  'BE-07-background-cluster',
  'BE-08-query-capacity',
  'INF-01-ci-control-plane',
  'INF-02-change-classifier',
  'INF-03-secret-identity',
  'INF-04-stateful-rollout',
  'INF-05-environment-parity',
  'INF-06-supply-chain',
  'INF-07-ci-performance',
  'INF-08-observability-routing',
  'INF-09-provider-boundary',
  'SEC-01-session-replay',
  'SEC-02-sensitive-lifecycle',
  'SEC-03-enforcement',
  'SEC-04-credential-authority',
  'SEC-05-disclosure',
  'SEC-06-abuse-rate-limit',
  'SEC-07-official-evidence',
]);
const DIRECT_XHIGH_DOMAIN_PREDICATES = new Set([
  'FE-03-async-conflict',
  'FE-04-cross-surface-state-machine',
  'FE-06-auth-browser-trust',
  'BE-01-concurrency-transaction',
  'BE-02-migration-backfill',
  'BE-03-multi-lifecycle',
  'BE-04-contract-persistence',
  'BE-05-side-effect-commit',
  'BE-06-auth-session',
  'INF-01-ci-control-plane',
  'INF-03-secret-identity',
  'INF-04-stateful-rollout',
  'SEC-01-session-replay',
  'SEC-02-sensitive-lifecycle',
  'SEC-03-enforcement',
  'SEC-04-credential-authority',
  'SEC-06-abuse-rate-limit',
]);
const COMPOSITE_CATEGORIES = new Set([
  'cross-owner',
  'public-contract',
  'stateful-boundary',
  'external-provider/release',
  'unknown-root-cause',
  'prior-failed-approach',
  'broad-verification',
  'domain-specific-major',
]);
const STRUCTURAL_CATEGORIES = new Set([
  'cross-owner',
  'public-contract',
  'stateful-boundary',
  'external-provider/release',
  'unknown-root-cause',
  'domain-specific-major',
]);
const TRANSITIONAL_RUNTIME_APPLICATION = Object.freeze({
  requested: true,
  supported: 'unknown',
  applied: false,
  evidenceStatus: 'deferred-to-runtime-compatibility',
});

export function selectAgentRoute(input = {}) {
  assertRecord(input, 'routing input');
  assertOnlyFields(input, ROUTING_INPUT_FIELDS, 'routing input');
  const modelRequest = normalizeModelRequest(input.modelRequest);

  const pass1 = validatePass1(input.pass1);
  const independent = input.independent ?? true;
  const childBenefit = input.childBenefit ?? true;
  assertBoolean(independent, 'independent');
  assertBoolean(childBenefit, 'childBenefit');

  if (pass1.executionShape === 'direct') {
    return deepFreeze({
      spawn: false,
      role: null,
      effort: null,
      execution: 'direct',
      reason: 'Pass 1 selected a direct path; repository child routing is not applied.',
      gaps: [],
    });
  }
  if (pass1.executionShape === 'leader-sequential' || !independent) {
    return sequentialResult(
      'The lane shares a dependency chain or final owner with the leader.',
      independent ? [] : ['independent-lane-required'],
    );
  }
  if (!childBenefit) {
    return deepFreeze({
      spawn: false,
      role: null,
      effort: null,
      execution: 'direct',
      reason: 'A Medium-or-higher child would cost more than direct completion.',
      gaps: ['measurable-child-benefit-required'],
    });
  }
  if (!input.contextPack || !input.pass2Evidence) {
    return sequentialResult(
      'Repository child routing requires bounded post-inspection semantic evidence.',
      ['pass2-semantic-evidence-required'],
    );
  }

  const validation = validatePass2Evidence(input.contextPack, input.pass2Evidence);
  if (validation.integrityGaps.length > 0 || validation.confirmedClaims.length === 0) {
    return sequentialResult(
      'Pass 2 evidence is incomplete or cannot be bound to the current ContextPack.',
      unique([
        ...validation.integrityGaps,
        ...(validation.confirmedClaims.length === 0 ? ['confirmed-semantic-claim-required'] : []),
      ]),
    );
  }

  const assessment = deriveAssessment(validation, input.pass2Evidence);
  const effort =
    assessment.reasoningComplexity === 'deep'
      ? 'xhigh'
      : assessment.mediumEligibility
        ? 'medium'
        : 'high';

  return deepFreeze({
    spawn: true,
    role: TASK_ROLES.get(pass1.taskKind),
    effort,
    execution: 'bounded-child',
    reason: routeReason(effort),
    pass2Applied: true,
    impactRisk: pass1.impactRisk,
    evidenceIds: assessment.evidenceIds,
    assessment,
    gaps: unique([...assessment.gaps, 'runtime-role-evidence-deferred']),
    confidence: assessment.confidence,
    runtimeApplication: TRANSITIONAL_RUNTIME_APPLICATION,
    ...(modelRequest
      ? {
          modelRecommendation: recommendModel({
            modelRequest,
            taskKind: pass1.taskKind,
            impactRisk: pass1.impactRisk,
            assessment,
          }),
        }
      : {}),
  });
}

// Model advice follows (and never changes) the semantic role/effort decision.
// These are finite experimental cohorts, not a price-based classifier or authorization.
export function normalizeModelRequest(value) {
  if (value === undefined) return undefined;
  assertRecord(value, 'modelRequest');
  assertOnlyFields(value, new Set(['profileId', 'purpose', 'verificationFacts']), 'modelRequest');
  const profile = getModelProfile(value.profileId);
  assertEnum(value.purpose, new Set(['pilot', 'routine']), 'model purpose');
  const keys = profile.verificationKeys;
  assertRecord(value.verificationFacts, 'model verificationFacts');
  assertOnlyFields(value.verificationFacts, new Set(keys), 'model verificationFacts');
  const verificationFacts = Object.fromEntries(
    keys.map((key) => {
      assertBoundedString(value.verificationFacts[key], `model verificationFacts.${key}`, 100);
      return [key, value.verificationFacts[key]];
    }),
  );
  return { profileId: value.profileId, purpose: value.purpose, verificationFacts };
}

export function recommendModel({ modelRequest, taskKind, impactRisk, assessment }) {
  const request = normalizeModelRequest(modelRequest);
  if (!TASK_ROLES.has(taskKind)) throw new TypeError('Unknown model task kind.');
  const profile = getModelProfile(request.profileId);
  const role = TASK_ROLES.get(taskKind);
  const cohortMatches =
    profile.taskKinds.includes(taskKind) &&
    profile.roles.includes(role) &&
    profile.impactRisks.includes(impactRisk) &&
    (request.purpose === 'pilot' || profile.routineRoles.includes(role));
  const bounded =
    assessment.mediumEligibility === true &&
    assessment.reasoningComplexity === 'bounded' &&
    assessment.xhighSignals.length === 0 &&
    assessment.domainSignals.length === 0 &&
    assessment.compositeCategories.length === 0 &&
    assessment.gaps.length === 0 &&
    assessment.confidence === 'high' &&
    assessment.facts.every((fact) => fact.confidence === 'high') &&
    impactRisk !== 'high';
  const verified = Object.values(request.verificationFacts).every((id) =>
    assessment.facts.some((fact) => fact.factId === id && fact.confidence === 'high'),
  );
  const eligible = cohortMatches && bounded && verified;
  return {
    request,
    taskKind,
    role: TASK_ROLES.get(taskKind),
    profileBinding: createModelProfileBinding(profile),
    recommendedModel: eligible ? profile.model : BASELINE_CHILD_MODEL,
    status: eligible ? 'candidate' : 'baseline',
    reason: eligible ? 'bounded-quality-evidence-candidate-only' : 'baseline-risk-or-quality-gate',
    applied: false,
  };
}

export function createSemanticSourceId(source) {
  assertRecord(source, 'semantic source');
  return stableId('source', {
    path: source.path,
    locator: source.locator,
    kind: source.kind,
    observedAt: source.observedAt,
    contentDigest: source.contentDigest,
  });
}

export function createSemanticFactId(fact) {
  assertRecord(fact, 'semantic fact');
  return stableId('fact', {
    statement: fact.statement,
    sourceIds: sortedStrings(fact.sourceIds, 'fact sourceIds'),
  });
}

export function createSemanticEvidenceId(claim) {
  assertRecord(claim, 'semantic claim');
  return stableId('evidence', {
    predicateId: claim.predicateId,
    factIds: sortedStrings(claim.factIds, 'claim factIds'),
  });
}

function validatePass1(pass1) {
  assertRecord(pass1, 'pass1');
  assertOnlyFields(pass1, PASS1_FIELDS, 'Pass 1');
  if (!TASK_ROLES.has(pass1.taskKind)) {
    throw new TypeError(`Unsupported task kind: ${pass1.taskKind}`);
  }
  assertEnum(pass1.executionShape, EXECUTION_SHAPES, 'execution shape');
  assertEnum(pass1.impactRisk, IMPACT_RISKS, 'impact risk');
  assertEnum(pass1.confidence, CONFIDENCE_LEVELS, 'Pass 1 confidence');
  if (pass1.candidateRole !== null && pass1.candidateRole !== undefined) {
    assertBoundedString(pass1.candidateRole, 'candidateRole', 80);
  }
  sortedStrings(pass1.requiredEvidence, 'requiredEvidence');
  return pass1;
}

function validatePass2Evidence(contextPack, evidence) {
  assertRecord(contextPack, 'contextPack');
  if (!Array.isArray(contextPack.sources)) {
    throw new TypeError('contextPack.sources must be an array.');
  }
  assertRecord(evidence, 'pass2Evidence');
  assertOnlyFields(evidence, PASS2_FIELDS, 'Pass 2 evidence');
  for (const field of ['sources', 'facts', 'predicateClaims', 'inferences', 'gaps']) {
    if (!Array.isArray(evidence[field]))
      throw new TypeError(`pass2Evidence.${field} must be an array.`);
  }
  validateBoundedStringArray(evidence.inferences, 'pass2Evidence.inferences');
  validateBoundedStringArray(evidence.gaps, 'pass2Evidence.gaps');
  assertEnum(evidence.confidence, CONFIDENCE_LEVELS, 'Pass 2 confidence');

  const integrityGaps = [];
  const validSources = validateSources(contextPack.sources, evidence.sources, integrityGaps);
  const validFacts = validateFacts(evidence.facts, validSources, integrityGaps);
  const confirmedClaims = validateClaims(evidence.predicateClaims, validFacts, integrityGaps);
  validateCompositeAssignments(confirmedClaims, integrityGaps);

  return { integrityGaps: unique(integrityGaps), validFacts, confirmedClaims };
}

function validateSources(contextSources, sources, gaps) {
  const valid = new Map();
  const seen = new Set();

  for (const source of sources) {
    if (!isRecord(source)) {
      gaps.push('malformed-source');
      continue;
    }
    const unsupported = unsupportedFields(source, SOURCE_FIELDS);
    if (unsupported.length > 0) {
      gaps.push(`unsupported-source-field:${unsupported.join(',')}`);
      continue;
    }
    const expectedId = safeStableId(() => createSemanticSourceId(source));
    if (!expectedId || source.sourceId !== expectedId) {
      gaps.push(`malformed-source-id:${String(source.sourceId ?? 'missing')}`);
      continue;
    }
    if (seen.has(source.sourceId)) {
      gaps.push(`duplicate-source-id:${source.sourceId}`);
      continue;
    }
    seen.add(source.sourceId);
    if (!isBoundedString(source.path, 500) || !isBoundedString(source.locator, 300)) {
      gaps.push(`malformed-source-pointer:${source.sourceId}`);
      continue;
    }
    if (!isBoundedString(source.kind, 80) || !isBoundedString(source.observedAt, 100)) {
      gaps.push(`malformed-source-observation:${source.sourceId}`);
      continue;
    }
    if (!/^sha256:[a-f\d]{64}$/u.test(source.contentDigest ?? '')) {
      gaps.push(`malformed-source-digest:${source.sourceId}`);
      continue;
    }

    const current = contextSources.find(
      (candidate) => candidate.path === source.path && candidate.kind === source.kind,
    );
    if (!current) {
      gaps.push(`unknown-source:${source.path}`);
      continue;
    }
    const currentObservation = current.verifiedAt ?? current.freshness;
    if (
      source.observedAt !== currentObservation ||
      current.conflictStatus === 'conflicting' ||
      (current.contentDigest && current.contentDigest !== source.contentDigest)
    ) {
      gaps.push(`stale-source:${source.sourceId}`);
      continue;
    }
    valid.set(source.sourceId, source);
  }

  return valid;
}

function validateFacts(facts, validSources, gaps) {
  const valid = new Map();

  for (const fact of facts) {
    if (!isRecord(fact)) {
      gaps.push('malformed-fact');
      continue;
    }
    const unsupported = unsupportedFields(fact, FACT_FIELDS);
    if (unsupported.length > 0) {
      gaps.push(`unsupported-fact-field:${unsupported.join(',')}`);
      continue;
    }
    const expectedId = safeStableId(() => createSemanticFactId(fact));
    if (!expectedId || fact.factId !== expectedId) {
      gaps.push(`malformed-fact-id:${String(fact.factId ?? 'missing')}`);
      continue;
    }
    if (valid.has(fact.factId)) {
      gaps.push(`duplicate-fact-id:${fact.factId}`);
      continue;
    }
    if (!isBoundedString(fact.statement, 500)) {
      gaps.push(`malformed-fact-statement:${fact.factId}`);
      continue;
    }
    if (!CONFIDENCE_LEVELS.has(fact.confidence)) {
      gaps.push(`malformed-fact-confidence:${fact.factId}`);
      continue;
    }
    const sourceIds = Array.isArray(fact.sourceIds) ? fact.sourceIds : [];
    const missingSources = sourceIds.filter((sourceId) => !validSources.has(sourceId));
    if (sourceIds.length === 0 || missingSources.length > 0) {
      gaps.push(`orphan-source:${fact.factId}`);
      continue;
    }
    valid.set(fact.factId, fact);
  }

  return valid;
}

function validateClaims(claims, validFacts, gaps) {
  const confirmed = [];
  const seen = new Set();

  for (const claim of claims) {
    if (!isRecord(claim)) {
      gaps.push('malformed-predicate-claim');
      continue;
    }
    const unsupported = unsupportedFields(claim, CLAIM_FIELDS);
    if (unsupported.length > 0) {
      gaps.push(`unsupported-claim-field:${unsupported.join(',')}`);
      continue;
    }
    if (!isKnownPredicate(claim.predicateId)) {
      gaps.push(`unknown-predicate:${String(claim.predicateId ?? 'missing')}`);
      continue;
    }
    if (!OUTCOMES.has(claim.outcome)) {
      gaps.push(`unsupported-predicate-outcome:${claim.predicateId}`);
      continue;
    }
    const expectedId = safeStableId(() => createSemanticEvidenceId(claim));
    if (!expectedId || claim.evidenceId !== expectedId) {
      gaps.push(`malformed-evidence-id:${String(claim.evidenceId ?? 'missing')}`);
      continue;
    }
    if (seen.has(claim.evidenceId)) {
      gaps.push(`duplicate-evidence-id:${claim.evidenceId}`);
      continue;
    }
    seen.add(claim.evidenceId);
    const factIds = Array.isArray(claim.factIds) ? claim.factIds : [];
    if (factIds.length === 0 || factIds.some((factId) => !validFacts.has(factId))) {
      gaps.push(`orphan-fact:${claim.evidenceId}`);
      continue;
    }
    if (
      !isRecord(claim.semanticMatch) ||
      claim.semanticMatch.matches !== true ||
      !isBoundedString(claim.semanticMatch.rationale, 500)
    ) {
      gaps.push(`semantic-mismatch:${claim.evidenceId}`);
      continue;
    }
    if (claim.compositeCategory !== null && !COMPOSITE_CATEGORIES.has(claim.compositeCategory)) {
      gaps.push(`unsupported-composite-category:${claim.evidenceId}`);
      continue;
    }
    if (claim.outcome === 'confirmed') confirmed.push(claim);
  }

  return confirmed;
}

function validateCompositeAssignments(claims, gaps) {
  const categoryByFact = new Map();
  for (const claim of claims) {
    if (!claim.compositeCategory) continue;
    for (const factId of claim.factIds) {
      const prior = categoryByFact.get(factId);
      if (prior && prior !== claim.compositeCategory) {
        gaps.push(`duplicate-fact-composite-category:${factId}`);
      } else {
        categoryByFact.set(factId, claim.compositeCategory);
      }
    }
  }
}

function deriveAssessment(validation, evidence) {
  const confirmedPredicateIds = new Set(
    validation.confirmedClaims.map(({ predicateId }) => predicateId),
  );
  const xhighSignals = [...confirmedPredicateIds]
    .filter(
      (predicateId) =>
        XHIGH_PREDICATES.has(predicateId) || DIRECT_XHIGH_DOMAIN_PREDICATES.has(predicateId),
    )
    .sort();
  const domainSignals = [...confirmedPredicateIds]
    .filter((predicateId) => DOMAIN_PREDICATES.has(predicateId))
    .sort();
  const compositeCategories = unique(
    validation.confirmedClaims.map(({ compositeCategory }) => compositeCategory).filter(Boolean),
  ).sort();
  const deepComposite =
    compositeCategories.length >= 3 &&
    compositeCategories.some((category) => STRUCTURAL_CATEGORIES.has(category));
  const mediumEligibility =
    xhighSignals.length === 0 &&
    !deepComposite &&
    [...MEDIUM_PREDICATES].every((predicateId) => confirmedPredicateIds.has(predicateId));
  const reasoningComplexity =
    xhighSignals.length > 0 || deepComposite
      ? 'deep'
      : mediumEligibility
        ? 'bounded'
        : 'substantial';

  return {
    reasoningComplexity,
    mediumEligibility,
    xhighSignals,
    deepComposite,
    compositeCategories,
    domainSignals,
    evidenceIds: validation.confirmedClaims.map(({ evidenceId }) => evidenceId).sort(),
    facts: [...validation.validFacts.values()].map((fact) => ({ ...fact })),
    inferences: [...evidence.inferences],
    gaps: [...evidence.gaps],
    confidence: evidence.confidence,
  };
}

function routeReason(effort) {
  if (effort === 'medium') {
    return 'Complete positive boundedness evidence supports a Medium child recommendation.';
  }
  if (effort === 'xhigh') {
    return 'A mandatory or deep-composite semantic signal supports an XHigh child recommendation.';
  }
  return 'Validated Pass 2 evidence requires substantial reasoning without an XHigh predicate.';
}

function sequentialResult(reason, gaps) {
  return deepFreeze({
    spawn: false,
    role: null,
    effort: null,
    execution: 'single-sequential',
    reason,
    gaps: unique(gaps),
  });
}

function isKnownPredicate(predicateId) {
  return (
    MEDIUM_PREDICATES.has(predicateId) ||
    XHIGH_PREDICATES.has(predicateId) ||
    DOMAIN_PREDICATES.has(predicateId)
  );
}

function stableId(prefix, value) {
  const digest = createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24);
  return `${prefix}-${digest}`;
}

function sortedStrings(value, field) {
  if (!Array.isArray(value) || value.some((item) => !isBoundedString(item, 500))) {
    throw new TypeError(`${field} must be an array of bounded strings.`);
  }
  return [...value].sort();
}

function validateBoundedStringArray(value, field) {
  if (value.some((item) => !isBoundedString(item, 500))) {
    throw new TypeError(`${field} must contain only bounded strings.`);
  }
}

function assertOnlyFields(value, allowed, label) {
  const unsupported = unsupportedFields(value, allowed);
  if (unsupported.length > 0) {
    throw new TypeError(`Unsupported ${label} field: ${unsupported.join(', ')}`);
  }
}

function unsupportedFields(value, allowed) {
  return Object.keys(value).filter((field) => !allowed.has(field));
}

function assertRecord(value, label) {
  if (!isRecord(value)) throw new TypeError(`${label} is required and must be an object.`);
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertBoolean(value, label) {
  if (typeof value !== 'boolean') throw new TypeError(`${label} must be a boolean.`);
}

function assertEnum(value, allowed, label) {
  if (!allowed.has(value)) throw new TypeError(`Unsupported ${label}: ${value}`);
}

function assertBoundedString(value, label, maxLength) {
  if (!isBoundedString(value, maxLength)) {
    throw new TypeError(`${label} must be a bounded string.`);
  }
}

function isBoundedString(value, maxLength) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
}

function safeStableId(factory) {
  try {
    return factory();
  } catch {
    return null;
  }
}

function unique(values) {
  return [...new Set(values)];
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
