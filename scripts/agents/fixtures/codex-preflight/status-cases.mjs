import { unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { disposablePreflight } from './disposable-preflight.mjs';

// Independent oracle: literal porcelain-v1 -z bytes and real index/worktree setup,
// not a copy of the production text parser. Only disposable fixture Git is mutated.
export const statusCases = [
  { id: 'clean', action: 'clean', raw: '' },
  { id: 'first-unstaged', action: 'unstaged', raw: ' M tracked.txt\0', unstaged: ['tracked.txt'] },
  {
    id: 'staged-only',
    action: 'staged',
    raw: 'M  tracked.txt\0',
    staged: ['tracked.txt'],
  },
  {
    id: 'mixed',
    action: 'mixed',
    raw: 'MM tracked.txt\0',
    staged: ['tracked.txt'],
    unstaged: ['tracked.txt'],
  },
  {
    id: 'untracked',
    action: 'untracked',
    raw: '?? new.txt\0',
    untracked: ['new.txt'],
  },
  { id: 'unstaged-delete', action: 'delete', raw: ' D tracked.txt\0', unstaged: ['tracked.txt'] },
  {
    id: 'staged-delete',
    action: 'staged-delete',
    raw: 'D  tracked.txt\0',
    staged: ['tracked.txt'],
  },
  { id: 'rename', action: 'rename', raw: 'R  renamed.txt\0tracked.txt\0', staged: ['renamed.txt'] },
  {
    id: 'rename-and-edit',
    action: 'rename-edit',
    raw: 'RM renamed.txt\0tracked.txt\0',
    staged: ['renamed.txt'],
    unstaged: ['renamed.txt'],
  },
  ...['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'].map((status) => ({
    id: `unmerged-${status}`,
    action: 'unmerged',
    status,
    raw: `${status} tracked.txt\0`,
    staged: ['tracked.txt'],
    unstaged: ['tracked.txt'],
  })),
  ...[
    'space name.txt',
    '한글.txt',
    'quote"name.txt',
    'line\nname.txt',
    'literal -> name.txt',
    ' leading.txt',
    'trailing.txt ',
    'tab\tname.txt',
    'back\\slash.txt',
  ].map((path, index) => ({
    id: `literal-path-${index}`,
    action: 'path',
    path,
    raw: `M  ${path}\0`,
    staged: [path],
  })),
];

export function expectedPaths(row) {
  return {
    stagedPaths: row.staged ?? [],
    unstagedPaths: row.unstaged ?? [],
    untrackedPaths: row.untracked ?? [],
  };
}

export function createStatusCase(t, row) {
  const f = disposablePreflight(t);
  if (row.action === 'path') {
    f.put(row.path, 'before\n');
    f.git(['add', '--', row.path]);
    f.git([
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      '-c',
      'core.hooksPath=/dev/null',
      '-c',
      'commit.gpgSign=false',
      'commit',
      '-m',
      'filename baseline',
    ]);
    f.put(row.path, 'after\n');
    f.git(['add', '--', row.path]);
  } else if (['unstaged', 'staged', 'mixed'].includes(row.action)) {
    f.put('tracked.txt', 'index or worktree change\n');
    if (row.action !== 'unstaged') f.git(['add', '--', 'tracked.txt']);
    if (row.action === 'mixed') f.put('tracked.txt', 'different working tree change\n');
  } else if (row.action === 'untracked') f.put('new.txt', 'new\n');
  else if (row.action === 'delete')
    unlinkSync(join(f.git(['rev-parse', '--show-toplevel']).trim(), 'tracked.txt'));
  else if (row.action === 'staged-delete') f.git(['rm', '--', 'tracked.txt']);
  else if (['rename', 'rename-edit'].includes(row.action)) {
    f.git(['mv', '--', 'tracked.txt', 'renamed.txt']);
    if (row.action === 'rename-edit') f.put('renamed.txt', 'changed after move\n');
  } else if (row.action === 'unmerged') {
    const blob = f.git(['rev-parse', 'HEAD:tracked.txt']).trim();
    f.git(['update-index', '--force-remove', '--', 'tracked.txt']);
    const stages = { DD: [1], AU: [2], UD: [1, 2], UA: [3], DU: [1, 3], AA: [2, 3], UU: [1, 2, 3] }[
      row.status
    ];
    f.git(
      ['update-index', '--index-info'],
      stages.map((stage) => `100644 ${blob} ${stage}\ttracked.txt\n`).join(''),
    );
  } else if (row.action !== 'clean') throw new Error('unknown status case');
  return f;
}
