import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  assessLaneIndependence,
  createModelScopeDigest,
  recommendDelegation,
} from '../agents/codex/child-task-contract.mjs';
import { discoverContextPack } from '../agents/common/domain-guide-registry.mjs';
import { buildTaskEnvelope } from '../agents/common/intake-policy.mjs';
import {
  createSemanticEvidenceId,
  createSemanticFactId,
  createSemanticSourceId,
} from '../agents/codex/routing-policy.mjs';

const repoRoot = resolve(import.meta.dirname, '../..');
const legalEvidence = [
  { path: 'docs/policies/legal-basis.md', kind: 'policy' },
  { path: 'apps/web/src/legal/README.md', kind: 'owner-readme' },
  { path: 'apps/api/src/legal/legal.controller.ts', kind: 'controller' },
  { path: 'packages/shared/src/legal/contract.ts', kind: 'contract' },
  { path: 'apps/web/src/legal/__tests__/legal-document-pages.test.tsx', kind: 'test' },
];

test('scoped delivery preserves every original child contract field and safety boundary', () => {
  const { envelope, contextPack } = legalFlow();
  const lane = repositoryLane(contextPack);
  const legacy = recommendDelegation({ envelope, contextPack, laneCandidates: [lane] });
  const request = deliveryRequest();
  const before = structuredClone(request);
  const result = recommendDelegation({
    envelope,
    contextPack,
    laneCandidates: [lane],
    deliveryByLane: { [lane.id]: request },
  });
  const { contextDelivery, ...contract } = result.recommendedChildren[0];
  assert.deepEqual(contract, legacy.recommendedChildren[0]);
  assert.equal(contextDelivery.mode, 'scoped');
  assert.equal(contextDelivery.compatible, true);
  assert.equal(contextDelivery.applied, false);
  assert.equal(contextDelivery.authority, 'leader-reported-not-host-authenticated');
  assert.equal(contextDelivery.requiresLeaderRuntimeConfirmation, true);
  assert.ok(contextDelivery.instructionSources.includes('AGENTS.md'));
  assert.deepEqual(contextDelivery.findings, request.findings);
  assert.deepEqual(contextDelivery.failures, request.failures);
  assert.deepEqual(request, before);
  assert.equal(Object.isFrozen(request.runtime), false);
  assert.equal(Object.isFrozen(contextDelivery), true);
  assert.equal('contextDelivery' in legacy.recommendedChildren[0], false);
});

for (const [name, patch, gap] of [
  ['unknown runtime', null, 'delivery-runtime-unverified'],
  ['stale runtime', { freshness: 'stale' }, 'delivery-runtime-unverified'],
  ['unknown fork', { scopedFork: null }, 'scoped-fork-unsupported'],
  ['missing fork', { scopedFork: false }, 'scoped-fork-unsupported'],
  ['unknown effort', { explicitEffort: null }, 'explicit-effort-unsupported'],
  ['fixed effort', { explicitEffort: false }, 'explicit-effort-unsupported'],
]) {
  test(`delivery never claims native application: ${name}`, () => {
    const request = deliveryRequest();
    request.runtime = patch === null ? null : { ...request.runtime, ...patch };
    const result = deliveredContract(request).contextDelivery;
    assert.equal(result.compatible, false);
    assert.equal(result.applied, false);
    assert.ok(result.gaps.includes(gap));
  });
}

test('full history needs a reason and supported explicit effort combination', () => {
  const request = deliveryRequest();
  request.mode = 'full-history';
  const noReason = deliveredContract(request).contextDelivery;
  assert.equal(noReason.compatible, false);
  assert.ok(noReason.gaps.includes('full-history-rationale-required'));
  request.rationale = 'This bounded task requires the current design discussion.';
  request.runtime.fullHistoryWithExplicitEffort = false;
  assert.equal(deliveredContract(request).contextDelivery.compatible, false);
  request.runtime.fullHistoryWithExplicitEffort = true;
  assert.equal(deliveredContract(request).contextDelivery.compatible, true);
  request.runtime.fullHistoryFork = null;
  assert.equal(deliveredContract(request).contextDelivery.compatible, false);
});

test('inherited effort must match the selected route and never lowers high-risk work', () => {
  const request = deliveryRequest();
  request.effortMode = 'inherit';
  request.runtime.explicitEffort = false;
  for (const effort of [null, 'medium', 'xhigh']) {
    request.runtime.effectiveEffort = effort;
    const result = deliveredContract(request);
    assert.equal(result.routeRecommendation.effort, 'high');
    assert.equal(result.contextDelivery.compatible, false);
  }
  request.runtime.effectiveEffort = 'high';
  assert.equal(deliveredContract(request).contextDelivery.compatible, true);
});

test('initial independent review requires fresh scoped context, not builder history or reuse', () => {
  for (const mode of ['scoped', 'full-history', 'reuse']) {
    const request = deliveryRequest();
    request.purpose = 'initial-review';
    request.mode = mode;
    request.rationale = 'Reuse would be cheaper, but must not weaken independent QA.';
    const result = deliveredContract(request, 'review').contextDelivery;
    assert.equal(result.mode, 'scoped');
    assert.equal(result.compatible, mode === 'scoped');
    assert.equal(result.reuseTarget, null);
  }
  assert.equal(deliveredContract(deliveryRequest(), 'review').contextDelivery.compatible, false);
  const wrongRole = deliveryRequest();
  wrongRole.purpose = 'initial-review';
  assert.equal(deliveredContract(wrongRole).contextDelivery.compatible, false);
});

test('same reviewer delta can reuse only a currently revalidated bounded context', () => {
  const request = reuseRequest();
  const result = deliveredContract(request, 'review').contextDelivery;
  assert.equal(result.mode, 'reuse');
  assert.equal(result.reuseTarget, '/root/reviewer');
  assert.equal(result.compatible, true);
  assert.equal(result.requiresLifecycleConfirmation, true);
  assert.equal(result.applied, false);
  for (const patch of [
    { laneId: 'other' },
    { role: 'repo_executor' },
    { sameOutcome: false },
    { scopeUnchanged: false },
    { independentReview: false },
    { revalidatedForSnapshot: 'old-snapshot' },
  ]) {
    const invalid = structuredClone(request);
    Object.assign(invalid.previous, patch);
    const recommendation = deliveredContract(invalid, 'review').contextDelivery;
    assert.equal(recommendation.compatible, false);
    assert.equal(recommendation.mode, 'scoped');
    assert.equal(recommendation.reuseTarget, null);
  }
  request.runtime.followup = false;
  assert.equal(deliveredContract(request, 'review').contextDelivery.compatible, false);
  request.mode = 'full-history';
  request.rationale = 'Do not substitute builder history for a review delta.';
  assert.equal(deliveredContract(request, 'review').contextDelivery.compatible, false);
});

test('non-review followup can reuse a scoped same-outcome lane without claiming independent QA', () => {
  const request = reuseRequest();
  request.purpose = 'task';
  request.previous.role = 'repo_explorer';
  request.previous.independentReview = false;
  assert.equal(deliveredContract(request).contextDelivery.compatible, true);
  request.effortMode = 'explicit';
  const unsupported = deliveredContract(request).contextDelivery;
  assert.equal(unsupported.compatible, false);
  assert.ok(unsupported.gaps.includes('reuse-effort-override-unsupported'));
});

test('context inputs cannot inject history/tools, widen evidence scope or silently truncate failures', () => {
  for (const mutate of [
    (v) => {
      v.history = 'builder transcript';
    },
    (v) => {
      v.allowedTools = ['workspace-edit'];
    },
    (v) => {
      delete v.failures;
    },
    (v) => {
      v.failures = ['x'.repeat(301)];
    },
    (v) => {
      v.evidencePointers = ['apps/api/src/auth'];
    },
    (v) => {
      v.runtime.scopedFork = 'true';
    },
    (v) => {
      v.runtime.effectiveEffort = 'low';
    },
    (v) => {
      v.runtime.hostAuthenticated = true;
    },
    (v) => {
      v.previous = { childId: '/unknown' };
    },
  ]) {
    const request = deliveryRequest();
    mutate(request);
    assert.throws(() => deliveredContract(request));
  }
  const { envelope, contextPack } = legalFlow();
  assert.throws(() =>
    recommendDelegation({
      envelope,
      contextPack,
      laneCandidates: [repositoryLane(contextPack)],
      deliveryByLane: { unknown: deliveryRequest() },
    }),
  );
});

test('HTTPS delivery evidence uses normalized origin/path containment, not raw prefix', () => {
  const { envelope, contextPack } = legalFlow();
  const lane = repositoryLane(contextPack, { readScope: ['https://example.test/docs'] });
  const deliver = (pointer) =>
    recommendDelegation({
      envelope,
      contextPack,
      laneCandidates: [lane],
      deliveryByLane: { [lane.id]: { ...deliveryRequest(), evidencePointers: [pointer] } },
    });
  for (const pointer of [
    'https://example.test/docs/../outside',
    'https://example.test/docs/%2e%2e/outside',
    'https://example.test/docs/.%2E/outside',
    'https://example.test/docs/%2F..%2Foutside',
    'https://example.test/docs/%5c..%5coutside',
    'https://other.test/docs/child',
    'https://example.test/docs-other/child',
    'https://user:password@example.test/docs/child',
  ])
    assert.throws(() => deliver(pointer), /readScope/u, pointer);
  assert.equal(deliver('https://example.test/docs').recommendedChildren.length, 1);
  assert.equal(deliver('https://example.test/docs/child').recommendedChildren.length, 1);
  assert.equal(deliver('https://example.test/docs/a/../child').recommendedChildren.length, 1);
});

test('delivery evidence does not create children for direct or dependent work', () => {
  for (const direct of [true, false]) {
    const { envelope, contextPack } = legalFlow(direct ? 'AGENTS.md의 줄 수를 알려줘.' : undefined);
    const lane = repositoryLane(contextPack, direct ? {} : { dependencies: ['prior-result'] });
    const result = recommendDelegation({
      envelope,
      contextPack,
      laneCandidates: [lane],
      deliveryByLane: { [lane.id]: deliveryRequest() },
    });
    assert.deepEqual(result.recommendedChildren, []);
  }
});

function deliveredContract(request, taskKind = 'analysis') {
  const { envelope, contextPack } = legalFlow();
  const lane = repositoryLane(contextPack, { taskKind });
  return recommendDelegation({
    envelope,
    contextPack,
    laneCandidates: [lane],
    deliveryByLane: { [lane.id]: request },
  }).recommendedChildren[0];
}

function deliveryRequest() {
  return {
    purpose: 'task',
    mode: 'scoped',
    effortMode: 'explicit',
    rationale: null,
    snapshot: 'current-source-snapshot',
    evidencePointers: ['docs/policies/legal-basis.md'],
    findings: ['Keep the source ownership finding.'],
    failures: ['Prior check failed; inspect the bounded evidence log.'],
    previous: null,
    runtime: {
      freshness: 'current-turn',
      scopedFork: true,
      fullHistoryFork: true,
      followup: true,
      explicitEffort: true,
      fullHistoryWithExplicitEffort: false,
      effectiveEffort: 'high',
    },
  };
}

function reuseRequest() {
  const request = deliveryRequest();
  request.purpose = 'review-delta';
  request.mode = 'reuse';
  request.effortMode = 'inherit';
  const { contextPack } = legalFlow();
  request.previous = {
    childId: '/root/reviewer',
    laneId: repositoryLane(contextPack).id,
    role: 'repo_reviewer',
    sourceSnapshot: 'prior-source-snapshot',
    revalidatedForSnapshot: request.snapshot,
    sameOutcome: true,
    scopeUnchanged: true,
    independentReview: true,
  };
  return request;
}

test('keeps direct requests child-free even when semantic lane candidates are supplied', () => {
  const envelope = buildTaskEnvelope({ request: 'AGENTS.md의 줄 수를 알려줘.' });
  const contextPack = discoverContextPack({
    envelope,
    repositoryEvidence: [{ path: 'AGENTS.md', kind: 'changed-file' }],
  });
  const result = recommendDelegation({
    envelope,
    contextPack,
    laneCandidates: [repositoryLane(contextPack)],
  });

  assert.equal(result.execution, 'direct');
  assert.deepEqual(result.recommendedChildren, []);
  assert.equal(result.limits.defaultChildren, 0);
});

test('permits one independently valuable lane and carries the complete Pass 2 route', () => {
  const { envelope, contextPack } = legalFlow();
  const result = recommendDelegation({
    envelope,
    contextPack,
    laneCandidates: [repositoryLane(contextPack)],
  });

  assert.equal(result.execution, 'bounded-lanes');
  assert.equal(result.recommendedChildren.length, 1);
  const [contract] = result.recommendedChildren;
  assert.equal(contract.routeRecommendation.role, 'repo_explorer');
  assert.equal(contract.routeRecommendation.effort, 'high');
  assert.equal(contract.routeRecommendation.pass2Applied, true);
  assert.equal(contract.routeRecommendation.evidenceIds.length, 1);
  assert.equal(contract.routeRecommendation.assessment.reasoningComplexity, 'substantial');
  assert.deepEqual(
    contract.routeRecommendation.runtimeApplication,
    transitionalRuntimeApplication(),
  );
  assert.match(contract.routeRecommendation.gaps.join(' '), /runtime-role-evidence-deferred/u);
  assert.equal(contract.leaderOwnership.finalDecision, true);
  assert.equal(contract.leaderOwnership.finalUserResponse, true);
  assert.equal(contract.leaderOwnership.integration, true);
  assert.equal(contract.leaderOwnership.finalVerification, true);
  assert.equal('parentEffort' in contract.routeRecommendation, false);
});

test('selects zero-to-two children normally and requires bound high-value evidence for a third', () => {
  const { envelope, contextPack } = legalFlow();
  const standardThird = recommendDelegation({
    envelope,
    contextPack,
    laneCandidates: [
      repositoryLane(contextPack, { id: 'lane-one', priority: 'high' }),
      repositoryLane(contextPack, { id: 'lane-two', priority: 'high' }),
      repositoryLane(contextPack, { id: 'lane-three', priority: 'medium' }),
    ],
  });

  assert.deepEqual(
    standardThird.recommendedChildren.map(({ laneId }) => laneId),
    ['lane-one', 'lane-two'],
  );
  assert.match(standardThird.gaps.join(' '), /third-proactive-child-requires-high-value-evidence/u);

  const thirdEvidence = semanticEvidence(contextPack, {
    predicateId: 'SEC-07-official-evidence',
    statement: 'A third specialist lane closes a distinct current-authority evidence gap.',
  });
  const evidenceBackedThird = recommendDelegation({
    envelope,
    contextPack,
    laneCandidates: [
      repositoryLane(contextPack, { id: 'lane-one', priority: 'high' }),
      repositoryLane(contextPack, { id: 'lane-two', priority: 'high' }),
      repositoryLane(contextPack, {
        id: 'lane-three',
        priority: 'medium',
        pass2Evidence: thirdEvidence,
        benefit: {
          kind: 'specialist-evidence',
          rationale: 'The third lane closes a separately evidenced authority gap.',
          value: 'high',
          evidenceIds: thirdEvidence.predicateClaims.map(({ evidenceId }) => evidenceId),
        },
      }),
      repositoryLane(contextPack, { id: 'lane-four', priority: 'low' }),
    ],
  });

  assert.deepEqual(
    evidenceBackedThird.recommendedChildren.map(({ laneId }) => laneId),
    ['lane-one', 'lane-two', 'lane-three'],
  );
  assert.deepEqual(
    evidenceBackedThird.deferredLanes.map(({ laneId }) => laneId),
    ['lane-four'],
  );
  assert.deepEqual(evidenceBackedThird.limits.proactiveChildren, {
    normalMax: 2,
    evidenceBackedMax: 3,
  });
});

test('allows explicit owner-directed fan-out up to the hard limit of six', () => {
  const { envelope, contextPack } = legalFlow();
  const result = recommendDelegation({
    envelope,
    contextPack,
    ownerDirectedChildLimit: 6,
    laneCandidates: Array.from({ length: 6 }, (_, index) =>
      repositoryLane(contextPack, { id: `manual-lane-${index + 1}` }),
    ),
  });

  assert.equal(result.execution, 'bounded-lanes');
  assert.equal(result.recommendedChildren.length, 6);
  assert.equal(result.limits.mode, 'owner-directed');
  assert.equal(result.limits.applied, 6);
  assert.equal(result.limits.ownerDirectedMax, 6);
});

test('keeps ambiguous, dependent, low-benefit, and missing-Pass-2 work child-free', () => {
  const ambiguousEnvelope = buildTaskEnvelope({ request: 'Legal을 개선해줘.' });
  const ambiguousContext = discoverContextPack({
    envelope: ambiguousEnvelope,
    repositoryEvidence: legalEvidence,
  });
  const ambiguous = recommendDelegation({
    envelope: ambiguousEnvelope,
    contextPack: ambiguousContext,
    laneCandidates: [repositoryLane(ambiguousContext)],
  });
  assert.equal(ambiguous.execution, 'single-sequential');
  assert.match(ambiguous.gaps.join(' '), /ambiguity-or-authority/u);

  const { envelope, contextPack } = legalFlow('Legal 구현을 수정해줘.');
  const dependent = recommendDelegation({
    envelope,
    contextPack,
    laneCandidates: [
      implementationLane(contextPack, {
        id: 'dependent-lane',
        dependencies: ['prior-result'],
        writeOwnership: ['apps/api/src/legal'],
      }),
    ],
  });
  assert.equal(dependent.execution, 'single-sequential');
  assert.match(JSON.stringify(dependent.deferredLanes), /lane-has-result-dependencies/u);

  const lowBenefit = recommendDelegation({
    envelope,
    contextPack,
    laneCandidates: [
      repositoryLane(contextPack, {
        benefit: {
          kind: 'latency',
          rationale: 'The lookup is cheaper for the leader to complete directly.',
          value: 'low',
        },
      }),
    ],
  });
  assert.equal(lowBenefit.execution, 'single-sequential');
  assert.match(lowBenefit.gaps.join(' '), /measurable-child-benefit-required/u);

  const missingPass2 = recommendDelegation({
    envelope,
    contextPack,
    laneCandidates: [{ ...repositoryLane(contextPack), pass2Evidence: undefined }],
  });
  assert.equal(missingPass2.execution, 'single-sequential');
  assert.match(missingPass2.gaps.join(' '), /pass2-semantic-evidence-required/u);
});

test('rejects lexical risk substitution and never selects more than one write child', () => {
  const { envelope, contextPack } = legalFlow('Legal 구현을 수정해줘.');
  assert.throws(
    () =>
      recommendDelegation({
        envelope,
        contextPack,
        laneCandidates: [{ ...repositoryLane(contextPack), risk: 'high' }],
      }),
    /Unsupported lane field: risk/u,
  );

  const distinctWrites = recommendDelegation({
    envelope,
    contextPack,
    laneCandidates: [
      implementationLane(contextPack, {
        id: 'api-writer',
        priority: 'high',
        writeOwnership: ['apps/api/src/legal'],
      }),
      implementationLane(contextPack, {
        id: 'web-writer',
        priority: 'medium',
        writeOwnership: ['apps/web/src/legal'],
      }),
    ],
  });
  assert.deepEqual(
    distinctWrites.recommendedChildren.map(({ laneId }) => laneId),
    ['api-writer'],
  );
  assert.match(distinctWrites.gaps.join(' '), /write-child-limit-exceeded/u);

  const overlappingWrites = recommendDelegation({
    envelope,
    contextPack,
    laneCandidates: [
      implementationLane(contextPack, {
        id: 'contract-writer',
        writeOwnership: ['packages/shared/src/legal'],
      }),
      implementationLane(contextPack, {
        id: 'contract-file-writer',
        writeOwnership: ['packages/shared/src/legal/contract.ts'],
      }),
    ],
  });
  assert.equal(overlappingWrites.execution, 'single-sequential');
  assert.match(JSON.stringify(overlappingWrites.deferredLanes), /shared-write-ownership/u);
});

test('fails closed on malformed contracts and hard-limit overflow', () => {
  const { envelope, contextPack } = legalFlow();
  assert.throws(
    () =>
      recommendDelegation({
        envelope,
        contextPack,
        laneCandidates: Array.from({ length: 7 }, (_, index) =>
          repositoryLane(contextPack, { id: `lane-${index}` }),
        ),
      }),
    /hard limit of 6/u,
  );
  assert.throws(
    () => recommendDelegation({ envelope, contextPack, ownerDirectedChildLimit: 7 }),
    /between 1 and 6/u,
  );
  assert.throws(
    () =>
      assessLaneIndependence({
        envelope,
        lane: { ...repositoryLane(contextPack), unexpected: true },
      }),
    /Unsupported lane field/u,
  );
});

test('child contract policy remains advisory and does not own runtime lifecycle', () => {
  const source = readFileSync(
    resolve(repoRoot, 'scripts/agents/codex/child-task-contract.mjs'),
    'utf8',
  );

  assert.doesNotMatch(source, /node:child_process|spawn_agent|exec_command|create_goal/u);
  assert.doesNotMatch(source, /retry\s*\(|respawn|tmux/u);
});

test('child contracts propagate optional model advice without relaxing write or verification ownership', () => {
  const { envelope, contextPack } = legalFlow('Legal test 구현해줘.');
  const parts = Array.from({ length: 15 }, (_, i) =>
    semanticEvidence(contextPack, {
      predicateId: `M-${String(i + 1).padStart(2, '0')}`,
      statement: `Bounded verification requirement ${i}`,
    }),
  );
  const evidence = Object.fromEntries(
    ['sources', 'facts', 'predicateClaims'].map((key) => [key, parts.flatMap((part) => part[key])]),
  );
  Object.assign(evidence, { inferences: [], gaps: [], confidence: 'high' });
  const lane = implementationLane(contextPack, {
    impactRisk: 'low',
    writeOwnership: ['apps/web/src/legal/example.test.ts'],
    pass2Evidence: evidence,
    modelRequest: {
      profileId: 'bounded-build',
      purpose: 'pilot',
      verificationFacts: {
        acceptance: evidence.facts[0].factId,
        regression: evidence.facts[1].factId,
        astraQa: evidence.facts[2].factId,
      },
    },
  });
  const result = recommendDelegation({ envelope, contextPack, laneCandidates: [lane] });
  const [child] = result.recommendedChildren;
  assert.equal(child.routeRecommendation.modelRecommendation.recommendedModel, 'gpt-6-sol');
  assert.match(child.modelScopeDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(child.leaderOwnership.finalVerification, true);
  const changed = structuredClone(child);
  changed.routeRecommendation.modelRecommendation.profileBinding.policyRevision = 'stale';
  assert.notEqual(createModelScopeDigest(changed), child.modelScopeDigest);
  assert.deepEqual(child.verification, lane.verification);
  const extraction = repositoryLane(contextPack, {
    impactRisk: 'low',
    pass2Evidence: evidence,
    modelRequest: {
      profileId: 'bounded-extract',
      purpose: 'pilot',
      verificationFacts: Object.fromEntries(
        ['acceptance', 'fixedInput', 'outputSchema', 'singleStep', 'independentCheck'].map(
          (k, i) => [k, evidence.facts[i].factId],
        ),
      ),
    },
  });
  for (const effort of ['medium', 'high', 'xhigh']) {
    const delivery = deliveryRequest();
    delivery.effortMode = 'inherit';
    delivery.runtime.effectiveEffort = effort;
    const [c] = recommendDelegation({
      envelope,
      contextPack,
      laneCandidates: [extraction],
      deliveryByLane: { [extraction.id]: delivery },
    }).recommendedChildren;
    assert.equal(c.routeRecommendation.effort, 'medium');
    assert.equal(c.contextDelivery.compatible, effort === 'xhigh');
  }
  assert.throws(
    () =>
      recommendDelegation({
        envelope,
        contextPack,
        laneCandidates: [{ ...lane, modelRequest: { ...lane.modelRequest, pilot: true } }],
      }),
    TypeError,
  );
});

function legalFlow(request = 'Legal 개선 지점 분석해줘.') {
  const envelope = buildTaskEnvelope({ request });
  const contextPack = discoverContextPack({ envelope, repositoryEvidence: legalEvidence });
  return { envelope, contextPack };
}

function repositoryLane(contextPack, overrides = {}) {
  return {
    id: 'legal-repository-map',
    domain: 'legal-policy',
    taskKind: 'analysis',
    priority: 'medium',
    objective: 'Map the current Legal policy, FE, BFF, BE, contract, and test surfaces.',
    question: 'Which current repository owners and executable boundaries implement Legal?',
    allowedEvidence: ['repo', 'test'],
    allowedTools: ['repository-read'],
    readScope: ['docs/policies', 'apps/web/src/legal', 'apps/api/src/legal'],
    writeOwnership: [],
    dependencies: [],
    expectedOutputFields: ['owners', 'paths', 'contracts', 'tests'],
    verification: ['Every claimed owner cites a current repository path.'],
    benefit: {
      kind: 'completeness',
      rationale: 'A bounded repository map can be collected independently.',
    },
    pass2Evidence: semanticEvidence(contextPack),
    ...overrides,
  };
}

function implementationLane(contextPack, overrides) {
  return repositoryLane(contextPack, {
    taskKind: 'implementation',
    allowedTools: ['repository-read', 'workspace-edit'],
    expectedOutputFields: ['changedFiles', 'behavior'],
    verification: ['Run the closest owner tests.'],
    benefit: {
      kind: 'latency',
      rationale: 'The write lane has bounded ownership and no result dependency.',
    },
    ...overrides,
  });
}

function semanticEvidence(
  contextPack,
  {
    predicateId = 'SEC-05-disclosure',
    statement = 'Current repository evidence supports a bounded Legal analysis lane.',
  } = {},
) {
  const current =
    contextPack.sources.find(({ path }) => path === 'docs/policies/legal-basis.md') ??
    contextPack.sources[0];
  const source = {
    path: current.path,
    locator: `fixture:${predicateId}`,
    kind: current.kind,
    observedAt: current.verifiedAt ?? current.freshness,
    contentDigest: `sha256:${'a'.repeat(64)}`,
  };
  source.sourceId = createSemanticSourceId(source);
  const fact = {
    statement,
    sourceIds: [source.sourceId],
    confidence: 'high',
  };
  fact.factId = createSemanticFactId(fact);
  const claim = {
    predicateId,
    outcome: 'confirmed',
    factIds: [fact.factId],
    semanticMatch: {
      matches: true,
      rationale: `The inspected source supports ${predicateId}.`,
    },
    compositeCategory: null,
  };
  claim.evidenceId = createSemanticEvidenceId(claim);
  return {
    sources: [source],
    facts: [fact],
    predicateClaims: [claim],
    inferences: [],
    gaps: [],
    confidence: 'high',
  };
}

function transitionalRuntimeApplication() {
  return {
    requested: true,
    supported: 'unknown',
    applied: false,
    evidenceStatus: 'deferred-to-runtime-compatibility',
  };
}

test('ordinary child delivery still rejects low and max invocation claims', () => {
  const { envelope, contextPack } = legalFlow();
  const lane = repositoryLane(contextPack);
  for (const effort of ['low', 'max']) {
    const delivery = deliveryRequest();
    delivery.runtime.effectiveEffort = effort;
    assert.throws(
      () =>
        recommendDelegation({
          envelope,
          contextPack,
          laneCandidates: [lane],
          deliveryByLane: { [lane.id]: delivery },
        }),
      TypeError,
    );
  }
});
