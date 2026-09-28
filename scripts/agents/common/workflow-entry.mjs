import { pathToFileURL } from 'node:url';
import { buildTaskEnvelope, assertValidTaskEnvelope } from './intake-policy.mjs';
import { discoverContextPack, listDomainGuides } from './domain-guide-registry.mjs';
import { readPlan } from './plan-store.mjs';

const W = 'docs/development/agent-workflows/';
const nodes = [
  ['root', 'AGENTS.md'],
  ['execution', W + 'agent-execution-contract.md'],
  ['intake', W + 'request-intake/README.md'],
  ['continuity', W + 'session-continuity.md'],
  ['planning', W + 'plan-authoring/core.md'],
  ['orchestration', W + 'orchestration.md'],
  ['qa', W + 'qa.md'],
  ['output', W + 'request-intake/output-contracts.md'],
  ['adapters', W + 'adapters/README.md'],
  ['branch', 'docs/development/github/branch-and-pr-strategy.md'],
  ['visual', W + 'visual-design/README.md'],
].map(([id, path]) => ({ id, path, owner: id }));
export const workflowGraph = Object.freeze({
  nodes: Object.freeze(nodes.map(Object.freeze)),
  edges: Object.freeze(
    [
      { from: 'root', to: 'execution', kind: 'requires' },
      { from: 'execution', to: 'intake', kind: 'requires' },
      { from: 'intake', to: 'output', kind: 'handoff' },
      { from: 'execution', to: 'adapters', kind: 'conditional', condition: 'active-host' },
      { from: 'execution', to: 'continuity', kind: 'conditional', condition: 'resume' },
      { from: 'intake', to: 'planning', kind: 'conditional', condition: 'plan' },
      { from: 'intake', to: 'branch', kind: 'conditional', condition: 'implement-or-debug' },
      { from: 'execution', to: 'orchestration', kind: 'conditional', condition: 'delegation' },
      { from: 'execution', to: 'visual', kind: 'conditional', condition: 'visual-work' },
      { from: 'execution', to: 'qa', kind: 'handoff' },
      { from: 'qa', to: 'execution', kind: 'reference' },
    ].map(Object.freeze),
  ),
});
const HOST_GUIDES = Object.freeze({
  codex: { guide: W + 'adapters/codex.md' },
  'claude-code': { guide: W + 'adapters/claude-code.md' },
});

export function validateWorkflowGraph(graph) {
  const errors = [],
    ids = new Set(),
    paths = new Set(),
    owners = new Set();
  for (const node of graph.nodes) {
    if (ids.has(node.id)) errors.push('duplicate-node');
    if (paths.has(node.path) || owners.has(node.owner)) errors.push('duplicate-canonical-owner');
    ids.add(node.id);
    paths.add(node.path);
    owners.add(node.owner);
  }
  const required = new Map([...ids].map((id) => [id, []]));
  for (const edge of graph.edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) {
      errors.push('missing-node');
      continue;
    }
    if (
      !['entry', 'requires', 'conditional', 'handoff', 'reference', 'historical'].includes(
        edge.kind,
      )
    )
      errors.push('unknown-edge');
    if (edge.kind === 'conditional' && !edge.condition) errors.push('missing-condition');
    if (edge.kind === 'requires') required.get(edge.from).push(edge.to);
  }
  const active = new Set(),
    done = new Set();
  function walk(id) {
    if (active.has(id)) {
      errors.push('required-cycle');
      return;
    }
    if (done.has(id)) return;
    active.add(id);
    for (const next of required.get(id)) walk(next);
    active.delete(id);
    done.add(id);
  }
  for (const id of ids) walk(id);
  return [...new Set(errors)];
}

export function resolveWorkflowEntry({ envelope, contextPack, host, mode, adapters = {} } = {}) {
  assertValidTaskEnvelope(envelope);
  if (typeof host !== 'string' || !host.trim()) throw new Error('explicit host required');
  if (!['fresh', 'resume'].includes(mode)) throw new Error('explicit fresh/resume mode required');
  if (
    contextPack &&
    (contextPack.requestId !== envelope.requestId || contextPack.intent !== envelope.intent)
  )
    throw new Error('context identity mismatch');
  if (contextPack) {
    const allowedGuides = new Set(listDomainGuides().map((guide) => guide.path));
    if (
      contextPack.schemaVersion !== 1 ||
      !Array.isArray(contextPack.selectedGuides) ||
      (envelope.intent !== 'plan' && contextPack.selectedGuides.length) ||
      contextPack.selectedGuides.some((guide) => !guide || !allowedGuides.has(guide.path))
    )
      throw new Error('invalid Plan-only context guides');
  }
  const adapter = Object.hasOwn(adapters, host)
    ? adapters[host]
    : Object.hasOwn(HOST_GUIDES, host)
      ? HOST_GUIDES[host]
      : null;
  if (
    adapter &&
    (typeof adapter.guide !== 'string' ||
      !/^docs\/[a-zA-Z0-9_/-]+\.md$/u.test(adapter.guide) ||
      adapter.guide.includes('..'))
  )
    throw new Error('invalid adapter guide');
  const byId = Object.fromEntries(workflowGraph.nodes.map((node) => [node.id, node.path]));
  const selected = ['root', 'execution', 'intake'];
  if (mode === 'resume') selected.push('continuity');
  if (envelope.intent === 'plan') selected.push('planning');
  if (['implement', 'debug'].includes(envelope.intent)) selected.push('branch', 'qa');
  if (envelope.intent === 'review') selected.push('qa');
  selected.push('output');
  return {
    intent: envelope.intent,
    mode,
    host,
    authorizedAction: envelope.authorizedAction,
    orderedReadset: [...new Set(selected.map((id) => byId[id]))],
    conditionalReads: [
      ...(adapter ? [{ condition: 'active-host', path: adapter.guide }] : []),
      { condition: 'delegation', path: byId.orchestration },
      { condition: 'visual-work', path: byId.visual },
      ...(contextPack?.selectedGuides ?? []).map((guide) => ({
        condition: 'plan-domain',
        path: guide.path,
      })),
    ],
    hostStatus: adapter ? 'registered-guide' : 'unregistered',
    requiresHostAdmission: true,
    runtimeQualified: false,
    nextOwner:
      envelope.intent === 'plan'
        ? 'plan-readiness'
        : envelope.intent === 'review'
          ? 'lead-finding-adjudication'
          : 'execution-and-verification',
  };
}

function main(args) {
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (
      !['--host', '--mode', '--request', '--plan'].includes(args[i]) ||
      !args[i + 1] ||
      options[args[i]]
    )
      throw new Error('expected unique --host --mode --request [--plan]');
    options[args[i]] = args[i + 1];
  }
  if (!options['--request']) throw new Error('request required');
  if (options['--plan'] && options['--mode'] !== 'resume')
    throw new Error('plan selection requires resume');
  const envelope = buildTaskEnvelope({ request: options['--request'] });
  const contextPack = discoverContextPack({ envelope });
  const route = resolveWorkflowEntry({
    envelope,
    contextPack,
    host: options['--host'],
    mode: options['--mode'],
  });
  // No plan enumeration or host memory reads on fresh requests.
  const plan = options['--plan'] ? readPlan(process.cwd(), options['--plan']) : null;
  process.stdout.write(JSON.stringify({ route, contextPack, plan }, null, 2) + '\n');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(error.message + '\n');
    process.exitCode = 1;
  }
}
