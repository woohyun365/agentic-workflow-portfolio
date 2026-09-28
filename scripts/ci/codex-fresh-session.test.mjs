import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { runFreshSessionSmoke } from '../agents/codex/fresh-session-smoke.mjs';

const repoRoot = resolve(import.meta.dirname, '../..');
const smokeScript = resolve(repoRoot, 'scripts/agents/codex/fresh-session-smoke.mjs');
const staleHandoffNames = [
  'frontend-feature-refactor-plan-authoring-handoff.md',
  'backend-feature-refactor-plan-authoring-handoff.md',
  'infrastructure-feature-refactor-plan-authoring-handoff.md',
];
const retiredWorkflowTokens = [
  '$' + 'ralph',
  '$' + 'ultrawork',
  '$' + 'pipeline',
  'autoresearch' + '-goal',
  'prometheus' + '-strict',
];
const textExtensions = new Set([
  '.js',
  '.json',
  '.jsx',
  '.md',
  '.mjs',
  '.mts',
  '.sh',
  '.ts',
  '.tsx',
  '.toml',
  '.yaml',
  '.yml',
]);

test('fresh smoke consumes model advice without enabling models, pilots or usage claims', () => {
  const { modelEvidence, boundaries } = runFreshSessionSmoke();
  assert.equal(modelEvidence.fixtureOnly, true);
  assert.equal(modelEvidence.candidate.recommendedModel, 'gpt-6-sol');
  assert.equal(modelEvidence.candidate.applied, false);
  assert.equal(modelEvidence.withoutAdmission.execution, 'leader-sequential');
  assert.equal(modelEvidence.pilot.execution, 'native-bounded-dispatch');
  assert.equal(modelEvidence.pilot.dispatches[0].modelPurpose, 'pilot');
  assert.equal(modelEvidence.routineWithPilot.execution, 'leader-sequential');
  assert.equal(modelEvidence.fixedRole.execution, 'leader-sequential');
  assert.equal(boundaries.invokesChild, false);
  assert.equal(boundaries.mutatesWorkspace, false);
});

test('fresh smoke consumes complete scoped packets and labels byte evidence separately from usage', () => {
  const { deliveryEvidence, boundaries } = runFreshSessionSmoke();
  assert.equal(deliveryEvidence.scoped.mode, 'scoped');
  assert.equal(deliveryEvidence.scoped.compatible, true);
  assert.equal(deliveryEvidence.unknown.applied, false);
  assert.equal(deliveryEvidence.unknown.compatible, false);
  assert.equal(deliveryEvidence.fullHistoryConflict.compatible, false);
  assert.equal(deliveryEvidence.fixtureOnly, true);
  assert.equal(deliveryEvidence.measurement.unit, 'utf8-bytes');
  assert.ok(
    deliveryEvidence.measurement.withSyntheticHistoryBytes >
      deliveryEvidence.measurement.packetBytes,
  );
  assert.equal(deliveryEvidence.measurement.tokens, null);
  assert.equal(deliveryEvidence.measurement.weeklyAllowance, null);
  assert.equal(boundaries.invokesChild, false);
  assert.equal(boundaries.mutatesWorkspace, false);
});

test('fresh smoke reaches ordinary scoped Astra dispatch and rejects context gaps', () => {
  const { deliveryEvidence, boundaries } = runFreshSessionSmoke();
  const { scoped, unknown, fullHistoryConflict } = deliveryEvidence.ordinaryDispatch;
  assert.deepEqual(scoped.dispatches[0].spawnArguments, {
    agent_type: 'repo_explorer',
    model: 'gpt-6-astra',
    reasoning_effort: 'xhigh',
    fork_turns: 'none',
  });
  assert.equal(scoped.dispatches[0].runtimeAction, false);
  for (const rejected of [unknown, fullHistoryConflict]) {
    assert.equal(rejected.execution, 'leader-sequential');
    assert.deepEqual(rejected.dispatches, []);
    assert.ok(rejected.gaps.includes('runtime-context-incompatible:legal-routing-evidence'));
  }
  assert.equal(boundaries.invokesChild, false);
  assert.equal(boundaries.mutatesWorkspace, false);
});

test('fresh smoke consumes lifecycle recommendations without invoking native lifecycle', () => {
  const report = runFreshSessionSmoke();
  const {
    unsupported,
    eligible,
    closedReleaseUnknown,
    noClose,
    mailboxUnknown,
    releasedWithoutClose,
  } = report.lifecycleEvidence;
  assert.equal(unsupported.recommendation, 'unsupported');
  assert.equal(eligible.recommendation, 'close-eligible');
  assert.equal(eligible.closeDisposition, 'not-attempted');
  assert.equal(closedReleaseUnknown.closeDisposition, 'closed-confirmed');
  assert.equal(closedReleaseUnknown.releaseDisposition, 'release-unverified');
  assert.equal(eligible.cleanupDisposition, 'required');
  assert.equal(closedReleaseUnknown.cleanupDisposition, 'satisfied');
  assert.equal(noClose.resultDisposition, 'collected');
  assert.equal(noClose.cleanupDisposition, 'not-required');
  assert.equal(noClose.recommendation, 'none');
  assert.equal(noClose.releaseDisposition, 'release-unverified');
  assert.equal(mailboxUnknown.resultDisposition, 'collected');
  assert.equal(mailboxUnknown.recommendation, 'wait');
  assert.equal(mailboxUnknown.cleanupDisposition, 'unknown');
  assert.equal(releasedWithoutClose.releaseDisposition, 'release-confirmed');
  assert.equal(releasedWithoutClose.closeDisposition, 'not-attempted');
  for (const result of Object.values(report.lifecycleEvidence)) {
    assert.equal(result.authority, 'leader-reported-not-host-authenticated');
    assert.equal(result.requiresLeaderRuntimeConfirmation, true);
  }
  assert.equal(report.boundaries.invokesChild, false);
  assert.equal(report.boundaries.mutatesWorkspace, false);
});

test('generic bootstrap discovers the tracked repository guidance chain', () => {
  const report = runFreshSessionSmoke();
  const tracked = new Set(trackedPaths());

  assert.equal(report.discovery.canonical, true);
  assert.deepEqual(report.discovery.order, [
    'current-request',
    'AGENTS.md',
    'minimum-relevant-workflow-guide',
    'current-code-contract-test-evidence',
  ]);
  for (const path of report.discovery.entryPoints) assert.ok(tracked.has(path), path);
  assert.deepEqual(report.boundaries, {
    readsLocalResumeState: false,
    readsIgnoredPlan: false,
    invokesChild: false,
    mutatesWorkspace: false,
  });
});

test('fresh direct, Analyze, and Plan routes retain their distinct authority', () => {
  const { scenarios } = runFreshSessionSmoke();

  assert.deepEqual(
    pick(scenarios.direct, ['intent', 'authorizedAction', 'delegation', 'dispatch', 'childCount']),
    {
      intent: 'answer',
      authorizedAction: 'answer',
      delegation: 'direct',
      dispatch: 'leader-direct',
      childCount: 0,
    },
  );
  assert.deepEqual(
    pick(scenarios.singleDomain, ['intent', 'authorizedAction', 'recommendedPath']),
    { intent: 'plan', authorizedAction: 'produce-plan', recommendedPath: 'sequential' },
  );
  assert.ok(
    scenarios.singleDomain.selectedGuides.includes(
      'docs/development/agent-workflows/plan-authoring/frontend.md',
    ),
  );
  assert.equal(scenarios.unavailableRoleRouting.intent, 'analyze');
  assert.equal(scenarios.unavailableRoleRouting.authorizedAction, 'produce-analysis');
});

test('single-domain planning selects one owner while mixed evidence fails closed', () => {
  const { singleDomain, mixedDomain } = runFreshSessionSmoke().scenarios;

  assert.deepEqual(singleDomain.selectedGuides, [
    'docs/development/agent-workflows/plan-authoring/core.md',
    'docs/development/agent-workflows/plan-authoring/frontend.md',
    'docs/development/agent-workflows/plan-authoring/cross-cutting/security-privacy.md',
  ]);
  assert.ok(
    mixedDomain.gaps.some(
      (gap) =>
        gap.startsWith('primary-domain-conflict:') &&
        gap.includes('frontend') &&
        gap.includes('backend'),
    ),
  );
  assert.equal(mixedDomain.delegation, 'single-sequential');
  assert.equal(mixedDomain.dispatch, 'leader-sequential');
  assert.equal(mixedDomain.childCount, 0);
});

test('unavailable role routing never fabricates a child role', () => {
  const scenario = runFreshSessionSmoke().scenarios.unavailableRoleRouting;

  assert.equal(scenario.delegation, 'bounded-lanes');
  assert.equal(scenario.dispatch, 'leader-sequential');
  assert.equal(scenario.childCount, 0);
  assert.deepEqual(scenario.routedRoles, []);
  assert.match(scenario.dispatchReason, /cannot honor every selected child route safely/u);
});

test('fresh routing ignores lexical escalation and changes effort only from current evidence', () => {
  const { routingEvidence } = runFreshSessionSmoke();

  assert.deepEqual(routingEvidence.keywordOnly, {
    effort: 'high',
    role: 'repo_explorer',
    childCount: 1,
  });
  assert.deepEqual(routingEvidence.sameRequest.efforts, ['medium', 'high', 'xhigh']);
  assert.deepEqual(routingEvidence.sameRequest.roles, [
    'repo_explorer',
    'repo_explorer',
    'repo_explorer',
  ]);
  assert.deepEqual(routingEvidence.sameRequest.childCounts, [1, 1, 1]);
  assert.equal(routingEvidence.parentEffortClaimed, false);
});

test('a clean process produces the same smoke result without OMX or Codex session state', () => {
  const result = spawnSync(process.execPath, [smokeScript, '--json'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      HOME: '/tmp/roommate-matching-empty-home',
      LANG: 'C.UTF-8',
      PATH: process.env.PATH,
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), runFreshSessionSmoke());

  const source = readFileSync(smokeScript, 'utf8');
  assert.doesNotMatch(source, /\.omx\/(?:context|notepad|plans|project-memory|state)/u);
  assert.doesNotMatch(source, /process\.env/u);
});

test('tracked guidance and runtime code no longer reference obsolete authoring handoffs', () => {
  const violations = trackedPaths()
    .filter((path) => path !== 'scripts/ci/codex-fresh-session.test.mjs')
    .filter((path) => textExtensions.has(extname(path)))
    .flatMap((path) => {
      const source = readFileSync(resolve(repoRoot, path), 'utf8');
      return staleHandoffNames
        .filter((name) => source.includes(name))
        .map((name) => `${path}: ${name}`);
    });

  assert.deepEqual(violations, []);
});

test('tracked guidance no longer routes to retired user workflows', () => {
  const scannedPaths = trackedPaths()
    .filter((path) => path !== 'scripts/ci/codex-fresh-session.test.mjs')
    .filter(
      (path) =>
        path === 'AGENTS.md' ||
        path.startsWith('.codex/') ||
        path.startsWith('docs/') ||
        path.startsWith('scripts/'),
    )
    .filter((path) => textExtensions.has(extname(path)));
  const violations = scannedPaths.flatMap((path) => {
    const source = readFileSync(resolve(repoRoot, path), 'utf8');
    return retiredWorkflowTokens
      .filter((token) => source.includes(token))
      .map((token) => `${path}: ${token}`);
  });

  assert.ok(scannedPaths.includes('.codex/agents/repo_reviewer.toml'));
  assert.deepEqual(violations, []);
});

function trackedPaths() {
  const result = spawnSync('git', ['ls-files', '-z'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr || 'git ls-files failed');
  return result.stdout
    .split('\0')
    .filter(Boolean)
    .filter((path) => existsSync(resolve(repoRoot, path)));
}

function pick(value, fields) {
  return Object.fromEntries(fields.map((field) => [field, value[field]]));
}

test('synthetic model smoke preserves controlled miss, once rescue and null usage coherently', () => {
  const result = runFreshSessionSmoke();
  const { post, recovery, completedRecovery, runRecord } = result.modelEvidence.activation;
  assert.equal(result.modelEvidence.fixtureOnly, true);
  assert.equal(result.boundaries.mutatesWorkspace, false);
  assert.equal(post.accepted, false);
  assert.equal(recovery.action, 'alternate-once');
  assert.equal(completedRecovery.status, 'complete');
  assert.equal(completedRecovery.remainingAlternateAttempts, 0);
  assert.equal(runRecord.profileBinding.resolvedEffort, 'xhigh');
  assert.deepEqual(
    runRecord.attempts.map((a) => a.disposition),
    ['failure', 'success'],
  );
  assert.deepEqual(
    runRecord.attempts.map((a) => a.requested.model),
    ['gpt-6-luna', 'gpt-6-astra'],
  );
  assert.equal(runRecord.attempts[0].case, 'controlled-failure');
  assert.equal(runRecord.attempts[0].checks[0].status, 'passed');
  assert.equal(runRecord.attempts[0].checks[1].status, 'failed');
  assert.equal(runRecord.attempts[1].alternateOf, runRecord.attempts[0].attemptId);
  assert.ok(runRecord.attempts.every((a) => a.hostObserved === null && a.usage.tokens === null));
});

test('smoke actually carries low recovery admission, descriptor, post, synthesis and bound record', () => {
  const { activation } = runFreshSessionSmoke().modelEvidence;
  const d = activation.rescueDispatch.dispatches[0];
  assert.equal(d.kind, 'model-recovery');
  assert.equal(d.recoveryUse.admission.kind, 'recovery');
  assert.equal(d.spawnArguments.reasoning_effort, 'low');
  assert.equal(d.contract.routeRecommendation.effort, 'medium');
  assert.equal(d.contract.routeRecommendation.modelRecommendation, undefined);
  assert.equal(activation.rescuePost.accepted, true);
  assert.equal(activation.synthesis.readyForLeaderDecision, true);
  assert.equal(activation.synthesis.recoveryDecisions[0].attempts[0].outcome, 'failure');
  assert.equal(activation.synthesis.recoveryDecisions[0].attempts[1].effort, 'low');
  assert.deepEqual(activation.runRecord.recoveryBinding, d.recoveryBinding);
  assert.equal(activation.runRecord.attempts[1].resolved.effort, 'low');
  assert.notEqual(
    activation.runRecord.attempts[0].sourceDigest,
    activation.runRecord.attempts[1].sourceDigest,
  );
});
