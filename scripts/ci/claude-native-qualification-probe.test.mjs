import assert from 'node:assert/strict';
import test from 'node:test';
import { writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { fixture } from './fixtures/claude-native-qualification-fixture.mjs';
import { prepareClaudeNativeQualification } from '../agents/claude/native-qualification.mjs';
import {
  assessClaudeNativeDenial,
  runClaudeNativeFaultProbe,
  validateClaudeFaultLaunch,
} from '../agents/claude/native-qualification-probe.mjs';

function sample(caseId = 'wrong-model') {
  const context = {
    sessionId: 'session',
    readScopeRoot: '/fixture',
    cliVersion: '2.1.283',
    role: 'repo_explorer',
    requestedModel: 'haiku',
    prompt: 'bound',
    allowedParentTools: ['Task', 'Read'],
  };
  const expectedInput = {
    description: 'Bound native qualification',
    subagent_type: context.role,
    prompt: context.prompt,
    run_in_background: false,
  };
  if (caseId !== 'missing-model')
    expectedInput.model = caseId === 'wrong-model' ? 'sonnet' : 'haiku';
  let n = 0;
  const e = (v) => ({ session_id: 'session', uuid: String(++n), ...v });
  const hook = {
    type: 'system',
    subtype: 'hook_response',
    hook_id: 'hook',
    hook_name: 'PermissionRequest:Agent',
    hook_event: 'PermissionRequest',
    exit_code: 0,
    outcome: 'success',
    stdout: JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: { behavior: 'deny', message: 'native-binding-mismatch' },
      },
    }),
  };
  if (caseId === 'hook-missing')
    Object.assign(hook, { exit_code: 127, outcome: 'error', stdout: '' });
  if (caseId === 'hook-crash') Object.assign(hook, { exit_code: 1, outcome: 'error', stdout: '' });
  if (caseId === 'hook-malformed') Object.assign(hook, { stdout: '{invalid-json' });
  if (caseId === 'hook-timeout')
    Object.assign(hook, { exit_code: 1, outcome: 'cancelled', stdout: '' });
  const events = [
    e({
      type: 'system',
      subtype: 'init',
      cwd: '/fixture',
      permissionMode: 'default',
      claude_code_version: '2.1.283',
      agents: ['repo_explorer'],
      tools: ['Task', 'Read'],
      plugins: [],
      mcp_servers: [],
    }),
    e({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', id: 'tool', name: 'Agent', input: expectedInput }] },
    }),
    e({
      type: 'system',
      subtype: 'hook_started',
      hook_id: 'hook',
      hook_name: 'PermissionRequest:Agent',
      hook_event: 'PermissionRequest',
    }),
    e(hook),
    e({
      type: 'user',
      message: {
        content: [{ type: 'tool_result', tool_use_id: 'tool', is_error: true, content: 'denied' }],
      },
    }),
    e({
      type: 'result',
      subtype: 'success',
      is_error: false,
      subagent_stats: { spawned: 0, completed: 0, failed: 0 },
      permission_denials: [{ tool_name: 'Task', tool_use_id: 'tool', tool_input: expectedInput }],
    }),
  ];
  return { caseId, context, expectedInput, events, exitCode: 0, timedOut: false };
}
for (const id of [
  'wrong-model',
  'missing-model',
  'hook-missing',
  'hook-crash',
  'hook-malformed',
  'hook-timeout',
])
  test('structural denial chain ' + id, () =>
    assert.equal(assessClaudeNativeDenial(sample(id)).valid, true),
  );
for (const [name, mutate] of [
  ['empty', (x) => (x.events = [])],
  ['no attempt', (x) => x.events.splice(1, 1)],
  ['foreign session', (x) => (x.events[3].session_id = 'other')],
  ['duplicate', (x) => x.events.splice(4, 0, x.events[3])],
  ['no denial', (x) => x.events.splice(4, 1)],
  ['no terminal', (x) => x.events.pop()],
  [
    'child started',
    (x) =>
      x.events.splice(4, 0, {
        session_id: 'session',
        uuid: 'child',
        type: 'system',
        subtype: 'task_started',
      }),
  ],
  ['forwarded child', (x) => (x.events[4].parent_tool_use_id = 'tool')],
  ['nonzero stats', (x) => (x.events[5].subagent_stats.spawned = 1)],
  ['missing stats', (x) => delete x.events[5].subagent_stats],
  ['fake denied name', (x) => (x.events[5].permission_denials[0].tool_name = 'Read')],
  ['wrong tool id', (x) => (x.events[4].message.content[0].tool_use_id = 'foreign')],
  [
    'hook allowed',
    (x) => (x.events[3].stdout = '{"hookSpecificOutput":{"decision":{"behavior":"allow"}}}'),
  ],
  ['bad actual input', (x) => (x.events[1].message.content[0].input = { model: 'haiku' })],
  [
    'case not applied',
    (x) => {
      x.expectedInput = { ...x.expectedInput, model: 'haiku' };
    },
  ],
  [
    'parent fallback',
    (x) =>
      x.events.splice(5, 0, {
        session_id: 'session',
        uuid: 'extra',
        type: 'assistant',
        message: { content: [{ type: 'tool_use', name: 'Read', id: 'extra', input: {} }] },
      }),
  ],
  ['truncation', (x) => (x.timedOut = true)],
  ['nonzero exit', (x) => (x.exitCode = 1)],
  [
    'terminal before denial',
    (x) => {
      [x.events[4], x.events[5]] = [x.events[5], x.events[4]];
    },
  ],
])
  test('negative oracle rejects ' + name, () => {
    const x = sample();
    assert.equal(assessClaudeNativeDenial(x).valid, true);
    mutate(x);
    assert.equal(assessClaudeNativeDenial(x).valid, false);
  });

for (const drift of [false, true])
  test('actual caller production denial preserves identity; drift=' + drift, async (t) => {
    const f = fixture(t),
      fake = join(f.root, 'fake.cjs');
    // Fixture executable outside tracked task scope is committed before preparation.
    writeFileSync(
      fake,
      '#!' +
        process.execPath +
        '\n' +
        String.raw`
const fs=require('node:fs'),cp=require('node:child_process');
const args=process.argv.slice(2);let raw='';
process.stdin.on('data',x=>raw+=x);process.stdin.on('end',()=>{
 const input=JSON.parse(raw.slice(raw.indexOf('{')));
 const settings=JSON.parse(args[args.indexOf('--settings')+1]);
 const command=settings.hooks.PermissionRequest[0].hooks[0].command;
 const parts=[...command.matchAll(/'([^']*)'/g)].map(m=>m[1]);
 const packet=JSON.parse(fs.readFileSync(parts[3],'utf8')),c=packet.context;
 const out=cp.spawnSync(parts[0],parts.slice(1),{input:JSON.stringify({hook_event_name:'PermissionRequest',session_id:c.sessionId,cwd:process.cwd(),tool_name:'Agent',tool_input:input}),encoding:'utf8'});
 const decision=JSON.parse(out.stdout).hookSpecificOutput.decision.behavior;
 if(decision!=='deny')process.exit(8);
 let i=0; const send=e=>process.stdout.write(JSON.stringify({session_id:c.sessionId,uuid:String(++i),...e})+'\n');
 send({type:'system',subtype:'init',cwd:process.cwd(),permissionMode:'default',claude_code_version:c.cliVersion,agents:[c.role],tools:c.allowedParentTools,plugins:[],mcp_servers:[]});
 send({type:'assistant',message:{content:[{type:'tool_use',id:'tool',name:'Agent',input}]}});
 send({type:'system',subtype:'hook_started',hook_id:'hook',hook_event:'PermissionRequest',hook_name:'PermissionRequest:Agent'});
 send({type:'system',subtype:'hook_response',hook_id:'hook',hook_event:'PermissionRequest',hook_name:'PermissionRequest:Agent',stdout:out.stdout,exit_code:0,outcome:'success'});
 send({type:'user',message:{content:[{type:'tool_result',tool_use_id:'tool',is_error:true,content:'denied'}]}});
 send({type:'result',subtype:'success',is_error:false,subagent_stats:{spawned:0,completed:0,failed:0},permission_denials:[{tool_name:'Task',tool_use_id:'tool',tool_input:input}]});
 if(${drift})fs.writeFileSync('sample.txt','changed');
});
`,
      { mode: 0o700 },
    );
    chmodSync(fake, 0o700);
    // Keep the fake executable ignored; source task snapshot remains the original fixture.
    writeFileSync(join(f.root, '.git/info/exclude'), 'fake.cjs\n');
    const plan = prepareClaudeNativeQualification(f.input, f.options);
    plan.packet.context.role = 'public-tamper';
    const r = await runClaudeNativeFaultProbe(plan, { caseId: 'wrong-model', executable: fake });
    assert.equal(r.assessment.valid, !drift, JSON.stringify(r.assessment));
    if (drift) assert(r.assessment.errors.some((e) => e.startsWith('context-drift:')));
    assert.equal(r.result.observation.valid, false);
    assert.equal(r.receipt.originalInput.model, 'haiku');
    assert.equal(r.receipt.expectedInput.model, 'sonnet');
    assert.deepEqual(r.receipt.originalArgs, r.receipt.effectiveArgs);
    assert.notEqual(r.receipt.originalPromptDigest, r.receipt.effectivePromptDigest);
    assert.equal(r.receipt.ambientOverrideAbsent, true);
    assert.equal(r.assessment.runtimeQualified, false);
    for (const mutate of [
      (x) => x.effectiveArgs.push('--permission-mode', 'bypassPermissions'),
      (x) => (x.expectedInput.model = 'haiku'),
      (x) => (x.effectivePrompt = 'different'),
      (x) => (x.actualExecutable = '/foreign'),
      (x) => (x.cliExitCode = 1),
      (x) => (x.ambientOverrideAbsent = false),
    ]) {
      const receipt = structuredClone(r.receipt);
      mutate(receipt);
      assert.equal(
        validateClaudeFaultLaunch({
          receipt,
          originalArgs: r.result.launch.args,
          context: r.receipt.sourceContext,
          caseId: 'wrong-model',
          executable: fake,
        }).valid,
        false,
      );
    }
  });

test('terminal input object key order follows actual CLI schema, not stringify order', () => {
  const x = sample();
  x.events.at(-1).permission_denials[0].tool_input = Object.fromEntries(
    Object.entries(x.expectedInput).reverse(),
  );
  assert.equal(assessClaudeNativeDenial(x).valid, true);
});
test('contradictory explicit permission_denied cannot be ignored', () => {
  const x = sample();
  x.events.splice(4, 0, {
    session_id: 'session',
    uuid: 'system-denial',
    type: 'system',
    subtype: 'permission_denied',
    tool_name: 'Agent',
    tool_use_id: 'foreign',
    decision_reason_type: 'hook',
    decision_reason: 'native-binding-mismatch',
  });
  assert.equal(assessClaudeNativeDenial(x).valid, false);
});
test('malformed actual pipe retains raw evidence and is not a denial PASS', async (t) => {
  const f = fixture(t),
    fake = join(f.root, 'bad.cjs');
  writeFileSync(fake, '#!' + process.execPath + "\nprocess.stdout.write('{broken}\\n');", {
    mode: 0o700,
  });
  chmodSync(fake, 0o700);
  writeFileSync(join(f.root, '.git/info/exclude'), 'bad.cjs\n');
  const plan = prepareClaudeNativeQualification(f.input, f.options);
  const r = await runClaudeNativeFaultProbe(plan, { caseId: 'wrong-model', executable: fake });
  assert.equal(r.assessment.valid, false);
  assert.equal(r.result.stdout, '{broken}\n');
  assert.equal(typeof r.receiptRaw, 'string');
});

for (const [name, mutate] of [
  [
    'missing linkage IDs',
    (x) => {
      delete x.events[1].message.content[0].id;
      delete x.events[4].message.content[0].tool_use_id;
      delete x.events[5].permission_denials[0].tool_use_id;
      delete x.events[2].hook_id;
      delete x.events[3].hook_id;
    },
  ],
  ['wrong attempt envelope', (x) => (x.events[1].type = 'user')],
  ['wrong result envelope', (x) => (x.events[4].type = 'assistant')],
  ['wrong hook envelope', (x) => (x.events[3].type = 'user')],
  ['empty UUID', (x) => (x.events[0].uuid = '')],
  ['malformed message', (x) => (x.events[4].message.content = 'invalid')],
])
  test('actual linkage rejects ' + name, () => {
    const x = sample();
    assert.equal(assessClaudeNativeDenial(x).valid, true);
    mutate(x);
    assert.equal(assessClaudeNativeDenial(x).valid, false);
  });

test('denial marker outside actual hook decision is not production callback evidence', () => {
  const x = sample();
  x.events[3].stdout = JSON.stringify({
    unrelated: 'native-binding-mismatch',
    hookSpecificOutput: {
      hookEventName: 'PermissionRequest',
      decision: { behavior: 'deny', message: 'other' },
    },
  });
  assert.equal(assessClaudeNativeDenial(x).valid, false);
});
