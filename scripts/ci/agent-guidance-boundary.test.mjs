import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { extname, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const repoRoot = resolve(import.meta.dirname, '../..');
const rootAgentsPath = resolve(repoRoot, 'AGENTS.md');
const gitignorePath = resolve(repoRoot, '.gitignore');
const omxConfigPath = resolve(repoRoot, '.omx-config.json');
const textExtensions = new Set([
  '.js',
  '.json',
  '.jsx',
  '.md',
  '.mjs',
  '.mts',
  '.sh',
  '.ts',
  '.tsx',
  '.yaml',
  '.yml',
]);
const localPlanBoundaryAllowlist = new Set([
  'docs/architecture/README.md',
  'docs/development/agent-workflows/session-continuity.md',
  'docs/development/agent-workflows/adapters/codex.md',
  // Host lifecycle examples and disposable fixtures, never active-plan authority.
  'docs/development/agent-workflows/adapters/claude-code.md',
  'scripts/ci/claude-session-preflight.test.mjs',
  'scripts/ci/claude-workflow-entry.test.mjs',
  'scripts/ci/agent-native-adapter-contract.test.mjs',
  'scripts/agents/codex/session-preflight.mjs',
  'scripts/ci/fixtures/codex-session-context.valid.md',
  'scripts/ci/codex-session-contract.test.mjs',
  'scripts/ci/codex-session-preflight.test.mjs',
  'scripts/ci/agent-guidance-boundary.test.mjs',
  'scripts/agents/common/plan-store.mjs',
  'scripts/ci/agent-plan-store.test.mjs',
  'scripts/ci/agent-adapter-conformance.test.mjs',
  'scripts/ci/agent-workflow-entry.test.mjs',
  'scripts/ci/codex-workflow-entry.test.mjs', // Disposable plan lifecycle fixture, not durable authority.
  'scripts/agents/fixtures/codex-preflight/disposable-preflight.mjs',
]);
const workflowGuidePaths = [
  'docs/development/agent-workflows/README.md',
  'docs/development/agent-workflows/agentic-architecture-decisions.md',
  'docs/development/agent-workflows/getting-started.md',
  'docs/development/agent-workflows/agent-execution-contract.md',
  'docs/development/agent-workflows/session-continuity.md',
  'docs/development/agent-workflows/orchestration.md',
  'docs/development/agent-workflows/qa.md',
  'docs/development/agent-workflows/refactor-analysis.md',
];
const durableOrchestrationContractPaths = [
  'docs/development/agent-workflows/orchestration.md',
  'docs/development/agent-workflows/request-intake/README.md',
  'docs/development/agent-workflows/request-intake/ambiguity-and-authority.md',
  'docs/development/agent-workflows/request-intake/context-pack.md',
  'docs/development/agent-workflows/request-intake/decisions.md',
  'docs/development/agent-workflows/request-intake/delegation.md',
  'docs/development/agent-workflows/request-intake/orchestration-recovery.md',
  'docs/development/agent-workflows/request-intake/output-contracts.md',
  'docs/development/agent-workflows/request-intake/task-envelope.md',
];

function trackedPaths() {
  const result = spawnSync('git', ['ls-files', '-z'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr || 'git ls-files failed');
  return result.stdout.split('\0').filter(Boolean);
}

function workingPaths() {
  return [
    ...new Set([
      ...trackedPaths(),
      'CONTRIBUTING.md',
      'scripts/agents/codex/session-preflight.mjs',
      'scripts/ci/codex-session-preflight.test.mjs',
      'scripts/ci/codex-workflow-entry.test.mjs',
      ...workflowGuidePaths,
    ]),
  ];
}

function isIgnored(path) {
  const result = spawnSync('git', ['check-ignore', '-q', path], {
    cwd: repoRoot,
  });

  return result.status === 0;
}

test('repository guidance is available to clean clones and remains within the startup context budget', () => {
  const source = readFileSync(rootAgentsPath, 'utf8');
  const lineCount = source.split('\n').length;

  assert.equal(existsSync(rootAgentsPath), true, 'AGENTS.md must exist at the repository root');
  assert.equal(
    isIgnored('AGENTS.md'),
    false,
    'AGENTS.md must not be excluded from version control',
  );
  assert.ok(lineCount <= 200, `AGENTS.md has ${lineCount} lines; expected at most 200`);
  assert.ok(
    Buffer.byteLength(source) <= 32 * 1024,
    'AGENTS.md must stay below the default 32 KiB Codex project guidance limit',
  );
});

test('repository guidance does not depend on retired workflow names or documentation paths', () => {
  const source = readFileSync(rootAgentsPath, 'utf8');
  const forbiddenReferences = [
    '/prompts:',
    'docs/01_codex-review',
    'docs/03_planning',
    'docs/05_acceptance',
    'docs/07_tech',
  ].filter((reference) => source.includes(reference));

  assert.deepEqual(forbiddenReferences, []);
});

test('root CLAUDE bridge stays small and historical duplicate guidance does not return', () => {
  const gitignore = readFileSync(gitignorePath, 'utf8');
  const ignoredCanonicalFiles = ['AGENTS.md', 'CLAUDE.md', 'QA.md', 'REFACTOR-ANALYZE.md'].filter(
    (path) => new RegExp(`^${path.replace('.', '\\.')}$`, 'mu').test(gitignore),
  );

  assert.deepEqual(ignoredCanonicalFiles, []);
  assert.equal(existsSync(resolve(repoRoot, 'QA.md')), false, 'QA.md must move out of the root');
  assert.equal(
    existsSync(resolve(repoRoot, 'REFACTOR-ANALYZE.md')),
    false,
    'REFACTOR-ANALYZE.md must move out of the root',
  );
  const claude = readFileSync(resolve(repoRoot, 'CLAUDE.md'), 'utf8');
  assert.match(claude, /^@AGENTS\.md\s*$/mu);
  assert.ok(claude.split('\n').length <= 35, 'root CLAUDE.md must remain a small adapter');
  assert.match(claude, /adapters\/claude-code\.md/u);

  for (const path of workflowGuidePaths) {
    assert.equal(existsSync(resolve(repoRoot, path)), true, `${path} must exist`);
  }
});

test('developer and agent workflow entry points stay connected without duplicating root guidance', () => {
  const agents = readFileSync(rootAgentsPath, 'utf8');
  const contributing = readFileSync(resolve(repoRoot, 'CONTRIBUTING.md'), 'utf8');
  const workflowIndex = readFileSync(
    resolve(repoRoot, 'docs/development/agent-workflows/README.md'),
    'utf8',
  );

  assert.match(agents, /agent-execution-contract\.md/u);
  assert.match(agents, /session-continuity\.md/u);
  assert.match(agents, /github\/branch-and-pr-strategy\.md/u);
  assert.match(agents, /`dev`·`main`에서 직접 구현/u);
  assert.match(contributing, /agent-workflows\/getting-started\.md/u);
  assert.match(workflowIndex, /agentic-architecture-decisions\.md/u);
  assert.match(workflowIndex, /orchestration\.md/u);
});

test('production-only pnpm deploy inspection stays isolated from the active checkout', () => {
  const agents = readFileSync(rootAgentsPath, 'utf8');
  const deployReadme = readFileSync(resolve(repoRoot, 'infra/deploy/README.md'), 'utf8');
  const apiDockerfile = readFileSync(resolve(repoRoot, 'infra/deploy/api/Dockerfile'), 'utf8');
  const troubleshooting = readFileSync(
    resolve(
      repoRoot,
      'docs/development/troubleshooting/tooling/pnpm-legacy-deploy-active-checkout.md',
    ),
    'utf8',
  );

  assert.match(agents, /production-only `pnpm deploy`.*active checkout/u);
  assert.match(agents, /Docker build stage.*disposable copy\/worktree/u);
  assert.match(apiDockerfile, /pnpm deploy --legacy --filter api --prod \/workspace\/runtime/u);
  assert.match(deployReadme, /격리된 image build stage/u);
  assert.match(deployReadme, /active developer checkout/u);
  assert.match(troubleshooting, /CI=true pnpm install --frozen-lockfile/u);
  assert.match(troubleshooting, /git status --short/u);
});

test('agentic decisions and orchestration keep bounded single-first routing', () => {
  const decisions = readFileSync(
    resolve(repoRoot, 'docs/development/agent-workflows/agentic-architecture-decisions.md'),
    'utf8',
  );
  const orchestration = readFileSync(
    resolve(repoRoot, 'docs/development/agent-workflows/orchestration.md'),
    'utf8',
  );
  const codexAdapter = readFileSync(
    resolve(repoRoot, 'docs/development/agent-workflows/adapters/codex.md'),
    'utf8',
  );

  for (let index = 1; index <= 10; index += 1) {
    assert.match(decisions, new RegExp(`DA-${String(index).padStart(3, '0')}`, 'u'));
  }
  assert.match(orchestration, /single agent/u);
  assert.match(orchestration, /Codex\/OMX adapter/u);
  assert.match(orchestration, /Claude Code adapter/u);
  assert.match(codexAdapter, /Pass 1/u);
  assert.match(codexAdapter, /Pass 2/u);
  assert.match(codexAdapter, /medium/u);
  assert.match(codexAdapter, /high/u);
  assert.match(codexAdapter, /xhigh/u);
  // Task risk (low-impact) and separately bound recovery are not ordinary effort.
  // Check the declared route contract rather than banning a word across all docs.
  assert.match(codexAdapter, /effort는 `medium \| high \| xhigh`/u);
  assert.match(
    codexAdapter,
    /Low와 `max\/ultra`는 일반 repository child route에 사용하지 않습니다/u,
  );
  assert.match(codexAdapter, /`max\/ultra`.*사용하지/u);
  assert.match(codexAdapter, /역할을 prompt label로 가장하지 않고/u);
});

test('runtime code and scripts do not use retired OMX directories as output owners', () => {
  const retiredOutputOwners = ['.omx/reports', '.omx/screenshots', '.omx/artifacts'];
  const references = workingPaths()
    .filter((path) => /^(apps|packages|scripts|\.github)\//u.test(path))
    .filter((path) => textExtensions.has(extname(path)))
    .filter((path) => !/(?:^|\/)(?:test|tests|__tests__)(?:\/|$)|\.(?:spec|test)\./u.test(path))
    .flatMap((path) => {
      const absolutePath = resolve(repoRoot, path);
      if (!existsSync(absolutePath)) return [];
      const source = readFileSync(absolutePath, 'utf8');
      return retiredOutputOwners.some((owner) => source.includes(owner)) ? [path] : [];
    });

  assert.deepEqual(references, []);
});

test('repository scripts do not mutate tool-owned state or generate durable documentation', () => {
  const stateMutationPattern =
    /\b(?:appendFile|copyFile|mkdir|rename|rm|unlink|writeFile)(?:Sync)?\s*\([\s\S]{0,240}(?:\.omx\/(?:state|notepad\.md)|['"]\.omx['"]\s*,\s*['"](?:state|notepad\.md)['"])/u;
  const generatedDocsPattern =
    /\b(?:appendFile|copyFile|mkdir|rename|rm|unlink|writeFile)(?:Sync)?\s*\(\s*(?:['"`]docs\/|resolve\([^)]*['"`]docs(?:\/|['"`]))/u;
  const violations = workingPaths()
    .filter((path) => /^(apps|packages|scripts|\.github)\//u.test(path))
    .filter((path) => textExtensions.has(extname(path)))
    .filter(
      (path) => !/(?:^|\/)(?:test|tests|__tests__|fixtures)(?:\/|$)|\.(?:spec|test)\./u.test(path),
    )
    .flatMap((path) => {
      const absolutePath = resolve(repoRoot, path);
      if (!existsSync(absolutePath)) return [];
      const source = readFileSync(absolutePath, 'utf8');
      const reasons = [];
      if (stateMutationPattern.test(source)) reasons.push('tool-owned OMX state mutation');
      if (generatedDocsPattern.test(source)) reasons.push('generated docs output');
      return reasons.map((reason) => `${path}: ${reason}`);
    });

  assert.deepEqual(violations, []);
});

test('OMX wiki stays curated instead of auto-capturing session transcripts', () => {
  assert.equal(existsSync(omxConfigPath), true, '.omx-config.json must exist');

  const omxConfig = JSON.parse(readFileSync(omxConfigPath, 'utf8'));
  const wikiIgnore = readFileSync(resolve(repoRoot, 'omx_wiki/.gitignore'), 'utf8');

  assert.equal(omxConfig.wiki?.autoCapture, false);
  assert.match(wikiIgnore, /^session-log-\*\.md$/mu);
  assert.equal(
    isIgnored('omx_wiki/session-log-2099-01-01-example.md'),
    true,
    'generated session logs must not become Git candidates',
  );
});

test('generated local evidence stays outside the repository formatting gate', () => {
  const prettierIgnore = readFileSync(resolve(repoRoot, '.prettierignore'), 'utf8');

  assert.match(prettierIgnore, /^artifacts\/local\/$/mu);
  assert.match(prettierIgnore, /^omx_wiki\/$/mu);
  assert.match(prettierIgnore, /^\.plans\/$/mu);
  assert.equal(isIgnored('.plans/example-plan.md'), true);
});

// Generic root explanation is allowed; an individual ignored plan cannot be durable authority.
function referencesLocalPlan(source) {
  return /(?:\.omx\/plans|\.plans)\/[^\s`'"<>)]/u.test(source);
}
test('local-plan guard distinguishes root usage from ignored task authority', () => {
  for (const source of ['`.plans/` is the local root', '`.omx/plans/` legacy root'])
    assert.equal(referencesLocalPlan(source), false);
  for (const source of [
    'See .plans/task-plan.md',
    '[authority](.plans/supporting/task/detail.md)',
    'Use .omx/plans/task.md',
  ])
    assert.equal(referencesLocalPlan(source), true);
});
test('tracked durable documentation does not use ignored plans as source of truth', () => {
  const references = workingPaths()
    .filter((path) => textExtensions.has(extname(path)))
    .filter((path) => !localPlanBoundaryAllowlist.has(path))
    .flatMap((path) => {
      const absolutePath = resolve(repoRoot, path);
      if (!existsSync(absolutePath)) return [];
      return referencesLocalPlan(readFileSync(absolutePath, 'utf8'))
        ? [relative(repoRoot, absolutePath)]
        : [];
    });

  assert.deepEqual(references, []);
});

test('durable orchestration contracts describe current responsibility without implementation phase coupling', () => {
  const agents = readFileSync(rootAgentsPath, 'utf8');

  assert.match(agents, /active plan 파일명·Phase 번호·임시 checkpoint/u);

  for (const path of durableOrchestrationContractPaths) {
    const source = readFileSync(resolve(repoRoot, path), 'utf8');

    assert.doesNotMatch(source, /\bPhase\s+\d+(?:[.-]\d+)?\b/u, path);
    assert.equal(referencesLocalPlan(source), false, path);
  }
});

test('durable policy architecture and runbook docs do not depend on numbered implementation phases', () => {
  const violations = trackedPaths()
    .filter((path) => /^docs\/(?:policies|architecture|runbooks)\/.*\.md$/u.test(path))
    .filter((path) =>
      /\bPhase\s+\d+(?:[.-]\d+)?\b/u.test(readFileSync(resolve(repoRoot, path), 'utf8')),
    );

  assert.deepEqual(violations, []);
});
