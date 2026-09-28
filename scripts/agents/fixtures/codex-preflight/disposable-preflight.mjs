import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '../../../..');

// Copies actual source unchanged, uses real Git, and stubs ONLY optional OMX reads.
// No repository under test is staged, committed, or modified by this fixture.
export function disposablePreflight(t) {
  const root = realpathSync(mkdtempSync(resolve(tmpdir(), 'repo-codex-preflight-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
  Object.assign(env, {
    HOME: root,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
    NODE_OPTIONS: '',
  });
  const put = (path, body) => {
    const absolute = resolve(root, path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, body);
    return absolute;
  };
  const git = (args, input) => {
    const result = spawnSync('git', args, {
      cwd: root,
      env,
      input,
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, `fixture Git setup/read failed: ${result.stderr}`);
    return result.stdout;
  };
  cpSync(
    resolve(repoRoot, 'scripts/agents/common/plan-store.mjs'),
    put('scripts/agents/common/plan-store.mjs', ''),
  );
  for (const file of ['session-preflight.mjs', 'session-contract.mjs']) {
    const destination = put(`scripts/agents/codex/${file}`, '');
    cpSync(resolve(repoRoot, 'scripts/agents/codex', file), destination);
  }
  const omx = put(
    'bin/omx',
    `#!${process.execPath}
const args = process.argv.slice(2);
if (JSON.stringify(args) === JSON.stringify(['state', 'list-active', '--json'])) {
  process.stdout.write(JSON.stringify({active_modes: []}));
} else if (JSON.stringify(args) === JSON.stringify(['notepad', 'notepad_read', '--input', '{"section":"priority"}', '--json'])) {
  process.stdout.write(JSON.stringify({content: ''}));
} else {
  process.stderr.write('UNEXPECTED OMX COMMAND');
  process.exitCode = 92;
}
`,
  );
  chmodSync(omx, 0o755);
  put('.gitignore', '.omx/\n.plans/\n');
  put('tracked.txt', 'baseline\n');
  git(['init', '-b', 'fixture']);
  git(['add', '.']);
  git([
    '-c',
    'user.name=Disposable fixture',
    '-c',
    'user.email=fixture@example.invalid',
    '-c',
    'core.hooksPath=/dev/null',
    '-c',
    'commit.gpgSign=false',
    'commit',
    '-m',
    'disposable test baseline',
  ]);
  const run = (args) => {
    const result = spawnSync(
      process.execPath,
      [resolve(root, 'scripts/agents/codex/session-preflight.mjs'), ...args],
      {
        cwd: root,
        env: { ...env, PATH: `${resolve(root, 'bin')}:${env.PATH}` },
        encoding: 'utf8',
        timeout: 10000,
      },
    );
    assert.ifError(result.error);
    assert.doesNotMatch(result.stderr, /UNEXPECTED OMX COMMAND|EACCES|EPERM|ERR_MODULE_NOT_FOUND/u);
    return result;
  };
  const summary = (args = ['--fresh', '--json']) => {
    const result = run(args);
    assert.equal(result.status, 0, `preflight startup failed: ${result.stderr}`);
    return JSON.parse(result.stdout);
  };
  return { put, git, run, summary };
}
