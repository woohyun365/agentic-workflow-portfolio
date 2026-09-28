import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createRecoveryChildContract, recommendDelegation } from './child-task-contract.mjs';
import { prepareCodexWorkflow } from './workflow-entry.mjs';
import { discoverContextPack } from '../common/domain-guide-registry.mjs';
import { createModelRunEvidence } from './model-run-evidence.mjs';
import { buildTaskEnvelope } from '../common/intake-policy.mjs';
import {
  createDispatchRecommendation,
  createLifecycleRecommendation,
  evaluateModelExecution,
  evaluateRecovery,
  prepareLeaderSynthesis,
} from './orchestration-policy.mjs';
import {
  createSemanticEvidenceId,
  createSemanticFactId,
  createSemanticSourceId,
} from './routing-policy.mjs';

const repoRoot = resolve(import.meta.dirname, '../../..');
const entryPoints = Object.freeze([
  'AGENTS.md',
  'docs/development/agent-workflows/README.md',
  'docs/development/agent-workflows/getting-started.md',
  'docs/development/agent-workflows/agent-execution-contract.md',
  'docs/development/agent-workflows/request-intake/README.md',
  'docs/development/agent-workflows/plan-authoring/README.md',
  'docs/development/agent-workflows/orchestration.md',
]);

export function runFreshSessionSmoke() {
  const discovery = discoverBootstrap();
  const direct = evaluateScenario({
    request: 'AGENTS.md의 줄 수를 알려줘.',
    repositoryEvidence: [{ path: 'AGENTS.md', kind: 'changed-file' }],
  });
  const singleDomain = evaluateScenario({
    request: 'Legal Web UI 책임을 분석하고 개선 계획을 작성해줘.',
    repositoryEvidence: [
      { path: 'docs/policies/legal-basis.md', kind: 'policy' },
      { path: 'apps/web/src/legal/README.md', kind: 'owner-readme' },
      { path: 'apps/web/src/legal/__tests__/legal-document-pages.test.tsx', kind: 'test' },
    ],
  });
  const mixedDomain = evaluateScenario({
    request: 'Legal Web/API 책임을 분석하고 개선 계획을 작성해줘.',
    repositoryEvidence: [
      { path: 'apps/web/src/legal/README.md', kind: 'owner-readme' },
      { path: 'apps/api/src/legal/README.md', kind: 'owner-readme' },
    ],
  });
  const unavailableRoleRouting = evaluateScenario({
    request: 'Legal 개선 지점 분석해줘.',
    repositoryEvidence: [
      { path: 'docs/policies/legal-basis.md', kind: 'policy' },
      { path: 'apps/web/src/legal/README.md', kind: 'owner-readme' },
    ],
    laneCandidates: advisoryLegalLanes(),
    reportedRuntimeEvidence: {
      schemaVersion: 1,
      surfaceMode: 'native',
      observationScope: 'current-turn',
      freshness: 'current-turn',
      provenance: ['host-tool-schema'],
      dispatchPermission: 'allowed',
      roles: [
        {
          agentType: 'explore',
          available: true,
          effectiveModel: 'gpt-5.6-luna',
          effectiveEffort: 'medium',
          explicitEffortSupport: true,
        },
      ],
    },
  });
  const routingEvidence = evaluateRoutingEvidence();

  return deepFreeze({
    schemaVersion: 1,
    discovery,
    scenarios: {
      direct: summarizeScenario(direct),
      singleDomain: summarizeScenario(singleDomain),
      mixedDomain: summarizeScenario(mixedDomain),
      unavailableRoleRouting: summarizeScenario(unavailableRoleRouting),
    },
    routingEvidence,
    lifecycleEvidence: evaluateLifecycleEvidence(),
    deliveryEvidence: evaluateDeliveryEvidence(),
    modelEvidence: evaluateModelEvidence(),
    boundaries: {
      readsLocalResumeState: false,
      readsIgnoredPlan: false,
      invokesChild: false,
      mutatesWorkspace: false,
    },
  });
}

function evaluateLifecycleEvidence() {
  // Synthetic contract examples only, not observations of a real native host.
  const input = {
    schemaVersion: 1,
    intent: 'cleanup',
    observation: {
      scope: 'current-turn',
      freshness: 'current-turn',
      provenance: 'native-tools',
      actionPermission: 'allowed',
    },
    target: {
      parentId: '/smoke',
      childId: '/smoke/review',
      ownerParentId: '/smoke',
      taskId: 'synthetic-review',
      observedTaskId: 'synthetic-review',
      isRoot: false,
      state: 'completed',
      pendingTasks: 0,
      pendingTools: 0,
      pendingMailbox: 0,
    },
    capabilities: { close: false, startTurn: true },
    result: { taskId: 'synthetic-review', collected: true, delivery: 'final' },
    retention: null,
    close: { status: 'not-attempted', childId: null, taskId: null },
    release: { status: 'unknown', childId: null, taskId: null },
  };
  const noClose = {
    ...input,
    lifecycleContract: {
      cleanup: 'runtime-managed',
      verification: 'current-host',
      reference: 'synthetic-host-contract-not-a-native-observation',
    },
  };
  return {
    unsupported: createLifecycleRecommendation(input),
    noClose: createLifecycleRecommendation(noClose),
    mailboxUnknown: createLifecycleRecommendation({
      ...noClose,
      target: { ...input.target, pendingMailbox: null },
    }),
    releasedWithoutClose: createLifecycleRecommendation({
      ...noClose,
      release: { status: 'confirmed', childId: input.target.childId, taskId: input.target.taskId },
    }),
    eligible: createLifecycleRecommendation({
      ...input,
      capabilities: { ...input.capabilities, close: true },
    }),
    closedReleaseUnknown: createLifecycleRecommendation({
      ...input,
      capabilities: { ...input.capabilities, close: true },
      target: { ...input.target, state: 'closed' },
      close: { status: 'succeeded', childId: input.target.childId, taskId: input.target.taskId },
    }),
  };
}

function evaluateDeliveryEvidence() {
  // Deterministic fixtures, not a benchmark or real usage/host observations.
  const request = {
    purpose: 'task',
    mode: 'scoped',
    effortMode: 'explicit',
    rationale: null,
    snapshot: 'synthetic-source-v1',
    evidencePointers: ['docs/policies/legal-basis.md'],
    findings: ['Preserve the bounded source finding.'],
    failures: ['Preserve prior failed-check evidence.'],
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
  const packetFor = (delivery) =>
    evaluateScenario({
      request: 'Legal 개선 지점 분석해줘.',
      repositoryEvidence: [{ path: 'docs/policies/legal-basis.md', kind: 'policy' }],
      laneCandidates: [routingEvidenceLane(['FE-08-performance-causal'])],
      deliveryByLane: { 'legal-routing-evidence': delivery },
    }).delegation.recommendedChildren[0];
  const dispatchFor = (change = {}) =>
    evaluateScenario({
      request: 'Legal 개선 지점 분석해줘.',
      repositoryEvidence: [{ path: 'docs/policies/legal-basis.md', kind: 'policy' }],
      laneCandidates: [routingEvidenceLane(['BE-01-concurrency-transaction'])],
      deliveryByLane: {
        'legal-routing-evidence': {
          ...request,
          runtime: { ...request.runtime, effectiveEffort: 'xhigh' },
          ...change,
        },
      },
      reportedRuntimeEvidence: {
        schemaVersion: 1,
        surfaceMode: 'native',
        observationScope: 'current-turn',
        freshness: 'current-turn',
        provenance: ['host-tool-schema'],
        dispatchPermission: 'allowed',
        roles: [
          {
            agentType: 'repo_explorer',
            available: true,
            effectiveModel: 'gpt-6-astra',
            effectiveEffort: 'xhigh',
            explicitEffortSupport: true,
            modelSelection: {
              supportedModels: ['gpt-6-astra'],
              roleModel: null,
              explicitModelSupport: true,
              reference: 'synthetic-current-native-schema',
            },
          },
        ],
      },
    }).dispatch;
  const packet = packetFor(request);
  return {
    scoped: packet.contextDelivery,
    unknown: packetFor({ ...request, runtime: null }).contextDelivery,
    fullHistoryConflict: packetFor({
      ...request,
      mode: 'full-history',
      rationale: 'Synthetic full-history compatibility case.',
    }).contextDelivery,
    ordinaryDispatch: {
      scoped: dispatchFor(),
      unknown: dispatchFor({ runtime: null }),
      fullHistoryConflict: dispatchFor({
        mode: 'full-history',
        rationale: 'Synthetic full-history compatibility case.',
      }),
    },
    fixtureOnly: true,
    measurement: {
      unit: 'utf8-bytes',
      packetBytes: Buffer.byteLength(JSON.stringify(packet), 'utf8'),
      withSyntheticHistoryBytes: Buffer.byteLength(
        JSON.stringify({
          packet,
          history: 'Synthetic unrelated prior completed work.\n'.repeat(24),
        }),
        'utf8',
      ),
      tokens: null,
      weeklyAllowance: null,
    },
  };
}

function evaluateModelEvidence() {
  // Synthetic source, permission and host observations: never a real pilot/GO.
  const envelope = buildTaskEnvelope({ request: 'Legal 개선 지점 분석해줘.' });
  const contextPack = discoverContextPack({
    envelope,
    repositoryEvidence: [{ path: 'docs/policies/legal-basis.md', kind: 'policy' }],
  });
  const { smokePredicateIds: _predicates, ...base } = routingEvidenceLane(mediumPredicateIds());
  const evidence = semanticEvidence(contextPack, mediumPredicateIds());
  const makeDelegation = (purpose, extraction = false) =>
    recommendDelegation({
      envelope,
      contextPack,
      laneCandidates: [
        {
          ...base,
          impactRisk: 'low',
          pass2Evidence: evidence,
          modelRequest: {
            profileId: extraction ? 'bounded-extract' : 'bounded-read',
            purpose,
            verificationFacts: {
              acceptance: evidence.facts[0].factId,
              independentCheck: evidence.facts[1].factId,
              ...(extraction
                ? {
                    fixedInput: evidence.facts[2].factId,
                    outputSchema: evidence.facts[3].factId,
                    singleStep: evidence.facts[4].factId,
                  }
                : {}),
            },
          },
        },
      ],
      deliveryByLane: {
        [base.id]: {
          purpose: 'task',
          mode: 'scoped',
          effortMode: 'explicit',
          rationale: null,
          snapshot: 'synthetic-model-source',
          evidencePointers: base.readScope,
          findings: [],
          failures: [],
          previous: null,
          runtime: {
            freshness: 'current-turn',
            scopedFork: true,
            fullHistoryFork: true,
            followup: true,
            explicitEffort: true,
            fullHistoryWithExplicitEffort: false,
            effectiveEffort: 'xhigh',
          },
        },
      },
    });
  const delegation = makeDelegation('pilot');
  const [contract] = delegation.recommendedChildren;
  const reportedRuntimeEvidence = {
    schemaVersion: 1,
    surfaceMode: 'native',
    observationScope: 'current-turn',
    freshness: 'current-turn',
    provenance: ['host-tool-schema'],
    dispatchPermission: 'allowed',
    roles: [
      {
        agentType: 'repo_explorer',
        available: true,
        effectiveModel: 'gpt-6-sol',
        effectiveEffort: 'xhigh',
        explicitEffortSupport: true,
        modelSelection: {
          supportedModels: ['gpt-6-astra', 'gpt-6-sol'],
          roleModel: null,
          explicitModelSupport: true,
          reference: 'synthetic-host-schema',
        },
      },
    ],
  };
  const configDigest = `sha256:${'c'.repeat(64)}`;
  const modelUseByLane = {
    [base.id]: {
      observedAt: '2026-09-20T10:00:00.000Z',
      scopeDigest: contract.modelScopeDigest,
      configDigest,
      scopeStatus: 'current',
      checks: 'passed',
      remainingBudget: { children: 1, minutes: 10 },
      admission: {
        profileBinding: contract.routeRecommendation.modelRecommendation.profileBinding,
        kind: 'pilot',
        reference: 'synthetic-user-pilot-authorization',
        quality: 'unadopted',
        model: 'gpt-6-sol',
        role: 'repo_explorer',
        effort: 'xhigh',
        cohort: 'bounded-read-only',
        scopeDigest: contract.modelScopeDigest,
        configDigest,
        notBefore: '2026-09-20T09:00:00.000Z',
        expiresAt: '2026-09-20T11:00:00.000Z',
        budget: { maxChildren: 1, maxMinutes: 10 },
        cleanupReference: 'synthetic-cleanup-contract',
      },
    },
  };
  const input = { delegation, reportedRuntimeEvidence, modelUseByLane };
  const routine = structuredClone({ ...input, delegation: makeDelegation('routine') });
  // Rebind the exact routine scope; its pilot permission must STILL be rejected.
  const routineDigest = routine.delegation.recommendedChildren[0].modelScopeDigest;
  routine.modelUseByLane[base.id].scopeDigest = routineDigest;
  routine.modelUseByLane[base.id].admission.scopeDigest = routineDigest;
  const fixed = structuredClone(input);
  fixed.reportedRuntimeEvidence.roles[0].modelSelection.roleModel = 'gpt-6-astra';
  const contextConflict = structuredClone(input);
  contextConflict.delegation.recommendedChildren[0].contextDelivery.compatible = false;
  const luna = structuredClone({ ...input, delegation: makeDelegation('routine', true) });
  const lunaContract = luna.delegation.recommendedChildren[0];
  Object.assign(luna.reportedRuntimeEvidence.roles[0], {
    effectiveModel: null,
    effectiveEffort: null,
    configurationResolution: {
      profileBinding: lunaContract.routeRecommendation.modelRecommendation.profileBinding,
      model: 'gpt-6-luna',
      effort: 'xhigh',
      configDigest,
      reference: 'synthetic-current-resolution',
    },
  });
  luna.reportedRuntimeEvidence.roles[0].modelSelection.supportedModels.push('gpt-6-luna');
  luna.modelUseByLane[base.id].scopeDigest = lunaContract.modelScopeDigest;
  Object.assign(luna.modelUseByLane[base.id].admission, {
    profileBinding: lunaContract.routeRecommendation.modelRecommendation.profileBinding,
    effort: 'xhigh',
    kind: 'adoption',
    quality: 'go',
    model: 'gpt-6-luna',
    cohort: 'bounded-extraction',
    scopeDigest: lunaContract.modelScopeDigest,
  });
  const lunaDispatch = createDispatchRecommendation(luna);
  const post = evaluateModelExecution({
    dispatch: lunaDispatch.dispatches[0],
    expectedChildId: '/root/synthetic-luna',
    reportedExecution: {
      profileBinding: lunaContract.routeRecommendation.modelRecommendation.profileBinding,
      childId: '/root/synthetic-luna',
      taskId: lunaContract.modelTaskId,
      scopeDigest: lunaContract.modelScopeDigest,
      provenance: 'native-tool-result',
      accepted: true,
      executed: true,
      resultReference: 'synthetic-native-final',
      independentCheck: { status: 'failed', reference: 'synthetic-controlled-canary' },
      hostMetadata: null,
      usageReference: null,
    },
  });
  const sourceDigest = `sha256:${'a'.repeat(64)}`;
  const rescueSourceDigest = `sha256:${'b'.repeat(64)}`;
  const rescueContract = createRecoveryChildContract({
    primaryContract: lunaContract,
    sourceSnapshot: 'synthetic-post-fault-source',
  });
  const primaryAttempt = {
    approachId: 'synthetic-luna',
    outcome: 'failure',
    failureCategory: 'verification-failed',
    evidence: 'synthetic-controlled-failure-not-actual-model-failure',
    model: 'gpt-6-luna',
    effort: 'xhigh',
    executed: true,
    identity: {
      taskId: lunaContract.modelTaskId,
      childId: '/root/synthetic-luna',
      sourceDigest,
      scopeDigest: lunaContract.modelScopeDigest,
    },
  };
  const modelRecovery = {
    profileBinding: lunaContract.routeRecommendation.modelRecommendation.profileBinding,
    pendingWriter: 'cleared',
    request: {
      primaryContract: lunaContract,
      rescueContract,
      sourceDigest: rescueSourceDigest,
      configDigest,
      attemptId: 'synthetic-astra',
      assessment: {
        cause: 'controlled-injection',
        bounded: true,
        contextComplete: true,
        oracleAvailable: true,
        identityVerified: true,
        reasonRefs: ['evidence:synthetic-fault-manifest'],
      },
    },
  };
  const recovery = evaluateRecovery({ laneId: base.id, attempts: [primaryAttempt], modelRecovery });
  const recoveryBinding = recovery.recoveryBinding;
  const rescueDelegation = { ...luna.delegation, recommendedChildren: [rescueContract] };
  const rescueRuntime = structuredClone(luna.reportedRuntimeEvidence);
  rescueRuntime.roles[0].configurationResolution = {
    kind: 'recovery',
    recoveryBinding,
    model: recoveryBinding.model,
    effort: recoveryBinding.resolvedEffort,
    configDigest,
    reference: 'synthetic-current-recovery-resolution',
  };
  const rescueUse = {
    ...luna.modelUseByLane[base.id],
    scopeDigest: rescueContract.modelScopeDigest,
    admission: {
      kind: 'recovery',
      reference: 'synthetic-exact-rescue-authorization',
      recoveryBinding,
      notBefore: '2026-09-20T09:00:00.000Z',
      expiresAt: '2026-09-20T11:00:00.000Z',
      budget: { maxChildren: 1, maxMinutes: 10 },
      cleanupReference: 'synthetic-rescue-cleanup',
    },
  };
  const rescueDispatch = createDispatchRecommendation({
    delegation: rescueDelegation,
    reportedRuntimeEvidence: rescueRuntime,
    modelUseByLane: { [base.id]: rescueUse },
    recoveryDecision: recovery,
  });
  const [rescueDescriptor] = rescueDispatch.dispatches;
  const rescuePost = evaluateModelExecution({
    dispatch: rescueDescriptor,
    expectedChildId: '/root/synthetic-astra',
    reportedExecution: {
      recoveryBinding,
      childId: '/root/synthetic-astra',
      taskId: rescueContract.modelTaskId,
      scopeDigest: rescueContract.modelScopeDigest,
      provenance: 'native-tool-result',
      accepted: true,
      executed: true,
      resultReference: 'synthetic-rescue-result',
      independentCheck: { status: 'passed', reference: 'synthetic-rescue-oracle-and-qa' },
      hostMetadata: null,
      usageReference: null,
    },
  });
  const completedRecovery = evaluateRecovery({
    laneId: base.id,
    attempts: [
      primaryAttempt,
      {
        approachId: recoveryBinding.rescue.attemptId,
        alternateOf: primaryAttempt.approachId,
        outcome: rescuePost.accepted ? 'success' : 'failure',
        failureCategory: rescuePost.accepted ? null : 'verification-failed',
        evidence: 'synthetic-revalidation',
        model: rescueDescriptor.resolvedModel,
        effort: rescueDescriptor.resolvedEffort,
        executed: true,
        recoveryBinding,
        identity: {
          taskId: rescueContract.modelTaskId,
          childId: '/root/synthetic-astra',
          sourceDigest: rescueSourceDigest,
          scopeDigest: rescueContract.modelScopeDigest,
        },
      },
    ],
    modelRecovery,
  });
  const synthesis = prepareLeaderSynthesis({
    delegation: rescueDelegation,
    recoveryDecisions: [completedRecovery],
    childResults: [
      {
        laneId: base.id,
        status: rescuePost.accepted ? 'completed' : 'failed',
        outputs: Object.fromEntries(
          rescueContract.expectedOutputSchema.required
            .filter((key) => !['facts', 'inferences', 'gaps', 'confidence'].includes(key))
            .map((key) => [key, ['synthetic-validated-result']]),
        ),
        facts: [
          {
            statement: 'Synthetic rescue oracle and independent QA passed.',
            source: 'synthetic-rescue-oracle-and-qa',
          },
        ],
        inferences: [],
        gaps: [],
        confidence: 'high',
        verification: [
          {
            claim: 'Synthetic rescue result',
            evidence: 'synthetic-rescue-oracle-and-qa',
            status: rescuePost.accepted ? 'passed' : 'failed',
          },
        ],
        blocker: rescuePost.accepted ? null : 'synthetic-rescue-failed',
      },
    ],
  });
  const dispatch = lunaDispatch.dispatches[0];
  const check = (kind, name, status) => ({
    kind,
    commandRef: `command:${name}`,
    resultRef: `artifact:${name}`,
    status,
  });
  const primaryRecord = {
    attemptId: primaryAttempt.approachId,
    alternateOf: null,
    taskId: lunaContract.modelTaskId,
    laneId: base.id,
    sourceDigest,
    configDigest,
    scopeDigest: lunaContract.modelScopeDigest,
    requested: {
      model: dispatch.spawnArguments.model,
      effort: dispatch.spawnArguments.reasoning_effort,
    },
    resolved: { model: dispatch.resolvedModel, effort: dispatch.resolvedEffort },
    hostObserved: null,
    stage: 'completed',
    executed: true,
    childId: '/root/synthetic-luna',
    case: 'controlled-failure',
    disposition: post.accepted ? 'success' : 'failure',
    failureCategory: primaryAttempt.failureCategory,
    checks: [
      check('quality', 'original-quality', 'passed'),
      check('canary', 'controlled-canary', 'failed'),
    ],
    factRefs: ['evidence:synthetic-canary-failure'],
    hypothesis: {
      cause: 'controlled-injection',
      confidence: 'high',
      evidenceRefs: ['evidence:synthetic-fault-manifest'],
    },
    remediation: null,
    metrics: {
      durationMs: null,
      timeSource: null,
      corrections: null,
      revalidations: null,
      scopeViolations: null,
      qaFindings: null,
    },
    usage: { tokens: null, cost: null, reference: null },
  };
  // Synthetic reports consume the actual recovery adapters; no native/provider attestation.
  const rescueRecord = {
    ...primaryRecord,
    attemptId: 'synthetic-astra',
    alternateOf: primaryRecord.attemptId,
    childId: '/root/synthetic-astra',
    case: 'approved-baseline',
    sourceDigest: rescueSourceDigest,
    scopeDigest: rescueContract.modelScopeDigest,
    requested: {
      model: rescueDescriptor.spawnArguments.model,
      effort: rescueDescriptor.spawnArguments.reasoning_effort,
    },
    resolved: { model: rescueDescriptor.resolvedModel, effort: rescueDescriptor.resolvedEffort },
    disposition: synthesis.readyForLeaderDecision ? 'success' : 'failure',
    failureCategory: null,
    checks: [
      check('acceptance', 'rescue-oracle', 'passed'),
      check('independent-qa', 'rescue-qa', 'passed'),
    ],
    factRefs: ['evidence:synthetic-rescue-result'],
    hypothesis: { cause: 'unknown', confidence: 'unknown', evidenceRefs: [] },
    remediation: {
      action: 'astra-handoff',
      evidenceRefs: ['evidence:synthetic-recovery-decision'],
      checkRefs: ['artifact:rescue-oracle', 'artifact:rescue-qa'],
    },
  };
  const runRecord = createModelRunEvidence({
    schemaVersion: 1,
    runId: 'synthetic-model-smoke',
    taskId: lunaContract.modelTaskId,
    laneId: base.id,
    profileBinding: modelRecovery.profileBinding,
    sourceDigest,
    configDigest,
    scopeDigest: lunaContract.modelScopeDigest,
    selectionRefs: ['evidence:synthetic-bounded-extraction-rubric'],
    writerClearance: modelRecovery.pendingWriter,
    recoveryBinding: synthesis.recoveryDecisions[0].recoveryBinding,
    attempts: [primaryRecord, rescueRecord],
    finalDisposition: rescueRecord.disposition,
  });
  return {
    fixtureOnly: true,
    activation: {
      dispatch: lunaDispatch,
      post,
      recovery,
      rescueDispatch,
      rescuePost,
      completedRecovery,
      synthesis,
      runRecord,
    },
    candidate: contract.routeRecommendation.modelRecommendation,
    withoutAdmission: createDispatchRecommendation({ delegation, reportedRuntimeEvidence }),
    pilot: createDispatchRecommendation(input),
    routineWithPilot: createDispatchRecommendation(routine),
    fixedRole: createDispatchRecommendation(fixed),
    contextConflict: createDispatchRecommendation(contextConflict),
  };
}

function discoverBootstrap() {
  for (const path of entryPoints) {
    if (!existsSync(resolve(repoRoot, path)))
      throw new Error(`Missing bootstrap entry point: ${path}`);
  }

  const agents = read('AGENTS.md');
  const workflowIndex = read('docs/development/agent-workflows/README.md');
  const gettingStarted = read('docs/development/agent-workflows/getting-started.md');

  requireReference(agents, 'docs/development/agent-workflows/getting-started.md', 'AGENTS.md');
  requireReference(agents, 'agent-execution-contract.md', 'AGENTS.md');
  requireReference(agents, 'orchestration.md', 'AGENTS.md');
  requireReference(workflowIndex, 'request-intake/README.md', 'workflow index');
  requireReference(workflowIndex, 'plan-authoring/README.md', 'workflow index');
  requireReference(gettingStarted, 'request-intake/README.md', 'getting started');
  requireReference(gettingStarted, 'plan-authoring/README.md', 'getting started');

  return {
    entryPoints: [...entryPoints],
    order: [
      'current-request',
      'AGENTS.md',
      'minimum-relevant-workflow-guide',
      'current-code-contract-test-evidence',
    ],
    canonical: true,
  };
}

function evaluateScenario({
  request,
  repositoryEvidence,
  laneCandidates = [],
  reportedRuntimeEvidence = null,
  deliveryByLane = {},
}) {
  assertRepositoryEvidenceExists(repositoryEvidence);
  const envelope = buildTaskEnvelope({ request });
  const contextPack = discoverContextPack({ envelope, repositoryEvidence });
  const workflow = prepareCodexWorkflow({
    request,
    mode: 'fresh',
    repositoryEvidence,
    reportedRuntimeEvidence,
    deliveryByLane,
    laneCandidates: laneCandidates.map((lane) => {
      const { smokePredicateIds, ...candidate } = lane;
      return {
        ...candidate,
        pass2Evidence: semanticEvidence(
          contextPack,
          smokePredicateIds ??
            (lane.taskKind === 'research' ? 'SEC-07-official-evidence' : 'SEC-05-disclosure'),
        ),
      };
    }),
  });
  return workflow;
}

function evaluateRoutingEvidence() {
  const sameRequest = 'Legal 개선 지점 분석해줘.';
  const keywordOnly = routedEffort({
    request: 'critical migration transaction xhigh Legal 개선 지점 분석해줘.',
    predicateIds: ['FE-05-browser-runtime'],
  });
  const medium = routedEffort({ request: sameRequest, predicateIds: mediumPredicateIds() });
  const high = routedEffort({ request: sameRequest, predicateIds: ['FE-08-performance-causal'] });
  const xhigh = routedEffort({
    request: sameRequest,
    predicateIds: ['BE-01-concurrency-transaction'],
  });

  return {
    keywordOnly,
    sameRequest: {
      request: sameRequest,
      efforts: [medium.effort, high.effort, xhigh.effort],
      roles: [medium.role, high.role, xhigh.role],
      childCounts: [medium.childCount, high.childCount, xhigh.childCount],
    },
    parentEffortClaimed: false,
  };
}

function routedEffort({ request, predicateIds }) {
  const result = evaluateScenario({
    request,
    repositoryEvidence: [{ path: 'docs/policies/legal-basis.md', kind: 'policy' }],
    laneCandidates: [routingEvidenceLane(predicateIds)],
  });
  const [contract] = result.delegation.recommendedChildren;
  if (!contract) throw new Error('Fresh-session routing evidence requires one child contract.');
  return {
    effort: contract.routeRecommendation.effort,
    role: contract.routeRecommendation.role,
    childCount: result.delegation.recommendedChildren.length,
  };
}

function routingEvidenceLane(predicateIds) {
  return {
    id: 'legal-routing-evidence',
    domain: 'legal-policy',
    taskKind: 'analysis',
    priority: 'high',
    impactRisk: 'high',
    objective: 'Analyze one bounded Legal repository question.',
    question: 'Which current evidence determines the reasoning complexity?',
    allowedEvidence: ['repo', 'test'],
    allowedTools: ['repository-read'],
    readScope: ['docs/policies/legal-basis.md'],
    writeOwnership: [],
    dependencies: [],
    expectedOutputFields: ['findings'],
    verification: ['Cite the current repository evidence.'],
    benefit: {
      kind: 'completeness',
      rationale: 'The bounded evidence lane can be completed independently.',
    },
    smokePredicateIds: predicateIds,
  };
}

function summarizeScenario({ envelope, contextPack, delegation, dispatch }) {
  return {
    intent: envelope.intent,
    authorizedAction: envelope.authorizedAction,
    recommendedPath: envelope.recommendedPath,
    domains: contextPack.domainCandidates.map(({ domain }) => domain),
    selectedGuides: contextPack.selectedGuides.map(({ path }) => path),
    gaps: [...contextPack.gaps, ...delegation.gaps, ...dispatch.gaps],
    delegation: delegation.execution,
    delegationReason: delegation.reason,
    dispatch: dispatch.execution,
    dispatchReason: dispatch.reason,
    childCount: dispatch.dispatches.length,
    routedRoles: dispatch.dispatches.map(({ agentType }) => agentType),
  };
}

function advisoryLegalLanes() {
  return [
    {
      id: 'legal-repository',
      domain: 'legal-policy',
      taskKind: 'analysis',
      priority: 'high',
      impactRisk: 'high',
      objective: 'Analyze current repository Legal responsibilities.',
      question: 'Which current repository boundaries affect Legal?',
      allowedEvidence: ['repo', 'test'],
      allowedTools: ['repository-read'],
      readScope: ['docs/policies/legal-basis.md', 'apps/web/src/legal'],
      writeOwnership: [],
      dependencies: [],
      expectedOutputFields: ['problems', 'recommendations'],
      verification: ['Cite current repository paths.'],
      benefit: {
        kind: 'completeness',
        rationale: 'Repository evidence can be inspected independently.',
      },
    },
    {
      id: 'legal-official',
      domain: 'legal-policy',
      taskKind: 'research',
      priority: 'high',
      impactRisk: 'high',
      objective: 'Verify current official Legal evidence.',
      question: 'Which current official sources support the Legal claims?',
      allowedEvidence: ['official-current'],
      allowedTools: ['official-web-read'],
      readScope: ['https://www.law.go.kr/'],
      writeOwnership: [],
      dependencies: [],
      expectedOutputFields: ['currentClaims'],
      verification: ['Cite a directly verified official source.'],
      benefit: {
        kind: 'specialist-evidence',
        rationale: 'External authority can be checked independently.',
      },
    },
  ];
}

function semanticEvidence(contextPack, predicateIds) {
  const normalizedPredicateIds = Array.isArray(predicateIds) ? predicateIds : [predicateIds];
  const current =
    contextPack.sources.find(({ path }) => path === 'docs/policies/legal-basis.md') ??
    contextPack.sources[0];
  const source = {
    path: current.path,
    locator: `fresh-session:${normalizedPredicateIds.join(',')}`,
    kind: current.kind,
    observedAt: current.verifiedAt ?? current.freshness,
    contentDigest: `sha256:${'d'.repeat(64)}`,
  };
  source.sourceId = createSemanticSourceId(source);
  const facts = normalizedPredicateIds.map((predicateId) => {
    const fact = {
      statement: `Fresh-session evidence supports ${predicateId}.`,
      sourceIds: [source.sourceId],
      confidence: 'high',
    };
    return { ...fact, factId: createSemanticFactId(fact) };
  });
  const predicateClaims = normalizedPredicateIds.map((predicateId, index) => {
    const claim = {
      predicateId,
      outcome: 'confirmed',
      factIds: [facts[index].factId],
      semanticMatch: {
        matches: true,
        rationale: `The fresh ContextPack source supports ${predicateId}.`,
      },
      compositeCategory: null,
    };
    return { ...claim, evidenceId: createSemanticEvidenceId(claim) };
  });
  return {
    sources: [source],
    facts,
    predicateClaims,
    inferences: [],
    gaps: [],
    confidence: 'high',
  };
}

function mediumPredicateIds() {
  return Array.from({ length: 15 }, (_, index) => `M-${String(index + 1).padStart(2, '0')}`);
}

function assertRepositoryEvidenceExists(repositoryEvidence) {
  for (const { path } of repositoryEvidence) {
    if (!path.startsWith('https://') && !existsSync(resolve(repoRoot, path))) {
      throw new Error(`Missing repository evidence: ${path}`);
    }
  }
}

function requireReference(source, expected, owner) {
  if (!source.includes(expected)) throw new Error(`${owner} does not discover ${expected}`);
}

function read(path) {
  return readFileSync(resolve(repoRoot, path), 'utf8');
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

if (process.argv.includes('--json')) {
  process.stdout.write(`${JSON.stringify(runFreshSessionSmoke(), null, 2)}\n`);
}
