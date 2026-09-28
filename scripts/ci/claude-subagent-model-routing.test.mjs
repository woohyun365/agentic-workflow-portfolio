import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import { buildTaskEnvelope, validateCrossModelExchange } from '../agents/common/index.mjs';
import {
  CLAUDE_ADAPTER_READINESS,
  assessClaudeStaticExchange,
  assessClaudeModelObservation,
  assessClaudeSubagentAdmission,
  createClaudeSubagentBinding,
  evaluateClaudeProfileEligibility,
  listClaudeSubagentProfiles,
} from '../agents/claude/index.mjs';

const root = resolve(import.meta.dirname, '../..');
const snapshotDigest = `sha256:${'1'.repeat(64)}`;
const configDigest = `sha256:${'2'.repeat(64)}`;
const now = '2026-09-26T12:00:00.000Z';
const roles = {
  repo_explorer: ['Read', 'Grep', 'Glob'],
  repo_researcher: ['Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch'],
  repo_executor: ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'Bash'],
  repo_reviewer: ['Read', 'Grep', 'Glob'],
};

function facts(...keys) {
  return keys.map((key) => ({
    key,
    sourceRef: 'docs/development/agent-workflows/qa.md',
    confidence: 'high',
  }));
}

function digestObject(value) {
  const canonical = (item) =>
    Array.isArray(item)
      ? item.map(canonical)
      : item && typeof item === 'object'
        ? Object.fromEntries(
            Object.keys(item)
              .sort()
              .map((key) => [key, canonical(item[key])]),
          )
        : item;
  return `sha256:${createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex')}`;
}

function inputFor(profileId = 'bounded-standard', kind = 'build') {
  const envelope = buildTaskEnvelope({
    request: 'scripts/agents/claude 계약을 구현해줘.',
  });
  const task = {
    taskId: 'task-h3m-001',
    kind,
    impactRisk: 'medium',
    complexity: 'bounded',
    uncertainty: 'resolved',
    role: kind === 'build' ? 'repo_executor' : kind === 'review' ? 'repo_reviewer' : 'repo_explorer',
    allowedTools: [
      ...roles[
        kind === 'build' ? 'repo_executor' : kind === 'review' ? 'repo_reviewer' : 'repo_explorer'
      ],
    ],
    readScope: ['scripts/agents/claude'],
    writeScope: kind === 'build' ? ['scripts/agents/claude'] : [],
    writeOwner: kind === 'build' ? 'executor-h3m' : null,
    childValue: 'independent-verification',
    independent: true,
    knownGaps: [],
    facts: facts(
      'source-bound',
      'bounded-scope',
      'acceptance',
      'oracle',
      'independent-qa',
      'regression',
      'one-writer',
    ),
  };
  if (profileId === 'bounded-extraction') {
    task.kind = 'extract';
    task.impactRisk = 'low';
    task.role = 'repo_explorer';
    task.allowedTools = [...roles.repo_explorer];
    task.writeScope = [];
    task.writeOwner = null;
    task.facts = facts(
      'source-bound',
      'fixed-input',
      'single-step',
      'output-schema',
      'acceptance',
      'independent-check',
    );
  }
  if (kind === 'read' && profileId === 'bounded-standard') {
    task.facts = facts('source-bound', 'bounded-scope', 'acceptance', 'oracle', 'independent-qa');
  }
  if (profileId === 'complex-critical') {
    task.kind = 'review';
    task.impactRisk = 'high';
    task.complexity = 'complex';
    task.role = 'repo_reviewer';
    task.allowedTools = [...roles.repo_reviewer];
    task.writeScope = [];
    task.writeOwner = null;
    task.facts = facts(
      'source-bound',
      'bounded-scope',
      'acceptance',
      'oracle',
      'independent-qa',
      'fresh-context',
    );
  }
  return {
    envelope,
    profileId,
    selectedBy: 'lead',
    selectionBasisRef: 'docs/development/agent-workflows/qa.md',
    task,
    sourceDigest: snapshotDigest,
    configDigest,
    issuedAt: '2026-09-26T11:55:00.000Z',
    expiresAt: '2026-09-26T12:25:00.000Z',
  };
}

function admitted(binding) {
  return {
    bindingDigest: binding.bindingDigest,
    taskId: binding.taskId,
    sourceDigest: binding.sourceDigest,
    configDigest: binding.configDigest,
    scopeDigest: binding.scopeDigest,
    envelopeDigest: binding.envelopeDigest,
    approvedBy: 'lead',
    authorityRef: 'current-owner-request',
    permission: 'allowed',
    qaOwner: 'independent-reviewer',
    issuedAt: '2026-09-26T11:56:00.000Z',
    expiresAt: '2026-09-26T12:20:00.000Z',
  };
}

function reportedRuntime(binding) {
  return {
    support: 'supported',
    permission: 'allowed',
    quota: 'available',
    freshness: 'current-turn',
    role: binding.role,
    roleTools: roles[binding.role],
    requestedAlias: binding.requestedModelAlias,
    expectedResolvedModel: `claude-${binding.requestedModelAlias}-synthetic`,
    evidenceRef: 'fixture:reported-current-turn',
  };
}

function candidate(input = inputFor()) {
  const binding = createClaudeSubagentBinding(input);
  const admission = admitted(binding);
  const runtime = reportedRuntime(binding);
  const result = assessClaudeSubagentAdmission({
    binding,
    admission,
    runtime,
    current: {
      requestId: input.envelope.requestId,
      taskId: input.task.taskId,
      sourceDigest: input.sourceDigest,
      configDigest: input.configDigest,
      scopeDigest: binding.scopeDigest,
      envelopeDigest: binding.envelopeDigest,
      writerInventory: { status: 'current-turn', evidenceRef: 'fixture:writer-state', active: [] },
      now,
    },
  });
  return { binding, admission, runtime, result };
}

test('finite Claude profiles are lead-selected task candidates, never role pins or live admission', () => {
  const profiles = listClaudeSubagentProfiles();
  assert.deepEqual(
    profiles.map(({ id, modelAlias }) => [id, modelAlias]),
    [
      ['bounded-extraction', 'haiku'],
      ['bounded-standard', 'sonnet'],
      ['complex-critical', 'opus'],
    ],
  );
  assert.equal(Object.isFrozen(profiles), true);
  assert.deepEqual(CLAUDE_ADAPTER_READINESS, {
    host: 'claude-code',
    admission: 'mode-specific',
    mode: 'interactive-auto',
    enforcement: 'healthy-hook-request-check',
    runtimeSupport: 'per-run-observation-required',
    applied: false,
  });
  for (const profile of profiles) assert.equal(Object.isFrozen(profile), true);
});

test('eligibility rejects low-model downgrade, role/tool mismatch and child-free work', () => {
  const valid = inputFor('bounded-standard', 'build');
  assert.equal(evaluateClaudeProfileEligibility(valid).eligible, true);
  for (const mutate of [
    (x) => {
      x.task.impactRisk = 'high';
    },
    (x) => {
      x.task.complexity = 'complex';
    },
    (x) => {
      x.task.uncertainty = 'uncertain';
    },
    (x) => {
      x.task.role = 'repo_reviewer';
    },
    (x) => {
      x.task.writeOwner = null;
    },
    (x) => {
      x.task.childValue = 'none';
    },
    (x) => {
      x.task.independent = false;
    },
    (x) => {
      x.task.knownGaps = ['missing oracle'];
    },
    (x) => {
      x.task.facts = x.task.facts.filter(({ key }) => key !== 'regression');
    },
    (x) => {
      x.task.facts[0].confidence = 'low';
    },
  ]) {
    const input = structuredClone(valid);
    mutate(input);
    assert.equal(
      evaluateClaudeProfileEligibility(input).eligible,
      false,
      JSON.stringify(input.task),
    );
  }
  const read = inputFor('bounded-standard', 'read');
  read.task.writeScope = [];
  read.task.writeOwner = null;
  read.task.allowedTools = ['Read', 'Bash'];
  assert.equal(evaluateClaudeProfileEligibility(read).eligible, false);
  const malformed = inputFor();
  malformed.task.facts = [null];
  assert.doesNotThrow(() => evaluateClaudeProfileEligibility(malformed));
  assert.equal(evaluateClaudeProfileEligibility(malformed).eligible, false);
  const understatedBuild = inputFor();
  understatedBuild.task.allowedTools = understatedBuild.task.allowedTools.filter(
    (tool) => tool !== 'Bash',
  );
  assert.equal(evaluateClaudeProfileEligibility(understatedBuild).eligible, false);
});

test('neutral intake authority and risk cannot be expanded or downgraded', () => {
  const analysis = inputFor();
  analysis.envelope = buildTaskEnvelope({ request: '현재 코드를 분석해줘.' });
  assert.equal(analysis.envelope.authorizedAction, 'produce-analysis');
  assert.equal(evaluateClaudeProfileEligibility(analysis).eligible, false);
  const risky = inputFor('bounded-extraction');
  risky.envelope = buildTaskEnvelope({ request: '보안 로그를 분석해줘.' });
  assert.equal(risky.envelope.risk, 'high');
  assert.equal(evaluateClaudeProfileEligibility(risky).eligible, false);
  const safeExtraction = inputFor('bounded-extraction');
  safeExtraction.envelope = buildTaskEnvelope({ request: '현재 코드를 분석해줘.' });
  assert.equal(evaluateClaudeProfileEligibility(safeExtraction).eligible, true);
});

test('Opus baseline covers bounded complex/high-risk/uncertain tasks, not only review', () => {
  const highRiskBuild = inputFor('bounded-standard', 'build');
  highRiskBuild.profileId = 'complex-critical';
  highRiskBuild.task.impactRisk = 'high';
  highRiskBuild.task.complexity = 'complex';
  assert.equal(evaluateClaudeProfileEligibility(highRiskBuild).eligible, true);
  assert.equal(createClaudeSubagentBinding(highRiskBuild).requestedModelAlias, 'opus');

  const uncertainRead = inputFor('bounded-standard', 'read');
  uncertainRead.profileId = 'complex-critical';
  uncertainRead.task.uncertainty = 'uncertain';
  assert.equal(evaluateClaudeProfileEligibility(uncertainRead).eligible, true);
  assert.equal(createClaudeSubagentBinding(uncertainRead).requestedModelAlias, 'opus');

  const ordinaryRead = inputFor('bounded-standard', 'read');
  assert.equal(evaluateClaudeProfileEligibility(ordinaryRead).eligible, true);
  ordinaryRead.task.impactRisk = 'high';
  assert.equal(evaluateClaudeProfileEligibility(ordinaryRead).eligible, false);

  const verifiedBuild = inputFor('bounded-standard', 'build');
  assert.ok(verifiedBuild.task.allowedTools.includes('Bash'));
  assert.equal(evaluateClaudeProfileEligibility(verifiedBuild).eligible, true);
});

test('Opus admits explicit bounded independent review without fabricated critical risk', () => {
  const review = inputFor('complex-critical');
  review.envelope = buildTaskEnvelope({ request: '현재 코드를 검토해줘.' });
  review.task.impactRisk = 'low';
  review.task.complexity = 'bounded';
  review.task.uncertainty = 'resolved';

  assert.deepEqual(evaluateClaudeProfileEligibility(review), { eligible: true, reasons: [] });
  assert.equal(createClaudeSubagentBinding(review).requestedModelAlias, 'opus');
  const mediumReview = structuredClone(review);
  mediumReview.task.impactRisk = 'medium';
  assert.deepEqual(evaluateClaudeProfileEligibility(mediumReview), { eligible: true, reasons: [] });

  for (const mutate of [
    (x) => {
      x.task.kind = 'read';
      x.task.role = 'repo_explorer';
      x.task.allowedTools = [...roles.repo_explorer];
    },
    (x) => {
      x.task.independent = false;
    },
    (x) => {
      x.task.writeScope = ['scripts/agents/claude'];
      x.task.writeOwner = 'reviewer-h4l';
    },
    (x) => {
      x.task.role = 'repo_explorer';
      x.task.allowedTools = [...roles.repo_explorer];
    },
  ]) {
    const invalid = structuredClone(review);
    mutate(invalid);
    const assessed = evaluateClaudeProfileEligibility(invalid);
    assert.equal(assessed.eligible, false, JSON.stringify(invalid.task));
    // Each mutation must lose the narrowed review exemption itself, not only an older rule.
    assert.ok(assessed.reasons.includes('critical-signal'), JSON.stringify(assessed.reasons));
  }
});

test('binding refuses free-form model choice, unknown profile/fields and stale or child-selected facts', () => {
  const valid = inputFor();
  const binding = createClaudeSubagentBinding(valid);
  assert.equal(binding.requestedModelAlias, 'sonnet');
  assert.equal(binding.requestedModelSource, 'profile:bounded-standard');
  assert.match(binding.bindingDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(Object.isFrozen(binding), true);
  for (const patch of [
    { profileId: 'free-form-claude-model' },
    { model: 'opus' },
    { modelRequest: { model: 'opus' } },
    { reasoning_effort: 'low' },
    { selectedBy: 'child' },
    { selectionBasisRef: '' },
    { sourceDigest: 'unknown' },
    { configDigest: 'unknown' },
    { issuedAt: '2026-09-26T12:30:00.000Z' },
    { issuedAt: '2026-09-26T11:55:00Z' },
  ]) {
    assert.throws(() => createClaudeSubagentBinding({ ...valid, ...patch }), TypeError);
  }
  const changed = structuredClone(valid);
  changed.task.facts[0].sourceRef = 'docs/development/agent-workflows/orchestration.md';
  assert.notEqual(createClaudeSubagentBinding(changed).bindingDigest, binding.bindingDigest);
  const unsafe = structuredClone(valid);
  unsafe.task.facts[0].sourceRef = '../../private/credential';
  assert.throws(() => createClaudeSubagentBinding(unsafe), TypeError);
});

test('task admission binds current task/source/config/scope/permission/QA and refuses unknown host support', () => {
  const { binding, admission, runtime, result } = candidate();
  assert.equal(result.decision, 'candidate');
  assert.equal(result.descriptor.dispatchAllowed, false);
  assert.equal(result.descriptor.applied, false);
  assert.equal(result.descriptor.runtimeQualification, 'not-run');
  assert.deepEqual(result.descriptor.requestedModel, {
    alias: 'sonnet',
    source: 'profile:bounded-standard',
  });
  assert.equal(result.descriptor.expectedResolvedModel, 'claude-sonnet-synthetic');
  assert.equal(result.descriptor.transport, 'native-subagent');
  assert.equal(result.descriptor.host, 'claude-code');
  const base = {
    binding,
    admission,
    runtime,
    current: {
      requestId: binding.requestId,
      taskId: binding.taskId,
      sourceDigest: binding.sourceDigest,
      configDigest: binding.configDigest,
      scopeDigest: binding.scopeDigest,
      envelopeDigest: binding.envelopeDigest,
      writerInventory: { status: 'current-turn', evidenceRef: 'fixture:writer-state', active: [] },
      now,
    },
  };
  for (const mutate of [
    (x) => {
      x.admission = null;
    },
    (x) => {
      x.admission.bindingDigest = 'sha256:dead';
    },
    (x) => {
      x.admission.permission = 'denied';
    },
    (x) => {
      x.admission.approvedBy = 'child';
    },
    (x) => {
      x.admission.qaOwner = x.binding.writeOwner;
    },
    (x) => {
      x.current.requestId = 'other-request';
    },
    (x) => {
      x.current.sourceDigest = `sha256:${'a'.repeat(64)}`;
    },
    (x) => {
      x.current.configDigest = `sha256:${'a'.repeat(64)}`;
    },
    (x) => {
      x.current.scopeDigest = `sha256:${'a'.repeat(64)}`;
    },
    (x) => {
      x.current.envelopeDigest = `sha256:${'a'.repeat(64)}`;
    },
    (x) => {
      x.current.writerInventory.active = [
        { owner: 'other-writer', writeScope: ['scripts/agents'] },
      ];
    },
    (x) => {
      x.current.writerInventory.status = 'unknown';
    },
    (x) => {
      x.current.now = '2026-09-26T12:30:00.000Z';
    },
    (x) => {
      x.current.now = '2026-09-26T12:00:00Z';
    },
    (x) => {
      x.runtime.support = 'unknown';
    },
    (x) => {
      x.runtime.permission = 'denied';
    },
    (x) => {
      x.runtime.quota = 'denied';
    },
    (x) => {
      x.runtime.role = 'repo_reviewer';
    },
    (x) => {
      x.runtime.requestedAlias = 'opus';
    },
    (x) => {
      x.runtime.roleTools = ['Read'];
    },
    (x) => {
      x.runtime.expectedResolvedModel = 'unknown';
    },
    (x) => {
      x.runtime.expectedResolvedModel = 'sonnet';
    },
    (x) => {
      x.runtime.expectedResolvedModel = 'claude-opus-synthetic';
    },
  ]) {
    const input = structuredClone(base);
    mutate(input);
    const refusal = assessClaudeSubagentAdmission(input);
    assert.equal(refusal.decision, 'refuse', JSON.stringify(input));
    assert.equal(refusal.descriptor, null);
  }
  const unsupported = structuredClone(base);
  unsupported.runtime.support = 'unknown';
  assert.equal(assessClaudeSubagentAdmission(unsupported).reason, 'runtime-unknown');
  const denied = structuredClone(base);
  denied.runtime.permission = 'denied';
  assert.equal(assessClaudeSubagentAdmission(denied).reason, 'permission-denied');
  const conflict = structuredClone(base);
  conflict.current.writerInventory.active = [
    { owner: 'other-writer', writeScope: ['scripts/agents/claude'] },
  ];
  assert.equal(assessClaudeSubagentAdmission(conflict).reason, 'writer-conflict');
});

test('a caller-rehashed binding cannot bypass task/profile eligibility', () => {
  const { binding, admission, runtime } = candidate();
  const forged = structuredClone(binding);
  forged.impactRisk = 'high';
  const { bindingDigest: _old, ...data } = forged;
  forged.bindingDigest = digestObject(data);
  const sameGrant = { ...admission, bindingDigest: forged.bindingDigest };
  const result = assessClaudeSubagentAdmission({
    binding: forged,
    admission: sameGrant,
    runtime,
    current: {
      requestId: binding.requestId,
      taskId: binding.taskId,
      sourceDigest: binding.sourceDigest,
      configDigest: binding.configDigest,
      scopeDigest: binding.scopeDigest,
      envelopeDigest: binding.envelopeDigest,
      writerInventory: { status: 'current-turn', evidenceRef: 'fixture:writer-state', active: [] },
      now,
    },
  });
  assert.equal(result.decision, 'refuse');
});

test('observation separates requested/resolved/observed and cannot grant live PASS', () => {
  const { binding, result } = candidate();
  const descriptor = result.descriptor;
  const receipt = {
    bindingDigest: descriptor.bindingDigest,
    status: 'complete',
    role: descriptor.role,
    requestedAlias: descriptor.requestedModel.alias,
    resolvedModel: descriptor.expectedResolvedModel,
    observedModel: descriptor.expectedResolvedModel,
    evidenceRef: 'fixture:post-tool-use',
    oracle: 'pass',
  };
  const compatible = assessClaudeModelObservation({ binding, descriptor, receipt });
  assert.equal(compatible.decision, 'compatible-static');
  assert.equal(compatible.liveQualified, false);
  for (const patch of [
    { role: 'repo_explorer' },
    { observedModel: 'unknown' },
    { observedModel: null },
    { resolvedModel: 'claude-opus-substituted' },
    { requestedAlias: 'haiku' },
    { status: 'denied' },
    { status: 'timed-out' },
    { oracle: 'not-run' },
    { evidenceRef: '' },
  ]) {
    const refusal = assessClaudeModelObservation({
      binding,
      descriptor,
      receipt: { ...receipt, ...patch },
    });
    assert.equal(refusal.decision, 'blocked', JSON.stringify(patch));
    assert.equal(refusal.liveQualified, false);
  }
  const wrongDescriptor = structuredClone(descriptor);
  wrongDescriptor.requestedModel.source = 'profile:bounded-extraction';
  assert.equal(
    assessClaudeModelObservation({ binding, descriptor: wrongDescriptor, receipt }).decision,
    'blocked',
  );
  const substitutedDescriptor = structuredClone(descriptor);
  substitutedDescriptor.expectedResolvedModel = 'claude-opus-synthetic';
  assert.equal(
    assessClaudeModelObservation({
      binding,
      descriptor: substitutedDescriptor,
      receipt: {
        ...receipt,
        resolvedModel: 'claude-opus-synthetic',
        observedModel: 'claude-opus-synthetic',
      },
    }).decision,
    'blocked',
  );
  const forged = structuredClone(descriptor);
  forged.role = 'not-a-project-role';
  forged.allowedTools = ['SecretReader'];
  assert.equal(
    assessClaudeModelObservation({ binding, descriptor: forged, receipt }).decision,
    'blocked',
  );
  assert.equal(
    assessClaudeModelObservation({
      binding,
      descriptor,
      receipt: { ...receipt, status: 'timed-out' },
    }).reason,
    'timed-out',
  );
});

test('neutral intake to Claude proposal and H3 blocked QA is deterministic but never a host run', () => {
  const { basePacket, baseResult } = JSON.parse(
    readFileSync(resolve(root, 'scripts/ci/fixtures/cross-model-handoff-cases.json'), 'utf8'),
  );
  const input = inputFor('complex-critical');
  input.sourceDigest = digestObject(basePacket.snapshot);
  const { binding, result } = candidate(input);
  assert.equal(binding.requestedModelAlias, 'opus');
  assert.equal(result.decision, 'candidate');
  assert.equal(result.descriptor.dispatchAllowed, false);
  const packet = structuredClone(basePacket);
  const qa = structuredClone(baseResult);
  packet.packetId = binding.taskId;
  packet.objective = binding.requestSummary;
  qa.packetId = binding.taskId;
  packet.lifecycle.support = 'unknown';
  qa.status = 'denied';
  qa.identity.resolvedModel = 'unknown';
  qa.identity.observedModel = 'unknown';
  qa.acceptanceCoverage[0].gap = 'No native Claude invocation was authorized.';
  qa.acceptanceCoverage[0].evidenceRefs = [];
  qa.commandsActuallyRun = [];
  qa.notRun = ['Claude native subagent model call'];
  qa.knownGaps = ['Claude runtime/model/permission qualification not run'];
  qa.confidence = 'low';
  qa.verdict = 'BLOCKED';
  qa.blocker = 'Native Claude model call not run in H3M.';
  qa.cleanup.status = 'not-started';
  const validation = validateCrossModelExchange({
    packet,
    result: qa,
    currentSnapshot: packet.snapshot,
  });
  assert.equal(validation.decision, 'accept', JSON.stringify(validation));
  assert.equal(validation.verificationClass, 'runner-live-required');
  assert.deepEqual(
    assessClaudeStaticExchange({
      binding,
      descriptor: result.descriptor,
      packet,
      result: qa,
      currentSnapshot: packet.snapshot,
    }),
    { decision: 'accept-static-blocked', liveQualified: false },
  );
  const unrelated = structuredClone(packet);
  unrelated.snapshot.headSHA = 'f'.repeat(64);
  assert.equal(
    assessClaudeStaticExchange({
      binding,
      descriptor: result.descriptor,
      packet: unrelated,
      result: qa,
      currentSnapshot: unrelated.snapshot,
    }).decision,
    'refuse',
  );
  const unrelatedObjective = structuredClone(packet);
  unrelatedObjective.objective = 'Review another unrelated change.';
  assert.equal(
    assessClaudeStaticExchange({
      binding,
      descriptor: result.descriptor,
      packet: unrelatedObjective,
      result: qa,
      currentSnapshot: unrelatedObjective.snapshot,
    }).decision,
    'refuse',
  );
  qa.verdict = 'PASS';
  assert.equal(
    validateCrossModelExchange({ packet, result: qa, currentSnapshot: packet.snapshot }).decision,
    'reject',
  );
});

test('qualification matrix leaves every native candidate and failure path not-run', () => {
  const matrix = JSON.parse(
    readFileSync(
      resolve(root, 'scripts/ci/fixtures/claude-subagent-model-qualification-matrix.json'),
      'utf8',
    ),
  );
  assert.deepEqual(
    new Set(matrix.rows.map((row) => row.profileId)),
    new Set(['bounded-extraction', 'bounded-standard', 'complex-critical']),
  );
  for (const row of matrix.rows) {
    assert.equal(row.actualInvocation, 'not-run');
    assert.ok(['haiku', 'sonnet', 'opus'].includes(row.requestedModelAlias));
    assert.match(row.expectedResolvedIdentity, /exact.*host/u);
    assert.ok(row.positiveOracle && row.adversarialOracle && row.cleanupOwner);
    assert.ok(row.denialPath && row.substitutionPath && row.timeoutPath);
    assert.ok(row.observationMethod && row.goNoGoCriterion);
    assert.deepEqual(row.tools, roles[row.role]);
    assert.ok(row.caseId && row.cleanupOwner.includes(row.caseId));
    assert.ok(row.cleanupTarget.includes(row.caseId) && row.cleanupVerifier.includes(row.caseId));
  }
});
