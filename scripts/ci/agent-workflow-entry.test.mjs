import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import test from 'node:test';
import { buildTaskEnvelope, discoverContextPack } from '../agents/common/index.mjs';
import {
  resolveWorkflowEntry,
  workflowGraph,
  validateWorkflowGraph,
} from '../agents/common/workflow-entry.mjs';
const root = resolve(import.meta.dirname, '../..');
const requests = {
  answer: 'API 코드의 역할을 설명해줘.',
  analyze: 'API 오류 원인을 분석해줘.',
  plan: 'API 변경 계획을 작성해줘.',
  implement: 'API 응답에 필드를 추가해줘.',
  review: 'API 변경을 리뷰해줘.',
  debug: 'API 재현 오류를 고쳐줘.',
};
for (const host of ['codex', 'claude-code', 'third-fixture'])
  for (const mode of ['fresh', 'resume'])
    for (const [intent, request] of Object.entries(requests)) {
      test(`${host}/${intent}/${mode}: actual neutral route preserves authority and Plan-only guides`, () => {
        const envelope = buildTaskEnvelope({ request });
        const contextPack = discoverContextPack({ envelope });
        const adapters = {
          'third-fixture': { guide: 'docs/development/agent-workflows/adapters/README.md' },
        };
        const route = resolveWorkflowEntry({ envelope, contextPack, host, mode, adapters });
        assert.equal(route.intent, intent);
        assert.equal(route.authorizedAction, envelope.authorizedAction);
        assert.equal(route.runtimeQualified, false);
        assert.equal(route.orderedReadset[0], 'AGENTS.md');
        assert.equal(
          route.orderedReadset.includes('docs/development/agent-workflows/session-continuity.md'),
          mode === 'resume',
        );
        assert.ok(route.orderedReadset.every((path) => existsSync(resolve(root, path))));
        assert.equal(
          route.conditionalReads.some(({ condition }) => condition === 'active-host'),
          true,
        );
        assert.deepEqual(
          contextPack.selectedGuides,
          intent === 'plan' ? contextPack.selectedGuides : [],
        );
        assert.ok(!route.orderedReadset.some((path) => /adapters\/(?:codex|claude)/u.test(path)));
      });
    }
test('unknown host fails closed for host capabilities without pretending safe direct work is forbidden', () => {
  const envelope = buildTaskEnvelope({ request: requests.analyze });
  const route = resolveWorkflowEntry({ envelope, host: 'unknown-host', mode: 'fresh' });
  assert.equal(route.hostStatus, 'unregistered');
  assert.equal(route.requiresHostAdmission, true);
  assert.ok(!JSON.stringify(route).includes('codex.md'));
  assert.equal(route.authorizedAction, 'produce-analysis');
  assert.throws(() => resolveWorkflowEntry({ envelope, mode: 'fresh' }), /explicit host/u);
  assert.throws(() => resolveWorkflowEntry({ envelope, host: 'codex', mode: 'auto' }));
});
test('graph has one canonical owner, valid nodes, and only requires edges impose DAG', () => {
  assert.deepEqual(validateWorkflowGraph(workflowGraph), []);
  const clone = () => structuredClone(workflowGraph);
  let graph = clone();
  graph.nodes.push({ ...graph.nodes[0], id: 'duplicate' });
  assert.ok(validateWorkflowGraph(graph).includes('duplicate-canonical-owner'));
  graph = clone();
  graph.edges.push({ from: 'execution', to: 'root', kind: 'requires' });
  assert.ok(validateWorkflowGraph(graph).includes('required-cycle'));
  graph = clone();
  graph.edges.push({ from: 'execution', to: 'root', kind: 'reference' });
  assert.deepEqual(validateWorkflowGraph(graph), []);
  graph = clone();
  graph.edges.push({ from: 'root', to: 'missing', kind: 'requires' });
  assert.ok(validateWorkflowGraph(graph).includes('missing-node'));
});
test('host-neutral CLI is a real diagnostic caller, never dispatches or discovers memory for fresh', () => {
  const result = spawnSync(
    process.execPath,
    [
      'scripts/agents/common/workflow-entry.mjs',
      '--host',
      'claude-code',
      '--mode',
      'fresh',
      '--request',
      requests.analyze,
    ],
    { cwd: root, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.route.intent, 'analyze');
  assert.equal(output.plan, null);
  assert.equal(output.route.runtimeQualified, false);
  const invalid = spawnSync(
    process.execPath,
    ['scripts/agents/common/workflow-entry.mjs', '--request', requests.analyze],
    { cwd: root, encoding: 'utf8' },
  );
  assert.notEqual(invalid.status, 0);
});

test('context injection cannot add a foreign guide or activate Plan guide selection for analysis', () => {
  const envelope = buildTaskEnvelope({ request: requests.analyze });
  const contextPack = discoverContextPack({ envelope });
  assert.throws(
    () =>
      resolveWorkflowEntry({
        envelope,
        host: 'codex',
        mode: 'fresh',
        contextPack: {
          ...contextPack,
          selectedGuides: [{ path: 'docs/development/agent-workflows/plan-authoring/core.md' }],
        },
      }),
    /Plan-only/u,
  );
  assert.throws(() =>
    resolveWorkflowEntry({
      envelope,
      host: 'codex',
      mode: 'fresh',
      contextPack: { ...contextPack, selectedGuides: [{ path: '/private/data' }] },
    }),
  );
});

test('resume CLI consumes only the explicitly selected common plan; legacy remains unsupported', (t) => {
  const cwd = mkdtempSync(resolve(tmpdir(), 'workflow-entry-resume-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  mkdirSync(resolve(cwd, '.plans'));
  writeFileSync(resolve(cwd, '.plans/task.md'), '- Plan ID: task\n- Status: active\n');
  const call = (path) => {
    const result = spawnSync(
      process.execPath,
      [
        resolve(root, 'scripts/agents/common/workflow-entry.mjs'),
        '--host',
        'claude-code',
        '--mode',
        'resume',
        '--request',
        requests.analyze,
        '--plan',
        path,
      ],
      { cwd, encoding: 'utf8' },
    );
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  assert.equal(call('.plans/task.md').plan.state, 'active');
  assert.equal(call('.plans/moved.md').plan.state, 'missing');
  assert.equal(call('.omx/plans/task.md').plan.state, 'unsafe');
});
