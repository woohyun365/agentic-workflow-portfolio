import { chmodSync, symlinkSync, unlinkSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  prepareClaudeNativeQualification,
  decideClaudeNativePermission,
  runClaudeNativeQualification,
} from '../agents/claude/native-qualification.mjs';
const sha = (s) => `sha256:${createHash('sha256').update(s).digest('hex')}`;
const cli = new URL('../agents/claude/native-qualification.mjs', import.meta.url).pathname;
import { fixture } from './fixtures/claude-native-qualification-fixture.mjs';

function event(packet) {
  return {
    hook_event_name: 'PermissionRequest',
    session_id: packet.context.sessionId,
    cwd: packet.root,
    tool_name: 'Agent',
    tool_input: {
      description: 'test',
      subagent_type: packet.context.role,
      model: packet.context.requestedModel,
      prompt: packet.context.prompt,
      run_in_background: false,
    },
  };
}
test('actual workflow binding and full request identity feed gate', (t) => {
  const f = fixture(t),
    p = prepareClaudeNativeQualification(f.input, f.options);
  assert.equal(p.packet.context.bindingDigest, p.workflow.native.binding.bindingDigest);
  assert.equal(p.packet.context.requestDigest, p.workflow.requestDigest);
  assert.equal(p.dispatchAuthorized, false);
  assert.equal(decideClaudeNativePermission(p.packet, event(p.packet)).allow, true);
});
for (const [name, change] of [
  [
    'wrong-model',
    (e) => {
      e.tool_input.model = 'sonnet';
    },
  ],
  [
    'missing-model',
    (e) => {
      delete e.tool_input.model;
    },
  ],
  [
    'wrong-role',
    (e) => {
      e.tool_input.subagent_type = 'general-purpose';
    },
  ],
  [
    'wrong-session',
    (e) => {
      e.session_id = 'foreign';
    },
  ],
  [
    'wrong-prompt',
    (e) => {
      e.tool_input.prompt = 'other';
    },
  ],
  [
    'background',
    (e) => {
      e.tool_input.run_in_background = true;
    },
  ],
  [
    'unexpected-argument',
    (e) => {
      e.tool_input.isolation = 'worktree';
    },
  ],
  [
    'wrong-event',
    (e) => {
      e.hook_event_name = 'PreToolUse';
    },
  ],
])
  test(`gate denies ${name}`, (t) => {
    const f = fixture(t),
      p = prepareClaudeNativeQualification(f.input, f.options),
      e = event(p.packet);
    change(e);
    assert.equal(decideClaudeNativePermission(p.packet, e).allow, false);
  });
test('only selected Read file allowed; Bash and external reads denied', (t) => {
  const f = fixture(t),
    p = prepareClaudeNativeQualification(f.input, f.options),
    e = event(p.packet);
  e.tool_name = 'Read';
  e.tool_input = { file_path: join(f.root, 'sample.txt') };
  assert.equal(decideClaudeNativePermission(p.packet, e).allow, true);
  e.tool_input.file_path = '/etc/hosts';
  assert.equal(decideClaudeNativePermission(p.packet, e).allow, false);
  e.tool_name = 'Bash';
  assert.equal(decideClaudeNativePermission(p.packet, e).allow, false);
});
test('expired and changed task/role sources denied', (t) => {
  const f = fixture(t),
    p = prepareClaudeNativeQualification(f.input, f.options);
  assert.equal(
    decideClaudeNativePermission(p.packet, event(p.packet), { now: '2100-01-01T00:00:00.000Z' })
      .allow,
    false,
  );
  writeFileSync(join(f.root, 'sample.txt'), 'changed');
  assert.equal(decideClaudeNativePermission(p.packet, event(p.packet)).allow, false);
});
test('ineligible source or unsupported selected model never gets a plan', (t) => {
  const f = fixture(t);
  assert.throws(() =>
    prepareClaudeNativeQualification(f.input, {
      ...f.options,
      expectedResolvedModel: 'claude-sonnet-5',
    }),
  );
  f.input.nativeRequest.selectedBy = 'child';
  assert.throws(() => prepareClaudeNativeQualification(f.input, f.options));
});
test('imported JSON cannot launch a process', async (t) => {
  const f = fixture(t),
    p = prepareClaudeNativeQualification(f.input, f.options);
  await assert.rejects(
    runClaudeNativeQualification(JSON.parse(JSON.stringify(p)), { executable: '/does/not/exist' }),
    /fresh prepared/,
  );
});
test('stale prepared source is rejected before process creation', async (t) => {
  const f = fixture(t),
    p = prepareClaudeNativeQualification(f.input, f.options);
  writeFileSync(join(f.root, 'sample.txt'), 'changed');
  await assert.rejects(
    runClaudeNativeQualification(p, { executable: '/does/not/exist' }),
    /source/,
  );
});
test('actual hook CLI checks packet hash and one-shot Agent grant', (t) => {
  const f = fixture(t),
    p = prepareClaudeNativeQualification(f.input, f.options);
  const dir = mkdtempSync(join(tmpdir(), 'permission-packet-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'packet.json'),
    bytes = JSON.stringify(p.packet);
  writeFileSync(path, bytes);
  const invoke = (hash) => {
    const r = spawnSync(process.execPath, [cli, '--permission-event', path, hash], {
      input: JSON.stringify(event(p.packet)),
      encoding: 'utf8',
    });
    assert.equal(r.status, 0);
    return JSON.parse(r.stdout).hookSpecificOutput.decision.behavior;
  };
  assert.equal(invoke('bad'), 'deny');
  assert.equal(invoke(sha(bytes)), 'allow');
  assert.equal(invoke(sha(bytes)), 'deny');
});
test('ignored project settings added after prepare are denied', (t) => {
  const f = fixture(t),
    p = prepareClaudeNativeQualification(f.input, f.options);
  writeFileSync(join(f.root, '.git/info/exclude'), '.claude/settings.local.json\n');
  writeFileSync(join(f.root, '.claude/settings.local.json'), '{}');
  assert.equal(decideClaudeNativePermission(p.packet, event(p.packet)).allow, false);
});
test('expired prepared binding is rejected before starting an executable', async (t) => {
  const f = fixture(t);
  f.input.nativeRequest.expiresAt = new Date(Date.now() + 500).toISOString();
  const p = prepareClaudeNativeQualification(f.input, f.options);
  await new Promise((r) => setTimeout(r, 550));
  await assert.rejects(
    runClaudeNativeQualification(p, { executable: '/does/not/exist' }),
    /expired/,
  );
});
test('role symlink or runtime frontmatter is rejected before reading or dispatch', (t) => {
  const f = fixture(t),
    path = join(f.root, '.claude/agents/repo_explorer.md'),
    bytes = readFileSync(path);
  unlinkSync(path);
  symlinkSync('/etc/hosts', path);
  assert.throws(() => prepareClaudeNativeQualification(f.input, f.options), /symlink/);
  unlinkSync(path);
  writeFileSync(path, bytes.toString().replace('tools:', 'model: opus\ntools:'));
  assert.throws(() => prepareClaudeNativeQualification(f.input, f.options), /frontmatter/);
});
function fakeExecutable(t, mode = 'success') {
  const dir = mkdtempSync(join(tmpdir(), 'fake-native-host-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'claude');
  writeFileSync(
    path,
    `#!${process.execPath}
 const fs=require('node:fs'),cp=require('node:child_process');
 const args=process.argv.slice(2), mode=${JSON.stringify(mode)}; let input='';
 process.stdin.on('data',x=>input+=x);process.stdin.on('end',()=>{
 if(mode==='timeout'){setInterval(()=>{},1000);return;}
 if(mode==='overflow'){process.stdout.write('x'.repeat(10000));return;}
 if(mode==='malformed'){process.stdout.write('{broken}\\n');return;}
 if(['CLAUDE_CODE_SUBAGENT_MODEL','CLAUDE_CODE_SUBAGENT_MODEL_FORCE','ANTHROPIC_MODEL'].some(k=>process.env[k]))process.exit(8);
 const settings=JSON.parse(args[args.indexOf('--settings')+1]);
 const command=settings.hooks.PermissionRequest[0].hooks[0].command;
 const parts=[...command.matchAll(/'([^']*)'/g)].map(m=>m[1]);
 const packet=JSON.parse(fs.readFileSync(parts[3],'utf8')),c=packet.context;
 const call=JSON.parse(input.slice(input.indexOf('{')));
 const hook=cp.spawnSync(parts[0],parts.slice(1),{input:JSON.stringify({hook_event_name:'PermissionRequest',session_id:c.sessionId,cwd:process.cwd(),tool_name:'Agent',tool_input:call}),encoding:'utf8'});
 if(JSON.parse(hook.stdout).hookSpecificOutput.decision.behavior!=='allow')process.exit(5);
 let n=0;const send=x=>process.stdout.write(JSON.stringify({session_id:c.sessionId,uuid:'event-'+(++n),...x})+'\\n');
 send({type:'system',subtype:'init',claude_code_version:c.cliVersion,cwd:c.readScopeRoot,permissionMode:'default',agents:[c.role],tools:['Task','Glob','Grep','Read'],plugins:[],mcp_servers:[]});
 send({type:'assistant',parent_tool_use_id:null,message:{content:[{type:'tool_use',id:'call',name:'Agent',input:call}]}});
 send({type:'system',subtype:'task_started',task_id:'child',tool_use_id:'call',subagent_type:c.role,prompt:c.prompt});
 send({type:'assistant',parent_tool_use_id:'call',message:{model:c.expectedResolvedModel,content:[{type:'tool_use',id:'read',name:'Read',input:{file_path:process.cwd()+'/sample.txt'}}]}});
 send({type:'user',parent_tool_use_id:'call',message:{content:[{type:'tool_result',tool_use_id:'read',content:'oracle'}]}});
 send({type:'system',subtype:'task_notification',task_id:'child',tool_use_id:'call',status:'completed'});
 send({type:'user',parent_tool_use_id:null,message:{content:[{type:'tool_result',tool_use_id:'call'}]},tool_use_result:{agentId:'child',agentType:c.role,status:'completed',resolvedModel:c.expectedResolvedModel,prompt:c.prompt,totalToolUseCount:1,content:[{type:'text',text:'oracle'}]}});
 send({type:'result',subtype:'success',is_error:false,subagent_stats:{spawned:1,completed:1,failed:0},permission_denials:[]});
 if(mode==='exit-failure')process.exitCode=3;
 });
 `,
  );
  chmodSync(path, 0o700);
  return path;
}
test('owned local transport connects callback, collector and common validator but never runtime admission', async (t) => {
  const f = fixture(t),
    p = prepareClaudeNativeQualification(f.input, f.options);
  p.workflow.lanes[0].owner = 'tampered';
  const r = await runClaudeNativeQualification(p, { executable: fakeExecutable(t) });
  assert.equal(r.observation.valid, true, JSON.stringify(r.observation.errors));
  assert.equal(r.commonResult.status, 'partial');
  assert.equal(r.commonAssessment.fanIn.valid, false);
  assert.deepEqual(r.commonResult.gaps, ['semantic-acceptance-and-independent-qa-not-verified']);
  assert(r.commonAssessment.errors.includes('strict-native-dispatch-not-qualified'));
  assert.equal(r.commonAssessment.valid, false);
  assert.equal(r.runtimeQualified, false);
  assert.equal(r.commonResult.owner, 'explorer');
  assert(!r.launch.args.includes('--safe-mode'));
  assert(!r.launch.args.includes('--restricted'));
  await assert.rejects(
    runClaudeNativeQualification(p, { executable: '/does/not/exist' }),
    /fresh prepared/,
  );
});
for (const mode of ['timeout', 'overflow', 'malformed', 'exit-failure'])
  test(`local transport refuses ${mode}`, async (t) => {
    const f = fixture(t),
      p = prepareClaudeNativeQualification(f.input, f.options);
    const r = await runClaudeNativeQualification(p, {
      executable: fakeExecutable(t, mode),
      timeoutMs: 1000,
      maxOutputBytes: mode === 'overflow' ? 1024 : 100000,
    });
    assert.equal(r.observation.valid, false);
    assert.equal(r.commonResult, null);
    assert.equal(r.runtimeQualified, false);
  });

test('missing CLI executable fails without fallback and consumes preparation', async (t) => {
  const f = fixture(t),
    p = prepareClaudeNativeQualification(f.input, f.options);
  await assert.rejects(
    runClaudeNativeQualification(p, { executable: join(f.root, 'absent-cli') }),
    /ENOENT/,
  );
  await assert.rejects(
    runClaudeNativeQualification(p, { executable: fakeExecutable(t) }),
    /fresh prepared/,
  );
});
test('caller does not inherit ambient model override variables', async (t) => {
  const keys = [
    'CLAUDE_CODE_SUBAGENT_MODEL',
    'CLAUDE_CODE_SUBAGENT_MODEL_FORCE',
    'ANTHROPIC_MODEL',
  ];
  const previous = keys.map((k) => process.env[k]);
  t.after(() =>
    keys.forEach((k, i) =>
      previous[i] === undefined ? delete process.env[k] : (process.env[k] = previous[i]),
    ),
  );
  for (const key of keys) process.env[key] = 'synthetic-override';
  const f = fixture(t),
    p = prepareClaudeNativeQualification(f.input, f.options);
  const result = await runClaudeNativeQualification(p, { executable: fakeExecutable(t) });
  assert.equal(result.observation.valid, true);
  assert.equal(result.runtimeQualified, false);
});
