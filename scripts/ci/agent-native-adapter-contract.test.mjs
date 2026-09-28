import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = resolve(import.meta.dirname, '../..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

function isIgnored(path) {
  const result = spawnSync('git', ['check-ignore', '--no-index', '-q', path], { cwd: root });
  assert.ok([0, 1].includes(result.status), result.stderr?.toString());
  return result.status === 0;
}

test('Claude entry imports the shared repository contract without copying it', () => {
  const source = read('CLAUDE.md');

  assert.match(source, /^@AGENTS\.md\s*$/mu);
  assert.ok(source.split('\n').length <= 35, 'Claude entry must remain a small adapter');
  assert.equal(isIgnored('CLAUDE.md'), false);
  assert.match(source, /docs\/development\/agent-workflows\/adapters\/claude-code\.md/u);
});

test('four project Claude agents declare bounded native tools', () => {
  const readOnly = new Set(['Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch']);

  for (const role of ['explorer', 'researcher', 'executor', 'reviewer']) {
    const path = `.claude/agents/repo_${role}.md`;
    const source = read(path);
    const frontmatter = /^---\n([\s\S]*?)\n---/u.exec(source)?.[1];
    assert.ok(frontmatter, `${path}: missing YAML frontmatter`);
    assert.match(frontmatter, new RegExp(`^name: repo_${role}$`, 'mu'));
    assert.match(frontmatter, /^description: .+$/mu);

    const tools = /^tools: (.+)$/mu
      .exec(frontmatter)?.[1]
      ?.split(',')
      .map((item) => item.trim());
    assert.ok(tools?.length, `${path}: explicit tools required`);
    assert.equal(new Set(tools).size, tools.length, `${path}: duplicate tool`);
    assert.ok(!tools.includes('Agent'), `${path}: child re-delegation is not allowed`);
    assert.doesNotMatch(frontmatter, /^permissionMode: bypassPermissions$/mu);
    if (role === 'executor') {
      assert.ok(tools.includes('Edit') && tools.includes('Bash'));
    } else {
      assert.ok(
        tools.every((tool) => readOnly.has(tool)),
        `${path}: read-only role has write-capable tool`,
      );
    }
    assert.equal(isIgnored(path), false, `${path}: project role must be portable`);
    assert.match(source, /docs\/development\/agent-workflows\//u);
  }
});

test('Claude private runtime state stays ignored while both host adapters have entry points', () => {
  for (const path of [
    '.claude/settings.local.json',
    '.claude/projects/example/session.json',
    '.claude/agents/private-draft.md',
    '.omc/session.json',
    '.omx/state/example.json',
  ]) {
    assert.equal(isIgnored(path), true, `${path}: private runtime data must remain ignored`);
  }

  for (const path of [
    'docs/development/agent-workflows/adapters/README.md',
    'docs/development/agent-workflows/adapters/codex.md',
    'docs/development/agent-workflows/adapters/claude-code.md',
  ]) {
    assert.equal(existsSync(resolve(root, path)), true, `${path}: missing adapter entry`);
  }

  assert.match(read('docs/development/agent-workflows/orchestration.md'), /Codex.*adapter/u);
  assert.match(
    read('docs/development/agent-workflows/agentic-architecture-decisions.md'),
    /Codex.*cohort/u,
  );
});

test('Taste and Redesign remain Codex-only and are not Claude project skills', () => {
  for (const skill of ['design-taste-frontend', 'redesign-existing-projects']) {
    for (const file of ['SKILL.md', 'LICENSE', 'SOURCE.json']) {
      const path = `.claude/skills/${skill}/${file}`;
      assert.equal(existsSync(resolve(root, path)), false, `${path}: skill must not be ported`);
      assert.equal(isIgnored(path), true, `${path}: skill must not be allowlisted`);
    }
  }

  const claude = read('docs/development/agent-workflows/adapters/claude-code.md');
  const codex = read('docs/development/agent-workflows/adapters/codex.md');
  const design = read(
    'docs/development/agent-workflows/visual-design/design-task-orchestration.md',
  );
  const codexOnlySkills =
    /Taste \(`design-taste-frontend`\)와 Redesign \(`redesign-existing-projects`\)은 \*\*Codex-only\*\*/u;
  assert.match(claude, codexOnlySkills);
  assert.match(
    codex,
    /Taste \(`design-taste-frontend`\)와 Redesign \(`redesign-existing-projects`\)은 \*\*Codex-only\*\*/u,
  );
  assert.match(design, /`design-taste-frontend`.*`redesign-existing-projects`.*Codex 전용/su);
});

test('repository preparation and future live qualification are distinct completion claims', () => {
  const adapters = read('docs/development/agent-workflows/adapters/README.md');
  const claude = read('docs/development/agent-workflows/adapters/claude-code.md');
  for (const source of [adapters, claude]) {
    assert.match(source, /repository-prepared/u);
    assert.match(source, /runtime-qualified/u);
  }
  assert.match(claude, /separately authorized/u);
});

test('Claude entry documents actual host commands and keeps native/lifecycle evidence distinct', () => {
  const guide = read('docs/development/agent-workflows/adapters/claude-code.md');
  const entry = read('CLAUDE.md');
  const manifest = JSON.parse(read('package.json'));
  for (const [command, file] of [
    ['claude:preflight', 'session-preflight'],
    ['claude:workflow', 'workflow-entry'],
    ['claude:native', 'native-session'],
  ]) {
    assert.ok(manifest.scripts[command].includes(`scripts/agents/claude/${file}.mjs`));
    assert.ok(existsSync(resolve(root, `scripts/agents/claude/${file}.mjs`)));
    assert.ok(guide.includes(`pnpm ${command}`));
    assert.ok(entry.includes(`pnpm ${command}`));
  }
  for (const boundary of [
    'dispatchAuthorized:false',
    'runtimeQualified:false',
    '.plans/finished/',
    '.plans/cancelled/',
    'Native Plan Mode',
    'OMC 없이도',
    '일반 interactive auto 세션',
    'PreToolUse',
    'PostToolUse',
    'PermissionRequest',
    // Hook failure falls to a human prompt; the guide must not claim fail-closed.
    'fail-closed가 아니라',
    'fail-safe to human',
    'common result는 `partial`',
  ]) {
    assert.ok(guide.includes(boundary), boundary);
  }
  const onboarding = read('docs/development/agent-workflows/getting-started.md');
  for (const boundary of ['fail-safe to human', '승인하지\n않습니다', '새 세션']) {
    assert.ok(onboarding.includes(boundary), boundary);
  }
  for (const role of ['explorer', 'researcher', 'executor', 'reviewer']) {
    const source = read(`.claude/agents/repo_${role}.md`);
    assert.doesNotMatch(source, /^model:/mu, 'no unauthorized permanent model pin');
    assert.ok(source.includes('다른 agent'), 'child offload boundary remains explicit');
  }
});
