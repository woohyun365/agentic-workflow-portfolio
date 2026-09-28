import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
export function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'native-qualification-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, '.claude/agents'), { recursive: true });
  writeFileSync(
    join(root, '.claude/agents/repo_explorer.md'),
    '---\nname: repo_explorer\ntools: Read, Grep, Glob\n---\nRead only.\n',
  );
  writeFileSync(join(root, 'sample.txt'), 'oracle');
  const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' });
  git('init', '-q');
  git('add', '.');
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'initial');
  const head = git('rev-parse', 'HEAD').trim();
  const now = Date.now();
  const input = {
    root,
    request: 'sample.txt 내용을 분석해줘.',
    mode: 'fresh',
    currentSnapshot: {
      baseSHA: head,
      headSHA: head,
      dirtyDiffDigest: null,
      untrackedInputDigests: [],
    },
    directAssignment: {
      owner: 'explorer',
      dispatchId: 'native-1',
      acceptance: ['oracle returned'],
      writeOwnership: [],
    },
    reviewDisposition: {
      required: false,
      reason: 'bounded synthetic extraction independently checked by oracle',
    },
    nativeRequest: {
      profileId: 'bounded-extraction',
      selectedBy: 'lead',
      selectionBasisRef: 'test-case',
      issuedAt: new Date(now - 1000).toISOString(),
      expiresAt: new Date(now + 60000).toISOString(),
      task: {
        taskId: 'task-1',
        kind: 'extract',
        impactRisk: 'low',
        complexity: 'bounded',
        uncertainty: 'resolved',
        role: 'repo_explorer',
        allowedTools: ['Read', 'Grep', 'Glob'],
        readScope: ['sample.txt'],
        writeScope: [],
        writeOwner: null,
        childValue: 'independent-extraction',
        independent: true,
        knownGaps: [],
        facts: [
          'source-bound',
          'fixed-input',
          'single-step',
          'output-schema',
          'acceptance',
          'independent-check',
        ].map((key) => ({ key, sourceRef: 'test-case', confidence: 'high' })),
      },
    },
  };
  const options = {
    prompt: 'Read sample.txt only.',
    expectedResolvedModel: 'claude-haiku-4-5-20251001',
    cliVersion: '2.1.283',
  };
  return { root, input, options };
}
