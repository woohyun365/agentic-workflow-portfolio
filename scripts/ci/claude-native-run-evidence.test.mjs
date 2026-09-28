import assert from 'node:assert/strict';
import test from 'node:test';
import { createClaudeNativeCollector } from '../agents/claude/native-run-evidence.mjs';
const d = `sha256:${'a'.repeat(64)}`;
const context = () => ({
  runId: 'run-1',
  sessionId: 'session-1',
  bindingDigest: d,
  requestDigest: d,
  sourceDigest: d,
  configDigest: d,
  roleDigest: d,
  taskSnapshotDigest: d,
  role: 'repo_explorer',
  requestedModel: 'haiku',
  expectedResolvedModel: 'claude-haiku-4-5-20251001',
  prompt: 'read sample',
  allowedTools: ['Read'],
  cliVersion: '2.1.283',
  allowedParentTools: ['Task', 'Read'],
  readScopeRoot: '/synthetic',
  readFiles: { 'sample.txt': d },
});
function events() {
  const c = context(),
    common = { session_id: c.sessionId };
  let n = 0;
  const event = (x) => ({ ...common, uuid: `e-${++n}`, ...x });
  return [
    event({
      type: 'system',
      subtype: 'init',
      claude_code_version: c.cliVersion,
      cwd: c.readScopeRoot,
      permissionMode: 'default',
      agents: [c.role],
      tools: ['Task', 'Read'],
      plugins: [],
      mcp_servers: [],
    }),
    event({
      type: 'assistant',
      parent_tool_use_id: null,
      message: {
        id: 'parent-message',
        content: [
          {
            type: 'tool_use',
            id: 'call-1',
            name: 'Agent',
            input: {
              subagent_type: c.role,
              model: c.requestedModel,
              prompt: c.prompt,
              run_in_background: false,
            },
          },
        ],
      },
    }),
    event({
      type: 'system',
      subtype: 'task_started',
      task_id: 'child-1',
      tool_use_id: 'call-1',
      subagent_type: c.role,
      prompt: c.prompt,
    }),
    event({
      type: 'assistant',
      parent_tool_use_id: 'call-1',
      message: {
        id: 'chunked',
        model: c.expectedResolvedModel,
        content: [
          {
            type: 'tool_use',
            id: 'read-1',
            name: 'Read',
            input: { file_path: '/synthetic/sample.txt' },
          },
        ],
      },
    }),
    event({
      type: 'user',
      parent_tool_use_id: 'call-1',
      message: { content: [{ type: 'tool_result', tool_use_id: 'read-1', content: 'oracle' }] },
    }),
    event({
      type: 'assistant',
      parent_tool_use_id: 'call-1',
      message: {
        id: 'chunked',
        model: c.expectedResolvedModel,
        content: [{ type: 'text', text: 'oracle' }],
      },
    }),
    event({
      type: 'system',
      subtype: 'task_notification',
      task_id: 'child-1',
      tool_use_id: 'call-1',
      status: 'completed',
    }),
    event({
      type: 'user',
      parent_tool_use_id: null,
      message: { content: [{ type: 'tool_result', tool_use_id: 'call-1' }] },
      tool_use_result: {
        status: 'completed',
        agentId: 'child-1',
        agentType: c.role,
        resolvedModel: c.expectedResolvedModel,
        prompt: c.prompt,
        totalToolUseCount: 1,
        content: [{ type: 'text', text: 'oracle' }],
      },
    }),
    event({
      type: 'result',
      subtype: 'success',
      is_error: false,
      subagent_stats: { spawned: 1, completed: 1, failed: 0 },
      permission_denials: [],
    }),
  ];
}
function collect(es = events(), end = { exitCode: 0, timedOut: false, currentContext: context() }) {
  const c = createClaudeNativeCollector(context());
  for (const e of es) c.consume(e);
  return c.finish(end);
}
test('actual CLI envelopes connect model/tool/session without claiming runtime admission', () => {
  const r = collect();
  assert.equal(r.valid, true);
  assert.equal(r.dispatchAuthorized, false);
  assert.equal(r.runtimeQualified, false);
  assert.equal(r.resolvedModel, context().expectedResolvedModel);
});
for (const [label, mutate] of [
  [
    'cross session',
    (e) => {
      e[4].session_id = 'other';
    },
  ],
  ['duplicate event', (e) => e.splice(4, 0, e[3])],
  ['missing completion', (e) => e.splice(7, 1)],
  [
    'reverse start',
    (e) => {
      [e[1], e[2]] = [e[2], e[1]];
    },
  ],
  [
    'wrong alias',
    (e) => {
      e[1].message.content[0].input.model = 'sonnet';
    },
  ],
  [
    'missing alias',
    (e) => {
      delete e[1].message.content[0].input.model;
    },
  ],
  [
    'wrong role',
    (e) => {
      e[2].subagent_type = 'other';
    },
  ],
  [
    'wrong child',
    (e) => {
      e[7].tool_use_result.agentId = 'other';
    },
  ],
  [
    'wrong resolved model',
    (e) => {
      e[7].tool_use_result.resolvedModel = 'claude-sonnet-5';
    },
  ],
  [
    'wrong observed model',
    (e) => {
      e[3].message.model = 'claude-sonnet-5';
    },
  ],
  [
    'unexpected tool',
    (e) => {
      e[3].message.content[0].name = 'Bash';
    },
  ],
  [
    'orphan child result',
    (e) => {
      e[4].message.content[0].tool_use_id = 'other';
    },
  ],
  ['missing tool result', (e) => e.splice(4, 1)],
  [
    'false completion',
    (e) => {
      e[8].subagent_stats.completed = 0;
    },
  ],
  [
    'permission denied',
    (e) => {
      e[8].permission_denials = [{ tool_name: 'Agent' }];
    },
  ],
  [
    'wrong prompt',
    (e) => {
      e[1].message.content[0].input.prompt = 'another task';
    },
  ],
  ['late child', (e) => e.push({ ...e[5], uuid: 'late' })],
])
  test(`reject ${label}`, () => {
    const e = events();
    mutate(e);
    assert.equal(collect(e).valid, false);
  });
for (const key of [
  'runId',
  'bindingDigest',
  'requestDigest',
  'sourceDigest',
  'configDigest',
  'roleDigest',
  'taskSnapshotDigest',
])
  test(`reject changed ${key}`, () => {
    const currentContext = context();
    currentContext[key] = 'changed';
    assert.equal(collect(events(), { exitCode: 0, timedOut: false, currentContext }).valid, false);
  });
test('timeout or nonzero process never succeeds', () => {
  for (const end of [
    { exitCode: 1, timedOut: false },
    { exitCode: 0, timedOut: true },
  ])
    assert.equal(collect(events(), { ...end, currentContext: context() }).valid, false);
});
test('malformed event is a bounded refusal, repeated finish cannot requalify', () => {
  const c = createClaudeNativeCollector(context());
  c.consume(null);
  assert.equal(c.finish({ exitCode: 0, currentContext: context() }).valid, false);
  assert.throws(() => c.finish({}));
});
test('startup hook envelopes are captured but unqualified for wrapper-free execution', () => {
  const es = events();
  es.unshift({
    type: 'system',
    subtype: 'hook_response',
    uuid: 'startup',
    session_id: context().sessionId,
    hook_event: 'SessionStart',
    outcome: 'success',
  });
  assert.equal(collect(es).valid, false);
});
test('reject out-of-scope Read even if host permits it', () => {
  const e = events();
  e[3].message.content[0].input.file_path = '/etc/hosts';
  assert.equal(collect(e).valid, false);
});
test('reject deleted whole tool pair against host completion count', () => {
  const e = events();
  e.splice(3, 2);
  assert.equal(collect(e).valid, false);
});

for (const [label, change] of [
  [
    'foreign cwd',
    (e) => {
      e[0].cwd = '/elsewhere';
    },
  ],
  [
    'bypass mode',
    (e) => {
      e[0].permissionMode = 'bypassPermissions';
    },
  ],
  [
    'rewritten started prompt',
    (e) => {
      e[2].prompt = 'different task';
    },
  ],
  [
    'rewritten completed prompt',
    (e) => {
      e[7].tool_use_result.prompt = 'different task';
    },
  ],
])
  test(label + ' rejects visible effective configuration contradiction', () => {
    const es = events();
    change(es);
    assert.equal(collect(es).valid, false);
  });
test('validated completion is detached from caller-owned event objects', () => {
  const es = events(),
    c = createClaudeNativeCollector(context());
  for (const e of es) c.consume(e);
  es[7].tool_use_result.resolvedModel = 'claude-sonnet-5';
  es[7].tool_use_result.content[0].text = 'mutated';
  const r = c.finish({ exitCode: 0, timedOut: false, currentContext: context() });
  assert.equal(r.valid, true);
  assert.equal(r.resolvedModel, context().expectedResolvedModel);
  assert.equal(r.content[0].text, 'oracle');
});
