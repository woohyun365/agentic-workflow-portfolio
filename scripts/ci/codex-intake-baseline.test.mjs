import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import { selectAgentRoute } from '../agents/codex/routing-policy.mjs';

const repoRoot = resolve(import.meta.dirname, '../..');
const fixtures = JSON.parse(
  readFileSync(resolve(repoRoot, 'scripts/ci/fixtures/agent-intake-cases.json'), 'utf8'),
);
const capabilityOwners = {
  'task-envelope-contract': 'docs/development/agent-workflows/request-intake/task-envelope.md',
  'task-envelope-mapper': 'scripts/agents/common/intake-policy.mjs',
  'domain-guide-discovery': 'scripts/agents/common/domain-guide-registry.mjs',
  'analyze-output-contract': 'docs/development/agent-workflows/request-intake/output-contracts.md',
  'plan-output-contract': 'docs/development/agent-workflows/request-intake/output-contracts.md',
  'ambiguity-authority-gate':
    'docs/development/agent-workflows/request-intake/ambiguity-and-authority.md',
  'direct-path-gate': 'scripts/agents/common/intake-policy.mjs',
  'bounded-recovery': 'scripts/agents/codex/orchestration-policy.mjs',
};

test('representative intake fixtures declare observable outcomes and current gaps', () => {
  assert.deepEqual(
    fixtures.map(({ id }) => id),
    ['legal-analysis', 'legal-plan', 'direct-path', 'ambiguity-oq', 'retry-ceiling'],
  );

  for (const fixture of fixtures) {
    assert.ok(fixture.request.length > 0, `${fixture.id}: request is required`);
    assert.ok(fixture.expected.intent, `${fixture.id}: intent is required`);
    assert.ok(fixture.expected.authorizedAction, `${fixture.id}: authority is required`);
    assert.ok(fixture.expected.recommendedPath, `${fixture.id}: route is required`);
    assert.ok(fixture.expected.outputFields.length > 0, `${fixture.id}: output is required`);
    assert.ok(fixture.requiredCapabilities.length > 0, `${fixture.id}: capability is required`);
    assert.ok(Array.isArray(fixture.currentGaps), `${fixture.id}: current gaps must be an array`);
  }
});

test('baseline fixtures report only intake capabilities without a canonical owner', () => {
  const missingByFixture = Object.fromEntries(
    fixtures.map((fixture) => [
      fixture.id,
      fixture.requiredCapabilities.filter(
        (capability) => !existsSync(resolve(repoRoot, capabilityOwners[capability])),
      ),
    ]),
  );

  assert.deepEqual(missingByFixture, {
    'legal-analysis': [],
    'legal-plan': [],
    'direct-path': [],
    'ambiguity-oq': [],
    'retry-ceiling': [],
  });
});

test('route selection stays downstream-only and requires Pass 2 after Pass 1', () => {
  assert.throws(() => selectAgentRoute({}), /pass1 is required/u);

  const lookupRoute = selectAgentRoute({
    pass1: {
      taskKind: 'lookup',
      executionShape: 'bounded-child',
      impactRisk: 'low',
      candidateRole: null,
      requiredEvidence: ['repo'],
      confidence: 'high',
    },
  });
  assert.equal(lookupRoute.spawn, false);
  assert.equal(lookupRoute.execution, 'single-sequential');
  assert.match(lookupRoute.gaps.join(' '), /pass2-semantic-evidence-required/u);
  assert.equal(
    'request' in lookupRoute || 'intent' in lookupRoute || 'authorizedAction' in lookupRoute,
    false,
  );
});

test('intake baseline adds no product runtime dependency', () => {
  const packageManifest = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'));
  const dependencyNames = Object.keys(packageManifest.dependencies ?? {});

  assert.deepEqual(dependencyNames, []);
});
