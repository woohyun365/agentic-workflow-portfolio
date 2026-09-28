import assert from 'node:assert/strict';
import test from 'node:test';
import {
  readClaudeStoppedTranscript,
  isClaudeCompletedNotification,
} from '../agents/claude/native-session-evidence.mjs';
const context = {
  sessionId: 'session',
  agentId: 'child',
  prompt: 'exact prompt',
  expectedModel: 'claude-haiku-4-5-20251001',
};
const row = (type, content) => ({
  type,
  sessionId: 'session',
  agentId: 'child',
  message: { content, ...(type === 'assistant' ? { model: context.expectedModel } : {}) },
});
const base = () => [
  row('user', 'exact prompt'),
  row('assistant', [
    { type: 'tool_use', id: 'call-1', name: 'SubagentHandback', input: { message: 'oracle' } },
  ]),
  row('user', [
    { type: 'tool_result', tool_use_id: 'call-1', is_error: false, content: 'delivered' },
  ]),
];
const encode = (rows) =>
  Buffer.from(rows.map((r, i) => JSON.stringify({ uuid: `event-${i}`, ...r })).join('\n') + '\n');
test('actual auto handback is connected in order with observed model', () =>
  assert.equal(readClaudeStoppedTranscript(encode(base()), context).content[0].text, 'oracle'));
for (const [name, mutate] of [
  ['missing call id', (r) => delete r[1].message.content[0].id],
  ['missing result id', (r) => delete r[2].message.content[0].tool_use_id],
  [
    'both ids missing',
    (r) => {
      delete r[1].message.content[0].id;
      delete r[2].message.content[0].tool_use_id;
    },
  ],
  ['result before call', (r) => r.splice(1, 2, r[2], r[1])],
  ['error', (r) => (r[2].message.content[0].is_error = true)],
  ['duplicate result', (r) => r.push(structuredClone(r[2]))],
  ['duplicate call', (r) => r.push(structuredClone(r[1]))],
  ['foreign child', (r) => (r[1].agentId = 'other')],
  ['wrong model', (r) => (r[1].message.model = 'claude-opus-4-6')],
  ['truncated call', (r) => r.pop()],
  ['wrong prompt', (r) => (r[0].message.content = 'other')],
])
  test(`rejects ${name}`, () => {
    const r = base();
    mutate(r);
    assert.throws(() => readClaudeStoppedTranscript(encode(r), context));
  });
const notification = (text) => ({ type: 'user', sessionId: 'session', message: { content: text } });
const good =
  '<task-notification>\n<task-id>child</task-id>\n<tool-use-id>call</tool-use-id>\n<status>completed</status>\n<summary>done</summary>\n</task-notification>';
const nc = { sessionId: 'session', agentId: 'child', toolUseId: 'call' };
test('only complete top-level matching task notification is completion', () => {
  assert.equal(isClaudeCompletedNotification(notification(good), nc), true);
  for (const text of [
    good.replace('</task-notification>', ''),
    good.replace('completed', 'failed').replace('done', '<status>completed</status>'),
    good
      .replace('<task-id>child</task-id>', '<task-id>other</task-id>')
      .replace('done', '<task-id>child</task-id>'),
    good.replace('done', '<status>completed</status>'),
    good.replace('<tool-use-id>call</tool-use-id>', ''),
    good.replace('call</tool-use-id>', 'foreign</tool-use-id>'),
  ])
    assert.equal(isClaudeCompletedNotification(notification(text), nc), false);
});

test('absorbed mid-turn task notification uses its delivered typed attachment, not queue intent', () => {
  const attached = {
    type: 'attachment',
    sessionId: 'session',
    session_id: 'session',
    isSidechain: false,
    attachment: { type: 'queued_command', commandMode: 'task-notification', prompt: good },
  };
  assert.equal(isClaudeCompletedNotification(attached, nc), true);
  for (const change of [
    { type: 'queue-operation', operation: 'enqueue', content: good },
    { sessionId: 'foreign' },
    { session_id: 'foreign' },
    { isSidechain: true },
    { attachment: { ...attached.attachment, type: 'prompt_snapshot' } },
    { attachment: { ...attached.attachment, commandMode: 'user' } },
    { attachment: { ...attached.attachment, prompt: good.replace('completed', 'failed') } },
  ])
    assert.equal(isClaudeCompletedNotification({ ...attached, ...change }, nc), false);
});
