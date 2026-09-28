import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  validateAdapterDescriptor,
  assessAdapterCapability,
  validateBoundedLanes,
  assessLaneReadiness,
  validateLaneResult,
  validateFanIn,
  validateAdapterReview,
} from '../agents/common/adapter-contract.mjs';
import { buildTaskEnvelope } from '../agents/common/intake-policy.mjs';
import { discoverContextPack } from '../agents/common/domain-guide-registry.mjs';

const qa = JSON.parse(
  readFileSync(new URL('./fixtures/cross-model-handoff-cases.json', import.meta.url)),
);
const snapshot = qa.basePacket.snapshot;
const identity = {
  sourceDigest: `sha256:${'a'.repeat(64)}`,
  configDigest: `sha256:${'b'.repeat(64)}`,
};
const adapter = {
  schemaVersion: 'workflow-adapter/v1',
  hostId: 'synthetic-third',
  entry: 'test-only/synthetic-adapter.mjs',
  identity,
  capabilities: {
    direct: 'supported',
    'native-child': 'supported',
    cancel: 'unsupported',
    'model-observation': 'unknown',
  },
};
const observations = [
  {
    hostId: adapter.hostId,
    identity,
    capability: 'native-child',
    state: 'supported',
    evidenceKind: 'runtime',
    evidenceRef: 'test-only simulated receipt; not live qualification',
  },
];
function input() {
  const envelope = buildTaskEnvelope({ request: '정해진 helper와 테스트를 구현해줘.' });
  return {
    envelope,
    contextPack: discoverContextPack({ envelope }),
    currentSnapshot: structuredClone(snapshot),
    lanes: [
      {
        id: 'helper',
        dispatchId: 'dispatch-helper',
        owner: 'writer-a',
        objective: 'Implement helper.',
        acceptance: ['Targeted regression passes.'],
        dependencies: [],
        writeOwnership: ['scripts/example/helper.mjs'],
        sourceSnapshot: structuredClone(snapshot),
      },
      {
        id: 'tests',
        dispatchId: 'dispatch-tests',
        owner: 'writer-b',
        objective: 'Add tests.',
        acceptance: ['Negative test rejects stale data.'],
        dependencies: ['helper'],
        writeOwnership: ['scripts/example/helper.test.mjs'],
        sourceSnapshot: structuredClone(snapshot),
      },
    ],
  };
}
function result(lane) {
  return {
    resultId: `result-${lane.id}`,
    dispatchId: lane.dispatchId,
    laneId: lane.id,
    owner: lane.owner,
    hostId: adapter.hostId,
    adapterIdentity: identity,
    sourceSnapshot: structuredClone(snapshot),
    status: 'complete',
    checks: ['Targeted check passed.'],
    findings: [],
    gaps: [],
    changedPaths: [...lane.writeOwnership],
  };
}
function assertRejected(outcome, fragment) {
  assert.equal(outcome.valid, false, JSON.stringify(outcome));
  if (fragment)
    assert.ok(
      outcome.errors.some((item) => item.includes(fragment)),
      JSON.stringify(outcome),
    );
}

test('a third adapter is injected as data without host-specific core policy', () => {
  assert.equal(validateAdapterDescriptor(adapter).valid, true);
  assert.equal(
    validateAdapterDescriptor({ ...adapter, hostId: 'another-future-host' }).valid,
    true,
  );
  const source = readFileSync(
    new URL('../agents/common/adapter-contract.mjs', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(source, /from ['"].*(?:codex|claude)|gpt-|OMX_|fork_turns/);
});

test('declared support and static observations never prove runtime capability', () => {
  const base = {
    adapter,
    hostId: adapter.hostId,
    currentIdentity: identity,
    capability: 'native-child',
  };
  assert.equal(assessAdapterCapability(base).decision, 'unknown');
  assert.equal(
    assessAdapterCapability({
      ...base,
      observations: observations.map((item) => ({ ...item, evidenceKind: 'static' })),
    }).decision,
    'unknown',
  );
  const outcome = assessAdapterCapability({ ...base, observations });
  assert.equal(outcome.decision, 'observed-supported');
  assert.equal(outcome.dispatchAuthorized, false);
  assert.equal(outcome.verificationClass, 'static-contract');
  assert.ok(outcome.liveChecks.includes('observation-authenticity-and-current-host-permissions'));
});

test('unknown host, absent capability, unknown model and unsupported cancellation do not fallback', () => {
  const base = { adapter, hostId: adapter.hostId, currentIdentity: identity, observations };
  assert.equal(
    assessAdapterCapability({ ...base, hostId: 'unregistered', capability: 'native-child' })
      .decision,
    'reject',
  );
  assert.equal(
    assessAdapterCapability({ ...base, capability: 'lead-cli-review' }).decision,
    'unknown',
  );
  assert.equal(
    assessAdapterCapability({ ...base, capability: 'model-observation' }).decision,
    'unknown',
  );
  assert.equal(assessAdapterCapability({ ...base, capability: 'cancel' }).decision, 'unsupported');
});

test('identity and observation provenance mismatch rejects stale or spoofed capability', () => {
  const base = {
    adapter,
    hostId: adapter.hostId,
    currentIdentity: identity,
    capability: 'native-child',
  };
  assert.equal(
    assessAdapterCapability({
      ...base,
      currentIdentity: { ...identity, configDigest: `sha256:${'c'.repeat(64)}` },
    }).decision,
    'reject',
  );
  for (const patch of [
    { hostId: 'other-host' },
    { identity: { ...identity, sourceDigest: `sha256:${'c'.repeat(64)}` } },
  ]) {
    assert.equal(
      assessAdapterCapability({
        ...base,
        observations: observations.map((item) => ({ ...item, ...patch })),
      }).decision,
      'unknown',
    );
  }
  assert.equal(
    assessAdapterCapability({
      ...base,
      observations: [...observations, { ...observations[0], state: 'unsupported' }],
    }).decision,
    'reject',
  );
});

test('adapter descriptor rejects malformed identity, unsafe entry and unknown vendor fields', () => {
  for (const patch of [
    { identity: {} },
    { entry: '../outside.mjs' },
    { effort: 'vendor-specific' },
    { capabilities: { cancel: true } },
  ]) {
    assertRejected(validateAdapterDescriptor({ ...adapter, ...patch }));
  }
});

test('actual TaskEnvelope and ContextPack compose into bounded lanes without a scheduler', () => {
  const data = input();
  const before = structuredClone(data);
  assert.equal(validateBoundedLanes(data).valid, true);
  assert.deepEqual(data, before);
  assert.deepEqual(data.contextPack.selectedGuides, []);
});

for (const [name, mutate, fragment] of [
  [
    'duplicate lane',
    (x) => {
      x.lanes[1].id = x.lanes[0].id;
    },
    'duplicate',
  ],
  [
    'overlap file',
    (x) => {
      x.lanes[1].writeOwnership = ['scripts/example/helper.mjs'];
    },
    'overlap',
  ],
  [
    'overlap directory',
    (x) => {
      x.lanes[1].writeOwnership = ['scripts/example'];
    },
    'overlap',
  ],
  [
    'unsafe scope',
    (x) => {
      x.lanes[0].writeOwnership = ['../other'];
    },
    'path',
  ],
  [
    'unregistered dependency',
    (x) => {
      x.lanes[1].dependencies = ['missing'];
    },
    'dependency',
  ],
  [
    'dependency cycle',
    (x) => {
      x.lanes[0].dependencies = ['tests'];
    },
    'cycle',
  ],
  [
    'stale snapshot',
    (x) => {
      x.lanes[0].sourceSnapshot.headSHA = 'f'.repeat(64);
    },
    'snapshot',
  ],
  [
    'context mismatch',
    (x) => {
      x.contextPack = { ...x.contextPack, requestId: 'other' };
    },
    'ContextPack',
  ],
  [
    'unbounded acceptance',
    (x) => {
      x.lanes[0].acceptance = [];
    },
    'acceptance',
  ],
  [
    'analysis cannot write',
    (x) => {
      x.envelope = buildTaskEnvelope({ request: 'Analyze the workflow only.' });
      x.contextPack = discoverContextPack({ envelope: x.envelope });
    },
    'write',
  ],
]) {
  test(`bounded lane rejects ${name}`, () => {
    const data = input();
    mutate(data);
    assertRejected(validateBoundedLanes(data), fragment);
  });
}

test('dependency is ready only after exact validated complete receipt', () => {
  const data = input();
  const base = { ...data, laneId: 'tests', hostId: adapter.hostId, adapterIdentity: identity };
  assert.equal(assessLaneReadiness(base).decision, 'blocked');
  assert.equal(
    assessLaneReadiness({ ...base, results: [result(data.lanes[0])] }).decision,
    'ready',
  );
  assert.equal(
    assessLaneReadiness({
      ...base,
      results: [{ ...result(data.lanes[0]), status: 'partial', gaps: ['Not complete.'] }],
    }).decision,
    'blocked',
  );
  assert.equal(
    assessLaneReadiness({ ...base, results: [{ ...result(data.lanes[0]), owner: 'spoof' }] })
      .decision,
    'reject',
  );
});

for (const [name, patch] of [
  ['wrong dispatch', { dispatchId: 'another-run' }],
  ['wrong lane', { laneId: 'unknown' }],
  ['wrong owner', { owner: 'spoof' }],
  ['wrong host', { hostId: 'another-host' }],
  ['wrong binding', { adapterIdentity: { ...identity, configDigest: `sha256:${'d'.repeat(64)}` } }],
  ['stale result', { sourceSnapshot: { ...snapshot, headSHA: 'e'.repeat(64) } }],
  ['out of scope write', { changedPaths: ['apps/api/outside.ts'] }],
  ['hidden gap', { gaps: ['check not run'] }],
  ['empty checks', { checks: [] }],
]) {
  test(`result rejects ${name}`, () => {
    const lane = input().lanes[0];
    assertRejected(
      validateLaneResult({
        lane,
        result: { ...result(lane), ...patch },
        currentSnapshot: snapshot,
        hostId: adapter.hostId,
        adapterIdentity: identity,
      }),
    );
  });
}

test('fan-in requires every unique exact complete result and preserves findings as hypotheses', () => {
  const data = input();
  const base = { ...data, hostId: adapter.hostId, adapterIdentity: identity };
  const results = data.lanes.map(result);
  results[0].findings = ['Potential edge case: parent must reproduce.'];
  const outcome = validateFanIn({ ...base, results });
  assert.equal(outcome.valid, true);
  assert.equal(outcome.dispatchAuthorized, false);
  assert.ok(outcome.liveChecks.includes('parent-reproduces-findings-and-verifies-evidence'));
  assertRejected(validateFanIn({ ...base, results: results.slice(0, 1) }), 'missing');
  assertRejected(
    validateFanIn({ ...base, results: [results[0], results[0], results[1]] }),
    'duplicate',
  );
  assertRejected(
    validateFanIn({
      ...base,
      results: [{ ...results[0], status: 'partial', gaps: ['unfinished'] }, results[1]],
    }),
    'complete',
  );
});

test('fresh QA reuses real packet/result validator and remains static, not live success', () => {
  const packet = structuredClone(qa.basePacket);
  packet.intent.direction = 'lead-takeover';
  const data = {
    packet,
    result: structuredClone(qa.baseResult),
    currentSnapshot: packet.snapshot,
    reviewerId: 'third-reviewer',
    builderIds: ['executor-h3'],
  };
  const outcome = validateAdapterReview(data);
  assert.equal(outcome.valid, true, JSON.stringify(outcome));
  assert.equal(outcome.verificationClass, 'static-contract');
  assert.ok(outcome.liveChecks.includes('context-isolation-observed'));
  assertRejected(validateAdapterReview({ ...data, reviewerId: 'executor-h3' }), 'independent');
  assertRejected(
    validateAdapterReview({
      ...data,
      packet: { ...packet, review: { ...packet.review, freshContext: false } },
    }),
    'freshContext',
  );
  assertRejected(
    validateAdapterReview({ ...data, result: { ...data.result, dispatchId: 'spoof' } }),
    'dispatchId',
  );
  assertRejected(
    validateAdapterReview({
      ...data,
      result: { ...data.result, reviewedSnapshot: { ...snapshot, headSHA: 'f'.repeat(64) } },
    }),
    'snapshot',
  );
});

test('malformed inputs reject without authority or implicit fallback', () => {
  for (const fn of [
    validateAdapterDescriptor,
    assessAdapterCapability,
    validateBoundedLanes,
    assessLaneReadiness,
    validateLaneResult,
    validateFanIn,
    validateAdapterReview,
  ]) {
    assertRejected(fn());
  }
});

test('synthetic scenario has independent lanes, ordered dependency, fan-in and no live invocation', () => {
  const data = input();
  data.lanes.push({
    ...structuredClone(data.lanes[0]),
    id: 'scan',
    dispatchId: 'dispatch-scan',
    owner: 'reader',
    objective: 'Independently inspect the bounded source.',
    writeOwnership: [],
  });
  const binding = { hostId: adapter.hostId, adapterIdentity: identity };
  for (const laneId of ['helper', 'scan']) {
    const ready = assessLaneReadiness({ ...data, ...binding, laneId });
    assert.equal(ready.decision, 'ready');
    assert.equal(ready.dispatchAuthorized, false);
  }
  assert.equal(assessLaneReadiness({ ...data, ...binding, laneId: 'tests' }).decision, 'blocked');
  const helper = result(data.lanes[0]);
  assert.equal(
    assessLaneReadiness({ ...data, ...binding, laneId: 'tests', results: [helper] }).decision,
    'ready',
  );
  assert.equal(validateFanIn({ ...data, ...binding, results: data.lanes.map(result) }).valid, true);
  assert.equal(
    assessAdapterCapability({
      adapter,
      hostId: adapter.hostId,
      currentIdentity: identity,
      capability: 'cancel',
      observations,
    }).decision,
    'unsupported',
  );
});

test('fresh QA rejects absent current identity, incomplete builder set and lifecycle false completion', () => {
  const packet = structuredClone(qa.basePacket);
  packet.intent.direction = 'lead-takeover';
  const data = {
    packet,
    result: structuredClone(qa.baseResult),
    currentSnapshot: packet.snapshot,
    reviewerId: 'third-reviewer',
    builderIds: [packet.authority.writeOwner],
  };
  assertRejected(
    validateAdapterReview({ ...data, currentSnapshot: undefined }),
    'current QA source',
  );
  assertRejected(
    validateAdapterReview({ ...data, builderIds: ['unrelated-owner'] }),
    'write owner',
  );
  assertRejected(
    validateAdapterReview({
      ...data,
      packet: { ...packet, lifecycle: { ...packet.lifecycle, support: 'unsupported' } },
    }),
    'unsupported',
  );
});

test('replayed result, duplicated dispatch and invalid parent scope are rejected', () => {
  const data = input();
  const lane = data.lanes[0];
  assertRejected(
    validateLaneResult({
      lane,
      result: result(lane),
      currentSnapshot: snapshot,
      hostId: adapter.hostId,
      adapterIdentity: identity,
      seenResultIds: ['result-helper'],
    }),
    'duplicate',
  );
  assertRejected(
    validateLaneResult({
      lane: { ...lane, writeOwnership: 'scripts' },
      result: result(lane),
      currentSnapshot: snapshot,
      hostId: adapter.hostId,
      adapterIdentity: identity,
    }),
    'writeOwnership',
  );
  data.lanes[1].dispatchId = lane.dispatchId;
  assertRejected(validateBoundedLanes(data), 'duplicate lane dispatchId');
});

test('Plan delegation may author an explicitly owned local plan but not product code', () => {
  const data = input();
  data.envelope = buildTaskEnvelope({ request: '공통 변경 계획을 작성해줘.' });
  data.contextPack = discoverContextPack({ envelope: data.envelope });
  data.lanes = [{ ...data.lanes[0], writeOwnership: ['.plans/example-plan.md'] }];
  assert.equal(validateBoundedLanes(data).valid, true);
  data.lanes[0].writeOwnership = ['apps/web/example.ts'];
  assertRejected(validateBoundedLanes(data), 'write');
});

test('bounded lanes reject non-Plan and foreign guides consistently with the common route', () => {
  const data = input();
  data.lanes = data.lanes.map((lane) => ({ ...lane, writeOwnership: [] }));
  for (const request of ['API 오류 원인을 분석해줘.', 'API 변경 계획을 작성해줘.']) {
    data.envelope = buildTaskEnvelope({ request });
    data.contextPack = discoverContextPack({ envelope: data.envelope });
    assert.equal(validateBoundedLanes(data).valid, true);
    const paths = ['/private/foreign.md'];
    if (data.envelope.intent !== 'plan')
      paths.push('docs/development/agent-workflows/plan-authoring/core.md');
    for (const path of paths) {
      const forged = { ...data.contextPack, selectedGuides: [{ path }] };
      assertRejected(validateBoundedLanes({ ...data, contextPack: forged }), 'ContextPack');
    }
  }
});
