import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildTaskEnvelope } from '../agents/common/intake-policy.mjs';
import { discoverContextPack } from '../agents/common/domain-guide-registry.mjs';
import { resolveWorkflowEntry } from '../agents/common/workflow-entry.mjs';
import {
  validateBoundedLanes,
  validateFanIn,
  validateAdapterReview,
} from '../agents/common/adapter-contract.mjs';
import { runClaudePreflight } from '../agents/claude/session-preflight.mjs';
import {
  prepareClaudeWorkflow,
  validateClaudeWorkflowResults,
} from '../agents/claude/workflow-entry.mjs';
const corpus = JSON.parse(
  readFileSync(new URL('../agents/fixtures/workflow-contract/intake-cases.json', import.meta.url)),
);
const identity = {
  sourceDigest: `sha256:${'c'.repeat(64)}`,
  configDigest: `sha256:${'d'.repeat(64)}`,
};
const assignment = {
  owner: 'parent',
  dispatchId: 'direct-1',
  acceptance: ['specified evidence checked'],
  writeOwnership: [],
};
const cli = new URL('../agents/claude/workflow-entry.mjs', import.meta.url).pathname;
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'claude-workflow-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  git('init', '-q', '-b', 'fixture');
  writeFileSync(join(root, '.gitignore'), '.plans/\nbin/\nprocess-calls\n');
  writeFileSync(join(root, 'source.txt'), 'baseline\n');
  git('add', '.');
  git(
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.invalid',
    'commit',
    '-qm',
    'fixture',
  );
  const head = git('rev-parse', 'HEAD').trim();
  return {
    root,
    snapshot: { baseSHA: head, headSHA: head, dirtyDiffDigest: null, untrackedInputDigests: [] },
  };
}
function input(f, intent = 'answer', mode = 'fresh') {
  return {
    root: f.root,
    request: corpus.cases.find((c) => c.intent === intent).request,
    mode,
    currentSnapshot: f.snapshot,
    adapterIdentity: identity,
    directAssignment: structuredClone(assignment),
    reviewDisposition: {
      required: ['implement', 'review', 'debug'].includes(intent),
      reason: 'Assessed current task against qa.md.',
    },
  };
}
function result(w) {
  const lane = w.lanes[0];
  return {
    resultId: 'result-1',
    dispatchId: lane.dispatchId,
    laneId: lane.id,
    owner: lane.owner,
    hostId: 'claude-code',
    adapterIdentity: identity,
    sourceSnapshot: w.currentSnapshot,
    status: 'complete',
    checks: ['actual source read'],
    findings: [],
    gaps: [],
    changedPaths: [],
  };
}
for (const session of corpus.sessions)
  for (const c of corpus.cases)
    test(`${c.intent}/${session.id}: same neutral conformance input through actual Claude composition`, (t) => {
      const i = { ...input(fixture(t), c.intent, session.id), request: session.prefix + c.request };
      const w = prepareClaudeWorkflow(i);
      const envelope = buildTaskEnvelope({ request: i.request });
      const contextPack = discoverContextPack({ envelope });
      assert.deepEqual(w.envelope, envelope);
      assert.deepEqual(w.contextPack, contextPack);
      assert.deepEqual(
        w.route,
        resolveWorkflowEntry({ envelope, contextPack, host: 'claude-code', mode: session.id }),
      );
      assert.equal(w.route.authorizedAction, c.action);
      assert.equal(w.dispatchAuthorized, false);
      assert.equal(w.runtimeQualified, false);
      assert.equal(w.native.status, 'not-ready');
      assert.deepEqual(
        w.laneValidation,
        validateBoundedLanes({
          envelope,
          contextPack,
          lanes: w.lanes,
          currentSnapshot: i.currentSnapshot,
        }),
      );
      const checked = validateClaudeWorkflowResults(i, { results: [result(w)] });
      assert.deepEqual(
        checked.fanIn,
        validateFanIn({
          envelope,
          contextPack,
          lanes: w.lanes,
          currentSnapshot: i.currentSnapshot,
          hostId: 'claude-code',
          adapterIdentity: identity,
          results: [result(w)],
        }),
      );
      assert.equal(checked.valid, !i.reviewDisposition.required);
      assert.equal(checked.runtimeQualified, false);
    });
test('authority, malformed assignments, missing bindings and stale/wrong result identities fail closed', (t) => {
  const f = fixture(t),
    i = input(f),
    w = prepareClaudeWorkflow(i);
  for (const intent of ['answer', 'analyze', 'review'])
    assert.throws(
      () =>
        prepareClaudeWorkflow({
          ...input(f, intent),
          directAssignment: { ...assignment, writeOwnership: ['apps/api'] },
        }),
      /write exceeds/,
    );
  assert.throws(
    () =>
      prepareClaudeWorkflow({
        ...input(f, 'debug'),
        request: '코드 수정 없이 API 오류 원인만 분석해줘.',
        directAssignment: { ...assignment, writeOwnership: ['apps/api'] },
      }),
    /write exceeds/,
  );
  assert.equal(
    prepareClaudeWorkflow({
      ...input(f, 'plan'),
      directAssignment: { ...assignment, writeOwnership: ['.plans/proposal.md'] },
    }).laneValidation.valid,
    true,
  );
  assert.throws(
    () =>
      prepareClaudeWorkflow({
        ...input(f, 'plan'),
        directAssignment: { ...assignment, writeOwnership: ['apps/api'] },
      }),
    /write exceeds/,
  );
  assert.throws(
    () => prepareClaudeWorkflow({ ...i, directAssignment: { ...assignment, native: true } }),
    /assignment/,
  );
  for (const field of [
    'directAssignment',
    'reviewDisposition',
    'adapterIdentity',
    'currentSnapshot',
  ]) {
    const missing = { ...i };
    delete missing[field];
    assert.equal(validateClaudeWorkflowResults(missing, { results: [result(w)] }).valid, false);
  }
  const r = result(w);
  for (const patch of [
    { hostId: 'codex' },
    { owner: 'other' },
    { dispatchId: 'old' },
    { adapterIdentity: { ...identity, configDigest: `sha256:${'e'.repeat(64)}` } },
    { sourceSnapshot: { ...f.snapshot, headSHA: 'f'.repeat(40) } },
    { changedPaths: ['apps/api'] },
    { status: 'cancelled', gaps: ['cancelled'] },
  ]) {
    assert.equal(validateClaudeWorkflowResults(i, { results: [{ ...r, ...patch }] }).valid, false);
  }
  assert.equal(validateClaudeWorkflowResults(i, { results: [r, r] }).valid, false);
  assert.equal(validateClaudeWorkflowResults(i, { results: [] }).valid, false);
  assert.equal(
    validateClaudeWorkflowResults(
      { ...i, currentSnapshot: { ...f.snapshot, headSHA: 'f'.repeat(40) } },
      { results: [r] },
    ).valid,
    false,
  );
});
test('resume reads explicit plan and binds continuation to live Git, not supplied current snapshot', (t) => {
  const f = fixture(t);
  mkdirSync(join(f.root, '.plans'));
  const planPath = '.plans/selected.md';
  writeFileSync(join(f.root, planPath), '- Plan ID: selected\n- Status: active\n');
  const i = {
    ...input(f, 'analyze', 'resume'),
    planPath,
    continuation: {
      expectedPlanId: 'selected',
      checkpointSnapshot: runClaudePreflight({ root: f.root }).snapshot,
    },
  };
  const w = prepareClaudeWorkflow(i);
  assert.equal(w.continuation.decision, 'candidate');
  assert.equal(validateClaudeWorkflowResults(i, { results: [result(w)] }).valid, true);
  writeFileSync(join(f.root, 'source.txt'), 'changed source\n');
  assert.equal(prepareClaudeWorkflow(i).continuation.decision, 'needs-review');
  assert.equal(validateClaudeWorkflowResults(i, { results: [result(w)] }).valid, false);
  writeFileSync(join(f.root, planPath), '- Plan ID: selected\n- Status: nope\n');
  assert.equal(prepareClaudeWorkflow(i).plan.state, 'unknown');
  assert.throws(() => prepareClaudeWorkflow({ ...i, mode: 'fresh' }), /resume/);
});
function qaCase(t) {
  const f = fixture(t),
    i = input(f, 'implement');
  const qa = JSON.parse(
    readFileSync(new URL('./fixtures/cross-model-handoff-cases.json', import.meta.url)),
  );
  i.directAssignment.owner = qa.basePacket.authority.writeOwner;
  i.directAssignment.writeOwnership = ['apps/api'];
  qa.basePacket.snapshot = f.snapshot;
  qa.baseResult.reviewedSnapshot = f.snapshot;
  qa.basePacket.objective = i.request;
  qa.basePacket.boundaries.allowedReadPaths.push('apps/api');
  qa.baseResult.acceptanceCoverage[0].criterion = assignment.acceptance[0];
  return {
    i,
    r: result(prepareClaudeWorkflow(i)),
    review: {
      requestDigest: prepareClaudeWorkflow(i).requestDigest,
      reviewerId: 'independent',
      builderIds: [i.directAssignment.owner],
      packet: qa.basePacket,
      result: qa.baseResult,
    },
  };
}
test('independent QA common validator is consumed; missing/self/stale/wrong-task/incomplete coverage cannot pass', (t) => {
  const { i, r, review } = qaCase(t);
  const valid = validateClaudeWorkflowResults(i, { results: [r], review });
  assert.equal(valid.valid, true, JSON.stringify(valid.errors));
  assert.deepEqual(
    valid.qa,
    validateAdapterReview({ ...review, currentSnapshot: i.currentSnapshot }),
  );
  assert.equal(valid.dispatchAuthorized, false);
  assert.equal(validateClaudeWorkflowResults(i, { results: [r] }).valid, false);
  for (const alter of [
    (q) => {
      q.reviewerId = i.directAssignment.owner;
    },
    (q) => {
      q.builderIds = ['another-builder'];
    },
    (q) => {
      q.packet.objective = 'different task';
    },
    (q) => {
      q.result.reviewedSnapshot.headSHA = 'f'.repeat(40);
    },
    (q) => {
      q.packet.review.freshContext = false;
    },
    (q) => {
      q.result.acceptanceCoverage = [null];
    },
    (q) => {
      q.result.acceptanceCoverage = {};
    },
    (q) => {
      q.result.acceptanceCoverage[0].criterion = 'other criterion';
    },
    (q) => {
      q.packet.boundaries.allowedReadPaths = ['docs'];
    },
    (q) => {
      q.result.verdict = 'BLOCKED';
    },
    (q) => {
      q.result.verdict = 'FAIL';
    },
  ]) {
    const changed = structuredClone(review);
    alter(changed);
    assert.equal(validateClaudeWorkflowResults(i, { results: [r], review: changed }).valid, false);
  }
});
test('plan readiness stays common, Plan-only and non-authorizing', (t) => {
  const f = fixture(t),
    planReadiness = JSON.parse(
      readFileSync(
        new URL('../agents/fixtures/plan-readiness/implementation-ready.json', import.meta.url),
      ),
    );
  const w = prepareClaudeWorkflow({ ...input(f, 'plan'), planReadiness });
  assert.equal(w.planReadiness.ready, true);
  assert.equal(w.dispatchAuthorized, false);
  assert.throws(() => prepareClaudeWorkflow({ ...input(f), planReadiness }), /plan intent/);
});
test('native request and caller-supplied supported reports never authorize dispatch or fall back', (t) => {
  const i = input(fixture(t), 'analyze');
  const w = prepareClaudeWorkflow({
    ...i,
    nativeRequest: {},
    reportedRuntimeEvidence: {
      support: 'supported',
      dispatchAuthorized: true,
      runtimeQualified: true,
    },
  });
  assert.equal(w.native.status, 'not-ready');
  assert.equal(w.native.requestStatus, 'blocked');
  assert.equal(w.native.profileAssessment.eligible, false);
  assert.equal(w.native.binding, null);
  assert.equal(w.dispatchAuthorized, false);
  assert.equal(w.runtimeQualified, false);
  assert.equal(
    validateClaudeWorkflowResults({ ...i, nativeRequest: {} }, { results: [result(w)] }).valid,
    false,
  );
  assert.throws(
    () =>
      prepareClaudeWorkflow({
        ...i,
        dispatch: () => {
          throw Error('must not call');
        },
      }),
    /unsupported/,
  );
});
test('actual CLI routes full neutral intent corpus with no provider, OMX or private Home access', (t) => {
  const f = fixture(t),
    bin = join(f.root, 'bin');
  mkdirSync(bin);
  for (const name of ['claude', 'codex', 'omx', 'omc'])
    writeFileSync(join(bin, name), '#!/bin/sh\nprintf called >> "$PWD/process-calls"\nexit 99\n', {
      mode: 0o755,
    });
  const env = {
    ...process.env,
    HOME: join(f.root, 'absent-home'),
    PATH: `${bin}:${process.env.PATH}`,
  };
  for (const s of corpus.sessions)
    for (const c of corpus.cases) {
      const p = spawnSync(
        process.execPath,
        [cli, '--request', s.prefix + c.request, '--mode', s.id, '--json'],
        { cwd: f.root, env, encoding: 'utf8', timeout: 10000 },
      );
      assert.equal(p.status, 0, p.stderr);
      const w = JSON.parse(p.stdout);
      assert.equal(w.route.intent, c.intent);
      assert.equal(w.route.authorizedAction, c.action);
      assert.equal(w.preflight.baseline.head, f.snapshot.headSHA);
      assert.equal(w.plan, null);
      assert.equal(w.runtimeQualified, false);
    }
  const blocked = spawnSync(
    process.execPath,
    [cli, '--request', corpus.cases[0].request, '--mode', 'fresh', '--native'],
    { cwd: f.root, env, encoding: 'utf8' },
  );
  assert.equal(blocked.status, 2);
  assert.equal(JSON.parse(blocked.stdout).native.requestStatus, 'blocked');
  assert.equal(existsSync(join(f.root, 'process-calls')), false);
  assert.equal(existsSync(env.HOME), false);
  for (const args of [
    ['--mode', 'fresh'],
    ['--request', 'hello', '--mode', 'auto'],
    ['--request', 'hello', '--mode', 'fresh', '--mode', 'resume'],
  ])
    assert.equal(
      spawnSync(process.execPath, [cli, ...args], { cwd: f.root, encoding: 'utf8' }).status,
      1,
    );
});
test('static Claude model selection is consumed but never upgrades the strict native gate', (t) => {
  const i = {
    ...input(fixture(t), 'implement'),
    request: 'scripts/agents/claude 계약을 구현해줘.',
  };
  const nativeRequest = {
    profileId: 'bounded-standard',
    selectedBy: 'lead',
    selectionBasisRef: 'docs/development/agent-workflows/qa.md',
    issuedAt: '2026-09-27T01:00:00.000Z',
    expiresAt: '2026-09-27T01:20:00.000Z',
    task: {
      taskId: 'static-build',
      kind: 'build',
      impactRisk: 'medium',
      complexity: 'bounded',
      uncertainty: 'resolved',
      role: 'repo_executor',
      allowedTools: ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'Bash'],
      readScope: ['scripts/agents/claude'],
      writeScope: ['scripts/agents/claude'],
      writeOwner: 'builder',
      childValue: 'independent-verification',
      independent: true,
      knownGaps: [],
      facts: [
        'source-bound',
        'bounded-scope',
        'acceptance',
        'oracle',
        'independent-qa',
        'regression',
        'one-writer',
      ].map((key) => ({
        key,
        sourceRef: 'docs/development/agent-workflows/qa.md',
        confidence: 'high',
      })),
    },
  };
  const w = prepareClaudeWorkflow({ ...i, nativeRequest });
  assert.equal(w.native.profileAssessment.eligible, true);
  assert.equal(w.native.binding.requestedModelAlias, 'sonnet');
  assert.equal(w.native.binding.requestId, w.envelope.requestId);
  assert.equal(w.native.binding.sourceDigest, identity.sourceDigest);
  assert.equal(w.native.binding.configDigest, identity.configDigest);
  assert.equal(Object.isFrozen(w.native.binding), true);
  assert.equal(w.native.requestStatus, 'blocked');
  assert.equal(w.dispatchAuthorized, false);
  for (const patch of [
    { profileId: 'unknown' },
    { selectedBy: 'child' },
    { requestedModel: 'opus' },
    { envelope: w.envelope },
    { configDigest: `sha256:${'e'.repeat(64)}` },
    { task: { ...nativeRequest.task, allowedTools: ['Agent'] } },
  ]) {
    const bad = prepareClaudeWorkflow({
      ...i,
      nativeRequest: { ...nativeRequest, ...patch },
      reportedRuntimeEvidence: {
        support: 'supported',
        role: 'repo_executor',
        requestedAlias: 'sonnet',
      },
    });
    assert.equal(bad.native.profileAssessment.eligible, false);
    assert.equal(bad.native.binding, null);
    assert.equal(bad.native.requestStatus, 'blocked');
  }
});
test('dirty source digest binds actual tracked diff, not merely any supplied non-null hash', (t) => {
  const f = fixture(t),
    i = input(f);
  writeFileSync(join(f.root, 'source.txt'), 'first edit\n');
  const first = runClaudePreflight({ root: f.root });
  i.currentSnapshot = { ...f.snapshot, dirtyDiffDigest: `sha256:${first.baseline.diffHash}` };
  const w = prepareClaudeWorkflow(i),
    r = result(w);
  assert.equal(validateClaudeWorkflowResults(i, { results: [r] }).valid, true);
  writeFileSync(join(f.root, 'source.txt'), 'second edit\n');
  const stale = validateClaudeWorkflowResults(i, { results: [r] });
  assert.equal(stale.valid, false);
  assert.ok(stale.errors.includes('current-source-diff-mismatch'));
  writeFileSync(join(f.root, 'source.txt'), 'baseline\n');
  assert.ok(prepareClaudeWorkflow(i).gaps.includes('current-source-diff-mismatch'));
});
test('CLI explicit selected plan can consume a bounded checkpoint, never restores mutation authority', (t) => {
  const f = fixture(t);
  mkdirSync(join(f.root, '.plans'));
  const planPath = '.plans/selected.md';
  writeFileSync(join(f.root, planPath), '- Plan ID: selected\n- Status: active\n');
  const continuation = {
    expectedPlanId: 'selected',
    checkpointSnapshot: runClaudePreflight({ root: f.root }).snapshot,
  };
  const args = [
    cli,
    '--request',
    corpus.cases[1].request,
    '--mode',
    'resume',
    '--plan',
    planPath,
    '--continuation',
    JSON.stringify(continuation),
  ];
  const good = spawnSync(process.execPath, args, { cwd: f.root, encoding: 'utf8' });
  assert.equal(good.status, 0, good.stderr);
  assert.equal(JSON.parse(good.stdout).continuation.decision, 'candidate');
  assert.equal(JSON.parse(good.stdout).route.authorizedAction, 'produce-analysis');
  writeFileSync(join(f.root, 'source.txt'), 'changed source\n');
  const stale = spawnSync(process.execPath, args, { cwd: f.root, encoding: 'utf8' });
  assert.equal(stale.status, 1);
  assert.equal(JSON.parse(stale.stdout).continuation.decision, 'needs-review');
});
test('exports and package scripts point to real Claude entries without host policy imports', async () => {
  const entry = await import('../agents/claude/index.mjs');
  assert.equal(entry.runClaudePreflight, runClaudePreflight);
  assert.equal(entry.prepareClaudeWorkflow, prepareClaudeWorkflow);
  assert.equal(entry.validateClaudeWorkflowResults, validateClaudeWorkflowResults);
  const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url)));
  assert.equal(
    manifest.scripts['claude:workflow'],
    'node scripts/agents/claude/workflow-entry.mjs',
  );
  assert.equal(
    manifest.scripts['claude:preflight'],
    'node scripts/agents/claude/session-preflight.mjs --json',
  );
  for (const path of ['workflow-entry.mjs', 'session-preflight.mjs']) {
    const source = readFileSync(new URL(`../agents/claude/${path}`, import.meta.url), 'utf8');
    assert.doesNotMatch(
      source,
      /(?:from|import)\s*['"][^'"]*(?:\/codex\/|\.omx|\.omc)|homedir\(|\.claude\//u,
    );
  }
});

test('portable lane and QA objectives reuse sanitized common summary, never raw request secrets', (t) => {
  const { i, review } = qaCase(t);
  i.request = 'API 응답에 필드를 추가해줘. token=fixture-secret user@example.invalid';
  const workflow = prepareClaudeWorkflow(i);
  assert.equal(workflow.lanes[0].objective, workflow.envelope.requestSummary);
  assert.doesNotMatch(JSON.stringify(workflow), /fixture-secret|user@example\.invalid/u);
  review.packet.objective = workflow.envelope.requestSummary;
  review.requestDigest = workflow.requestDigest;
  const r = result(workflow);
  const checked = validateClaudeWorkflowResults(i, { results: [r], review });
  assert.equal(checked.valid, true, JSON.stringify(checked.errors));
  assert.doesNotMatch(JSON.stringify(checked), /fixture-secret|user@example\.invalid/u);
  review.packet.objective = i.request;
  assert.equal(validateClaudeWorkflowResults(i, { results: [r], review }).valid, false);
});

test('full request identity rejects replay after the sanitized summary truncation boundary', (t) => {
  const { i, review } = qaCase(t);
  i.request = `계약을 구현해줘. ${'공통 검증 조건 설명 '.repeat(25)}target-alpha`;
  const a = prepareClaudeWorkflow(i);
  review.packet.objective = a.envelope.requestSummary;
  review.requestDigest = a.requestDigest;
  const ra = result(a);
  assert.equal(validateClaudeWorkflowResults(i, { results: [ra], review }).valid, true);
  const j = { ...i, request: i.request.replace('target-alpha', 'target-beta') };
  const b = prepareClaudeWorkflow(j);
  assert.equal(a.envelope.requestSummary, b.envelope.requestSummary);
  assert.equal(validateClaudeWorkflowResults(j, { results: [ra], review }).valid, false);
  assert.equal(validateClaudeWorkflowResults(j, { results: [result(b)], review }).valid, false);
  review.requestDigest = b.requestDigest;
  assert.equal(validateClaudeWorkflowResults(j, { results: [result(b)], review }).valid, true);
});
