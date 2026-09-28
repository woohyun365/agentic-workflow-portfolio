import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  readFileSync,
  writeFileSync,
  readdirSync,
  realpathSync,
  mkdtempSync,
  rmSync,
  existsSync,
} from 'node:fs';
import { resolve, relative, dirname, join, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { prepareClaudeWorkflow, validateClaudeWorkflowResults } from './workflow-entry.mjs';
import { runClaudePreflight } from './session-preflight.mjs';
import { createClaudeNativeCollector } from './native-run-evidence.mjs';

const modulePath = fileURLToPath(import.meta.url);
const ownDirectory = dirname(modulePath);
const prepared = new WeakMap();
const sha = (s) => `sha256:${createHash('sha256').update(s).digest('hex')}`;
const canonical = (v) =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === 'object'
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, canonical(v[k])]),
        )
      : v;
const jsonHash = (value) => sha(JSON.stringify(canonical(value)));
const quote = (s) => `'${s.replaceAll("'", "'\\''")}'`;
function assert(value, message) {
  if (!value) throw new TypeError(message);
}
function fileMap(root, paths) {
  return Object.fromEntries(
    paths.map((name) => {
      assert(
        typeof name === 'string' &&
          !isAbsolute(name) &&
          name.split('/').every((p) => p && p !== '.' && p !== '..'),
        'unsafe read scope',
      );
      const path = resolve(root, name),
        actual = realpathSync(path);
      assert(
        actual === path && !relative(root, actual).startsWith('..'),
        'symlink or escaped scope',
      );
      const bytes = readFileSync(path);
      assert(bytes.length <= 256 * 1024, 'input too large');
      return [name, sha(bytes)];
    }),
  );
}
function adapterDigest() {
  const paths = [
    ...readdirSync(ownDirectory)
      .filter((p) => p.endsWith('.mjs'))
      .map((p) => join(ownDirectory, p)),
    ...readdirSync(resolve(ownDirectory, '../common'))
      .filter((p) => p.endsWith('.mjs'))
      .map((p) => resolve(ownDirectory, '../common', p)),
  ].sort();
  return jsonHash(
    paths.map((path) => [relative(resolve(ownDirectory, '..'), path), sha(readFileSync(path))]),
  );
}
function currentIdentity(packet) {
  for (const name of ['.claude/settings.json', '.claude/settings.local.json'])
    assert(!existsSync(join(packet.root, name)), 'unqualified project settings');
  const preflight = runClaudePreflight({ root: packet.root, mode: 'fresh' });
  assert(
    preflight.diagnostics.length === 0 && preflight.baseline.clean,
    'task source not clean/observable',
  );
  return {
    ...packet.context,
    sourceDigest: adapterDigest(),
    roleDigest: fileMap(packet.root, [packet.rolePath])[packet.rolePath],
    taskSnapshotDigest: jsonHash(preflight.snapshot),
    configDigest: jsonHash({
      ...packet.config,
      readFiles: fileMap(packet.root, Object.keys(packet.readFiles)),
    }),
  };
}

// Explicit qualification only. It does not enable routine native admission or a bridge.
// The owning process/human still supplies actual host/provider authorization.
export function prepareClaudeNativeQualification(workflowInput, options) {
  const {
    prompt,
    expectedResolvedModel,
    cliVersion,
    sessionId = randomUUID(),
    runId = randomUUID(),
    now = new Date().toISOString(),
  } = options ?? {};
  assert(
    typeof prompt === 'string' && prompt.length > 0 && prompt.length <= 8000,
    'bounded native prompt required',
  );
  assert(
    /^claude-(haiku|sonnet|opus)-[a-zA-Z0-9._-]+$/u.test(expectedResolvedModel ?? ''),
    'exact resolved model required',
  );
  assert(/^\d+\.\d+\.\d+$/u.test(cliVersion ?? ''), 'observed CLI version required');
  assert(
    /^[a-f0-9-]{36}$/u.test(sessionId) && /^[a-f0-9-]{36}$/u.test(runId),
    'run/session UUID required',
  );
  const root = realpathSync(workflowInput.root ?? process.cwd());
  const task = workflowInput.nativeRequest?.task;
  assert(
    task &&
      ['repo_explorer', 'repo_reviewer', 'repo_researcher'].includes(task.role) &&
      task.writeScope?.length === 0 &&
      task.allowedTools?.every((t) => ['Read', 'Grep', 'Glob'].includes(t)),
    'only bounded read-only native qualification supported',
  );
  for (const name of ['.claude/settings.json', '.claude/settings.local.json'])
    assert(!existsSync(join(root, name)), 'unqualified project settings');
  const rolePath = `.claude/agents/${task.role}.md`;
  fileMap(root, [rolePath]);
  const roleBytes = readFileSync(join(root, rolePath)),
    roleText = roleBytes.toString('utf8');
  assert(
    roleText.startsWith('---\n') &&
      new RegExp(`^name: ${task.role}$`, 'mu').test(roleText.split('---')[1]),
    'project role mismatch',
  );
  const headerKeys = roleText
    .split('---')[1]
    .trim()
    .split('\n')
    .map((line) => line.match(/^(name|description|tools): .+$/u)?.[1]);
  assert(
    headerKeys.every(Boolean) && new Set(headerKeys).size === headerKeys.length,
    'unqualified role frontmatter',
  );
  const tools = roleText
    .split('---')[1]
    .match(/^tools: (.+)$/mu)?.[1]
    .split(',')
    .map((t) => t.trim());
  assert(
    JSON.stringify(tools) === JSON.stringify(task.allowedTools),
    'project role tools mismatch',
  );
  const readFiles = fileMap(root, task.readScope);
  const config = {
    cliVersion,
    nodeVersion: process.version,
    permissionMode: 'manual',
    permissionPrompts: 'none',
    rolePath,
    tools: ['Agent', 'Read', 'Grep', 'Glob'],
    ask: ['Agent', 'Read', 'Grep', 'Glob'],
    disabledPlugins: ['oh-my-claudecode@omc'],
    expectedResolvedModel,
    sessionId,
    runId,
  };
  const identity = {
    sourceDigest: adapterDigest(),
    configDigest: jsonHash({ ...config, readFiles }),
  };
  const workflow = prepareClaudeWorkflow({ ...workflowInput, root, adapterIdentity: identity });
  const binding = workflow.native.binding;
  assert(
    binding && workflow.gaps.every((g) => g === 'strict-native-dispatch-not-qualified'),
    `workflow not ready for qualification: ${workflow.gaps.join(',')}`,
  );
  assert(
    Date.parse(now) >= Date.parse(binding.issuedAt) &&
      Date.parse(now) <= Date.parse(binding.expiresAt),
    'expired qualification binding',
  );
  assert(
    expectedResolvedModel.startsWith(`claude-${binding.requestedModelAlias}-`),
    'selected model mismatch',
  );
  const nativePrompt = `${prompt}\n\nQualification association: ${runId}; request ${workflow.requestDigest}; binding ${binding.bindingDigest}.`;
  const context = {
    runId,
    sessionId,
    bindingDigest: binding.bindingDigest,
    requestDigest: workflow.requestDigest,
    ...identity,
    roleDigest: sha(roleBytes),
    taskSnapshotDigest: jsonHash(workflow.preflight.snapshot),
    role: binding.role,
    requestedModel: binding.requestedModelAlias,
    expectedResolvedModel,
    prompt: nativePrompt,
    allowedTools: [...binding.allowedTools],
    cliVersion,
    allowedParentTools: ['Task', 'Glob', 'Grep', 'Read'],
    readScopeRoot: root,
    readFiles,
  };
  const packet = {
    schemaVersion: 1,
    root,
    rolePath,
    readFiles,
    config,
    context,
    binding,
    expiresAt: binding.expiresAt,
  };
  const plan = Object.freeze({
    packet: JSON.parse(JSON.stringify(packet)),
    workflow,
    dispatchAuthorized: false,
    runtimeQualified: false,
  });
  prepared.set(plan, {
    packet: structuredClone(packet),
    workflow: structuredClone(workflow),
    workflowInput: structuredClone({ ...workflowInput, root, adapterIdentity: identity }),
  });
  return plan;
}

export function decideClaudeNativePermission(
  packet,
  event,
  { now = new Date().toISOString() } = {},
) {
  const deny = (reason) => ({ allow: false, reason });
  try {
    assert(
      packet.schemaVersion === 1 &&
        Date.parse(now) <= Date.parse(packet.expiresAt) &&
        Date.parse(now) >= Date.parse(packet.binding.issuedAt),
      'expired-or-malformed-binding',
    );
    assert(
      event?.hook_event_name === 'PermissionRequest' &&
        event.session_id === packet.context.sessionId &&
        realpathSync(event.cwd) === packet.root,
      'foreign-event',
    );
    const current = currentIdentity(packet);
    for (const key of ['sourceDigest', 'roleDigest', 'taskSnapshotDigest', 'configDigest'])
      assert(current[key] === packet.context[key], `stale-${key}`);
    const i = event.tool_input;
    assert(i && typeof i === 'object', 'missing-input');
    if (event.tool_name === 'Agent') {
      assert(
        i.subagent_type === packet.context.role &&
          i.model === packet.context.requestedModel &&
          i.prompt === packet.context.prompt &&
          i.run_in_background === false,
        'native-binding-mismatch',
      );
      assert(
        Object.keys(i).every((k) =>
          ['description', 'subagent_type', 'model', 'prompt', 'run_in_background'].includes(k),
        ),
        'unexpected-native-argument',
      );
      return { allow: true, reason: 'bound-native-request' };
    }
    // No directory patterns: Read alone is the currently supported scoped file operation.
    assert(event.tool_name === 'Read' && typeof i.file_path === 'string', 'unqualified-tool');
    const path = realpathSync(resolve(packet.root, i.file_path));
    assert(Object.hasOwn(packet.readFiles, relative(packet.root, path)), 'outside-read-scope');
    return { allow: true, reason: 'bound-file-read' };
  } catch (error) {
    return deny(error.message);
  }
}

function permissionMain(packetPath, expectedHash) {
  const bytes = readFileSync(packetPath);
  assert(sha(bytes) === expectedHash, 'packet-tampered');
  const packet = JSON.parse(bytes),
    raw = readFileSync(0);
  assert(raw.length <= 128 * 1024, 'hook input limit');
  const event = JSON.parse(raw);
  let result = decideClaudeNativePermission(packet, event);
  if (result.allow && event.tool_name === 'Agent') {
    try {
      writeFileSync(
        `${packetPath}.grant`,
        JSON.stringify({ sessionId: event.session_id, inputDigest: jsonHash(event.tool_input) }),
        { flag: 'wx', mode: 0o600 },
      );
    } catch {
      result = { allow: false, reason: 'grant-already-used' };
    }
  }
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: { behavior: result.allow ? 'allow' : 'deny', message: result.reason },
      },
    }),
  );
}

export async function runClaudeNativeQualification(
  plan,
  { executable, timeoutMs = 90000, maxOutputBytes = 2 * 1024 * 1024 } = {},
) {
  assert(prepared.has(plan), 'requires fresh prepared qualification, not imported JSON');
  const { packet, workflowInput, workflow } = prepared.get(plan);
  assert(
    Date.now() >= Date.parse(packet.binding.issuedAt) && Date.now() <= Date.parse(packet.expiresAt),
    'expired qualification before launch',
  );
  prepared.delete(plan);
  assert(
    typeof executable === 'string' && isAbsolute(executable),
    'explicit installed CLI required',
  );
  assert(
    Number.isInteger(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 150000,
    'bounded timeout required',
  );
  assert(
    Number.isInteger(maxOutputBytes) && maxOutputBytes >= 1024 && maxOutputBytes <= 4 * 1024 * 1024,
    'bounded output required',
  );
  for (const [key, value] of Object.entries(currentIdentity(packet)))
    assert(JSON.stringify(value) === JSON.stringify(packet.context[key]), `prelaunch ${key} drift`);
  const temp = mkdtempSync(join(tmpdir(), 'repo-claude-qualification-')),
    packetPath = join(temp, 'request.json');
  const bytes = JSON.stringify(packet);
  writeFileSync(packetPath, bytes, { mode: 0o600 });
  const command = [process.execPath, modulePath, '--permission-event', packetPath, sha(bytes)]
    .map(quote)
    .join(' ');
  const settings = {
    enabledPlugins: Object.fromEntries(packet.config.disabledPlugins.map((id) => [id, false])),
    permissions: { ask: packet.config.ask },
    hooks: {
      PermissionRequest: [
        { matcher: 'Agent|Read|Grep|Glob', hooks: [{ type: 'command', command, timeout: 5 }] },
      ],
    },
  };
  const args = [
    '--print',
    '--disable-slash-commands',
    '--model',
    'sonnet',
    '--permission-mode',
    'manual',
    '--permission-prompts',
    'none',
    '--setting-sources',
    'project',
    '--tools',
    packet.config.tools.join(','),
    '--strict-mcp-config',
    '--mcp-config',
    '{"mcpServers":{}}',
    '--settings',
    JSON.stringify(settings),
    '--session-id',
    packet.context.sessionId,
    '--no-session-persistence',
    '--max-turns',
    '4',
    '--output-format',
    'stream-json',
    '--verbose',
    '--forward-subagent-text',
    '--include-hook-events',
    '--system-prompt',
    'Qualification coordinator. Call the explicitly requested native role once with the exact supplied input. Never substitute roles/models/tools. Do not read task files yourself; report denied/unavailable without retry.',
  ];
  const input = {
    description: 'Bound native qualification',
    subagent_type: packet.context.role,
    model: packet.context.requestedModel,
    prompt: packet.context.prompt,
    run_in_background: false,
  };
  const prompt = `Call native Agent exactly once with this JSON input, then report the child result and stop: ${JSON.stringify(input)}`;
  const env = Object.fromEntries(
    ['HOME', 'PATH', 'USER', 'LOGNAME', 'TMPDIR', 'SHELL', 'LANG', 'TERM']
      .filter((k) => process.env[k])
      .map((k) => [k, process.env[k]]),
  );
  env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '1';
  env.DISABLE_TELEMETRY = '1';
  const collector = createClaudeNativeCollector(packet.context);
  const raw = [],
    stderr = [];
  let pending = '',
    size = 0,
    timedOut = false,
    outputExceeded = false,
    child,
    timer,
    killTimer;
  const stop = () => {
    if (child?.pid) {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        /* Already exited. */
      }
      killTimer = setTimeout(() => {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          /* Already exited. */
        }
      }, 1000);
    }
  };
  try {
    const exitCode = await new Promise((resolveExit, reject) => {
      child = spawn(executable, args, {
        cwd: packet.root,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: true,
      });
      child.on('error', reject);
      child.on('close', (code) => resolveExit(code));
      const account = (b) => {
        size += b.length;
        if (size > maxOutputBytes) {
          outputExceeded = true;
          stop();
          return false;
        }
        return true;
      };
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        if (!account(Buffer.from(chunk))) return;
        raw.push(chunk);
        pending += chunk;
        let nl;
        while ((nl = pending.indexOf('\n')) >= 0) {
          const line = pending.slice(0, nl);
          pending = pending.slice(nl + 1);
          if (line.trim()) {
            try {
              collector.consume(JSON.parse(line));
            } catch {
              collector.consume(null);
            }
          }
        }
      });
      child.stderr.on('data', (chunk) => {
        if (account(chunk)) stderr.push(chunk.toString());
      });
      timer = setTimeout(() => {
        timedOut = true;
        stop();
      }, timeoutMs);
      child.stdin.on('error', () => {});
      child.stdin.end(prompt);
    });
    if (pending.trim()) collector.consume(null);
    let current;
    try {
      current = currentIdentity(packet);
    } catch {
      current = {};
    }
    const observed = collector.finish({
      exitCode,
      timedOut: timedOut || outputExceeded,
      currentContext: current,
    });
    let grantValid = false;
    try {
      const grant = JSON.parse(readFileSync(`${packetPath}.grant`, 'utf8'));
      grantValid =
        grant.sessionId === packet.context.sessionId &&
        grant.inputDigest === jsonHash(observed.requestedInput);
    } catch {
      /* No matching permission grant. */
    }
    const observation = grantValid
      ? observed
      : {
          ...observed,
          valid: false,
          content: null,
          errors: [...observed.errors, 'missing-or-foreign-permission-grant'],
        };
    const lane = workflow.lanes[0];
    const result = observation.valid
      ? {
          resultId: packet.context.runId,
          dispatchId: lane.dispatchId,
          laneId: lane.id,
          owner: lane.owner,
          hostId: 'claude-code',
          adapterIdentity: workflowInput.adapterIdentity,
          sourceSnapshot: workflow.currentSnapshot,
          status: 'partial',
          checks: [
            'validated same-run native role/model/tools/result; independent semantic oracle still required',
          ],
          findings: [],
          gaps: ['semantic-acceptance-and-independent-qa-not-verified'],
          changedPaths: [],
        }
      : null;
    // Consume the same common result contract. The outstanding native readiness gate
    // is deliberately retained; a structurally valid observation cannot clear it.
    const commonAssessment = validateClaudeWorkflowResults(workflowInput, {
      results: result ? [result] : [],
    });
    return {
      observation,
      commonResult: result,
      commonAssessment,
      exitCode,
      timedOut,
      outputExceeded,
      stdout: raw.join(''),
      stderr: stderr.join(''),
      launch: {
        args,
        sessionId: packet.context.sessionId,
        runId: packet.context.runId,
        executable,
      },
      hostArtifactCleanup:
        'inspect exact observed session/task output; no arbitrary emitted-path deletion',
      dispatchAuthorized: false,
      runtimeQualified: false,
    };
  } finally {
    clearTimeout(timer);
    clearTimeout(killTimer);
    if (child?.pid) {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        /* Already exited. */
      }
    }
    rmSync(temp, { recursive: true, force: true });
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === '--permission-event') {
    try {
      permissionMain(process.argv[3], process.argv[4]);
    } catch {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PermissionRequest',
            decision: { behavior: 'deny', message: 'invalid native gate input' },
          },
        }),
      );
      process.exitCode = 0;
    }
  } else {
    process.stderr.write('Use the explicit qualification API; this is not a routine dispatcher.\n');
    process.exitCode = 2;
  }
}
