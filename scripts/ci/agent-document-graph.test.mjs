import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import test from 'node:test';
import { workflowGraph, validateWorkflowGraph } from '../agents/common/workflow-entry.mjs';
const root = resolve(import.meta.dirname, '../..');
const corpus = JSON.parse(
  readFileSync(resolve(root, 'scripts/ci/fixtures/workflow-document-owners.json'), 'utf8'),
);
function markdownFiles(dir) {
  return readdirSync(resolve(root, dir), { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? markdownFiles(`${dir}/${entry.name}`)
      : entry.name.endsWith('.md')
        ? [`${dir}/${entry.name}`]
        : [],
  );
}
function prose(source) {
  let fence = null;
  return source
    .split('\n')
    .filter((line) => {
      const marker = line.match(/^\s*(`{3,}|~{3,})/u)?.[1];
      if (marker) {
        if (!fence) fence = marker[0];
        else if (fence === marker[0]) fence = null;
        return false;
      }
      return !fence;
    })
    .join('\n');
}
function anchors(source) {
  const result = new Set(),
    counts = new Map();
  for (const match of prose(source).matchAll(/^#{1,6}\s+(.+)$/gmu)) {
    const base = match[1]
      .trim()
      .toLowerCase()
      .replace(/<[^>]+>/gu, '')
      .replace(/[^\p{L}\p{N}_\-\s]/gu, '')
      .replace(/\s/gu, '-');
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);
    result.add(base + (count ? `-${count}` : ''));
  }
  for (const match of source.matchAll(/<(?:a|h[1-6])[^>]+(?:id|name)=["']([^"']+)["']/gu))
    result.add(match[1]);
  return result;
}
function links(path) {
  const text = prose(readFileSync(resolve(root, path), 'utf8')).replace(/`+[^`\n]*`+/gu, '');
  const targets = [...text.matchAll(/(?<!!)\[[^\]]*\]\(([^\s)]+)(?:\s+[^)]*)?\)/gu)].map(
    (m) => m[1],
  );
  for (const match of text.matchAll(/^\s*\[[^\]]+\]:\s*(\S+)/gmu)) targets.push(match[1]);
  return targets
    .filter((target) => !/^(?:[a-z]+:|\/\/)/iu.test(target))
    .map((target) => {
      const [file, fragment] = target.split('#');
      return {
        path: relative(root, resolve(root, dirname(path), decodeURIComponent(file))),
        fragment: fragment ? decodeURIComponent(fragment) : null,
      };
    });
}

test('every current development Markdown owner is classified, with rationale rather than blanket rewrite', () => {
  const actual = markdownFiles('docs/development').sort();
  assert.deepEqual(corpus.documents.map((x) => x.path).sort(), actual);
  assert.equal(new Set(corpus.documents.map((x) => x.path)).size, actual.length);
  for (const row of corpus.documents) {
    assert.ok(row.owner && row.kind && row.rationale, row.path);
  }
});
test('actual document links/anchors resolve and every development owner is index-reachable', () => {
  const paths = corpus.documents.map((x) => x.path),
    edges = new Map();
  for (const path of paths) {
    const targets = links(path);
    edges.set(
      path,
      targets.map((x) => x.path),
    );
    for (const target of targets) {
      assert.ok(existsSync(resolve(root, target.path)), `${path} -> ${target.path}`);
      if (target.fragment && target.path.endsWith('.md'))
        assert.ok(
          anchors(readFileSync(resolve(root, target.path), 'utf8')).has(target.fragment),
          `${path} -> ${target.path}#${target.fragment}`,
        );
    }
  }
  const reached = new Set();
  function visit(path) {
    if (reached.has(path)) return;
    reached.add(path);
    for (const next of edges.get(path) ?? []) visit(next);
  }
  visit('docs/development/README.md');
  assert.deepEqual(
    paths.filter((path) => !reached.has(path)),
    [],
  );
});
test('production workflow graph has real discoverable owners and required DAG without banning backlinks', () => {
  assert.deepEqual(validateWorkflowGraph(workflowGraph), []);
  for (const node of workflowGraph.nodes)
    assert.ok(existsSync(resolve(root, node.path)), node.path);
  for (const edge of workflowGraph.edges.filter((e) => e.kind === 'requires')) {
    const from = workflowGraph.nodes.find((n) => n.id === edge.from),
      to = workflowGraph.nodes.find((n) => n.id === edge.to);
    assert.match(
      readFileSync(resolve(root, from.path), 'utf8'),
      new RegExp(to.path.split('/').at(-1).replaceAll('.', '\\.')),
    );
  }
});
test('host mechanics remain scoped and no unrelated host is mandatory in shared entry', () => {
  for (const [path, pattern] of [
    ['agent-execution-contract.md', /adapters\/codex\.md#codexomx-permission-mechanism/u],
    ['session-continuity.md', /adapters\/codex\.md#diagnostic-contract/u],
    ['request-intake/decisions.md', /Codex/u],
    ['visual-design/figma-mcp-evidence.md', /Codex/u],
  ])
    assert.match(
      readFileSync(resolve(root, 'docs/development/agent-workflows', path), 'utf8'),
      pattern,
    );
  const adapterIndex = readFileSync(
    resolve(root, 'docs/development/agent-workflows/adapters/README.md'),
    'utf8',
  );
  assert.match(adapterIndex, /모든 adapter를 기본 입력으로 읽지/u);
  assert.match(adapterIndex, /등록 전 Codex fallback 없음/u);
  assert.match(adapterIndex, /static PASS만으로/u);
});

test('Codex mechanisms have a conditional canonical host owner after extraction', () => {
  const read = (path) =>
    readFileSync(resolve(root, 'docs/development/agent-workflows', path), 'utf8');
  assert.match(read('adapters/codex.md'), /Codex\/OMX host 전용/u);
  assert.match(read('adapters/codex.md'), /Codex\/OMX 전용 호환 계약/u);
  assert.doesNotMatch(read('agent-execution-contract.md'), /\[auto_review\]\.policy/u);
  assert.doesNotMatch(read('session-continuity.md'), /"taskMatch"\s*:/u);
});
