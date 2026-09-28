import { resolve, relative } from 'node:path';
// Structural CLI stream validation, not provider authentication or dispatch authority.
// A live caller must own the process/pipe and freeze the context before launch.
const digest = /^sha256:[a-f0-9]{64}$/u;
const identityKeys = [
  'runId',
  'sessionId',
  'bindingDigest',
  'requestDigest',
  'sourceDigest',
  'configDigest',
  'roleDigest',
  'taskSnapshotDigest',
];
export function createClaudeNativeCollector(input) {
  const context = structuredClone(input);
  for (const key of identityKeys) {
    if (
      typeof context?.[key] !== 'string' ||
      !context[key] ||
      (key.endsWith('Digest') && !digest.test(context[key]))
    )
      throw new TypeError(`invalid observation ${key}`);
  }
  if (
    !Array.isArray(context.allowedTools) ||
    !context.allowedTools.length ||
    typeof context.prompt !== 'string' ||
    !context.prompt ||
    !/^claude-(haiku|sonnet|opus)-/u.test(context.expectedResolvedModel)
  )
    throw new TypeError('invalid observation contract');
  const errors = [],
    seen = new Set(),
    reads = new Map();
  let initialized = false,
    call = null,
    task = null,
    completion = null,
    notified = false,
    terminal = false,
    observed = 0,
    finished = false,
    count = 0;
  let requestedInput = null;
  const check = (condition, code) => {
    if (!condition) errors.push(code);
    return condition;
  };
  return {
    consume(event) {
      if (finished) throw new TypeError('collector already finished');
      if (++count > 10000) {
        if (count === 10001) errors.push('event-limit');
        return;
      }
      if (!event || typeof event !== 'object' || Array.isArray(event)) {
        errors.push('malformed-event');
        return;
      }
      if (!check(event.session_id === context.sessionId, 'foreign-session')) return;
      if (
        !check(
          typeof event.uuid === 'string' && !seen.has(event.uuid),
          'duplicate-or-missing-event-id',
        )
      )
        return;
      seen.add(event.uuid);
      if (terminal) {
        errors.push('event-after-terminal');
        return;
      }
      if (event.type === 'system' && event.subtype === 'init') {
        check(!initialized, 'duplicate-init');
        initialized = true;
        check(event.claude_code_version === context.cliVersion, 'cli-version-mismatch');
        check(event.cwd === context.readScopeRoot, 'cwd-mismatch');
        check(event.permissionMode === 'default', 'permission-mode-mismatch');
        check(event.agents?.includes(context.role), 'role-not-loaded');
        check(
          Array.isArray(event.plugins) &&
            event.plugins.every((p) => p.path === 'builtin' && p.source === 'agents-md@builtin'),
          'unqualified-plugin',
        );
        check(
          Array.isArray(event.mcp_servers) && event.mcp_servers.length === 0,
          'unqualified-mcp',
        );
        check(
          Array.isArray(event.tools) &&
            JSON.stringify([...event.tools].sort()) ===
              JSON.stringify([...context.allowedParentTools].sort()),
          'unqualified-parent-tools',
        );
        return;
      }
      if (
        !initialized &&
        event.type === 'system' &&
        ['hook_started', 'hook_progress', 'hook_response'].includes(event.subtype)
      ) {
        errors.push('unqualified-startup-hook');
        return;
      }
      if (!check(initialized, 'event-before-init')) return;
      if (event.type === 'system' && event.subtype === 'task_started') {
        check(
          call &&
            !task &&
            event.tool_use_id === call &&
            event.subagent_type === context.role &&
            event.prompt === context.prompt &&
            event.is_backgrounded !== true,
          'invalid-task-start',
        );
        if (typeof event.task_id !== 'string' || !event.task_id) errors.push('missing-task-id');
        task = event.task_id;
        return;
      }
      if (
        event.type === 'system' &&
        ['task_progress', 'task_updated', 'task_notification'].includes(event.subtype)
      ) {
        check(
          task && event.task_id === task && (!event.tool_use_id || event.tool_use_id === call),
          'foreign-task',
        );
        if (event.subtype === 'task_notification') {
          check(!notified && event.status === 'completed', 'bad-task-notification');
          notified = true;
        }
        if (event.patch?.status && event.patch.status !== 'completed')
          errors.push('noncomplete-task');
        return;
      }
      const blocks = event.message?.content;
      if (blocks !== undefined && !Array.isArray(blocks)) {
        errors.push('malformed-message');
        return;
      }
      const child = event.parent_tool_use_id != null;
      if (child) {
        check(task && event.parent_tool_use_id === call && !completion, 'orphan-or-late-child');
        if (event.type === 'assistant') {
          check(event.message.model === context.expectedResolvedModel, 'child-model-mismatch');
          observed++;
        }
      }
      for (const block of blocks ?? []) {
        if (block.type === 'tool_use') {
          if (!child) {
            const i = block.input;
            check(
              !call &&
                block.name === 'Agent' &&
                i?.subagent_type === context.role &&
                i.model === context.requestedModel &&
                i.prompt === context.prompt &&
                i.run_in_background === false,
              'native-request-mismatch',
            );
            call = block.id;
            requestedInput = structuredClone(i);
          } else {
            check(
              typeof block.id === 'string' &&
                !reads.has(block.id) &&
                context.allowedTools.includes(block.name),
              'unallowed-or-duplicate-child-tool',
            );
            const path = block.input?.file_path;
            check(
              block.name === 'Read' &&
                typeof path === 'string' &&
                context.readScopeRoot &&
                Object.hasOwn(
                  context.readFiles ?? {},
                  relative(context.readScopeRoot, resolve(context.readScopeRoot, path)),
                ),
              'outside-read-scope',
            );
            reads.set(block.id, false);
          }
        }
        if (block.type === 'tool_result' && child) {
          check(
            reads.has(block.tool_use_id) &&
              reads.get(block.tool_use_id) === false &&
              !block.is_error,
            'orphan-or-failed-child-result',
          );
          reads.set(block.tool_use_id, true);
        }
      }
      if (event.tool_use_result?.agentId) {
        const r = event.tool_use_result;
        check(
          !child &&
            task &&
            !completion &&
            blocks?.filter((b) => b.type === 'tool_result' && b.tool_use_id === call && !b.is_error)
              .length === 1,
          'unbound-native-result',
        );
        check(
          r.status === 'completed' &&
            r.agentId === task &&
            r.agentType === context.role &&
            r.resolvedModel === context.expectedResolvedModel &&
            r.prompt === context.prompt,
          'native-result-mismatch',
        );
        if (r.modelsUsed)
          check(
            Array.isArray(r.modelsUsed) &&
              r.modelsUsed.every((m) => m === context.expectedResolvedModel),
            'model-changed',
          );
        completion = structuredClone(r);
      }
      if (event.type === 'result') {
        terminal = true;
        check(
          event.subtype === 'success' &&
            event.is_error === false &&
            completion &&
            notified &&
            observed > 0,
          'incomplete-native-run',
        );
        check(
          event.subagent_stats?.spawned === 1 &&
            event.subagent_stats.completed === 1 &&
            event.subagent_stats.failed === 0 &&
            !(event.subagent_stats.spawned_by_subagents > 0),
          'native-count-mismatch',
        );
        check(
          Array.isArray(event.permission_denials) && event.permission_denials.length === 0,
          'permission-denial',
        );
      }
    },
    finish({ exitCode, timedOut, currentContext } = {}) {
      if (finished) throw new TypeError('collector already finished');
      finished = true;
      check(exitCode === 0 && timedOut === false, 'process-failed');
      check(terminal && completion && observed > 0, 'missing-terminal');
      check([...reads.values()].every(Boolean), 'missing-child-tool-result');
      check(completion?.totalToolUseCount === reads.size, 'child-tool-count-mismatch');
      for (const key of Object.keys(context))
        check(
          JSON.stringify(currentContext?.[key]) === JSON.stringify(context[key]),
          `context-drift:${key}`,
        );
      return Object.freeze({
        valid: errors.length === 0,
        errors: [...new Set(errors)],
        verificationClass: 'structural-cli-observation',
        dispatchAuthorized: false,
        runtimeQualified: false,
        association: structuredClone(context),
        agentId: task,
        requestedInput,
        parentToolUseId: call,
        resolvedModel: completion?.resolvedModel ?? null,
        observedChildMessages: observed,
        childToolCalls: reads.size,
        content: errors.length ? null : structuredClone(completion?.content ?? []),
      });
    },
  };
}
