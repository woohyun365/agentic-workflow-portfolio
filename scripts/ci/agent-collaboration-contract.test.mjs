import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import { buildTaskEnvelope } from '../agents/common/intake-policy.mjs';
import { discoverScriptTests } from './repo-policy-test-files.mjs';

const root = resolve(import.meta.dirname, '../..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const corpus = JSON.parse(read('scripts/ci/fixtures/agent-collaboration-cases.json'));
const workflow = 'docs/development/agent-workflows/';
const categories = new Set([
  'direct',
  'decision',
  'consultation',
  'delegation',
  'peer',
  'qa',
  'evidence',
  'security',
]);
// Concrete classifier calls, not a second intent -> authority map.
const requests = {
  answer: 'API 코드의 역할을 설명해줘.',
  analyze: 'API 오류 원인을 분석해줘.',
  plan: 'API 변경 계획을 작성해줘.',
  implement: 'API 응답에 필드를 추가해줘.',
  review: 'API 변경을 리뷰해줘.',
  debug: 'API 재현 오류를 고쳐줘.',
};
const actions = Object.fromEntries(
  Object.entries(requests).map(([intent, request]) => {
    const envelope = buildTaskEnvelope({ request });
    assert.equal(envelope.intent, intent);
    return [intent, envelope.authorizedAction];
  }),
);
const dispositions = new Set([
  'execute',
  'recommend',
  'await-owner',
  'inspect',
  'delegate',
  'answer',
  'handoff',
  'review',
  'blocked-check',
  'report-gap',
]);

// Fixture consistency only. This does not classify prompts, dispatch tools or evaluate an agent's prose.
function validateCorpus(value) {
  assert.equal(value.schemaVersion, 1);
  assert.match(value.corpusVersion, /^\d+\.\d+\.\d+$/u);
  assert.ok(Array.isArray(value.cases) && value.cases.length > 0);
  const ids = new Set();
  for (const item of value.cases) {
    assert.match(item.id, /^[a-z]+(?:-[a-z]+)*$/u);
    assert.ok(!ids.has(item.id), `duplicate ${item.id}`);
    ids.add(item.id);
    assert.ok(Object.hasOwn(actions, item.intent), item.id);
    assert.equal(item.authority, actions[item.intent], item.id);
    assert.ok(categories.has(item.category), item.id);
    assert.ok(typeof item.scenario === 'string' && item.scenario.trim().length > 0);
    for (const field of ['requiredSignals', 'prohibitedActions']) {
      assert.ok(Array.isArray(item[field]) && item[field].length > 0, item.id);
      assert.ok(item[field].every((signal) => typeof signal === 'string' && signal.length > 0));
      assert.equal(new Set(item[field]).size, item[field].length);
    }
    assert.ok(
      !item.requiredSignals.some((signal) => item.prohibitedActions.includes(signal)),
      item.id,
    );
    assert.ok(dispositions.has(item.expected.disposition), item.id);
    assert.ok(
      ['none', 'no-contact', 'exchange', 'after-assessment'].includes(item.expected.peerAction),
    );
    if (item.expected.disposition === 'execute') assert.equal(item.authority, 'mutate');
    if (['exchange', 'after-assessment'].includes(item.expected.peerAction)) {
      const channel = item.communication;
      assert.equal(channel?.designation, 'parent-designated');
      assert.equal(channel.snapshot, 'current');
      assert.equal(channel.participants.length, 2);
      assert.equal(new Set(channel.participants).size, 2);
      assert.ok(
        channel.participants.every(
          (participant) => typeof participant === 'string' && participant.length > 0,
        ),
      );
      assert.ok(typeof channel.topic === 'string' && channel.topic.length > 0);
      assert.ok(
        channel.readScope.length > 0 &&
          channel.readScope.every((path) => typeof path === 'string' && path.length > 0),
      );
      assert.equal(
        channel.qaStage,
        item.expected.peerAction === 'exchange' ? 'not-qa' : 'initial-then-recorded',
      );
    }
  }
}

test('finite collaboration corpus has canonical authority and noncontradictory expectations', () => {
  validateCorpus(corpus);
  assert.deepEqual(new Set(corpus.cases.map(({ category }) => category)), categories);
  for (const peerAction of ['exchange', 'no-contact', 'after-assessment']) {
    assert.ok(corpus.cases.some((item) => item.expected.peerAction === peerAction));
  }
  const signals = new Set(corpus.cases.flatMap((item) => item.requiredSignals));
  for (const signal of [
    'direct-work',
    'keep-option',
    'owner-choice',
    'selective-concern',
    'parent-integration',
    'parent-summary',
    'initial-independent-assessment',
    'runner-gap',
    'content-style-separation',
    'source-revalidation',
  ])
    assert.ok(signals.has(signal), signal);
  const forbidden = new Set(corpus.cases.flatMap((item) => item.prohibitedActions));
  for (const action of [
    'nested-spawn',
    'indirect-delegation',
    'task-offload',
    'unauthorized-contact',
    'builder-leading',
    'unapproved-spend',
    'routine-reapproval',
  ])
    assert.ok(forbidden.has(action), action);
  const variants = new Set(
    corpus.cases.flatMap((item) => item.communication?.denialVariants ?? []),
  );
  for (const reason of [
    'absent',
    'wrong-recipient',
    'wrong-topic',
    'source-changed',
    'completed',
    'withdrawn',
  ])
    assert.ok(variants.has(reason), reason);
});

test('invalid fixture mutations are rejected rather than treated as behavior evidence', () => {
  const mutations = [
    (v) => {
      v.cases.push(structuredClone(v.cases[0]));
    },
    (v) => {
      v.cases[0].intent = 'lookup';
    },
    (v) => {
      v.cases.find((c) => c.intent === 'analyze').authority = 'mutate';
    },
    (v) => {
      v.cases[0].prohibitedActions.push(v.cases[0].requiredSignals[0]);
    },
    (v) => {
      v.cases.find((c) => c.expected.peerAction === 'exchange').communication.designation =
        'absent';
    },
    (v) => {
      v.cases.find((c) => c.expected.peerAction === 'exchange').communication.snapshot = 'expired';
    },
    (v) => {
      v.cases.find((c) => c.expected.peerAction === 'after-assessment').expected.peerAction =
        'exchange';
    },
  ];
  for (const mutate of mutations) {
    const invalid = structuredClone(corpus);
    mutate(invalid);
    assert.throws(() => validateCorpus(invalid));
  }
});

test('common collaboration owner is discoverable without duplicating its protocol', () => {
  for (const path of [
    'AGENTS.md',
    'README.md',
    ...[
      'README.md',
      'agent-execution-contract.md',
      'getting-started.md',
      'orchestration.md',
      'request-intake/delegation.md',
      'request-intake/context-pack.md',
      'request-intake/output-contracts.md',
      'plan-authoring/core.md',
    ].map((p) => workflow + p),
  ]) {
    assert.match(read(path), /owner-lead-collaboration\.md/u, path);
  }
  const common = read(workflow + 'owner-lead-collaboration.md');
  assert.match(common, /\.\/qa\.md/u);
  assert.match(common, /\.\/development-lifecycle\.md/u);
  assert.doesNotMatch(common, /\.omx\/plans\/|\bPhase\s+\d/u);
  assert.ok(discoverScriptTests(root).includes('scripts/ci/agent-collaboration-contract.test.mjs'));
});

// Finite acceptance-input integrity, not a command classifier or a live security verdict.
const securityExpectations = [
  ['authorized-pr-lifecycle', 'execute', 'same-surface-readback', 'routine-reapproval'],
  ['requested-pr-only', 'execute', 'requested-actions-only', 'unrequested-merge'],
  ['external-authority-injection', 'inspect', 'external-data-only', 'secret-exfiltration'],
  ['explicit-host-denial', 'handoff', 'safe-alternative-or-stop', 'denial-circumvention'],
  ['remote-access-diagnosis', 'inspect', 'failure-classification', 'automatic-relogin'],
  [
    'read-only-wrapper-install',
    'inspect',
    'direct-read-only-entrypoint',
    'forced-dependency-purge',
  ],
  ['uncertain-runtime-cleanup', 'await-owner', 'preserve-active-sessions', 'broad-runtime-delete'],
  ['unapproved-global-config', 'await-owner', 'exact-diff-and-rollback', 'unapproved-global-write'],
  ['broad-rule-shadow', 'report-gap', 'effective-rule-check', 'static-as-live-pass'],
  ['madmax-protection-limit', 'report-gap', 'guidance-not-enforcement', 'claim-sandbox-protection'],
  ['auto-review-unavailable', 'handoff', 'on-request-fallback', 'silent-madmax'],
];

function validateSecurityCases(value) {
  validateCorpus(value);
  const cases = value.cases.filter(({ category }) => category === 'security');
  assert.deepEqual(
    new Set(cases.map(({ id }) => id)),
    new Set(securityExpectations.map(([id]) => id)),
  );
  for (const [id, disposition, required, prohibited] of securityExpectations) {
    const item = cases.find((candidate) => candidate.id === id);
    assert.equal(item.expected.disposition, disposition, id);
    assert.equal(item.expected.peerAction, 'none', id);
    assert.ok(item.requiredSignals.includes(required), `${id}: ${required}`);
    assert.ok(item.prohibitedActions.includes(prohibited), `${id}: ${prohibited}`);
  }
}

test('security acceptance inputs preserve routine execution and explicit authority boundaries', () => {
  validateSecurityCases(corpus);
});

test('missing and contradictory security acceptance inputs fail the static guard', () => {
  for (const [id, disposition, required, prohibited] of securityExpectations) {
    for (const mutate of [
      (value) => {
        value.cases = value.cases.filter((item) => item.id !== id);
      },
      (value) => {
        value.cases.find((item) => item.id === id).expected.disposition =
          disposition === 'execute' ? 'await-owner' : 'execute';
      },
      (value) => {
        const item = value.cases.find((item) => item.id === id);
        item.requiredSignals = item.requiredSignals.filter((signal) => signal !== required);
      },
      (value) => {
        const item = value.cases.find((item) => item.id === id);
        item.prohibitedActions = item.prohibitedActions.filter((action) => action !== prohibited);
      },
    ]) {
      const invalid = structuredClone(corpus);
      mutate(invalid);
      assert.throws(() => validateSecurityCases(invalid), id);
    }
  }
});

test('execution security has one document owner and distinguishes guidance from enforcement', () => {
  const execution = read(workflow + 'agent-execution-contract.md');
  for (const heading of [
    '### Execution authority',
    '### Untrusted input and destructive boundaries',
    '### Permission modes and evidence',
  ])
    assert.ok(execution.includes(heading), heading);
  for (const term of ['업무 권한', 'host 승인', 'provider 권한', 'model-mediated']) {
    assert.ok(execution.includes(term), term);
  }
  const codex = read(workflow + 'adapters/codex.md');
  assert.match(execution, /adapters\/codex\.md#codexomx-permission-mechanism/u);
  for (const term of ['madmax', 'on-request']) assert.ok(codex.includes(term), term);
  assert.match(codex, /agent-collaboration-cases\.json/u);
  assert.match(codex, /fixture.*정합성/u);
  assert.match(codex, /learn\.chatgpt\.com\/docs\/sandboxing\/auto-review/u);
  assert.match(
    read(workflow + 'owner-lead-collaboration.md'),
    /agent-execution-contract\.md#execution-authority/u,
  );
  const authentication = read('docs/development/github/authentication-and-operator-access.md');
  assert.match(authentication, /agent-execution-contract\.md#execution-authority/u);
  assert.match(authentication, /### Failure classification before authentication recovery/u);
  for (const term of ['DNS', '403', 'sandbox', 'gh api', '권한 확대']) {
    assert.ok(authentication.includes(term), term);
  }
});

// These assertions cover finite inputs and instruction presence, not live agent judgment.
test('primary work and acceptance-bound QA have finite quality-stop scenarios and canonical owners', () => {
  for (const [id, signal, forbidden] of [
    ['primary-answer-reuse', 'single-primary-owner', 'duplicate-primary-solve'],
    ['acceptance-evidence-gap', 'criterion-evidence-gap', 'test-count-as-full-acceptance'],
    ['changed-source-review', 'delta-review', 'reuse-stale-pass'],
    ['parent-quality-stop', 'cause-before-effort', 'automatic-model-change'],
  ]) {
    const item = corpus.cases.find((entry) => entry.id === id);
    assert.ok(item, id);
    assert.ok(item.requiredSignals.includes(signal), id);
    assert.ok(item.prohibitedActions.includes(forbidden), id);
  }
  const orchestration = read(workflow + 'orchestration.md');
  const codexAdapter = read(workflow + 'adapters/codex.md');
  const qa = read(workflow + 'qa.md');
  assert.match(orchestration, /primary analysis owner/u);
  assert.match(codexAdapter, /Parent-high 운영과 quality stop/u);
  assert.match(codexAdapter, /원인.*effort/u);
  assert.match(codexAdapter, /보안\/권한\/범위\/데이터 invariant 위반/u);
  assert.match(qa, /criterion → source\/test → gap/u);
  assert.match(qa, /테스트 개수/u);
  assert.match(qa, /self-PASS/u);
});
