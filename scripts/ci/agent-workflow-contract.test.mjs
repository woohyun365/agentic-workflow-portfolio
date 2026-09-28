import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import { buildTaskEnvelope, validateTaskEnvelope } from '../agents/common/intake-policy.mjs';
import { discoverContextPack } from '../agents/common/domain-guide-registry.mjs';
import { validateFixtureGraph } from '../agents/fixtures/workflow-contract/graph-oracle.mjs';
import { discoverScriptTests } from './repo-policy-test-files.mjs';

const root = resolve(import.meta.dirname, '../..');
const fixtureRoot = 'scripts/agents/fixtures/workflow-contract';
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const intake = JSON.parse(read(`${fixtureRoot}/intake-cases.json`));
const graphs = JSON.parse(read(`${fixtureRoot}/graph-cases.json`));
const repositoryEvidence = [
  { path: 'apps/api/src/example/example.controller.ts', kind: 'controller' },
];

test('oracle covers six outputs, not unknown or session lifecycle as additional intents', () => {
  assert.deepEqual(intake.cases.map(({ intent }) => intent).sort(), [
    'analyze',
    'answer',
    'debug',
    'implement',
    'plan',
    'review',
  ]);
  assert.deepEqual(
    intake.sessions.map(({ id }) => id),
    ['fresh', 'resume'],
  );
  assert.equal(intake.evidenceClass, 'actual-public-api-characterization');
  for (const row of intake.cases) assert.ok(row.rationale.length > 20);
});

// The session dimension is request wording, not a fabricated mode field on these APIs.
// Actual preflight fresh/resume behavior remains in codex-session-preflight.test.mjs.
for (const session of intake.sessions) {
  for (const row of intake.cases) {
    test(`actual intake: ${row.intent} × ${session.id} wording keeps output and Plan-only guides`, () => {
      const input = { request: `${session.prefix}${row.request}` };
      const before = structuredClone(input);
      const envelope = buildTaskEnvelope(input);
      const envelopeBefore = structuredClone(envelope);
      const pack = discoverContextPack({ envelope, repositoryEvidence });

      assert.equal(envelope.intent, row.intent, row.rationale);
      assert.equal(envelope.authorizedAction, row.action, row.rationale);
      assert.equal(validateTaskEnvelope(envelope).valid, true);
      assert.deepEqual(input, before);
      assert.deepEqual(envelope, envelopeBefore, 'context discovery cannot enlarge authority');
      assert.equal(Object.isFrozen(envelope), true);
      assert.equal(Object.isFrozen(pack), true);
      assert.equal(pack.sources[0].owner, 'backend');
      assert.deepEqual(
        pack.selectedGuides.map(({ path }) => path),
        row.intent === 'plan'
          ? [
              'docs/development/agent-workflows/plan-authoring/core.md',
              'docs/development/agent-workflows/plan-authoring/backend.md',
            ]
          : [],
      );
    });
  }
}

test('independent minimal contrast: cause investigation differs from an explicit fix', () => {
  const diagnosis = buildTaskEnvelope({ request: 'Investigate the failing API test.' });
  const repair = buildTaskEnvelope({ request: 'Fix the failing API test.' });
  assert.equal(diagnosis.authorizedAction, 'produce-analysis');
  assert.equal(repair.intent, 'debug');
  assert.equal(repair.authorizedAction, 'mutate');
  // An analysis verb takes precedence over mention of a repair; do not copy a fixture action map.
  const mixed = buildTaskEnvelope({ request: 'Analyze why this fix failed.' });
  assert.equal(mixed.intent, 'analyze');
  assert.equal(mixed.authorizedAction, 'produce-analysis');
});

for (const intent of ['answer', 'analyze', 'plan', 'review']) {
  test(`actual authority validator rejects ${intent} → mutate independently of classification`, () => {
    const envelope = buildTaskEnvelope({ request: 'API 역할을 설명해줘.' });
    const result = validateTaskEnvelope({ ...envelope, intent, authorizedAction: 'mutate' });
    assert.equal(result.valid, false);
    assert.ok(
      result.errors.includes('Mutate authority requires explicit implement or debug intent.'),
    );
  });
}

test('unknown request is fail-safe inspection, not a seventh normal workflow', () => {
  const envelope = buildTaskEnvelope({ request: 'Legal을 개선해줘.' });
  assert.equal(envelope.intent, 'unknown');
  assert.equal(envelope.authorizedAction, 'inspect');
  assert.equal(envelope.recommendedPath, 'clarify');
  assert.deepEqual(discoverContextPack({ envelope, repositoryEvidence }).selectedGuides, []);
  for (const patch of [{ authorizedAction: 'mutate' }, { recommendedPath: 'bounded-lanes' }]) {
    assert.equal(validateTaskEnvelope({ ...envelope, ...patch }).valid, false);
  }
});

for (const host of ['codex', 'claude', 'unknown', 'synthetic-third']) {
  test(`actual neutral APIs: ${host} environment evidence grants no host or mutation authority`, () => {
    const envelope = buildTaskEnvelope({
      request: 'API 구조를 분석해줘.',
      constraints: [{ source: 'environment', statement: `Host observation: ${host}` }],
    });
    assert.equal(envelope.authorizedAction, 'produce-analysis');
    assert.deepEqual(discoverContextPack({ envelope, repositoryEvidence }).selectedGuides, []);
    for (const key of ['host', 'model', 'capabilities', 'sessionMode']) {
      assert.equal(Object.hasOwn(envelope, key), false);
      const result = validateTaskEnvelope({ ...envelope, [key]: host });
      assert.equal(result.valid, false);
      assert.ok(result.errors.includes(`Unsupported TaskEnvelope field: ${key}`));
    }
  });
}

test('source-linked contracts retain advisory authority and Plan-only selection meaning', () => {
  const authority = read(intake.sources.authority);
  const guides = read(intake.sources.guideContract);
  assert.match(authority, /Analyze requests cannot authorize `mutate`/u);
  assert.match(authority, /Plan requests authorize `produce-plan`, not implementation/u);
  assert.match(guides, /Plan intent만 `plan-authoring\/core\.md`/u);
  assert.match(
    guides,
    /ContextPack은 mutation authority 또는 child spawn authority를 부여하지 않습니다/u,
  );
  for (const sourcePath of [intake.sources.intake, intake.sources.guides]) {
    const source = read(sourcePath);
    assert.doesNotMatch(source, /node:(?:fs|child_process)|\b(?:fetch|spawn|exec|import)\s*\(/u);
    assert.doesNotMatch(
      source,
      /from\s+['"][^'"]*(?:codex|claude|routing-policy|orchestration-policy)/u,
    );
  }
});

for (const row of graphs.cases) {
  test(`Synthetic fixture-only graph oracle: ${row.id}`, () => {
    assert.equal(graphs.evidenceClass, 'synthetic-test-only-graph-not-runtime');
    const graph = structuredClone(graphs.graph);
    graph.nodes.push(...(row.addNodes ?? []));
    graph.edges.push(...(row.addEdges ?? []));
    assert.deepEqual(validateFixtureGraph(graph, { host: row.host }), row.expected);
  });
}

test('actual repo-policy discovery includes the contract suite without fixture runners', () => {
  const discovered = discoverScriptTests(root);
  assert.ok(discovered.includes('scripts/ci/agent-workflow-contract.test.mjs'));
  assert.equal(
    discovered.some((path) => path.startsWith('scripts/agents/fixtures/')),
    false,
  );
});
