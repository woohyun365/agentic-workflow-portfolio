// TEST-ONLY synthetic graph oracle. No production caller imports this module.
// Passing these fixtures does not validate the repository's actual document graph.
const edgeKinds = new Set([
  'entry',
  'requires',
  'conditional',
  'handoff',
  'reference',
  'historical',
]);

export function validateFixtureGraph(graph, { host = 'unknown', intent = 'analyze' } = {}) {
  const errors = [];
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const owners = new Map();
  for (const node of graph.nodes) {
    for (const contract of node.canonicalFor ?? []) {
      owners.set(contract, [...(owners.get(contract) ?? []), node.id]);
    }
  }
  for (const contract of graph.contracts) {
    if (owners.get(contract)?.length !== 1) errors.push(`canonical-owner:${contract}`);
  }
  for (const edge of graph.edges) {
    if (!edgeKinds.has(edge.kind)) errors.push(`unknown-edge-kind:${edge.kind}`);
    if (!nodes.has(edge.from) || !nodes.has(edge.to)) {
      errors.push(`missing-node:${edge.from}->${edge.to}`);
      continue;
    }
    const target = nodes.get(edge.to);
    if (
      ['requires', 'conditional'].includes(edge.kind) &&
      target.host &&
      (edge.kind !== 'conditional' || edge.host !== target.host)
    ) {
      errors.push(`unscoped-host-requirement:${edge.from}->${edge.to}`);
    }
  }

  // Discovery includes references and scoped host entries; historical nodes need not be current.
  const reachable = closure(
    graph.entries,
    graph.edges.filter((edge) => edge.kind !== 'historical'),
  );
  for (const node of graph.nodes) {
    if (node.current && !reachable.has(node.id)) errors.push(`orphan-current:${node.id}`);
  }

  const required = graph.edges.filter(
    (edge) => edge.kind === 'requires' || (edge.kind === 'conditional' && edge.host === host),
  );
  const visiting = new Set();
  const visited = new Set();
  function cyclic(id) {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const edge of required.filter((candidate) => candidate.from === id)) {
      if (cyclic(edge.to)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  }
  if (graph.nodes.some((node) => cyclic(node.id))) errors.push('required-cycle');

  const route = closure(graph.entries, required);
  // Unknown hosts get no default vendor capability. Declared capabilities remain fixture data.
  const capabilities = Object.hasOwn(graph.adapters, host) ? graph.adapters[host] : [];
  for (const id of route) {
    const node = nodes.get(id);
    if (!node) continue;
    if (intent === 'analyze' && node.action === 'mutate') errors.push(`analyze-write:${id}`);
    for (const capability of node.requiredCapabilities ?? []) {
      if (!capabilities.includes(capability)) errors.push(`unsupported-capability:${capability}`);
    }
  }
  return [...new Set(errors)].sort();
}

function closure(entries, edges) {
  const found = new Set(entries);
  const pending = [...entries];
  while (pending.length) {
    const id = pending.pop();
    for (const edge of edges.filter((candidate) => candidate.from === id)) {
      if (!found.has(edge.to)) {
        found.add(edge.to);
        pending.push(edge.to);
      }
    }
  }
  return found;
}
