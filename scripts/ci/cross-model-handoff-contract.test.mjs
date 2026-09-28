import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  CROSS_MODEL_HANDOFF_SCHEMA,
  validateCrossModelExchange,
  validateCrossModelPacket,
  validateCrossModelResult,
} from '../agents/common/cross-model-handoff.mjs';

const fixturePath = resolve(import.meta.dirname, 'fixtures/cross-model-handoff-cases.json');
const corpus = JSON.parse(readFileSync(fixturePath, 'utf8'));

test('fixture corpus uses the public schema and contains unique adversarial case names', () => {
  assert.equal(corpus.basePacket.schemaVersion, CROSS_MODEL_HANDOFF_SCHEMA);
  assert.equal(corpus.baseResult.schemaVersion, CROSS_MODEL_HANDOFF_SCHEMA);
  assert.ok(corpus.cases.length >= 20);
  assert.equal(new Set(corpus.cases.map(({ name }) => name)).size, corpus.cases.length);
});

for (const fixture of corpus.cases) {
  test(`cross-model handoff: ${fixture.name}`, () => {
    const packet = structuredClone(corpus.basePacket);
    const result = structuredClone(corpus.baseResult);
    const subject =
      fixture.target === 'exchange'
        ? { packet, result }
        : fixture.target === 'packet'
          ? packet
          : result;
    for (const patch of fixture.patches ?? []) applyPatch(subject, patch);

    const currentSnapshot = structuredClone(packet.snapshot);
    if (fixture.options?.currentSnapshotHeadSHA) {
      currentSnapshot.headSHA = fixture.options.currentSnapshotHeadSHA;
    }
    const options = {
      currentSnapshot,
      seenDispatchIds: fixture.options?.seenDispatchIds ?? [],
      seenResultIds: fixture.options?.seenResultIds ?? [],
    };
    const before = structuredClone({ packet, result });
    const validation =
      fixture.target === 'packet'
        ? validateCrossModelPacket(packet, options)
        : fixture.target === 'result'
          ? validateCrossModelResult(result, { packet, ...options })
          : validateCrossModelExchange({ packet, result, ...options });

    assert.equal(
      validation.decision,
      fixture.expectedDecision,
      JSON.stringify(validation, null, 2),
    );
    if (fixture.expectedClass) assert.equal(validation.verificationClass, fixture.expectedClass);
    if (fixture.errorIncludes) {
      assert.ok(
        validation.errors.some((error) => error.includes(fixture.errorIncludes)),
        JSON.stringify(validation, null, 2),
      );
    }
    if (fixture.expectedLiveCheck) {
      assert.ok(validation.liveChecks.includes(fixture.expectedLiveCheck));
    }
    for (const expectedLiveCheck of fixture.expectedLiveChecks ?? []) {
      assert.ok(validation.liveChecks.includes(expectedLiveCheck), expectedLiveCheck);
    }
    assert.deepEqual({ packet, result }, before, 'validation must not mutate caller input');
    assert.equal(Object.isFrozen(validation), true);
    assert.equal(Object.isFrozen(validation.errors), true);
    assert.equal(Object.isFrozen(validation.liveChecks), true);
  });
}

test('packet and result identities are bound instead of inferred from host state', () => {
  const packet = structuredClone(corpus.basePacket);
  const result = structuredClone(corpus.baseResult);
  result.packetId = 'another-packet';
  result.dispatchId = 'another-dispatch';
  result.contextIsolationMethod = 'builder-history';
  result.identity.requestedModelIntent = 'provider-specific-model';
  result.cleanup.owner = 'reviewer';
  result.handoff.integrationOwner = 'reviewer';

  const validation = validateCrossModelResult(result, { packet, currentSnapshot: packet.snapshot });
  assert.equal(validation.verificationClass, 'static-reject');
  for (const boundary of [
    'packetId',
    'dispatchId',
    'contextIsolationMethod',
    'identity.requestedModelIntent',
    'cleanup.owner',
    'handoff.integrationOwner',
  ]) {
    assert.ok(
      validation.errors.some((error) => error.includes(boundary)),
      boundary,
    );
  }
});

test('direct result validation rejects malformed packet fields without throwing', () => {
  for (const [field, value] of [
    ['evidence.knownFailures', {}],
    ['boundaries.permittedOutputPaths', 7],
  ]) {
    const packet = structuredClone(corpus.basePacket);
    const [owner, key] = field.split('.');
    packet[owner][key] = value;
    const validation = validateCrossModelResult(structuredClone(corpus.baseResult), {
      packet,
      currentSnapshot: packet.snapshot,
    });
    assert.equal(validation.decision, 'reject', field);
    assert.ok(
      validation.errors.some((error) => error.includes(field)),
      field,
    );
  }
});

test('snapshot equality accepts repository SHA-1 identities and ignores untracked-input order', () => {
  const packet = structuredClone(corpus.basePacket);
  packet.snapshot.baseSHA = '1'.repeat(40);
  packet.snapshot.headSHA = '2'.repeat(40);
  packet.snapshot.untrackedInputDigests.push({
    path: 'docs/development/agent-workflows/qa.md',
    digest: `sha256:${'5'.repeat(64)}`,
  });
  const currentSnapshot = {
    untrackedInputDigests: [...packet.snapshot.untrackedInputDigests].reverse(),
    dirtyDiffDigest: packet.snapshot.dirtyDiffDigest,
    headSHA: packet.snapshot.headSHA,
    baseSHA: packet.snapshot.baseSHA,
  };
  const validation = validateCrossModelPacket(packet, { currentSnapshot });
  assert.equal(validation.decision, 'accept', JSON.stringify(validation.errors));
});

test('H4 matrix is explicitly unqualified, bidirectional, runner-oracle-owned and cleanup-bound', () => {
  assert.deepEqual(
    new Set(corpus.h4Matrix.map(({ direction }) => direction)),
    new Set(['codex-maker-claude-checker', 'claude-maker-codex-checker', 'lead-takeover']),
  );
  for (const row of corpus.h4Matrix) {
    assert.equal(row.actualInvocation, 'not-run');
    assert.equal(row.cleanupOwner, corpus.basePacket.lifecycle.cleanupOwner);
    assert.equal(row.packetFixture.base, 'basePacket');
    const materializedPacket = structuredClone(corpus.basePacket);
    for (const patch of row.packetFixture.patches) applyPatch(materializedPacket, patch);
    assert.equal(materializedPacket.intent.direction, row.direction);
    const packetValidation = validateCrossModelPacket(materializedPacket, {
      currentSnapshot: materializedPacket.snapshot,
    });
    assert.equal(packetValidation.decision, 'accept', JSON.stringify(packetValidation.errors));
    assert.match(row.runnerOnlyOracleFixtureRef, /^case:/u);
    assert.ok(corpus.cases.some(({ name }) => `case:${name}` === row.runnerOnlyOracleFixtureRef));
    assert.ok(row.seededFailure.length > 0);
    assert.ok(row.expectedFailure.length > 0);
    assert.ok(row.evidence.includes('cleanup receipt'));
    assert.equal('runnerOnlyOracleFixtureRef' in materializedPacket, false);
    assert.equal('seededFailure' in materializedPacket, false);
    assert.equal('expectedFailure' in corpus.basePacket, false);
  }
});

test('tracked workflow docs discover the neutral contract without local plan authority', () => {
  const repoRoot = resolve(import.meta.dirname, '../..');
  const adapterPath = resolve(
    repoRoot,
    'docs/development/agent-workflows/adapters/cross-model-handoff.md',
  );
  assert.equal(existsSync(adapterPath), true);
  const adapter = readFileSync(adapterPath, 'utf8');
  const qa = readFileSync(resolve(repoRoot, 'docs/development/agent-workflows/qa.md'), 'utf8');
  const adapterIndex = readFileSync(
    resolve(repoRoot, 'docs/development/agent-workflows/adapters/README.md'),
    'utf8',
  );
  assert.match(qa, /adapters\/cross-model-handoff\.md/u);
  assert.match(adapterIndex, /cross-model-handoff\.md/u);
  assert.doesNotMatch(adapter, /\.omx\/plans/u);
  for (const linkedPath of [
    '../../../../scripts/agents/common/cross-model-handoff.mjs',
    '../../../../scripts/ci/fixtures/cross-model-handoff-cases.json',
  ]) {
    assert.match(adapter, new RegExp(linkedPath.replaceAll('.', '\\.')));
    assert.equal(existsSync(resolve(adapterPath, '..', linkedPath)), true, linkedPath);
  }
});

function applyPatch(target, patch) {
  const segments = patch.path.split('.');
  const key = segments.pop();
  let parent = target;
  for (const segment of segments) {
    assert.ok(
      parent !== null && typeof parent === 'object',
      `invalid fixture patch path: ${patch.path}`,
    );
    parent = parent[segment];
  }
  if (patch.op === 'set') parent[key] = structuredClone(patch.value);
  else if (patch.op === 'delete') delete parent[key];
  else assert.fail(`unsupported fixture patch operation: ${patch.op}`);
}

test('same-host independent review uses the neutral QA contract without pretending cross-host transport', () => {
  const packet = structuredClone(corpus.basePacket);
  const result = structuredClone(corpus.baseResult);
  packet.intent.direction = 'same-host-independent-review';
  assert.equal(
    validateCrossModelExchange({ packet, result, currentSnapshot: packet.snapshot }).valid,
    true,
  );
  packet.review.freshContext = false;
  assert.equal(
    validateCrossModelExchange({ packet, result, currentSnapshot: packet.snapshot }).valid,
    false,
  );
});
