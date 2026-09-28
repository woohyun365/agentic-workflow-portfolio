import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { discoverPlans, readPlan, assessPlanContinuation } from '../agents/common/plan-store.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'neutral-plans-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (path, text = '- Plan ID: task-one\n- Status: active\n') => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  return { root, put };
}

test('missing common root is explicit, never reads legacy runtime or creates files', (t) => {
  const { root, put } = fixture(t);
  put('.omx/plans/legacy.md');
  assert.deepEqual(discoverPlans(root), {
    plans: [],
    issues: ['missing-root'],
    complete: false,
    identityComplete: false,
    identityIssues: ['missing-root'],
  });
  assert.equal(readPlan(root, '.plans/absent.md').state, 'missing');
});

test('discovery ignores navigation, nested support and terminal plans; explicit support can resume', (t) => {
  const { root, put } = fixture(t);
  put('.plans/README.md', '# Navigation\n');
  put('.plans/current.md');
  put('.plans/supporting/detail.md', '# Design detail without a separate lifecycle\n');
  put('.plans/supporting/child.md', '- Plan ID: child\n- Status: active\n');
  put('.plans/cancelled/old.md', '- Plan ID: old\n- Status: active\n');
  put('.plans/ended.md', '- Plan ID: ended\n- Status: completed\n');
  assert.deepEqual(
    discoverPlans(root).plans.map((p) => p.path),
    ['.plans/current.md'],
  );
  assert.equal(readPlan(root, '.plans/supporting/child.md').state, 'active');
  assert.equal(readPlan(root, '.plans/cancelled/old.md').state, 'archived');
  assert.equal(readPlan(root, '.plans/ended.md').state, 'terminal');
  assert.equal(readPlan(root, '.plans/README.md').state, 'navigation');
});

test('path boundary rejects root, nested symlinks, traversal and absolute/foreign paths', (t) => {
  const { root, put } = fixture(t);
  put('.plans/ok.md');
  put('outside.md');
  symlinkSync(join(root, 'outside.md'), join(root, '.plans/link.md'));
  symlinkSync(root, join(root, '.plans/directory'));
  for (const path of [
    '.plans/../outside.md',
    join(root, '.plans/ok.md'),
    '.omx/plans/ok.md',
    '.plans/link.md',
    '.plans/directory/outside.md',
    '.plans//ok.md',
    '.plans/./ok.md',
  ])
    assert.equal(readPlan(root, path).state, 'unsafe', path);
  const other = fixture(t);
  other.put('store/ok.md');
  symlinkSync(join(other.root, 'store'), join(other.root, '.plans'));
  assert.equal(readPlan(other.root, '.plans/ok.md').state, 'unsafe');
});

test('duplicate IDs fail closed, moved pointers remain missing without archive fallback', (t) => {
  const { root, put } = fixture(t);
  put('.plans/one.md');
  put('.plans/supporting/two.md');
  assert.equal(readPlan(root, '.plans/one.md').state, 'ambiguous');
  assert.equal(discoverPlans(root).plans.length, 0);
  rmSync(join(root, '.plans/supporting/two.md'));
  renameSync(join(root, '.plans/one.md'), join(root, '.plans/moved.md'));
  assert.equal(readPlan(root, '.plans/one.md').state, 'missing');
  assert.equal(readPlan(root, '.plans/moved.md').state, 'active');
});

test('metadata is bounded and top-level; invalid/duplicate declarations cannot be inferred from prose', (t) => {
  const { root, put } = fixture(t);
  for (const [name, text] of Object.entries({
    body: '# Plan\n## Work\n- Plan ID: body\n- Status: active',
    fence: '```\n- Plan ID: fence\n- Status: active\n```',
    conflict: '- Plan ID: conflict\n- Status: active\n- Status: done',
    unknown: '- Plan ID: unknown\n- Status: perhaps',
    tooBig: 'a'.repeat(65537),
  })) {
    put(`.plans/${name}.md`, text);
    assert.equal(readPlan(root, `.plans/${name}.md`).state, 'unknown', name);
  }
});

test('resume selection never grants write/host authority; source mismatch and terminal states block', (t) => {
  const { root, put } = fixture(t);
  put('.plans/current.md');
  const plan = readPlan(root, '.plans/current.md');
  const snapshot = { branch: 'work', head: 'a'.repeat(40), diffHash: 'b'.repeat(64) };
  const input = {
    plan,
    mode: 'resume',
    explicitlySelected: true,
    expectedPlanId: 'task-one',
    checkpointSnapshot: snapshot,
    currentSnapshot: snapshot,
  };
  assert.equal(assessPlanContinuation(input).decision, 'candidate');
  for (const delta of [
    { mode: 'fresh' },
    { explicitlySelected: false },
    { expectedPlanId: 'other' },
    { checkpointSnapshot: null },
    { currentSnapshot: { ...snapshot, diffHash: 'c'.repeat(64) } },
    { plan: { ...plan, state: 'terminal' } },
  ])
    assert.notEqual(assessPlanContinuation({ ...input, ...delta }).decision, 'candidate');
  assert.equal(assessPlanContinuation(input).grantsExecutionAuthority, false);
});

test('unknown lifecycle is not active and archival terminal aliases remain explicit', (t) => {
  const { root, put } = fixture(t);
  for (const status of ['paused', 'blocked', 'proposed', 'superseded', 'cancelled']) {
    put(`.plans/${status}.md`, `- Plan ID: ${status}\n- Status: ${status}\n`);
    assert.notEqual(readPlan(root, `.plans/${status}.md`).state, 'active');
  }
  assert.deepEqual(discoverPlans(root).plans, []);
});

test('implementation-ready is an active candidate and duplicate discovery exposes its ambiguity', (t) => {
  const { root, put } = fixture(t);
  put('.plans/ready.md', '- Plan ID: ready\n- Status: implementation-ready\n');
  assert.equal(readPlan(root, '.plans/ready.md').state, 'active');
  assert.equal(discoverPlans(root).plans.length, 1);
  put('.plans/copy.md', '- Plan ID: ready\n- Status: active\n');
  assert.ok(discoverPlans(root).issues.includes('duplicate-plan-id'));
  assert.equal(discoverPlans(root).complete, false);
});

test('a bounded partial inventory never certifies unique active resume', (t) => {
  const { root, put } = fixture(t);
  put('.plans/current.md');
  for (let i = 0; i < 513; i++) put(`.plans/supporting/detail-${i}.md`, '# Supporting notes\n');
  const inventory = discoverPlans(root);
  assert.equal(inventory.complete, false);
  assert.ok(inventory.issues.includes('candidate-limit'));
  assert.equal(inventory.identityComplete, false);
  assert.deepEqual(inventory.plans, []);
  assert.equal(readPlan(root, '.plans/current.md').state, 'unknown');
});

test('fenced and indented examples never become active plan metadata', (t) => {
  const { root, put } = fixture(t);
  for (const [name, text] of Object.entries({
    nested: '# Supporting example\n````\n```md\n- Plan ID: example\n- Status: active\n```\n````\n',
    shortClose: '~~~~\n~~~\n- Plan ID: example\n- Status: active\n~~~~\n',
    invalidClose: '```md\n```still-code\n- Plan ID: example\n- Status: active\n```\n',
    indented: '    - Plan ID: example\n    - Status: active\n',
  })) {
    put(`.plans/${name}.md`, text);
    assert.equal(readPlan(root, `.plans/${name}.md`).state, 'unknown', name);
  }
  assert.deepEqual(discoverPlans(root).plans, []);
  put(
    '.plans/actual.md',
    '````md\n- Plan ID: ignored\n- Status: cancelled\n`````\n- Plan ID: actual\n- Status: active\n',
  );
  assert.equal(readPlan(root, '.plans/actual.md').state, 'active');
});

test('malformed candidates remain unresumable without poisoning a complete identity scan', (t) => {
  const { root, put } = fixture(t);
  put('.plans/current.md');
  put('.plans/supporting/detail.md', '# Supporting detail without metadata\n');
  assert.equal(discoverPlans(root).complete, false);
  assert.equal(discoverPlans(root).identityComplete, true);
  assert.equal(readPlan(root, '.plans/supporting/detail.md').state, 'unknown');
  for (const status of ['perhaps', 'constructor', '__proto__']) {
    put('.plans/unclear.md', `- Plan ID: unclear\n- Status: ${status}\n`);
    assert.equal(readPlan(root, '.plans/unclear.md').state, 'unknown');
    assert.ok(discoverPlans(root).issues.includes('metadata-unknown'));
    assert.equal(discoverPlans(root).complete, false);
    assert.equal(readPlan(root, '.plans/current.md').state, 'active');
  }
});

test('legacy authoring status aliases normalize without changing runtime ownership', (t) => {
  const { root, put } = fixture(t);
  for (const [raw, status] of Object.entries({
    'in-progress': 'active',
    draft: 'proposed',
    진행중: 'active',
    초안: 'proposed',
    제안: 'proposed',
    차단: 'blocked',
    '구현 준비 완료': 'implementation-ready',
  })) {
    put('.plans/one.md', `- Plan ID: one\n- Status: ${raw}\n`);
    assert.equal(readPlan(root, '.plans/one.md').status, status);
  }
});

test('large bodies and non-executable lifecycle warnings preserve selected readiness and audit gaps', (t) => {
  const { root, put } = fixture(t);
  put('.plans/current.md', '- Plan ID: task-one\n- Status: active\n## Work\n' + 'x'.repeat(100000));
  put(
    '.plans/supporting/detail.md',
    '- Document Type: reference\n- Status: partial detail\n## Notes\n' + 'x'.repeat(100000),
  );
  put(
    '.plans/finished/history.md',
    '- Plan ID: history\n- Status: completed with caveats\n## History\n',
  );
  put('.plans/pending/old.md', '- Status: pending old decision\n## Work\n');
  const scan = discoverPlans(root);
  assert.equal(scan.complete, false);
  assert.ok(scan.issues.includes('metadata-unknown'));
  assert.equal(scan.identityComplete, true);
  assert.deepEqual(scan.identityIssues, []);
  assert.deepEqual(
    scan.plans.map((p) => p.path),
    ['.plans/current.md'],
  );
  const selected = readPlan(root, '.plans/current.md');
  assert.equal(selected.state, 'active');
  assert.equal(selected.complete, false);
  assert.equal(selected.identityComplete, true);
  assert.equal(readPlan(root, '.plans/supporting/detail.md').state, 'reference');
  assert.equal(readPlan(root, '.plans/finished/history.md').state, 'archived');
  assert.equal(readPlan(root, '.plans/pending/old.md').state, 'unknown');
});

test('document classification is explicit and never inferred from supporting location', (t) => {
  const { root, put } = fixture(t);
  for (const [name, text, expected] of [
    ['detail', '- Document Type: reference\n', 'reference'],
    ['missing', '# Supporting notes\n', 'unknown'],
    ['status-only', '- Status: active\n', 'unknown'],
    ['ambiguous', '- Document Type: reference\n- Document Type: reference\n', 'unknown'],
    ['invalid', '- Document Type: narrative\n', 'unknown'],
    ['standalone', '- Plan ID: standalone\n- Status: active\n', 'active'],
  ]) {
    put(`.plans/supporting/${name}.md`, text);
    assert.equal(readPlan(root, `.plans/supporting/${name}.md`).state, expected);
  }
});

test('all actual header declarations participate in duplicate identity detection', (t) => {
  const { root, put } = fixture(t);
  put('.plans/current.md');
  for (const path of [
    '.plans/other.md',
    '.plans/supporting/other.md',
    '.plans/finished/other.md',
    '.plans/cancelled/other.md',
    '.plans/README.md',
  ]) {
    put(path, '- Document Type: reference\n- Plan ID: task-one\n- Status: narrative\n');
    assert.equal(readPlan(root, '.plans/current.md').state, 'ambiguous', path);
    assert.ok(discoverPlans(root).identityIssues.includes('duplicate-plan-id'), path);
    rmSync(join(root, path));
  }
  put(
    '.plans/supporting/example.md',
    '- Document Type: reference\n```md\n- Plan ID: task-one\n```\n    - Plan ID: task-one\n## Body\n- Plan ID: task-one\n',
  );
  assert.equal(readPlan(root, '.plans/current.md').state, 'active');
});

test('invalid or repeated identity declarations cannot hide behind reference classification', (t) => {
  const { root, put } = fixture(t);
  put('.plans/current.md');
  for (const declaration of [
    '- Plan ID: bad_id',
    '- Plan ID: task-one\n- Plan ID: other',
    '- Plan ID: task-one\n- Plan ID: task-one',
  ]) {
    put('.plans/supporting/detail.md', `- Document Type: reference\n${declaration}\n`);
    assert.equal(discoverPlans(root).identityComplete, false);
    assert.ok(discoverPlans(root).identityIssues.includes('identity-invalid'));
    assert.notEqual(readPlan(root, '.plans/current.md').state, 'active');
  }
});

test('incomplete headers fail closed while a bounded complete header may precede an arbitrary body', (t) => {
  const { root, put } = fixture(t);
  put('.plans/current.md');
  for (const header of [
    '- Document Type: reference\n' + 'x'.repeat(65537),
    '- Document Type: reference\n```md\n## Not a boundary\n' + 'x'.repeat(65537),
    '- Document Type: reference\n```md\n',
    '- Document Type: reference\n' + 'x'.repeat(65537) + '\n## Too late\n',
  ]) {
    put('.plans/supporting/incomplete.md', header);
    assert.equal(discoverPlans(root).identityComplete, false);
    assert.equal(readPlan(root, '.plans/current.md').state, 'unknown');
  }
  put(
    '.plans/supporting/incomplete.md',
    '- Document Type: reference\n## Body\n' + 'x'.repeat(65537),
  );
  assert.equal(discoverPlans(root).identityComplete, true);
  assert.equal(readPlan(root, '.plans/current.md').state, 'active');
});

test('short reads and read errors cannot certify header identity completeness', (t) => {
  const { root, put } = fixture(t);
  put('.plans/short.md', '## Body\n' + 'x'.repeat(100));
  for (const failure of ['short', 'error']) {
    const run = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
      import fs from 'node:fs';
      import { syncBuiltinESMExports } from 'node:module';
      const { discoverPlans } = await import(${JSON.stringify(new URL('../agents/common/plan-store.mjs', import.meta.url).href)});
      const original = fs.readSync;
      fs.readSync = (fd, buffer, offset, length, position) => {
        if (${JSON.stringify(failure)} === 'error') throw Object.assign(new Error('read failed'), { code: 'EIO' });
        return original(fd, buffer, offset, Math.min(length, 3), position);
      };
      syncBuiltinESMExports();
      process.stdout.write(JSON.stringify(discoverPlans(${JSON.stringify(root)})));
    `,
      ],
      { encoding: 'utf8', timeout: 10000 },
    );
    assert.equal(run.status, 0, run.stderr);
    const scan = JSON.parse(run.stdout);
    assert.equal(scan.identityComplete, false, failure);
    assert.deepEqual(scan.plans, []);
    assert.ok(
      scan.identityIssues.includes(
        failure === 'short' ? 'header-incomplete' : 'unreadable-or-unsafe',
      ),
    );
  }
});

test('only a complete boundary line within the header byte budget admits a large body', (t) => {
  const { root, put } = fixture(t);
  put('.plans/current.md');
  const prefix = '- Document Type: reference\n';
  const boundary = '\n## Body\n';
  const padding = 'x'.repeat(65536 - Buffer.byteLength(prefix + boundary));
  put('.plans/detail.md', prefix + padding + boundary + 'body'.repeat(30000));
  assert.equal(discoverPlans(root).identityComplete, true);
  assert.equal(readPlan(root, '.plans/current.md').state, 'active');
  put('.plans/detail.md', prefix + padding + 'x' + boundary + 'body'.repeat(30000));
  assert.equal(discoverPlans(root).identityComplete, false);
  assert.equal(readPlan(root, '.plans/current.md').state, 'unknown');
});
