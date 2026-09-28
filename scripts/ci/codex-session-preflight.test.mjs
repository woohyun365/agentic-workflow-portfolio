import assert from 'node:assert/strict';
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const repoRoot = resolve(import.meta.dirname, '../..');
const selectedPlan = '.omx/plans/alpha-task-plan.md';
const head = 'a'.repeat(40);
const otherHead = 'b'.repeat(40);
const template = JSON.parse(
  readFileSync(
    resolve(repoRoot, 'scripts/ci/fixtures/codex-session-context.valid.md'),
    'utf8',
  ).match(/```json\s*([\s\S]*?)```/u)[1],
);
const snapshotPath = (stamp = '20260102T030405Z', slug = 'alpha-task') =>
  `.omx/context/${slug}-${stamp}.md`;

function fixture(t, options = {}) {
  const root = realpathSync(mkdtempSync(resolve(tmpdir(), 'repo-session-preflight-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (path, content) => {
    mkdirSync(dirname(resolve(root, path)), { recursive: true });
    writeFileSync(resolve(root, path), content);
    return resolve(root, path);
  };
  cpSync(
    resolve(repoRoot, 'scripts/agents/common/plan-store.mjs'),
    put('scripts/agents/common/plan-store.mjs', ''),
  );
  for (const file of ['session-preflight.mjs', 'session-contract.mjs']) {
    mkdirSync(resolve(root, 'scripts/agents/codex'), { recursive: true });
    cpSync(
      resolve(repoRoot, 'scripts/agents/codex', file),
      resolve(root, 'scripts/agents/codex', file),
    );
  }
  put(selectedPlan, '# Example\n- Plan ID: alpha-task\n- Status: in-progress\n\n## Work\n');
  put('README.md', 'public fixture file');
  const settings = { head, branch: 'fix/example', status: '', omxMode: 'ok', ...options };
  const stub = `#!${process.execPath}
import { appendFileSync, readFileSync } from 'node:fs';
const config = JSON.parse(readFileSync(new URL('../settings.json', import.meta.url), 'utf8'));
const args = process.argv.slice(2);
const kind = process.argv[1].split('/').pop();
appendFileSync(new URL('../calls.jsonl', import.meta.url), JSON.stringify([kind, ...args]) + '\\n');
const key = JSON.stringify(args);
if (kind === 'git') {
 const known = new Map([
  [JSON.stringify(['branch','--show-current']), config.branch],
  [JSON.stringify(['rev-parse','HEAD']), config.head],
  [JSON.stringify(['status','--porcelain=v1','-z','--untracked-files=all']), config.status],
  ...[config.head, '${otherHead}'].flatMap(sha => [sha, sha.slice(0, 8)].map(value => [JSON.stringify(['rev-parse','--verify','--end-of-options',value+'^{commit}']), sha])),
 ]);
 if (known.has(key)) { process.stdout.write(known.get(key) + (args[0] === 'status' ? '' : '\\n')); process.exit(0); }
 if (args[0] === 'rev-parse' && args[1] === '--verify' && args[2] === '--end-of-options' && /^[a-f0-9]{7,40}\\^\\{commit\\}$/.test(args[3] ?? '')) process.exit(1);
} else if (kind === 'omx') {
 const active = key === JSON.stringify(['state','list-active','--json']);
 const priority = key === JSON.stringify(['notepad','notepad_read','--input','{"section":"priority"}','--json']);
 if (active || priority) {
  if (config.omxMode === 'fail') process.exit(1);
  if (config.omxMode === 'timeout') { setTimeout(() => {}, 10000); } else {
   const response = config.omxMode === 'malformed' ? 'not-json' : config.omxMode === 'oversized' ? 'x'.repeat(70000) : JSON.stringify(config.omxMode === 'null' ? null : config.omxMode === 'shape' ? (active ? {active_modes:{}} : {content:42}) : active ? {active_modes:[]} : {content:config.priority ?? ''});
   process.stdout.write(response); process.exit(0);
  }
 } else { process.stderr.write('UNEXPECTED COMMAND'); process.exit(92); }
} else { process.stderr.write('UNEXPECTED COMMAND'); process.exit(92); }
if (kind === 'git') { process.stderr.write('UNEXPECTED COMMAND'); process.exit(92); }
`;
  for (const bin of ['git', 'omx']) chmodSync(put(`bin/${bin}`, stub), 0o755);
  // Instrument only the disposable child. Production code has no test-only flags/env seam.
  put(
    'audit.mjs',
    `import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const append = fs.appendFileSync;
for (const method of ['readFileSync','openSync']) {
 const original = fs[method];
 fs[method] = function(path, ...args) {
  if (typeof path === 'string' && path.includes('/.omx/context/')) append(new URL('./reads.jsonl', import.meta.url), JSON.stringify(path) + '\\n');
  return original.call(this, path, ...args);
 };
}
syncBuiltinESMExports();`,
  );
  const snapshot = (path = snapshotPath(), patch = {}) => {
    const stamp = path.match(/-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z\.md$/u);
    const createdAt = stamp
      ? `${stamp[1]}-${stamp[2]}-${stamp[3]}T${stamp[4]}:${stamp[5]}:${stamp[6]}Z`
      : 'invalid';
    const value = {
      ...template,
      taskSlug: 'alpha-task',
      activePlan: selectedPlan,
      branch: settings.branch,
      head,
      relevantFiles: ['README.md'],
      createdAt,
      expiresAt: '2999-01-01T00:00:00Z',
      ...patch,
    };
    put(path, `# Private checkpoint\n\n\`\`\`json\n${JSON.stringify(value)}\n\`\`\`\n`);
    return path;
  };
  const point = (path, patch = {}) => {
    settings.priority = JSON.stringify({
      task: 'alpha-task',
      branch: settings.branch,
      head,
      contextPath: path,
      nextAction: 'PRIVATE_SENTINEL',
      blocker: null,
      ...patch,
    });
  };
  const lines = (name) => {
    try {
      return readFileSync(resolve(root, name), 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(JSON.parse);
    } catch {
      return [];
    }
  };
  const run = (args = ['--resume', '--plan', selectedPlan, '--json']) => {
    put('settings.json', JSON.stringify(settings));
    put('calls.jsonl', '');
    put('reads.jsonl', '');
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        resolve(root, 'audit.mjs'),
        resolve(root, 'scripts/agents/codex/session-preflight.mjs'),
        ...args,
      ],
      {
        cwd: root,
        env: { ...process.env, PATH: resolve(root, 'bin'), HOME: root, NODE_OPTIONS: '' },
        encoding: 'utf8',
        timeout: 14000,
      },
    );
    assert.ok(!result.stderr.includes('UNEXPECTED COMMAND'), result.stderr);
    return { ...result, calls: lines('calls.jsonl'), reads: [...new Set(lines('reads.jsonl'))] };
  };
  const summary = (args) => {
    const r = run(args);
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  };
  return { root, put, snapshot, point, settings, run, summary };
}

test('fresh mode preserves JSON/text/CLI shape and never reads context or calls notepad', (t) => {
  const f = fixture(t);
  f.point(f.snapshot());
  const r = f.run(['--fresh', '--json']);
  assert.equal(r.status, 0, r.stderr);
  const s = JSON.parse(r.stdout);
  assert.equal(s.schemaVersion, 1);
  assert.equal(s.readOnly, true);
  assert.equal(s.mode, 'fresh');
  assert.equal(s.resume, null);
  assert.equal(s.repository.root, f.root);
  assert.equal(s.repository.head, head);
  for (const field of ['stagedPaths', 'unstagedPaths', 'untrackedPaths'])
    assert.ok(Array.isArray(s.repository[field]));
  assert.ok(Array.isArray(s.activePlans));
  assert.ok(Array.isArray(s.omx.activeModes));
  assert.ok(s.canonicalVerification.includes('pnpm test:repo-policy'));
  assert.deepEqual(r.reads, []);
  assert.ok(r.calls.every((call) => !call.includes('notepad')));
  assert.match(f.run(['--fresh']).stdout, /^mode: fresh\n/u);
  for (const args of [
    ['--fresh', '--resume'],
    ['--plan', selectedPlan],
    ['--resume', '--plan', '../outside.md'],
    ['--resume', '--plan', 'README.md'],
  ])
    assert.notEqual(f.run(args).status, 0);
});

test('header metadata accepts aliases/equivalence but never prose, fences or conflicts', (t) => {
  const f = fixture(t);
  const cases = [
    ['- Status: `implementation-ready`; reviewed', 'implementation-ready'],
    ['- 상태: 진행 중', 'in-progress'],
    ['- Status: done\n- 상태: 완료', 'completed'],
    ['- Status: canceled', 'cancelled'],
    ['- 상태: 초안', 'draft'],
    ['- 상태: 제안', 'proposed'],
    ['- 상태: 차단', 'blocked'],
    ['- 상태: 구현 준비 완료', 'implementation-ready'],
    ['- Status: proposed\n- Status: completed', 'unknown'],
    ['- Status: almost completed', 'unknown'],
    ['```md\n- Status: completed\n```', 'unknown'],
    ['~~~md\n- Status: completed\n~~~', 'unknown'],
    ['## Progress\n- Status: completed', 'unknown'],
    ['', 'unknown'],
  ];
  for (const [metadata, expected] of cases) {
    f.put(selectedPlan, `# Example\n- Plan ID: alpha-task\n${metadata}\n`);
    const s = f.summary();
    assert.equal(s.resume.diagnostics.planStatus, expected, metadata);
    assert.deepEqual(s.activePlans, [], 'legacy reads never enter canonical discovery');
  }
});

test('recommendation selects newest related body rather than filename slug or priority age; no raw memory', (t) => {
  const f = fixture(t);
  const older = f.snapshot();
  const newer = f.snapshot(snapshotPath('20260103T030405Z'));
  for (let i = 1; i <= 6; i++)
    f.snapshot(snapshotPath(`2026020${i}T030405Z`, 'zz-unrelated'), { taskSlug: 'zz-unrelated' });
  f.point(older);
  const before = readFileSync(resolve(f.root, older));
  const r = f.run();
  const s = JSON.parse(r.stdout).resume;
  assert.equal(s.notepadPriority.valid, true);
  assert.equal(s.diagnostics.taskId, 'alpha-task');
  assert.equal(s.diagnostics.taskIdSource, 'plan-id');
  assert.deepEqual(s.contextSnapshots, [newer, older]);
  assert.deepEqual(
    s.diagnostics.snapshots.map((x) => x.path),
    s.contextSnapshots,
  );
  assert.equal(s.diagnostics.recommendedContextPath, newer);
  assert.equal(s.diagnostics.priority.taskMatch, 'matched');
  assert.equal(s.diagnostics.priority.freshness, 'current');
  assert.equal(r.reads.length, 2);
  assert.ok(r.reads.every((p) => !p.includes('zz-unrelated')));
  assert.ok(!r.stdout.includes('PRIVATE_SENTINEL'));
  assert.ok(!r.stdout.includes(template.latestUserRequest));
  assert.deepEqual(readFileSync(resolve(f.root, older)), before);
});

test('identity conflicts win, invalid priority cannot hide a valid independent candidate', (t) => {
  const f = fixture(t);
  const older = f.snapshot();
  const newer = f.snapshot(snapshotPath('20260103T030405Z'));
  f.point(newer, { task: 'different-task' });
  let s = f.summary().resume;
  assert.equal(s.diagnostics.priority.taskMatch, 'mismatched');
  assert.equal(s.diagnostics.snapshots.find((x) => x.path === newer).taskMatch, 'mismatched');
  assert.equal(s.diagnostics.recommendedContextPath, older);
  f.snapshot(newer, { activePlan: '.omx/plans/other.md' });
  f.point(newer);
  s = f.summary().resume;
  assert.equal(s.diagnostics.priority.taskMatch, 'mismatched');
  assert.equal(s.diagnostics.recommendedContextPath, older);
  f.settings.priority = 'not-json';
  assert.equal(f.summary().resume.diagnostics.recommendedContextPath, older);
});

test('missing selection, missing plan and ambiguous Plan ID do not infer authority from memory', (t) => {
  const f = fixture(t);
  const path = f.snapshot();
  f.point(path);
  let d = f.summary(['--resume', '--json']).resume.diagnostics;
  assert.equal(d.taskId, null);
  assert.equal(d.recommendedContextPath, null);
  assert.ok(d.limitations.includes('no-selected-plan'));
  rmSync(resolve(f.root, selectedPlan));
  d = f.summary().resume.diagnostics;
  assert.equal(d.recommendedContextPath, null);
  assert.ok(d.limitations.includes('selected-plan-missing'));
  for (const id of ['- Plan ID: bad_id', '- Plan ID: alpha-task\n- Plan ID: other-task']) {
    f.put(selectedPlan, `# Example\n${id}\n- Status: in-progress`);
    d = f.summary().resume.diagnostics;
    assert.equal(d.taskIdSource, 'unknown');
    assert.equal(d.recommendedContextPath, null);
  }
  f.put(selectedPlan, '# Example\n- Status: in-progress');
  f.snapshot(path, { taskSlug: 'fixture-task' });
  f.point(path, { task: 'fixture-task' });
  d = f.summary().resume.diagnostics;
  assert.equal(d.taskIdSource, 'filename-hint');
  assert.equal(d.recommendedContextPath, path);
});

test('freshness separates expiry, drift, malformed evidence and phase-unknown; structural valid survives task mismatch', (t) => {
  const f = fixture(t);
  const path = f.snapshot();
  f.point(path);
  const cases = [
    [{ expiresAt: '2000-01-01T00:00:00Z' }, 'expired', 'expired'],
    [{ expiresAt: 'on-phase-completion' }, 'unknown', 'expiry-unknown'],
    [{ head: otherHead }, 'needs-review', 'head-changed'],
    [{ branch: 'other-branch' }, 'needs-review', 'branch-changed'],
    [{ head: 'c'.repeat(40) }, 'unknown', 'head-unknown'],
    [{ relevantFiles: ['missing.ts'] }, 'unknown', 'relevant-path-missing'],
    [{ relevantFiles: [] }, 'unknown', 'relevant-path-missing'],
    [{ relevantFiles: ['../outside'] }, 'unknown', 'unsafe-path'],
    [{ createdAt: '2026-01-02T03:04:06Z' }, 'unknown', 'timestamp-conflict'],
    [{ createdAt: 'not-time' }, 'unknown', 'timestamp-invalid'],
    [{ createdAt: '2999-01-02T03:04:05Z' }, 'unknown', 'timestamp-invalid'],
    [{ activePlan: '.omx/plans/other.md' }, 'unknown', 'identity-conflict'],
    [{ taskSlug: 'other-task' }, 'unknown', 'identity-conflict'],
  ];
  for (const [patch, freshness, reason] of cases) {
    f.snapshot(path, patch);
    const s = f.summary().resume;
    assert.equal(s.notepadPriority.valid, true);
    assert.equal(s.diagnostics.priority.freshness, freshness, JSON.stringify(patch));
    assert.ok(
      s.diagnostics.priority.reasons.includes(reason),
      `${reason}: ${JSON.stringify(s.diagnostics.priority)}`,
    );
    assert.equal(s.diagnostics.recommendedContextPath, null);
  }
  f.snapshot(path);
  f.settings.status = '?? untouched-user-file.md\0';
  let d = f.summary().resume.diagnostics;
  assert.equal(d.priority.freshness, 'needs-review');
  assert.ok(d.priority.reasons.includes('dirty-tree'));
  f.settings.status = '';
  f.point(path, { head: otherHead, branch: 'other' });
  d = f.summary().resume.diagnostics;
  assert.ok(d.priority.reasons.includes('head-changed'));
  assert.ok(d.priority.reasons.includes('branch-changed'));
  f.point(path, { head: head.slice(0, 8) });
  f.snapshot(path, { head: head.slice(0, 8) });
  assert.equal(f.summary().resume.diagnostics.priority.freshness, 'current');
});

test('terminal, archived and phase-unknown plans are never recommended', (t) => {
  const f = fixture(t);
  const path = f.snapshot();
  f.point(path);
  f.put(selectedPlan, '# Example\n- Plan ID: alpha-task\n- Status: completed');
  let d = f.summary().resume.diagnostics;
  assert.equal(d.priority.freshness, 'expired');
  assert.ok(d.priority.reasons.includes('plan-terminal'));
  f.snapshot(path, { expiresAt: 'on-phase-completion' });
  assert.equal(f.summary().resume.diagnostics.priority.freshness, 'expired');
  const archived = '.omx/plans/finished/2026/01/alpha-task-plan.md';
  f.put(archived, '# Example\n- Plan ID: alpha-task\n- Status: in-progress');
  f.snapshot(path, { activePlan: archived });
  d = f.summary(['--resume', '--plan', archived, '--json']).resume.diagnostics;
  assert.equal(d.priority.freshness, 'needs-review');
  assert.ok(d.priority.reasons.includes('archived-plan'));
  f.put(selectedPlan, '# Example\n- Plan ID: alpha-task\n## Status\n- Status: in-progress');
  f.snapshot(path);
  assert.equal(f.summary().resume.diagnostics.priority.freshness, 'unknown');
});

test('retrieval is capped at five unique bodies with invalid-time last and no refill', (t) => {
  const f = fixture(t);
  for (let i = 1; i <= 7; i++) f.snapshot(snapshotPath(`2026010${i}T030405Z`));
  const invalid = f.snapshot(snapshotPath('20260107T030405Z'), { createdAt: 'invalid' });
  f.point(invalid);
  const r = f.run();
  const s = JSON.parse(r.stdout).resume;
  assert.equal(s.contextSnapshots.length, 5);
  assert.equal(r.reads.length, 5);
  assert.equal(s.contextSnapshots.at(-1), invalid);
  assert.ok(s.diagnostics.limitations.includes('candidate-limit'));
  assert.equal(s.diagnostics.recommendedContextPath, snapshotPath('20260106T030405Z'));
  f.snapshot(snapshotPath('20260230T030405Z')); // nonexistent calendar date is not a discovery timestamp
  assert.ok(!f.summary().resume.contextSnapshots.includes(snapshotPath('20260230T030405Z')));
});

test('missing, malformed, oversized and unsafe optional context cannot leak or be recommended', (t) => {
  const f = fixture(t);
  const path = snapshotPath();
  f.point(path);
  let s = f.summary().resume;
  assert.ok(s.diagnostics.priority.reasons.includes('context-missing'));
  for (const content of ['not-json', '```json\nnull\n```', 'x'.repeat(65537)]) {
    f.put(path, content);
    s = f.summary().resume;
    assert.ok(s.diagnostics.priority.reasons.includes('context-invalid'));
    assert.equal(s.diagnostics.recommendedContextPath, null);
  }
  rmSync(resolve(f.root, path));
  symlinkSync(f.put('external.md', 'PRIVATE_SENTINEL'), resolve(f.root, path));
  let r = f.run();
  s = JSON.parse(r.stdout).resume;
  assert.ok(s.diagnostics.priority.reasons.includes('unsafe-path'));
  assert.deepEqual(r.reads, []);
  assert.ok(!r.stdout.includes('PRIVATE_SENTINEL'));
  rmSync(resolve(f.root, path));
  mkdirSync(resolve(f.root, path));
  assert.ok(f.summary().resume.diagnostics.priority.reasons.includes('unsafe-path'));
  f.point('../escape');
  assert.equal(f.summary().resume.diagnostics.recommendedContextPath, null);
  f.settings.priority = JSON.stringify({
    task: 12,
    branch: [],
    head: null,
    contextPath: [],
    nextAction: {},
    blocker: null,
  });
  assert.equal(f.summary().resume.notepadPriority.valid, false);
});

test('owner-directory symlinks, escaped plan/relevant paths and huge plan metadata are bounded', (t) => {
  const f = fixture(t);
  const path = f.snapshot();
  f.point(path);
  symlinkSync(f.put('outside.md', 'PRIVATE_SENTINEL'), resolve(f.root, '.omx/plans/link.md'));
  assert.notEqual(f.run(['--resume', '--plan', '.omx/plans/link.md', '--json']).status, 0);
  symlinkSync(resolve(f.root), resolve(f.root, 'linked-root'));
  f.snapshot(path, { relevantFiles: ['linked-root/README.md'] });
  assert.ok(f.summary().resume.diagnostics.priority.reasons.includes('unsafe-path'));
  f.put(selectedPlan, '- Status: in-progress\n' + 'x'.repeat(65537));
  assert.equal(f.summary().resume.diagnostics.planStatus, 'unknown');
  rmSync(resolve(f.root, '.omx/context'), { recursive: true });
  mkdirSync(resolve(f.root, 'contexts'));
  symlinkSync(resolve(f.root, 'contexts'), resolve(f.root, '.omx/context'));
  const r = f.run();
  assert.equal(r.status, 0);
  assert.deepEqual(r.reads, []);
  assert.ok(JSON.parse(r.stdout).resume.diagnostics.priority.reasons.includes('unsafe-path'));
});

test('optional OMX unavailable/malformed/oversized responses are non-blocking and timeout is bounded', (t) => {
  const f = fixture(t);
  for (const mode of ['fail', 'malformed', 'null', 'shape', 'oversized']) {
    f.settings.omxMode = mode;
    const s = f.summary();
    assert.equal(s.omx.available, false);
    assert.equal(s.resume.notepadPriority.available, false);
    assert.ok(s.resume.diagnostics.limitations.includes('omx-unavailable'));
  }
  f.settings.omxMode = 'timeout';
  const start = Date.now();
  const r = f.run(['--fresh', '--json']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).omx.available, false);
  assert.ok(Date.now() - start < 9000);
  assert.deepEqual(r.reads, []);
});

test('malformed identity never becomes a match, and invalid priority preserves known conflict on rediscovery', (t) => {
  const f = fixture(t);
  f.put(selectedPlan, '# Example\n- Status: in-progress');
  const path = f.snapshot();
  for (const taskSlug of ['', null, {}, undefined]) {
    f.snapshot(path, { taskSlug });
    f.point(path, { task: taskSlug });
    const diagnostic = f.summary().resume.diagnostics;
    assert.equal(diagnostic.snapshots[0].taskMatch, 'unknown');
    assert.equal(diagnostic.recommendedContextPath, null);
  }
  f.put(selectedPlan, '# Example\n- Plan ID: alpha-task\n- Status: in-progress');
  f.snapshot(path, { taskSlug: null });
  f.point(path);
  assert.equal(f.summary().resume.diagnostics.priority.taskMatch, 'unknown');
  f.snapshot(path);
  const older = f.snapshot(snapshotPath('20260101T030405Z'));
  f.point(path, { task: 'different-task', nextAction: { bad: true } });
  const s = f.summary().resume;
  assert.equal(s.notepadPriority.valid, false);
  assert.equal(s.diagnostics.priority.taskMatch, 'mismatched');
  assert.equal(s.diagnostics.snapshots.find((x) => x.path === path).taskMatch, 'mismatched');
  assert.equal(s.diagnostics.recommendedContextPath, older);
});

test('calendar-invalid creation and expiry cannot normalize into current evidence', (t) => {
  const f = fixture(t);
  const path = snapshotPath('20260302T030405Z');
  for (const createdAt of [
    '2026-02-30T03:04:05Z',
    '2026-03-01T27:04:05Z',
    'March 2 2026 03:04:05 GMT',
  ]) {
    f.snapshot(path, { createdAt });
    f.point(path);
    const diagnostic = f.summary().resume.diagnostics;
    assert.ok(diagnostic.priority.reasons.includes('timestamp-invalid'));
    assert.equal(diagnostic.recommendedContextPath, null);
  }
  f.snapshot(path, { expiresAt: '2999-02-30T00:00:00Z' });
  const d = f.summary().resume.diagnostics;
  assert.ok(d.priority.reasons.includes('expiry-unknown'));
  assert.equal(d.recommendedContextPath, null);
  f.snapshot(path, { createdAt: '2026-03-02T12:04:05.123+09:00' });
  assert.equal(f.summary().resume.diagnostics.recommendedContextPath, path);
});

test('preflight implementation remains read-only', () => {
  const source = readFileSync(
    resolve(repoRoot, 'scripts/agents/codex/session-preflight.mjs'),
    'utf8',
  );
  for (const mutation of [
    'writeFile',
    'appendFile',
    'mkdir',
    'rmSync',
    'unlink',
    'rename',
    'copyFile',
  ])
    assert.equal(source.includes(mutation), false, mutation);
});

const canonicalPlan = '.plans/alpha-task-plan.md';
const canonicalBody = (id = 'alpha-task', status = 'active') =>
  `# Plan\n- Plan ID: ${id}\n- Status: ${status}\n`;
const resumePlan = (path) => ['--resume', '--plan', path, '--json'];

test('canonical discovery uses only active root plans and preserves explicit nested binding', (t) => {
  const f = fixture(t);
  assert.deepEqual(f.summary(['--fresh', '--json']).activePlans, []);
  assert.ok(f.summary(['--fresh', '--json']).planDiscovery.issues.includes('missing-root'));
  f.put(canonicalPlan, canonicalBody());
  f.put('.plans/README.md', '# navigation');
  f.put('.plans/supporting/child.md', canonicalBody('child'));
  f.put('.plans/done.md', canonicalBody('done', 'completed'));
  f.put('.plans/cancelled.md', canonicalBody('cancelled', 'cancelled'));
  f.put('.plans/finished/archived.md', canonicalBody('archived'));
  let s = f.summary(['--fresh', '--json']);
  assert.deepEqual(s.activePlans, [{ path: canonicalPlan, status: 'active' }]);
  assert.equal(s.planDiscovery.complete, true);
  assert.equal(s.resume, null);
  for (const legacy of [`./${selectedPlan}`, resolve(f.root, selectedPlan)]) {
    assert.deepEqual(f.summary(resumePlan(legacy)).resume.plan, {
      path: selectedPlan,
      exists: true,
    });
  }
  assert.equal(
    f.summary().resume.planBinding,
    null,
    'legacy selection remains a compatibility read',
  );
  s = f.summary(resumePlan('.plans/supporting/child.md'));
  assert.equal(s.resume.planBinding.id, 'child');
  assert.equal(s.resume.planBinding.state, 'active');
  assert.equal(s.resume.diagnostics.taskId, 'child');
});

test('canonical resume keeps OMX context owner and does not repair moved plan pointers', (t) => {
  const f = fixture(t);
  f.put(canonicalPlan, canonicalBody());
  const path = f.snapshot(undefined, { activePlan: canonicalPlan });
  f.point(path);
  let s = f.summary(resumePlan(canonicalPlan)).resume;
  assert.equal(s.diagnostics.recommendedContextPath, path);
  assert.equal(s.planBinding.state, 'active');
  assert.deepEqual(s.plan, { path: canonicalPlan, exists: true });
  const moved = '.plans/supporting/moved.md';
  mkdirSync(resolve(f.root, '.plans/supporting'));
  renameSync(resolve(f.root, canonicalPlan), resolve(f.root, moved));
  s = f.summary(resumePlan(canonicalPlan)).resume;
  assert.equal(s.planBinding.state, 'missing');
  assert.equal(s.plan.exists, false);
  assert.equal(s.diagnostics.recommendedContextPath, null);
  s = f.summary(resumePlan(moved)).resume;
  assert.equal(s.planBinding.state, 'active');
  assert.equal(s.diagnostics.priority.taskMatch, 'mismatched');
  assert.equal(s.diagnostics.recommendedContextPath, null);
  f.snapshot(path, { activePlan: moved });
  assert.equal(f.summary(resumePlan(moved)).resume.diagnostics.recommendedContextPath, path);
  assert.ok(readFileSync(resolve(f.root, path), 'utf8').includes(moved));
});

test('canonical terminal, archived, duplicate, navigation and unknown plans cannot recommend context', (t) => {
  const f = fixture(t);
  const path = f.snapshot(undefined, { activePlan: canonicalPlan });
  f.point(path);
  for (const status of [
    'completed',
    'cancelled',
    'superseded',
    'paused',
    'blocked',
    'proposed',
    'nonsense',
  ]) {
    f.put(canonicalPlan, canonicalBody('alpha-task', status));
    const s = f.summary(resumePlan(canonicalPlan));
    assert.equal(s.resume.diagnostics.recommendedContextPath, null, status);
    assert.ok(s.resume.diagnostics.limitations.includes('plan-not-active'), status);
    assert.deepEqual(s.activePlans, []);
  }
  for (const archived of ['.plans/finished/alpha.md', '.plans/cancelled/alpha.md']) {
    rmSync(resolve(f.root, '.plans'), { recursive: true });
    f.put(archived, canonicalBody());
    f.snapshot(path, { activePlan: archived });
    const s = f.summary(resumePlan(archived)).resume;
    assert.equal(s.planBinding.state, 'archived');
    assert.equal(s.diagnostics.recommendedContextPath, null);
  }
  rmSync(resolve(f.root, '.plans'), { recursive: true });
  f.put(canonicalPlan, canonicalBody());
  f.put('.plans/supporting/duplicate.md', canonicalBody());
  f.snapshot(path, { activePlan: canonicalPlan });
  let s = f.summary(resumePlan(canonicalPlan));
  assert.deepEqual(s.activePlans, []);
  assert.equal(s.planDiscovery.complete, false);
  assert.ok(s.planDiscovery.issues.includes('duplicate-plan-id'));
  assert.equal(s.resume.planBinding.state, 'ambiguous');
  assert.ok(s.resume.diagnostics.limitations.includes('duplicate-plan-id'));
  assert.equal(s.resume.diagnostics.recommendedContextPath, null);
  f.put('.plans/README.md', canonicalBody('navigation'));
  s = f.summary(resumePlan('.plans/README.md'));
  assert.equal(s.resume.planBinding.state, 'navigation');
  assert.equal(s.resume.diagnostics.recommendedContextPath, null);
});

test('canonical safe paths reject escapes, symlink files/owners and retain incomplete discovery reasons', (t) => {
  const f = fixture(t);
  f.put(canonicalPlan, canonicalBody());
  symlinkSync(
    f.put('outside-plan.md', canonicalBody('outside')),
    resolve(f.root, '.plans/link.md'),
  );
  for (const path of [
    '.plans/link.md',
    '.plans/../README.md',
    `.plans/../${selectedPlan}`,
    '.plans/supporting/../alpha-task-plan.md',
    resolve(f.root, canonicalPlan),
    '.plans',
    '.plans/not-markdown.txt',
  ]) {
    assert.notEqual(f.run(resumePlan(path)).status, 0, path);
  }
  let s = f.summary(resumePlan(canonicalPlan));
  assert.equal(s.planDiscovery.complete, false);
  assert.ok(s.planDiscovery.issues.includes('unsafe-entry'));
  assert.equal(s.resume.planBinding.state, 'unknown');
  assert.ok(s.resume.diagnostics.limitations.includes('unsafe-entry'));
  rmSync(resolve(f.root, '.plans'), { recursive: true });
  mkdirSync(resolve(f.root, 'outside-plans'));
  symlinkSync(resolve(f.root, 'outside-plans'), resolve(f.root, '.plans'));
  s = f.summary(['--fresh', '--json']);
  assert.deepEqual(s.activePlans, []);
  assert.ok(s.planDiscovery.issues.includes('unsafe-directory'));
  assert.notEqual(f.run(resumePlan(canonicalPlan)).status, 0);
});

test('host-named package preflight accepts one forwarded separator after its default flags', (t) => {
  const f = fixture(t);
  const manifest = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'));
  const defaults = manifest.scripts['codex:preflight'].split(' ').slice(2);
  assert.deepEqual(defaults, ['--json']);
  assert.equal(f.summary([...defaults, '--', '--fresh']).mode, 'fresh');
  const resumed = f.summary([...defaults, '--', '--resume', '--plan', selectedPlan]);
  assert.equal(resumed.mode, 'resume');
  assert.equal(resumed.resume.plan.path, selectedPlan);
  assert.notEqual(f.run([...defaults, '--', '--', '--fresh']).status, 0);
  assert.notEqual(f.run([...defaults, '--', '--unknown']).status, 0);
});

test('canonical resume exposes corpus warnings separately from selected identity readiness', (t) => {
  const f = fixture(t);
  f.put(canonicalPlan, canonicalBody() + '## Work\n' + 'x'.repeat(100000));
  f.put(
    '.plans/supporting/detail.md',
    '- Document Type: reference\n- Status: narrative\n## Detail\n' + 'x'.repeat(100000),
  );
  f.put('.plans/pending/old.md', '- Status: unfinished old proposal\n');
  const path = f.snapshot(undefined, { activePlan: canonicalPlan });
  f.point(path);
  let s = f.summary(resumePlan(canonicalPlan));
  assert.equal(s.planDiscovery.complete, false);
  assert.ok(s.planDiscovery.issues.includes('metadata-unknown'));
  assert.equal(s.planDiscovery.identityComplete, true);
  assert.deepEqual(s.planDiscovery.identityIssues, []);
  assert.equal(s.resume.planBinding.state, 'active');
  assert.equal(s.resume.diagnostics.recommendedContextPath, path);
  assert.equal(
    f.summary(resumePlan('.plans/pending/old.md')).resume.diagnostics.recommendedContextPath,
    null,
  );
  f.snapshot(path, { activePlan: canonicalPlan, head: otherHead });
  assert.equal(
    f.summary(resumePlan(canonicalPlan)).resume.diagnostics.recommendedContextPath,
    null,
  );
  f.snapshot(path, { activePlan: canonicalPlan });
  f.put('.plans/finished/duplicate.md', canonicalBody());
  s = f.summary(resumePlan(canonicalPlan));
  assert.equal(s.planDiscovery.identityComplete, false);
  assert.deepEqual(s.activePlans, []);
  assert.equal(s.resume.planBinding.state, 'ambiguous');
  assert.equal(s.resume.diagnostics.recommendedContextPath, null);
});
