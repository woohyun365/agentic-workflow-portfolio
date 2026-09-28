import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getModelProfile,
  createModelProfileBinding,
  assertCurrentModelProfileBinding,
  resolveRouteEffort,
} from '../agents/codex/model-profiles.mjs';

test('finite immutable profiles resolve GPT-6 models independently from semantic effort', () => {
  for (const [id, model, effort] of [
    ['bounded-read', 'gpt-6-sol', 'xhigh'],
    ['bounded-build', 'gpt-6-sol', 'xhigh'],
    ['bounded-extract', 'gpt-6-luna', 'xhigh'],
  ]) {
    const p = getModelProfile(id);
    const b = createModelProfileBinding(p);
    assert.equal(b.model, model);
    assert.equal(b.resolvedEffort, effort);
    assert.match(b.profileDigest, /^sha256:[a-f0-9]{64}$/);
    assert.doesNotThrow(() => assertCurrentModelProfileBinding(b));
    assert.throws(() => p.taskKinds.push('review'), TypeError);
    assert.equal(
      resolveRouteEffort({
        effort: 'medium',
        modelRecommendation: { status: 'candidate', profileBinding: b },
      }),
      effort,
    );
  }
  assert.equal(resolveRouteEffort({ effort: 'xhigh' }), 'xhigh');
  assert.equal(
    resolveRouteEffort({ effort: 'high', modelRecommendation: { status: 'baseline' } }),
    'high',
  );
  for (const id of ['gpt-5.6-sol', 'gpt-6-sol', 'latest', 'gpt-7', '__proto__'])
    assert.throws(() => getModelProfile(id), TypeError);
});

test('binding hashes complete policy canonically; synthetic future profiles never become installed', () => {
  const p = getModelProfile('bounded-build');
  const current = createModelProfileBinding(p);
  assert.deepEqual(
    createModelProfileBinding(Object.fromEntries(Object.entries(p).reverse())),
    current,
  );
  for (const patch of [
    { policyRevision: 'next' },
    { model: 'gpt-7' },
    { resolvedEffort: 'high' },
    { taskKinds: ['review'] },
    { allowedTools: ['repository-read'] },
    { routineRoles: [] },
  ]) {
    const future = createModelProfileBinding({ ...p, ...patch });
    assert.notEqual(future.profileDigest, current.profileDigest);
    assert.throws(() => assertCurrentModelProfileBinding(future), TypeError);
  }
  for (const patch of [
    { policyRevision: 'old' },
    { profileDigest: `sha256:${'0'.repeat(64)}` },
    { model: 'gpt-5.6-sol' },
    { resolvedEffort: 'high' },
    { cohort: 'bounded-extraction' },
    { extra: true },
  ]) {
    assert.throws(() => assertCurrentModelProfileBinding({ ...current, ...patch }), TypeError);
  }
});

test('previous effort revisions cannot be restored by rehashing profile data', () => {
  for (const id of ['bounded-build', 'bounded-read', 'bounded-extract']) {
    const profile = getModelProfile(id);
    assert.notEqual(profile.policyRevision, '2026-09-24.1');
    for (const resolvedEffort of ['medium', 'high', 'max']) {
      assert.throws(
        () =>
          assertCurrentModelProfileBinding(
            createModelProfileBinding({
              ...profile,
              policyRevision: '2026-09-24.1',
              resolvedEffort,
            }),
          ),
        TypeError,
      );
    }
  }
});

test('recovery policy chooses low only for finite known non-QA work and never accepts raw effort', async () => {
  const { createRecoveryBinding, assertCurrentRecoveryBinding } =
    await import('../agents/codex/model-profiles.mjs');
  const digest = `sha256:${'a'.repeat(64)}`;
  const input = {
    primary: {
      profileBinding: createModelProfileBinding(getModelProfile('bounded-read')),
      attemptId: 'primary',
      taskId: 'task-1',
      laneId: 'lane-1',
      childId: '/root/primary',
      sourceDigest: digest,
      scopeDigest: digest,
      ownershipDigest: digest,
      failureCategory: 'verification-failed',
    },
    rescue: {
      attemptId: 'rescue',
      taskId: 'task-1',
      laneId: 'lane-1',
      sourceDigest: digest,
      scopeDigest: digest,
      configDigest: digest,
      role: 'repo_explorer',
      semanticEffort: 'medium',
      impactRisk: 'low',
    },
    assessment: {
      cause: 'controlled-injection',
      bounded: true,
      contextComplete: true,
      oracleAvailable: true,
      identityVerified: true,
      reasonRefs: ['evidence:known-failure'],
    },
  };
  const b = createRecoveryBinding(input);
  assert.equal(b.kind, 'model-recovery');
  assert.equal(b.policyId, 'astra-bounded-recovery');
  assert.equal(b.model, 'gpt-6-astra');
  assert.equal(b.resolvedEffort, 'low');
  assert.doesNotThrow(() => assertCurrentRecoveryBinding(b));
  for (const mutate of [
    (x) => {
      x.assessment.cause = 'unknown';
    },
    (x) => {
      x.assessment.cause = 'reasoning-miss';
    },
    (x) => {
      x.assessment.bounded = false;
    },
    (x) => {
      x.rescue.impactRisk = 'high';
    },
  ]) {
    const x = structuredClone(input);
    mutate(x);
    assert.notEqual(createRecoveryBinding(x).resolvedEffort, 'low');
  }
  for (const effort of ['medium', 'high', 'xhigh']) {
    const x = structuredClone(input);
    x.assessment.cause = 'unknown';
    x.rescue.semanticEffort = effort;
    assert.equal(createRecoveryBinding(x).resolvedEffort, effort);
  }
  for (const mutate of [
    (x) => {
      x.rescue.role = 'repo_reviewer';
    },
    (x) => {
      x.assessment.identityVerified = false;
    },
    (x) => {
      x.rescue.semanticEffort = 'low';
    },
    (x) => {
      x.rescue.resolvedEffort = 'max';
    },
  ]) {
    const x = structuredClone(input);
    mutate(x);
    assert.throws(() => createRecoveryBinding(x), TypeError);
  }
  for (const patch of [
    { resolvedEffort: 'high' },
    { model: 'gpt-5.6-sol' },
    { policyRevision: 'old' },
    { selectionDigest: digest },
  ])
    assert.throws(() => assertCurrentRecoveryBinding({ ...b, ...patch }), TypeError);
});

test('quality-only revision grants do not survive recovery policy activation', () => {
  for (const id of ['bounded-build', 'bounded-read', 'bounded-extract']) {
    const old = createModelProfileBinding({
      ...getModelProfile(id),
      policyRevision: '2026-09-24.2',
    });
    assert.throws(() => assertCurrentModelProfileBinding(old), TypeError);
  }
});

// Fingerprint/data seam only: this does not install a registry or protect against
// an operator restoring old validator code together with old grants.
test('rollback data with a new revision has a new binding, not a revived old grant', () => {
  const current = getModelProfile('bounded-build');
  const original = createModelProfileBinding(current);
  const changed = createModelProfileBinding({
    ...current,
    policyRevision: 'synthetic-next',
    resolvedEffort: 'high',
  });
  const rolledBack = createModelProfileBinding({
    ...current,
    policyRevision: 'synthetic-rollback-new-revision',
  });
  assert.equal(rolledBack.model, original.model);
  assert.equal(rolledBack.resolvedEffort, original.resolvedEffort);
  assert.notEqual(rolledBack.profileDigest, original.profileDigest);
  assert.notEqual(rolledBack.profileDigest, changed.profileDigest);
  for (const uninstalled of [changed, rolledBack])
    assert.throws(() => assertCurrentModelProfileBinding(uninstalled), TypeError);
  assert.deepEqual(assertCurrentModelProfileBinding(original), original);
});
