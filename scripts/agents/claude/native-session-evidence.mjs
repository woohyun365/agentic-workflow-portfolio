// Bounded normalization of an observed SubagentStop transcript, not a host grant.
export function readClaudeStoppedTranscript(bytes, { sessionId, agentId, prompt, expectedModel }) {
  if (!Buffer.isBuffer(bytes) || bytes.length > 4 * 1024 * 1024)
    throw new TypeError('transcript byte limit');
  const raw = bytes.toString('utf8');
  if (!Buffer.from(raw).equals(bytes) || !raw.endsWith('\n'))
    throw new TypeError('incomplete transcript');
  const rows = raw
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  const messages = rows.filter((r) => ['assistant', 'user'].includes(r.type));
  if (!messages.length || messages.some((r) => r.sessionId !== sessionId || r.agentId !== agentId))
    throw new TypeError('foreign transcript');
  const first = messages[0];
  if (first.type !== 'user' || first.message?.content !== prompt)
    throw new TypeError('transcript prompt mismatch');
  const assistants = messages.filter((r) => r.type === 'assistant');
  if (!assistants.length || assistants.some((r) => r.message?.model !== expectedModel))
    throw new TypeError('transcript model mismatch');
  const calls = new Map();
  let deliveredText = null;
  for (const row of messages) {
    const content = Array.isArray(row.message?.content) ? row.message.content : [];
    for (const c of content) {
      if (row.type === 'assistant' && c.type === 'tool_use' && c.name === 'SubagentHandback') {
        if (
          typeof c.id !== 'string' ||
          !c.id ||
          calls.has(c.id) ||
          typeof c.input?.message !== 'string'
        )
          throw new TypeError('malformed/duplicate handback');
        calls.set(c.id, { text: c.input.message, delivered: false });
      } else if (row.type === 'user' && c.type === 'tool_result' && calls.has(c.tool_use_id)) {
        const call = calls.get(c.tool_use_id);
        if (call.delivered || c.is_error === true)
          throw new TypeError('failed/duplicate handback result');
        call.delivered = true;
        deliveredText = call.text;
      }
    }
  }
  if ([...calls.values()].some((call) => !call.delivered))
    throw new TypeError('undelivered handback');
  const text =
    deliveredText ??
    assistants
      .flatMap((r) => r.message?.content ?? [])
      .filter((c) => c.type === 'text')
      .at(-1)?.text;
  if (typeof text !== 'string' || !text.trim()) throw new TypeError('missing final child response');
  return {
    status: 'completed',
    agentId,
    resolvedModel: expectedModel,
    modelsUsed: [...new Set(assistants.map((r) => r.message.model))],
    prompt,
    content: [{ type: 'text', text }],
  };
}

export function isClaudeCompletedNotification(row, { sessionId, agentId, toolUseId }) {
  // Claude can deliver a notification between turns as a user message, or absorb it
  // mid-turn as this typed attachment. Queue enqueue alone is not delivery evidence.
  const attached =
    row?.type === 'attachment' &&
    row.isSidechain === false &&
    row.attachment?.type === 'queued_command' &&
    row.attachment.commandMode === 'task-notification';
  const text = attached ? row.attachment.prompt : row?.message?.content;
  if (
    (row?.type !== 'user' && !attached) ||
    row.sessionId !== sessionId ||
    (row.session_id !== undefined && row.session_id !== sessionId) ||
    typeof text !== 'string' ||
    !text.endsWith('</task-notification>')
  )
    return false;
  const header =
    /^<task-notification>\n<task-id>([^<>\n]+)<\/task-id>\n<tool-use-id>([^<>\n]+)<\/tool-use-id>\n(?:<output-file>[^<>\n]*<\/output-file>\n)?<status>([^<>\n]+)<\/status>\n/u.exec(
      text,
    );
  if (!header || header[1] !== agentId || header[2] !== toolUseId || header[3] !== 'completed')
    return false;
  return ['task-id', 'tool-use-id', 'status'].every(
    (tag) => text.split(`<${tag}>`).length === 2 && text.split(`</${tag}>`).length === 2,
  );
}
