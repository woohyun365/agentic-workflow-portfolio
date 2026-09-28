import assert from 'node:assert/strict';
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  mkdtempSync,
  symlinkSync,
  readdirSync,
  rmSync,
  realpathSync,
} from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import test from 'node:test';
import { fixture } from './fixtures/claude-native-qualification-fixture.mjs';
import {
  registerClaudeNativeTask,
  handleClaudeNativeSessionEvent,
  completeClaudeNativeTask,
  releaseClaudeNativeTask,
} from '../agents/claude/native-session.mjs';

function setup(t) {
  const f = fixture(t);
  writeFileSync(join(f.root, '.git/info/exclude'), 'artifacts/\n');
  const sessionId = randomUUID();
  const registered = registerClaudeNativeTask({ ...f.options, workflowInput: f.input, sessionId });
  const event = {
    hook_event_name: 'PreToolUse',
    session_id: sessionId,
    cwd: f.root,
    permission_mode: 'auto',
    tool_name: 'Agent',
    tool_use_id: 'tool-1',
    tool_input: registered.invocation,
  };
  return { ...f, registered, event };
}
function raw(f, event = f.event) {
  return handleClaudeNativeSessionEvent(event, { root: f.root });
}
// Host order for repo_* Agent calls under the project ask rule: PreToolUse, then PermissionRequest.
function handle(f, event = f.event) {
  const output = raw(f, event);
  if (
    event.hook_event_name === 'PreToolUse' &&
    event.tool_name === 'Agent' &&
    !output?.hookSpecificOutput?.permissionDecision
  ) {
    const { tool_use_id: _toolUseId, ...rest } = event;
    raw(f, { ...rest, hook_event_name: 'PermissionRequest' });
  }
  return output;
}
function finish(f, patch = {}) {
  return handle(f, {
    ...f.event,
    hook_event_name: 'PostToolUse',
    tool_response: {
      status: 'completed',
      agentId: 'child-1',
      resolvedModel: f.options.expectedResolvedModel,
      content: [{ type: 'text', text: 'oracle' }],
      ...patch,
    },
  });
}

test('auto PreToolUse validates selected model and returns no decision before the ask-rule grant', (t) => {
  const f = setup(t);
  assert.deepEqual(handle(f), {});
  assert.equal(f.registered.invocation.model, 'haiku');
  assert.equal(Object.hasOwn(f.registered.invocation, 'run_in_background'), false);
  assert.equal(f.registered.workflow.native.requestStatus, 'eligible');
  assert.equal(f.registered.workflow.dispatchAuthorized, false);
  assert.equal(f.registered.workflow.runtimeQualified, false);
  assert.match(f.registered.invocation.prompt, /REPO_NATIVE_TASK/);
});
for (const [name, mutate] of [
  ['missing model', (e) => delete e.tool_input.model],
  ['wrong model', (e) => (e.tool_input.model = 'opus')],
  ['foreign session', (e) => (e.session_id = randomUUID())],
  ['permission drift', (e) => (e.permission_mode = 'bypassPermissions')],
  ['foreign role', (e) => (e.tool_input.subagent_type = 'repo_reviewer')],
  ['unregistered', (e) => (e.tool_input.prompt = 'no registration')],
  ['background', (e) => (e.tool_input.run_in_background = true)],
  ['missing tool id', (e) => delete e.tool_use_id],
  ['prompt drift', (e) => (e.tool_input.prompt = 'changed\n' + e.tool_input.prompt)],
])
  test(`auto rejects ${name}`, (t) => {
    const f = setup(t);
    mutate(f.event);
    assert.equal(handle(f).hookSpecificOutput.permissionDecision, 'deny');
  });
test('stale source denied before dispatch without requiring a clean checkout', (t) => {
  const f = setup(t);
  writeFileSync(join(f.root, 'sample.txt'), 'different');
  assert.equal(handle(f).hookSpecificOutput.permissionDecision, 'deny');
});
test('replayed task is denied; unrelated OMC role remains outside Repo policy', (t) => {
  const f = setup(t);
  assert.deepEqual(handle(f), {});
  assert.equal(handle(f).hookSpecificOutput.permissionDecision, 'deny');
  assert.deepEqual(
    handle(f, {
      ...f.event,
      tool_input: {
        subagent_type: 'oh-my-claudecode:planner',
        model: 'opus',
        prompt: 'own policy',
      },
    }),
    {},
  );
});
test('healthy same-run completion is observed but not semantic success', (t) => {
  const f = setup(t);
  handle(f);
  finish(f);
  const status = completeClaudeNativeTask(f.registered.taskId, {}, { root: f.root });
  assert.equal(status.observation.valid, true);
  assert.equal(status.valid, false);
  assert.equal(status.runtimeQualified, false);
});
for (const patch of [
  { resolvedModel: 'claude-opus-4-6' },
  { status: 'async_launched' },
  { modelsUsed: ['claude-opus-4-6'] },
  { agentId: '' },
  { content: [] },
])
  test(`completion rejects ${JSON.stringify(patch)}`, (t) => {
    const f = setup(t);
    handle(f);
    finish(f, patch);
    assert.equal(
      completeClaudeNativeTask(f.registered.taskId, {}, { root: f.root }).observation.valid,
      false,
    );
  });
test('posttool without healthy pretool cannot complete', (t) => {
  const f = setup(t);
  finish(f);
  assert.equal(completeClaudeNativeTask(f.registered.taskId, {}, { root: f.root }).valid, false);
});
test('settings connect real project hooks without overriding auto/Home/plugins/tools', () => {
  const settings = JSON.parse(
    readFileSync(new URL('../../.claude/settings.json', import.meta.url)),
  );
  assert.deepEqual(Object.keys(settings), ['permissions', 'hooks']);
  // Only explicit ask rules for Repo roles: no allow/deny/defaultMode override of auto or Home.
  assert.deepEqual(settings.permissions, {
    ask: [
      'Agent(repo_executor)',
      'Agent(repo_explorer)',
      'Agent(repo_researcher)',
      'Agent(repo_reviewer)',
    ],
  });
  assert.deepEqual(Object.keys(settings.hooks), [
    'SessionStart',
    'PreToolUse',
    'PermissionRequest',
    'PostToolUse',
    'PostToolUseFailure',
    'SubagentStop',
  ]);
  assert.equal(settings.hooks.PreToolUse[0].matcher, 'Agent|SendMessage');
  assert.equal(settings.hooks.PermissionRequest[0].matcher, 'Agent');
  assert.equal(settings.hooks.PostToolUse[0].matcher, 'Agent');
});

function semanticResult(f) {
  const path = join(f.registered.evidenceDirectory, 'completion.json');
  const observed = JSON.parse(readFileSync(path));
  const w = f.registered.workflow,
    lane = w.lanes[0];
  return {
    responseDigest: observed.responseDigest,
    acceptance: [
      { criterion: lane.acceptance[0], passed: true, evidenceRef: 'fixture:independent-oracle' },
    ],
    results: [
      {
        resultId: 'actual-1',
        dispatchId: lane.dispatchId,
        laneId: lane.id,
        owner: lane.owner,
        hostId: 'claude-code',
        adapterIdentity: w.adapterIdentity,
        sourceSnapshot: observed.finalSnapshot,
        status: 'complete',
        checks: ['independent oracle compared'],
        findings: [],
        gaps: [],
        changedPaths: [],
      },
    ],
  };
}
test('same response + independently checked acceptance completes common contract, never grants host authority', (t) => {
  const f = setup(t);
  handle(f);
  finish(f);
  const checked = completeClaudeNativeTask(f.registered.taskId, semanticResult(f), {
    root: f.root,
  });
  assert.equal(checked.valid, true, JSON.stringify(checked.errors));
  assert.equal(checked.dispatchAuthorized, false);
  assert.equal(checked.runtimeQualified, false);
});
test('foreign digest, missing criterion, partial result or later source changes cannot complete', (t) => {
  const f = setup(t);
  handle(f);
  finish(f);
  const input = semanticResult(f);
  assert.equal(completeClaudeNativeTask(f.registered.taskId, input, { root: f.root }).valid, true);
  for (const update of [
    { responseDigest: 'wrong' },
    { acceptance: [] },
    { results: [{ ...input.results[0], status: 'partial', gaps: ['unfinished'] }] },
  ])
    assert.equal(
      completeClaudeNativeTask(f.registered.taskId, { ...input, ...update }, { root: f.root })
        .valid,
      false,
    );
  writeFileSync(join(f.root, 'sample.txt'), 'late change');
  assert.equal(completeClaudeNativeTask(f.registered.taskId, input, { root: f.root }).valid, false);
});
test('ambient forced model conflict denied without scrubbing the normal environment', (t) => {
  const f = setup(t);
  const old = [
    process.env.CLAUDE_CODE_SUBAGENT_MODEL_FORCE,
    process.env.CLAUDE_CODE_SUBAGENT_MODEL,
  ];
  try {
    process.env.CLAUDE_CODE_SUBAGENT_MODEL_FORCE = '1';
    process.env.CLAUDE_CODE_SUBAGENT_MODEL = 'opus';
    assert.match(handle(f).hookSpecificOutput.permissionDecisionReason, /forced model/);
  } finally {
    for (const [key, value] of [
      ['CLAUDE_CODE_SUBAGENT_MODEL_FORCE', old[0]],
      ['CLAUDE_CODE_SUBAGENT_MODEL', old[1]],
    ]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
test('expired registration and task/lane ownership disagreement reject before writing task state', (t) => {
  const f = fixture(t);
  const base = { ...f.options, workflowInput: f.input, sessionId: randomUUID() };
  f.input.nativeRequest.issuedAt = new Date(Date.now() - 120000).toISOString();
  f.input.nativeRequest.expiresAt = new Date(Date.now() - 60000).toISOString();
  assert.throws(() => registerClaudeNativeTask(base), /expired/);
  f.input.nativeRequest.issuedAt = new Date(Date.now() - 1000).toISOString();
  f.input.nativeRequest.expiresAt = new Date(Date.now() + 60000).toISOString();
  f.input.directAssignment.writeOwnership = ['sample.txt'];
  assert.throws(() => registerClaudeNativeTask(base));
});

test('completion receipt cannot be replayed to another task with no pre/post', (t) => {
  const f = setup(t);
  handle(f);
  finish(f);
  const another = registerClaudeNativeTask({
    ...f.options,
    workflowInput: f.input,
    sessionId: f.event.session_id,
  });
  writeFileSync(
    join(another.evidenceDirectory, 'completion.json'),
    readFileSync(join(f.registered.evidenceDirectory, 'completion.json')),
  );
  const g = { ...f, registered: another };
  assert.equal(
    completeClaudeNativeTask(another.taskId, semanticResult(g), { root: f.root }).valid,
    false,
  );
});
test('read-only child actual mutation cannot be hidden with empty reported changedPaths', (t) => {
  const f = setup(t);
  handle(f);
  writeFileSync(join(f.root, 'sample.txt'), 'unauthorized mutation');
  finish(f);
  assert.equal(
    completeClaudeNativeTask(f.registered.taskId, semanticResult(f), { root: f.root }).valid,
    false,
  );
});

test('registration rejects artifact ancestor symlink before writing outside repository', (t) => {
  const f = fixture(t);
  const outside = mkdtempSync(join(tmpdir(), 'native-outside-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  writeFileSync(join(f.root, '.git/info/exclude'), 'artifacts/\n');
  mkdirSync(join(f.root, 'artifacts/local'), { recursive: true });
  symlinkSync(outside, join(f.root, 'artifacts/local/claude-native'));
  assert.throws(
    () =>
      registerClaudeNativeTask({ ...f.options, workflowInput: f.input, sessionId: randomUUID() }),
    /ancestor symlink/,
  );
  assert.deepEqual(readdirSync(outside), []);
});
function writer(t) {
  const f = fixture(t);
  writeFileSync(join(f.root, '.git/info/exclude'), 'artifacts/\n');
  writeFileSync(
    join(f.root, '.claude/agents/repo_executor.md'),
    '---\nname: repo_executor\ntools: Read, Grep, Glob, Edit, Write, Bash\n---\nImplement bounded work.\n',
  );
  writeFileSync(
    join(f.root, '.claude/agents/repo_reviewer.md'),
    '---\nname: repo_reviewer\ntools: Read, Grep, Glob\n---\nReview only.\n',
  );
  execFileSync('git', ['add', '.'], { cwd: f.root });
  delete f.input.currentSnapshot;
  f.input.request = 'sample.txt 변경을 구현해줘.';
  f.input.directAssignment.writeOwnership = ['sample.txt'];
  f.input.directAssignment.owner = 'builder';
  f.input.reviewDisposition.required = true;
  f.input.nativeRequest.profileId = 'bounded-standard';
  Object.assign(f.input.nativeRequest.task, {
    kind: 'build',
    impactRisk: 'medium',
    role: 'repo_executor',
    allowedTools: ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'Bash'],
    writeScope: ['sample.txt'],
    writeOwner: 'builder',
    facts: [
      'source-bound',
      'bounded-scope',
      'acceptance',
      'oracle',
      'independent-qa',
      'regression',
      'one-writer',
    ].map((key) => ({ key, sourceRef: 'fixture', confidence: 'high' })),
  });
  f.options.expectedResolvedModel = 'claude-sonnet-5';
  const sessionId = randomUUID();
  const registered = registerClaudeNativeTask({ ...f.options, workflowInput: f.input, sessionId });
  return {
    ...f,
    registered,
    event: {
      hook_event_name: 'PreToolUse',
      session_id: sessionId,
      cwd: f.root,
      permission_mode: 'auto',
      tool_name: 'Agent',
      tool_use_id: 'write-1',
      tool_input: registered.invocation,
    },
  };
}

function reviewPacket(subject, snapshot) {
  const { basePacket } = JSON.parse(
    readFileSync(join(import.meta.dirname, 'fixtures/cross-model-handoff-cases.json')),
  );
  return {
    ...structuredClone(basePacket),
    packetId: 'native-review-packet',
    objective: subject.registered.workflow.envelope.requestSummary,
    snapshot,
    authority: {
      ...basePacket.authority,
      integrationOwner: 'parent',
      writeOwner: 'builder',
      runnerOwner: 'parent',
      parentClarificationOwner: 'parent',
    },
    boundaries: {
      ...basePacket.boundaries,
      allowedReadPaths: ['sample.txt'],
      permittedOutputPaths: ['artifacts/local/claude-native'],
    },
    lifecycle: {
      ...basePacket.lifecycle,
      dispatchId: 'native-review-dispatch',
      cancelOwner: 'parent',
      cleanupOwner: 'parent',
    },
    intent: { ...basePacket.intent, direction: 'same-host-independent-review' },
  };
}

function reviewResult(packet, model, verdict = 'PASS') {
  const { baseResult } = JSON.parse(
    readFileSync(join(import.meta.dirname, 'fixtures/cross-model-handoff-cases.json')),
  );
  return {
    ...structuredClone(baseResult),
    packetId: packet.packetId,
    dispatchId: packet.lifecycle.dispatchId,
    resultId: 'native-review-result',
    reviewedSnapshot: packet.snapshot,
    identity: {
      requestedModelIntent: packet.intent.modelIntent,
      resolvedModel: model,
      observedModel: model,
    },
    acceptanceCoverage: [
      {
        criterion: 'oracle returned',
        sourceRefs: ['fixture'],
        evidenceRefs: ['fixture:review'],
        gap: null,
      },
    ],
    commandsActuallyRun: [],
    verdict,
    disposition: { owner: 'parent', nextAction: 'Adjudicate the native review.' },
    cleanup: { owner: 'parent', status: 'complete', handoff: 'No cleanup required.' },
    handoff: { integrationOwner: 'parent', requestedWriteOwner: null },
  };
}

function reviewer(t, subject, packet, options = {}) {
  const input = structuredClone(subject.input);
  input.request = 'sample.txt 변경을 독립 검토해줘.';
  input.currentSnapshot = options.currentSnapshot ?? packet.snapshot;
  input.directAssignment = {
    owner: 'reviewer',
    dispatchId: 'native-review-lane',
    acceptance: ['review subject acceptance'],
    writeOwnership: [],
  };
  input.reviewDisposition = { required: false, reason: 'terminal independent native review' };
  input.nativeRequest.profileId = 'complex-critical';
  Object.assign(input.nativeRequest.task, {
    taskId: 'review-task',
    kind: 'review',
    impactRisk: 'medium',
    complexity: 'bounded',
    uncertainty: 'resolved',
    role: 'repo_reviewer',
    allowedTools: ['Read', 'Grep', 'Glob'],
    readScope: options.readScope ?? ['sample.txt'],
    writeScope: [],
    writeOwner: null,
    childValue: 'independent-review',
    independent: true,
    facts: [
      'source-bound',
      'bounded-scope',
      'acceptance',
      'oracle',
      'independent-qa',
      'fresh-context',
    ].map((key) => ({ key, sourceRef: 'fixture', confidence: 'high' })),
  });
  const expectedResolvedModel = 'claude-opus-4-6';
  const registered = registerClaudeNativeTask({
    workflowInput: input,
    sessionId: subject.event.session_id,
    prompt: 'Review the frozen subject packet only.',
    expectedResolvedModel,
    independentReview: {
      subjectTaskId: subject.registered.taskId,
      reviewerId: 'reviewer',
      builderIds: ['builder'],
      packet,
      ...options.independentReview,
    },
  });
  return {
    ...subject,
    input,
    options: { ...subject.options, expectedResolvedModel },
    registered,
    event: {
      ...subject.event,
      tool_use_id: 'review-1',
      tool_input: registered.invocation,
    },
  };
}

test('terminal native reviewer receipt completes its subject without recursive QA', (t) => {
  const subject = writer(t);
  handle(subject);
  writeFileSync(join(subject.root, 'sample.txt'), 'allowed output');
  finish(subject);
  const subjectObservation = JSON.parse(
    readFileSync(join(subject.registered.evidenceDirectory, 'completion.json')),
  );
  const packet = reviewPacket(subject, subjectObservation.finalSnapshot);
  const qa = reviewer(t, subject, packet);
  const result = reviewResult(packet, qa.options.expectedResolvedModel);
  assert.match(qa.registered.invocation.prompt, /native-review-packet/);
  handle(qa);
  finish(qa, { content: [{ type: 'text', text: JSON.stringify(result) }] });
  const qaSemantic = semanticResult(qa);
  qaSemantic.reviewResult = result;
  assert.equal(
    completeClaudeNativeTask(qa.registered.taskId, qaSemantic, { root: qa.root }).valid,
    true,
  );
  const subjectSemantic = semanticResult(subject);
  subjectSemantic.results[0].changedPaths = ['sample.txt'];
  subjectSemantic.reviewerTaskId = qa.registered.taskId;
  assert.equal(
    completeClaudeNativeTask(subject.registered.taskId, subjectSemantic, { root: subject.root })
      .valid,
    true,
  );
  const rawReviewOnly = structuredClone(subjectSemantic);
  delete rawReviewOnly.reviewerTaskId;
  rawReviewOnly.review = {
    requestDigest: subject.registered.workflow.requestDigest,
    reviewerId: 'reviewer',
    builderIds: ['builder'],
    packet,
    result,
  };
  assert.equal(
    completeClaudeNativeTask(subject.registered.taskId, rawReviewOnly, { root: subject.root })
      .valid,
    false,
  );
  releaseClaudeNativeTask(qa.registered.taskId, { root: qa.root, ended: true });
  assert.equal(
    completeClaudeNativeTask(subject.registered.taskId, subjectSemantic, { root: subject.root })
      .valid,
    false,
  );
});

test('terminal reviewer rejects self, stale packet, missing observation and raw review override', (t) => {
  const missing = writer(t);
  const missingPacket = reviewPacket(missing, missing.registered.workflow.currentSnapshot);
  assert.throws(() => reviewer(t, missing, missingPacket), /completion\.json|observation/);

  const subject = writer(t);
  handle(subject);
  writeFileSync(join(subject.root, 'sample.txt'), 'allowed output');
  finish(subject);
  const observation = JSON.parse(
    readFileSync(join(subject.registered.evidenceDirectory, 'completion.json')),
  );
  const packet = reviewPacket(subject, observation.finalSnapshot);
  assert.throws(
    () =>
      reviewer(t, subject, packet, {
        independentReview: { builderIds: ['builder', 'reviewer'] },
      }),
    /independent/,
  );
  const stale = structuredClone(packet);
  stale.snapshot.headSHA = 'f'.repeat(40);
  assert.throws(
    () => reviewer(t, subject, stale, { currentSnapshot: observation.finalSnapshot }),
    /stale/,
  );
  const crossHost = structuredClone(packet);
  crossHost.intent.direction = 'codex-maker-claude-checker';
  assert.throws(() => reviewer(t, subject, crossHost), /same-host/);
  const manual = structuredClone(packet);
  manual.lifecycle.transport = 'manual';
  assert.throws(() => reviewer(t, subject, manual), /native/);

  const qa = reviewer(t, subject, packet);
  const result = reviewResult(packet, 'unknown');
  const subjectSemantic = semanticResult(subject);
  subjectSemantic.results[0].changedPaths = ['sample.txt'];
  subjectSemantic.reviewerTaskId = qa.registered.taskId;
  assert.equal(
    completeClaudeNativeTask(subject.registered.taskId, subjectSemantic, { root: subject.root })
      .valid,
    false,
  );
  const foreign = structuredClone(subjectSemantic);
  foreign.reviewerTaskId = randomUUID();
  assert.equal(
    completeClaudeNativeTask(subject.registered.taskId, foreign, { root: subject.root }).valid,
    false,
  );
  handle(qa);
  finish(qa, { content: [{ type: 'text', text: JSON.stringify(result) }] });
  const qaSemantic = semanticResult(qa);
  qaSemantic.reviewResult = { ...result, verdict: 'FAIL' };
  assert.equal(
    completeClaudeNativeTask(qa.registered.taskId, qaSemantic, { root: qa.root }).valid,
    false,
  );
  qaSemantic.reviewResult = result;
  assert.equal(
    completeClaudeNativeTask(qa.registered.taskId, qaSemantic, { root: qa.root }).valid,
    true,
  );
  finish(qa, { content: [{ type: 'text', text: JSON.stringify(result) }] });
  assert.equal(
    completeClaudeNativeTask(subject.registered.taskId, subjectSemantic, { root: subject.root })
      .valid,
    false,
  );
  subjectSemantic.review = {
    requestDigest: subject.registered.workflow.requestDigest,
    reviewerId: 'builder',
  };
  const overridden = completeClaudeNativeTask(subject.registered.taskId, subjectSemantic, {
    root: subject.root,
  });
  assert.equal(overridden.valid, false);
  assert.ok(overridden.errors.includes('native reviewer link cannot override review payload'));
});

test('terminal reviewer records complete FAIL but rejects partial BLOCKED and cannot pass builder', (t) => {
  const subject = writer(t);
  handle(subject);
  writeFileSync(join(subject.root, 'sample.txt'), 'allowed output');
  finish(subject);
  const observation = JSON.parse(
    readFileSync(join(subject.registered.evidenceDirectory, 'completion.json')),
  );
  const packet = reviewPacket(subject, observation.finalSnapshot);
  const failedQa = reviewer(t, subject, packet);
  const failedResult = reviewResult(packet, 'unknown', 'FAIL');
  handle(failedQa);
  finish(failedQa, { content: [{ type: 'text', text: JSON.stringify(failedResult) }] });
  const failedSemantic = semanticResult(failedQa);
  failedSemantic.reviewResult = failedResult;
  assert.equal(
    completeClaudeNativeTask(failedQa.registered.taskId, failedSemantic, {
      root: failedQa.root,
    }).valid,
    true,
  );
  const subjectSemantic = semanticResult(subject);
  subjectSemantic.results[0].changedPaths = ['sample.txt'];
  subjectSemantic.reviewerTaskId = failedQa.registered.taskId;
  assert.equal(
    completeClaudeNativeTask(subject.registered.taskId, subjectSemantic, { root: subject.root })
      .valid,
    false,
  );

  const blockedQa = reviewer(t, subject, packet);
  const blockedResult = {
    ...reviewResult(packet, 'unknown'),
    status: 'partial',
    verdict: 'BLOCKED',
    blocker: 'Reviewer did not finish.',
  };
  handle(blockedQa);
  finish(blockedQa, { content: [{ type: 'text', text: JSON.stringify(blockedResult) }] });
  const blockedSemantic = semanticResult(blockedQa);
  blockedSemantic.reviewResult = blockedResult;
  assert.equal(
    completeClaudeNativeTask(blockedQa.registered.taskId, blockedSemantic, {
      root: blockedQa.root,
    }).valid,
    false,
  );
});
test('read-only reviewer cites runner-owned checks as runner commands; unexecuted checks block PASS', (t) => {
  const subject = writer(t);
  handle(subject);
  writeFileSync(join(subject.root, 'sample.txt'), 'allowed output');
  finish(subject);
  const observation = JSON.parse(
    readFileSync(join(subject.registered.evidenceDirectory, 'completion.json')),
  );
  const packet = reviewPacket(subject, observation.finalSnapshot);
  packet.authority.runnerOwner = 'parent';
  const runnerCommand = (runner) => ({
    runner,
    exit: 0,
    observedResult: 'node --test sample: 1 pass',
    environment: 'node, same reviewed snapshot',
    outputPaths: [],
  });
  const reviewed = (result) => {
    const qa = reviewer(t, subject, packet);
    handle(qa);
    finish(qa, { content: [{ type: 'text', text: JSON.stringify(result) }] });
    const semantic = semanticResult(qa);
    semantic.reviewResult = result;
    return completeClaudeNativeTask(qa.registered.taskId, semantic, { root: qa.root });
  };

  const unexecuted = reviewResult(packet, 'unknown');
  unexecuted.notRun = ['node --test sample (runner-owned, not provided)'];
  const pending = reviewed(unexecuted);
  assert.equal(pending.valid, false);
  assert.ok(pending.errors.some((error) => /PASS requires/.test(error)));

  const selfReported = reviewResult(packet, 'unknown');
  selfReported.commandsActuallyRun = [runnerCommand('reviewer')];
  const misattributed = reviewed(selfReported);
  assert.equal(misattributed.valid, false);
  assert.ok(misattributed.errors.some((error) => /commandsActuallyRun\[0\]\.runner/.test(error)));

  const runnerEvidence = reviewResult(packet, 'unknown');
  runnerEvidence.commandsActuallyRun = [runnerCommand('parent')];
  assert.equal(reviewed(runnerEvidence).valid, true);
});
test('a reviewer FAIL receipt cannot be bypassed by linking another reviewer of the same subject', (t) => {
  const subject = writer(t);
  handle(subject);
  writeFileSync(join(subject.root, 'sample.txt'), 'allowed output');
  finish(subject);
  const observation = JSON.parse(
    readFileSync(join(subject.registered.evidenceDirectory, 'completion.json')),
  );
  const packet = reviewPacket(subject, observation.finalSnapshot);
  const completeReview = (verdict) => {
    const qa = reviewer(t, subject, packet);
    const result = reviewResult(packet, 'unknown', verdict);
    handle(qa);
    finish(qa, { content: [{ type: 'text', text: JSON.stringify(result) }] });
    const semantic = semanticResult(qa);
    semantic.reviewResult = result;
    assert.equal(
      completeClaudeNativeTask(qa.registered.taskId, semantic, { root: qa.root }).valid,
      true,
    );
    return qa;
  };
  completeReview('FAIL');
  const passing = completeReview('PASS');
  const subjectSemantic = semanticResult(subject);
  subjectSemantic.results[0].changedPaths = ['sample.txt'];
  subjectSemantic.reviewerTaskId = passing.registered.taskId;
  const shopped = completeClaudeNativeTask(subject.registered.taskId, subjectSemantic, {
    root: subject.root,
  });
  assert.equal(shopped.valid, false);
  assert.ok(shopped.errors.some((error) => /FAIL review receipt/.test(error)));
});
test('a delivered non-PASS or unsettled review of the subject blocks linking another reviewer', (t) => {
  const subject = writer(t);
  handle(subject);
  writeFileSync(join(subject.root, 'sample.txt'), 'allowed output');
  finish(subject);
  const observation = JSON.parse(
    readFileSync(join(subject.registered.evidenceDirectory, 'completion.json')),
  );
  const packet = reviewPacket(subject, observation.finalSnapshot);
  const passingReview = () => {
    const qa = reviewer(t, subject, packet);
    const result = reviewResult(packet, 'unknown');
    handle(qa);
    finish(qa, { content: [{ type: 'text', text: JSON.stringify(result) }] });
    const semantic = semanticResult(qa);
    semantic.reviewResult = result;
    assert.equal(
      completeClaudeNativeTask(qa.registered.taskId, semantic, { root: qa.root }).valid,
      true,
    );
    return qa;
  };
  const builderLinkedTo = (qa) => {
    const semantic = semanticResult(subject);
    semantic.results[0].changedPaths = ['sample.txt'];
    semantic.reviewerTaskId = qa.registered.taskId;
    return completeClaudeNativeTask(subject.registered.taskId, semantic, { root: subject.root });
  };

  const unsettled = reviewer(t, subject, packet);
  handle(unsettled);
  const pending = builderLinkedTo(passingReview());
  assert.equal(pending.valid, false);
  assert.ok(pending.errors.some((error) => /unsettled review attempt/.test(error)));

  finish(unsettled, {
    content: [{ type: 'text', text: JSON.stringify(reviewResult(packet, 'unknown', 'FAIL')) }],
  });
  const delivered = builderLinkedTo(passingReview());
  assert.equal(delivered.valid, false);
  assert.ok(delivered.errors.some((error) => /delivered non-PASS review/.test(error)));

  mkdirSync(join(subject.root, 'artifacts/local/claude-native', randomUUID()));
  const malformed = builderLinkedTo(passingReview());
  assert.equal(malformed.valid, false);
  assert.ok(malformed.errors.some((error) => /unreadable native task/.test(error)));
});
test('reviewer completion requires a delivered JSON object, not a falsy JSON value', (t) => {
  const subject = writer(t);
  handle(subject);
  writeFileSync(join(subject.root, 'sample.txt'), 'allowed output');
  finish(subject);
  const observation = JSON.parse(
    readFileSync(join(subject.registered.evidenceDirectory, 'completion.json')),
  );
  const qa = reviewer(t, subject, reviewPacket(subject, observation.finalSnapshot));
  handle(qa);
  finish(qa, { content: [{ type: 'text', text: 'null' }] });
  const semantic = semanticResult(qa);
  semantic.reviewResult = null;
  const completion = completeClaudeNativeTask(qa.registered.taskId, semantic, { root: qa.root });
  assert.equal(completion.valid, false);
  assert.ok(completion.errors.some((error) => /JSON object/.test(error)));
});
test('reviewer registration rejects the reviewer as runner and unbound packet scope', (t) => {
  const subject = writer(t);
  handle(subject);
  writeFileSync(join(subject.root, 'sample.txt'), 'allowed output');
  finish(subject);
  const observation = JSON.parse(
    readFileSync(join(subject.registered.evidenceDirectory, 'completion.json')),
  );
  const packet = reviewPacket(subject, observation.finalSnapshot);
  const selfRunner = structuredClone(packet);
  selfRunner.authority.runnerOwner = 'reviewer';
  assert.throws(() => reviewer(t, subject, selfRunner), /reviewer cannot be the packet runner/);
  const objective = structuredClone(packet);
  objective.objective = 'different request';
  assert.throws(() => reviewer(t, subject, objective), /objective mismatch/);
  const writerMismatch = structuredClone(packet);
  writerMismatch.authority.writeOwner = 'someone-else';
  assert.throws(() => reviewer(t, subject, writerMismatch), /writer\/builders mismatch/);
  const wider = structuredClone(packet);
  wider.boundaries.allowedReadPaths = ['sample.txt', 'other.txt'];
  assert.throws(() => reviewer(t, subject, wider), /exceeds reviewer task scope/);
  const uncovered = structuredClone(packet);
  uncovered.boundaries.allowedReadPaths = ['other.txt'];
  assert.throws(
    () => reviewer(t, subject, uncovered, { readScope: ['other.txt'] }),
    /does not cover subject changes/,
  );
  const qa = reviewer(t, subject, packet);
  assert.throws(
    () => reviewer(t, qa, reviewPacket(qa, observation.finalSnapshot)),
    /reviewer-of-reviewer/,
  );
});
test('one native writer at a time, allowed writes observed, independent QA cannot be omitted', (t) => {
  const f = writer(t);
  const other = registerClaudeNativeTask({
    ...f.options,
    workflowInput: f.input,
    sessionId: f.event.session_id,
  });
  assert.deepEqual(handle(f), {});
  assert.equal(
    handle(f, { ...f.event, tool_use_id: 'write-2', tool_input: other.invocation })
      .hookSpecificOutput.permissionDecision,
    'deny',
  );
  writeFileSync(join(f.root, 'sample.txt'), 'allowed output');
  finish(f);
  const r = semanticResult(f);
  r.results[0].changedPaths = ['sample.txt'];
  const checked = completeClaudeNativeTask(f.registered.taskId, r, { root: f.root });
  assert.equal(checked.observation.valid, true);
  assert.ok(checked.errors.includes('independent QA exchange required'));
  f.input.reviewDisposition.required = false;
  assert.throws(
    () =>
      registerClaudeNativeTask({ ...f.options, workflowInput: f.input, sessionId: randomUUID() }),
    /independent QA/,
  );
});
test('actual hook CLI returns no allow on good and deny on missing model', (t) => {
  const f = setup(t);
  const script = new URL('../agents/claude/native-session.mjs', import.meta.url).pathname;
  const good = spawnSync(process.execPath, [script, '--hook'], {
    cwd: f.root,
    env: { ...process.env, CLAUDE_PROJECT_DIR: f.root },
    input: JSON.stringify(f.event),
    encoding: 'utf8',
  });
  assert.equal(good.status, 0, good.stderr);
  assert.deepEqual(JSON.parse(good.stdout), {});
  delete f.event.tool_input.model;
  const bad = spawnSync(process.execPath, [script, '--hook'], {
    cwd: f.root,
    env: { ...process.env, CLAUDE_PROJECT_DIR: f.root },
    input: JSON.stringify(f.event),
    encoding: 'utf8',
  });
  assert.equal(bad.status, 0);
  assert.equal(JSON.parse(bad.stdout).hookSpecificOutput.permissionDecision, 'deny');
});

const permissionEvent = (f, input = f.event.tool_input) => {
  const { tool_use_id: _toolUseId, ...rest } = f.event;
  return { ...rest, hook_event_name: 'PermissionRequest', tool_input: input };
};
const permissionDecision = (output) => output?.hookSpecificOutput?.decision;

test('Repo ask prompt is answered once only for a healthy same-input PreToolUse attempt', (t) => {
  const f = setup(t);
  assert.deepEqual(raw(f), {});
  const granted = permissionDecision(raw(f, permissionEvent(f)));
  assert.deepEqual(granted, { behavior: 'allow' });
  const replay = permissionDecision(raw(f, permissionEvent(f)));
  assert.equal(replay.behavior, 'deny');
  assert.match(replay.message, /already granted/);
});

test('Repo ask prompt is denied without a healthy PreToolUse attempt or with changed input', (t) => {
  const missing = setup(t);
  const noAttempt = permissionDecision(raw(missing, permissionEvent(missing)));
  assert.equal(noAttempt.behavior, 'deny');
  assert.match(noAttempt.message, /PreToolUse/);

  const changed = setup(t);
  assert.deepEqual(raw(changed), {});
  const drifted = permissionDecision(
    raw(changed, permissionEvent(changed, { ...changed.event.tool_input, model: 'opus' })),
  );
  assert.equal(drifted.behavior, 'deny');

  const unrelated = setup(t);
  assert.deepEqual(
    raw(
      unrelated,
      permissionEvent(unrelated, { description: 'x', prompt: 'y', subagent_type: 'Explore' }),
    ),
    {},
  );
});

for (const [name, mutate, reason] of [
  ['foreign session', (f, e) => (e.session_id = randomUUID()), /foreign session/],
  ['non-auto mode', (f, e) => (e.permission_mode = 'default'), /auto permission mode/],
  [
    'settings drift',
    (f) => writeFileSync(join(f.root, '.claude/settings.local.json'), '{}\n'),
    /settings drift/,
  ],
  [
    'repo role without marker',
    (f, e) => (e.tool_input = { ...e.tool_input, prompt: 'no registration' }),
    /registered task required/,
  ],
])
  test(`Repo ask prompt denies ${name}`, (t) => {
    const f = setup(t);
    assert.deepEqual(raw(f), {});
    const event = permissionEvent(f);
    mutate(f, event);
    const decision = permissionDecision(raw(f, event));
    assert.equal(decision.behavior, 'deny');
    assert.match(decision.message, reason);
  });

test('a later Repo grant cannot validate an attempt that already executed without one', (t) => {
  const f = setup(t);
  assert.deepEqual(raw(f), {}); // PreToolUse; the prompt was then approved by a human.
  finish(f);
  const late = permissionDecision(raw(f, permissionEvent(f)));
  assert.equal(late.behavior, 'deny');
  assert.match(late.message, /already executed/);
  const completion = completeClaudeNativeTask(f.registered.taskId, semanticResult(f), {
    root: f.root,
  });
  assert.ok(completion.errors.includes('missing-permission-grant'));
});

test('a grant that does not match its attempt cannot complete', (t) => {
  const f = setup(t);
  handle(f);
  finish(f);
  const grantPath = join(f.registered.evidenceDirectory, 'permission.json');
  const grant = JSON.parse(readFileSync(grantPath));
  writeFileSync(grantPath, JSON.stringify({ ...grant, toolUseId: 'other-tool' }));
  const completion = completeClaudeNativeTask(f.registered.taskId, semanticResult(f), {
    root: f.root,
  });
  assert.ok(completion.errors.includes('missing-permission-grant'));
});

test('an uncaught PermissionRequest hook failure leaves no decision (exit 2, empty stdout)', (t) => {
  const f = setup(t);
  const script = new URL('../agents/claude/native-session.mjs', import.meta.url).pathname;
  const failed = spawnSync(process.execPath, [script, '--hook'], {
    cwd: f.root,
    env: { ...process.env, CLAUDE_PROJECT_DIR: join(f.root, 'missing-project-dir') },
    input: JSON.stringify(permissionEvent(f)),
    encoding: 'utf8',
  });
  assert.equal(failed.status, 2);
  assert.equal(failed.stdout, '');
});

test('human approval of the ask prompt after a Repo hook failure is not a completion grant', (t) => {
  const f = setup(t);
  assert.deepEqual(raw(f), {}); // PreToolUse recorded; PermissionRequest hook never answered.
  finish(f);
  const completion = completeClaudeNativeTask(f.registered.taskId, semanticResult(f), {
    root: f.root,
  });
  assert.equal(completion.valid, false);
  assert.ok(completion.errors.includes('missing-permission-grant'));
});

test('actual hook CLI answers the Repo ask prompt only after its PreToolUse attempt', (t) => {
  const f = setup(t);
  const script = new URL('../agents/claude/native-session.mjs', import.meta.url).pathname;
  const run = (event) =>
    spawnSync(process.execPath, [script, '--hook'], {
      cwd: f.root,
      env: { ...process.env, CLAUDE_PROJECT_DIR: f.root },
      input: JSON.stringify(event),
      encoding: 'utf8',
    });
  const early = run(permissionEvent(f));
  assert.equal(early.status, 0, early.stderr);
  assert.equal(permissionDecision(JSON.parse(early.stdout)).behavior, 'deny');
  assert.equal(run(f.event).status, 0);
  const allowed = run(permissionEvent(f));
  assert.equal(allowed.status, 0, allowed.stderr);
  assert.deepEqual(permissionDecision(JSON.parse(allowed.stdout)), { behavior: 'allow' });
});

test('writer replay cannot strand a lease and tool failure releases only its writer', (t) => {
  const f = writer(t);
  handle(f);
  finish(f);
  assert.equal(handle(f).hookSpecificOutput.permissionDecision, 'deny');
  const other = registerClaudeNativeTask({
    ...f.options,
    workflowInput: f.input,
    sessionId: f.event.session_id,
  });
  const event = { ...f.event, tool_use_id: 'write-next', tool_input: other.invocation };
  assert.deepEqual(handle(f, event), {});
  handle(f, { ...event, hook_event_name: 'PostToolUseFailure', error: 'synthetic failure' });
  const third = registerClaudeNativeTask({
    ...f.options,
    workflowInput: f.input,
    sessionId: f.event.session_id,
  });
  assert.deepEqual(
    handle(f, { ...event, tool_use_id: 'write-third', tool_input: third.invocation }),
    {},
  );
  assert.throws(() => releaseClaudeNativeTask(third.taskId, { root: f.root }), /ended/);
  assert.equal(
    releaseClaudeNativeTask(third.taskId, { root: f.root, ended: true }).completed,
    false,
  );
});
test('duplicate completion invalidates the result instead of silently preserving an earlier PASS', (t) => {
  const f = setup(t);
  handle(f);
  finish(f);
  const input = semanticResult(f);
  assert.equal(completeClaudeNativeTask(f.registered.taskId, input, { root: f.root }).valid, true);
  finish(f);
  assert.equal(completeClaudeNativeTask(f.registered.taskId, input, { root: f.root }).valid, false);
});

test('ordinary executor new files are fingerprinted without staging, then common QA remains required', (t) => {
  const f = writer(t);
  f.input.directAssignment.writeOwnership = ['new.txt'];
  f.input.nativeRequest.task.writeScope = ['new.txt'];
  const r = registerClaudeNativeTask({
    ...f.options,
    workflowInput: f.input,
    sessionId: f.event.session_id,
  });
  f.registered = r;
  f.event.tool_input = r.invocation;
  assert.deepEqual(handle(f), {});
  writeFileSync(join(f.root, 'new.txt'), 'new output');
  finish(f);
  const input = semanticResult(f);
  input.results[0].changedPaths = ['new.txt'];
  const checked = completeClaudeNativeTask(r.taskId, input, { root: f.root });
  assert.equal(checked.observation.valid, true, JSON.stringify(checked.errors));
  assert.equal(checked.observation.finalSnapshot.untrackedInputDigests[0].path, 'new.txt');
  assert.deepEqual(checked.errors, [
    'native required QA requires linked reviewerTaskId',
    'independent QA exchange required',
  ]);
});

test('foreign completion and async child do not release a live writer lease', (t) => {
  const f = writer(t);
  handle(f);
  const next = registerClaudeNativeTask({
    ...f.options,
    workflowInput: f.input,
    sessionId: f.event.session_id,
  });
  handle(f, { ...f.event, hook_event_name: 'PostToolUseFailure', tool_use_id: 'foreign-tool' });
  const event = { ...f.event, tool_use_id: 'write-next', tool_input: next.invocation };
  assert.equal(handle(f, event).hookSpecificOutput.permissionDecision, 'deny');
  finish(f, { status: 'async_launched' });
  assert.equal(handle(f, event).hookSpecificOutput.permissionDecision, 'deny');
  releaseClaudeNativeTask(f.registered.taskId, { root: f.root, ended: true });
  assert.deepEqual(handle(f, event), {});
});

for (const stopFirst of [false, true])
  test(`async stop/notification association, stopFirst=${stopFirst}`, (t) => {
    const f = setup(t);
    handle(f);
    const agentId = 'async-child';
    const launch = {
      ...f.event,
      hook_event_name: 'PostToolUse',
      tool_response: {
        status: 'async_launched',
        agentId,
        resolvedModel: f.options.expectedResolvedModel,
        prompt: f.registered.invocation.prompt,
      },
    };
    if (!stopFirst) handle(f, launch);
    assert.equal(completeClaudeNativeTask(f.registered.taskId, {}, { root: f.root }).valid, false);
    const base = join(realpathSync(f.root), 'artifacts/transcripts'),
      childDir = join(base, f.event.session_id, 'subagents');
    mkdirSync(childDir, { recursive: true });
    const childPath = join(childDir, `agent-${agentId}.jsonl`),
      parentPath = join(base, `${f.event.session_id}.jsonl`);
    const rows = [
      {
        type: 'user',
        sessionId: f.event.session_id,
        agentId,
        message: { content: f.registered.invocation.prompt },
      },
      {
        type: 'assistant',
        sessionId: f.event.session_id,
        agentId,
        message: {
          model: f.options.expectedResolvedModel,
          content: [{ type: 'text', text: 'oracle' }],
        },
      },
    ];
    writeFileSync(childPath, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    writeFileSync(parentPath, '');
    const stop = {
      hook_event_name: 'SubagentStop',
      session_id: f.event.session_id,
      cwd: f.root,
      agent_id: agentId,
      agent_type: 'repo_explorer',
      agent_transcript_path: childPath,
      transcript_path: parentPath,
    };
    handle(f, stop);
    if (stopFirst) handle(f, launch);
    assert.equal(completeClaudeNativeTask(f.registered.taskId, {}, { root: f.root }).valid, false);
    writeFileSync(
      parentPath,
      JSON.stringify({
        type: 'user',
        sessionId: f.event.session_id,
        message: {
          content: `<task-notification>\n<task-id>${agentId}</task-id>\n<tool-use-id>${f.event.tool_use_id}</tool-use-id>\n<status>completed</status>\n</task-notification>`,
        },
      }) + '\n',
    );
    completeClaudeNativeTask(f.registered.taskId, {}, { root: f.root });
    assert.equal(
      completeClaudeNativeTask(f.registered.taskId, semanticResult(f), { root: f.root }).valid,
      true,
    );
    assert.equal(
      handle(f, {
        ...f.event,
        tool_name: 'SendMessage',
        tool_input: { to: agentId, message: 'resume' },
      }).hookSpecificOutput.permissionDecision,
      'deny',
    );
    writeFileSync(childPath, readFileSync(childPath) + '{}\n');
    assert.equal(
      completeClaudeNativeTask(f.registered.taskId, semanticResult(f), { root: f.root }).valid,
      false,
    );
  });

test('native input key order does not break actual hook association', (t) => {
  const f = setup(t);
  f.event.tool_input = Object.fromEntries(Object.entries(f.event.tool_input).reverse());
  assert.deepEqual(handle(f), {});
  finish(f);
  assert.equal(
    completeClaudeNativeTask(f.registered.taskId, semanticResult(f), { root: f.root }).valid,
    true,
  );
});
