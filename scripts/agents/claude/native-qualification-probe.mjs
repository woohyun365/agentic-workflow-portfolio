// Explicit, finite fault injection at the qualification transport boundary.
// Never a routine dispatcher; imported observations never authorize execution.
import { mkdtempSync, writeFileSync, readFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isDeepStrictEqual } from 'node:util';
import { join, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { runClaudeNativeQualification } from './native-qualification.mjs';

export const CLAUDE_NATIVE_PROBE_CASES = Object.freeze([
  'good',
  'ambient-override',
  'missing-model',
  'wrong-model',
  'hook-missing',
  'hook-crash',
  'hook-malformed',
  'hook-timeout',
]);
const hash = (s) => createHash('sha256').update(s).digest('hex');
const quote = (s) => "'" + s.replaceAll("'", "'\\''") + "'";
const same = isDeepStrictEqual;
function checkCase(id) {
  if (!CLAUDE_NATIVE_PROBE_CASES.includes(id)) throw new TypeError('unknown qualification case');
}

// Pure structural assessment. Only the owning runner supplies captured pipe/launch evidence.
export function assessClaudeNativeDenial({
  caseId,
  events,
  context,
  expectedInput,
  exitCode,
  timedOut,
}) {
  checkCase(caseId);
  const errors = [];
  const require = (ok, why) => {
    if (!ok) errors.push(why);
  };
  require(!['good', 'ambient-override'].includes(caseId), 'not-negative-case');
  require(expectedInput?.subagent_type === context.role &&
    expectedInput?.prompt === context.prompt &&
    expectedInput?.run_in_background === false, 'expected-task-mismatch');
  require(caseId === 'missing-model'
    ? !Object.hasOwn(expectedInput ?? {}, 'model')
    : caseId === 'wrong-model'
      ? expectedInput?.model === (context.requestedModel === 'haiku' ? 'sonnet' : 'haiku')
      : expectedInput?.model === context.requestedModel, 'case-not-applied');
  require(exitCode === 0 && timedOut === false, 'process-incomplete');
  require(Array.isArray(events) && events.length > 0 && events.length <= 10000, 'event-count');
  if (!Array.isArray(events)) return { valid: false, errors, dispatchAuthorized: false };
  const ids = new Set();
  let systemDenials = 0;
  let init = null,
    attempt = null,
    denied = false,
    terminal = null,
    hookStart = null,
    hookEnd = null;
  for (const e of events) {
    if (!e || typeof e !== 'object') {
      errors.push('malformed-event');
      continue;
    }
    require(e.session_id === context.sessionId, 'foreign-session');
    require(typeof e.uuid === 'string' &&
      e.uuid.length > 0 &&
      !ids.has(e.uuid), 'duplicate-or-missing-id');
    ids.add(e.uuid);
    require(!terminal, 'after-terminal');
    if (e.type === 'system' && e.subtype === 'init') {
      require(!init && !attempt, 'duplicate-or-late-init');
      init = e;
      require(e.cwd === context.readScopeRoot &&
        e.permissionMode === 'default' &&
        e.claude_code_version === context.cliVersion &&
        Array.isArray(e.agents) &&
        e.agents.includes(context.role), 'effective-config');
      require(Array.isArray(e.plugins) &&
        e.plugins.every((p) => p.path === 'builtin' && p.source === 'agents-md@builtin') &&
        Array.isArray(e.mcp_servers) &&
        e.mcp_servers.length === 0, 'unqualified-extension');
      require(Array.isArray(e.tools) &&
        same([...e.tools].sort(), [...context.allowedParentTools].sort()), 'effective-tools');
      continue;
    }
    require(!!init, 'before-init');
    require(e.parent_tool_use_id == null &&
      !e.tool_use_result?.agentId &&
      !['task_started', 'task_progress', 'task_updated', 'task_notification'].includes(
        e.subtype,
      ), 'child-observed');
    require(e.message?.content === undefined ||
      Array.isArray(e.message.content), 'malformed-message');
    for (const b of Array.isArray(e.message?.content) ? e.message.content : []) {
      if (b.type === 'tool_use') {
        require(e.type === 'assistant' &&
          typeof b.id === 'string' &&
          b.id.length > 0 &&
          !attempt &&
          e.parent_tool_use_id == null &&
          b.name === 'Agent', 'unexpected-attempt');
        require(b.input &&
          same(Object.keys(b.input).sort(), Object.keys(expectedInput).sort()) &&
          Object.keys(expectedInput).every((k) =>
            same(b.input[k], expectedInput[k]),
          ), 'attempt-input');
        attempt = b;
      }
      if (b.type === 'tool_result') {
        require(e.type === 'user' &&
          attempt &&
          b.tool_use_id === attempt.id &&
          b.is_error === true &&
          !denied, 'unbound-denial');
        require(!!hookEnd, 'denial-before-hook');
        denied = true;
      }
    }
    if (e.subtype === 'hook_started') {
      require(e.type === 'system' &&
        typeof e.hook_id === 'string' &&
        e.hook_id.length > 0 &&
        attempt &&
        !hookStart &&
        e.hook_event === 'PermissionRequest' &&
        e.hook_name === 'PermissionRequest:Agent', 'unexpected-hook');
      hookStart = e;
    }
    if (e.subtype === 'hook_response') {
      require(e.type === 'system' &&
        typeof e.hook_id === 'string' &&
        e.hook_id.length > 0 &&
        hookStart &&
        !hookEnd &&
        e.hook_id === hookStart.hook_id &&
        e.hook_event === 'PermissionRequest' &&
        e.hook_name === 'PermissionRequest:Agent', 'unbound-hook-response');
      hookEnd = e;
      let behavior, hookOutput;
      try {
        hookOutput = JSON.parse(e.stdout).hookSpecificOutput;
        behavior = hookOutput?.decision?.behavior;
      } catch {
        /* no decision */
      }
      require(behavior !== 'allow', 'hook-allowed');
      if (['missing-model', 'wrong-model'].includes(caseId))
        require(behavior === 'deny' &&
          e.exit_code === 0 &&
          hookOutput?.hookEventName === 'PermissionRequest' &&
          hookOutput?.decision?.message === 'native-binding-mismatch', 'not-production-denial');
      if (caseId === 'hook-missing') require(e.exit_code === 127, 'not-missing-executable');
      if (caseId === 'hook-crash') require(e.exit_code === 1 && !e.stdout, 'not-crash');
      if (caseId === 'hook-malformed')
        require(e.exit_code === 0 && e.stdout?.trim() === '{invalid-json', 'not-malformed');
      if (caseId === 'hook-timeout') require(e.outcome === 'cancelled' && !e.stdout, 'not-timeout');
    }
    if (e.type === 'system' && e.subtype === 'permission_denied') {
      systemDenials++;
      require(systemDenials === 1 &&
        hookEnd &&
        e.tool_name === 'Agent' &&
        e.tool_use_id === attempt?.id, 'contradictory-system-denial');
      require(['missing-model', 'wrong-model'].includes(caseId)
        ? e.decision_reason_type === 'hook' && e.decision_reason === 'native-binding-mismatch'
        : e.decision_reason_type === 'asyncAgent' &&
            typeof e.decision_reason === 'string' &&
            e.decision_reason.includes('no approval surface'), 'unexpected-denial-reason');
    }
    if (e.type === 'result') {
      terminal = e;
      require(e.subtype === 'success' && e.is_error === false && denied, 'terminal-not-success');
      // Some CLI releases omit subagent_stats when no child was created. Missing stats is
      // NOT accepted until that exact zero-child schema has independent live evidence.
      require(e.subagent_stats?.spawned === 0 &&
        e.subagent_stats.completed === 0 &&
        e.subagent_stats.failed === 0 &&
        !(e.subagent_stats.spawned_by_subagents > 0), 'nonzero-or-missing-stats');
      require(e.permission_denials?.length === 1 &&
        ['Task', 'Agent'].includes(e.permission_denials[0].tool_name) &&
        e.permission_denials[0].tool_use_id === attempt?.id &&
        same(e.permission_denials[0].tool_input, attempt?.input), 'missing-native-denial');
    }
  }
  require(!!init && !!attempt && !!hookEnd && denied && !!terminal, 'incomplete-denial-chain');
  return {
    valid: errors.length === 0,
    errors: [...new Set(errors)],
    caseId,
    verificationClass: 'structural-native-negative',
    dispatchAuthorized: false,
    runtimeQualified: false,
  };
}

// Verifies the exact finite mutation; hashes alone never establish correctness.
export function validateClaudeFaultLaunch({
  receipt,
  originalArgs,
  context,
  caseId,
  executable,
  faultCommand,
}) {
  const errors = [];
  checkCase(caseId);
  const require = (ok, why) => {
    if (!ok) errors.push(why);
  };
  const input = {
    description: 'Bound native qualification',
    subagent_type: context.role,
    model: context.requestedModel,
    prompt: context.prompt,
    run_in_background: false,
  };
  const expected = { ...input };
  if (caseId === 'wrong-model') expected.model = input.model === 'haiku' ? 'sonnet' : 'haiku';
  if (caseId === 'missing-model') delete expected.model;
  const args = [...originalArgs];
  if (caseId.startsWith('hook-')) {
    const i = args.indexOf('--settings') + 1,
      settings = JSON.parse(args[i]);
    settings.hooks.PermissionRequest[0].hooks[0].command = faultCommand;
    args[i] = JSON.stringify(settings);
  }
  const prompt = (i) =>
    'Call native Agent exactly once with this JSON input, then report the child result and stop: ' +
    JSON.stringify(i);
  require(receipt?.caseId === caseId &&
    receipt.actualExecutable === executable, 'wrong-launch-identity');
  require(same(receipt?.originalArgs, originalArgs) &&
    same(receipt?.effectiveArgs, args), 'unexpected-launch-mutation');
  require(same(receipt?.originalInput, input) &&
    same(receipt?.expectedInput, expected), 'unexpected-input-mutation');
  require(receipt?.originalPrompt === prompt(input) &&
    receipt?.effectivePrompt === prompt(expected), 'unexpected-prompt-mutation');
  require(receipt?.ambientOverrideAbsent === true, 'ambient-override-survived');
  require(Number.isInteger(receipt?.cliPid) &&
    receipt.cliPid > 0 &&
    receipt.cliExitCode === 0 &&
    receipt.cliSignal === null, 'actual-cli-incomplete');
  return { valid: errors.length === 0, errors, dispatchAuthorized: false, runtimeQualified: false };
}

export async function runClaudeNativeFaultProbe(
  plan,
  { caseId, executable, timeoutMs = 75000 } = {},
) {
  checkCase(caseId);
  if (
    !isAbsolute(executable ?? '') ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1000 ||
    timeoutMs > 75000
  )
    throw new TypeError('explicit bounded executable/time required');
  const temp = mkdtempSync(join(tmpdir(), 'repo-native-fault-'));
  const receiptPath = join(temp, 'launch.json'),
    proxy = join(temp, 'proxy.cjs');
  const fault = join(temp, 'fault.cjs');
  writeFileSync(
    fault,
    "if(process.argv[2]==='hook-crash')process.exit(1);\nif(process.argv[2]==='hook-malformed')process.stdout.write('{invalid-json');\nif(process.argv[2]==='hook-timeout')setInterval(()=>{},1000);\n",
  );
  const faultCommand =
    caseId === 'hook-missing'
      ? quote(join(temp, 'absent-executable'))
      : [process.execPath, fault, caseId].map(quote).join(' ');
  const config = { caseId, executable, receiptPath, faultCommand };
  // The proxy has no discretionary override API. It captures the actual original
  // launch/input, applies one enumerated mutation, then inherits the same process group.
  writeFileSync(
    proxy,
    '#!' +
      process.execPath +
      '\n' +
      'const c=' +
      JSON.stringify(config) +
      ';\n' +
      String.raw`
const fs=require('node:fs'),cp=require('node:child_process');
const original=process.argv.slice(2),args=[...original];
let text='';process.stdin.on('data',b=>text+=b);
process.stdin.on('end',()=>{
 const at=text.indexOf('{'); const input=JSON.parse(text.slice(at));
 const originalInput=JSON.parse(JSON.stringify(input));
 if(c.caseId==='wrong-model')input.model=input.model==='haiku'?'sonnet':'haiku';
 if(c.caseId==='missing-model')delete input.model;
 const si=args.indexOf('--settings')+1;
 if(si===0)process.exit(9);
 if(c.caseId.startsWith('hook-')){
  const settings=JSON.parse(args[si]);
  settings.hooks.PermissionRequest[0].hooks[0].command=c.faultCommand;
  args[si]=JSON.stringify(settings);
 }
 const expectedPrompt=text.slice(0,at)+JSON.stringify(input);
 const receipt={
  caseId:c.caseId,originalArgs:original,effectiveArgs:args,originalInput,expectedInput:input,
  originalPrompt:text,effectivePrompt:expectedPrompt,actualExecutable:c.executable,
  faultCommand:c.caseId.startsWith('hook-')?c.faultCommand:null,
  ambientOverrideAbsent:['CLAUDE_CODE_SUBAGENT_MODEL','CLAUDE_CODE_SUBAGENT_MODEL_FORCE','ANTHROPIC_MODEL'].every(k=>!process.env[k])
 };
 const save=()=>fs.writeFileSync(c.receiptPath,JSON.stringify(receipt),{mode:0o600});
 save();
 const p=cp.spawn(c.executable,args,{stdio:['pipe','inherit','inherit'],env:process.env});
 receipt.cliPid=p.pid;save();
 p.on('error',()=>process.exit(9));p.on('close',(code,signal)=>{receipt.cliExitCode=code;receipt.cliSignal=signal;save();process.exit(code??9);});
 p.stdin.on('error',()=>{});p.stdin.end(expectedPrompt);
});
`,
    { mode: 0o700 },
  );
  chmodSync(proxy, 0o700);
  const keys = [
    'CLAUDE_CODE_SUBAGENT_MODEL',
    'CLAUDE_CODE_SUBAGENT_MODEL_FORCE',
    'ANTHROPIC_MODEL',
  ];
  const prior = keys.map((k) => process.env[k]);
  try {
    if (caseId === 'ambient-override') {
      process.env.CLAUDE_CODE_SUBAGENT_MODEL = 'sonnet';
      process.env.CLAUDE_CODE_SUBAGENT_MODEL_FORCE = '1';
      process.env.ANTHROPIC_MODEL = 'sonnet';
    }
    const result = await runClaudeNativeQualification(plan, { executable: proxy, timeoutMs });
    const context = structuredClone(result.observation.association);
    let receiptRaw = '',
      receipt,
      events;
    try {
      receiptRaw = readFileSync(receiptPath, 'utf8');
      receipt = JSON.parse(receiptRaw);
      events = result.stdout
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l));
    } catch {
      return {
        caseId,
        assessment: {
          valid: false,
          errors: ['incomplete-launch-or-stream-evidence'],
          dispatchAuthorized: false,
          runtimeQualified: false,
        },
        receiptRaw,
        result,
      };
    }
    const negative = !['good', 'ambient-override'].includes(caseId);
    const assessment = negative
      ? assessClaudeNativeDenial({
          caseId,
          events,
          context,
          expectedInput: receipt.expectedInput,
          exitCode: result.exitCode,
          timedOut: result.timedOut || result.outputExceeded,
        })
      : {
          valid: result.observation.valid,
          errors: result.observation.errors,
          dispatchAuthorized: false,
          runtimeQualified: false,
        };
    const launchAssessment = validateClaudeFaultLaunch({
      receipt,
      originalArgs: result.launch.args,
      context,
      caseId,
      executable,
      faultCommand,
    });
    assessment.errors.push(
      ...launchAssessment.errors,
      ...result.observation.errors.filter((e) => e.startsWith('context-drift:')),
    );
    assessment.valid = assessment.valid && assessment.errors.length === 0;
    return {
      caseId,
      assessment,
      receipt: {
        ...receipt,
        sourceContext: context,
        interceptorDigest: hash(readFileSync(proxy)),
        originalPromptDigest: hash(receipt.originalPrompt),
        effectivePromptDigest: hash(receipt.effectivePrompt),
        originalConfigDigest: hash(JSON.stringify(receipt.originalArgs)),
        effectiveConfigDigest: hash(JSON.stringify(receipt.effectiveArgs)),
      },
      result,
    };
  } finally {
    if (caseId === 'ambient-override')
      keys.forEach((k, i) => {
        if (prior[i] === undefined) delete process.env[k];
        else process.env[k] = prior[i];
      });
    rmSync(temp, { recursive: true, force: true });
  }
}
