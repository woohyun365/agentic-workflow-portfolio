#!/usr/bin/env node

import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  readdirSync,
  realpathSync,
} from 'node:fs';
import { basename, isAbsolute, resolve, relative, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { discoverPlans, readPlan } from '../common/plan-store.mjs';
import { parseContextContract, parsePriorityPointer } from './session-contract.mjs';

const repoRoot = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const args = parseArgs(process.argv.slice(2));
const now = new Date();
const readLimit = 64 * 1024;
const candidateLimit = 5;
const contextPattern = /^\.omx\/context\/([a-z0-9][a-z0-9-]*)-(\d{8}T\d{6}Z)\.md$/u;
const commitCache = new Map();

if (args.fresh && args.resume) fail('Choose either --fresh or --resume.');
if (args.plan && !args.resume) fail('--plan requires --resume.');

const mode = args.resume ? 'resume' : 'fresh';
const branch = resolveBranch();
const head = git(['rev-parse', 'HEAD']);
const statusLines = statusRecords(
  git(['status', '--porcelain=v1', '-z', '--untracked-files=all'], { trim: false }),
);
const workingTree = classifyChanges(statusLines);
const changeLimit = 100;

const omx = readOmxActiveModes();
const planDiscovery = discoverPlans(repoRoot);

const result = {
  schemaVersion: 1,
  readOnly: true,
  mode,
  repository: {
    root: repoRoot,
    branch,
    head,
    dirty: statusLines.length > 0,
    changes: statusLines.slice(0, changeLimit),
    omittedChangeCount: Math.max(0, statusLines.length - changeLimit),
    stagedPaths: workingTree.staged.slice(0, changeLimit),
    unstagedPaths: workingTree.unstaged.slice(0, changeLimit),
    untrackedPaths: workingTree.untracked.slice(0, changeLimit),
  },
  activePlans: planDiscovery.plans.map(({ path, status }) => ({ path, status })),
  planDiscovery: {
    complete: planDiscovery.complete,
    issues: planDiscovery.issues,
    identityComplete: planDiscovery.identityComplete,
    identityIssues: planDiscovery.identityIssues,
  },
  omx,
  canonicalVerification: [
    'pnpm test:repo-policy',
    'pnpm api:check',
    'pnpm web:check',
    'pnpm infra:check:static',
  ],
  sourcePriority: [
    'current-user-request',
    'branch-head-working-tree',
    'tracked-code-contract-test',
    'tracked-policy-architecture-runbook',
    'active-plan-checkpoint',
    'local-memory-history',
  ],
  resume: mode === 'resume' ? buildResumeSummary(args.plan) : null,
  next:
    mode === 'resume'
      ? 'Verify the selected checkpoint against code, tests, git history, and the latest user request.'
      : 'Inspect only files directly related to the current request; do not load local memory by default.',
};

if (args.json) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} else {
  printText(result);
}

function parseArgs(argv) {
  const parsed = { fresh: false, resume: false, json: false, plan: undefined };
  let separatorSeen = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    // Package runners can forward one separator after default --json flags.
    if (argument === '--' && !separatorSeen) separatorSeen = true;
    else if (argument === '--fresh') parsed.fresh = true;
    else if (argument === '--resume') parsed.resume = true;
    else if (argument === '--json') parsed.json = true;
    else if (argument === '--plan') {
      parsed.plan = argv[index + 1];
      index += 1;
      if (!parsed.plan) fail('--plan requires a repository-relative path.');
    } else {
      fail(`Unknown option: ${argument}`);
    }
  }

  return parsed;
}

function buildResumeSummary(planInput) {
  const selected = planInput ? resolveRepositoryPath(planInput) : null;
  const planBinding = selected?.binding ?? null;
  const metadata = planBinding
    ? {
        id: planBinding.id ?? null,
        idState: planBinding.id ? 'valid' : 'unknown',
        status: planBinding.status ?? 'unknown',
      }
    : selected?.exists
      ? readPlanMetadata(selected.path)
      : unknownMetadata();
  const taskId =
    metadata.idState === 'valid'
      ? metadata.id
      : selected?.exists && metadata.idState === 'absent'
        ? basename(selected.path, '.md').replace(/-plan$/u, '')
        : null;
  const info = {
    selected,
    metadata,
    planBinding,
    taskId: /^[a-z0-9][a-z0-9-]*$/u.test(taskId ?? '') ? taskId : null,
    taskIdSource: metadata.idState === 'valid' ? 'plan-id' : taskId ? 'filename-hint' : 'unknown',
  };
  if (!info.taskId) info.taskIdSource = 'unknown';
  const priority = readNotepadPriority();
  const limitations = [];
  if (planBinding && planBinding.state !== 'active')
    limitations.push('plan-not-active', ...planBinding.reasons);
  if (!selected) limitations.push('no-selected-plan');
  else if (!selected.exists) limitations.push('selected-plan-missing');
  if (metadata.status === 'unknown' || !info.taskId) limitations.push('plan-metadata-unknown');
  if (!priority.summary.available || !omx.available) limitations.push('omx-unavailable');

  const priorityPath = priority.value?.contextPath;
  const paths = new Set();
  if (priority.summary.valid && contextPattern.test(priorityPath ?? '')) paths.add(priorityPath);
  const directory = inspectPath('.omx/context', '.omx/context', 'directory');
  const candidates = [];
  if (directory.safe && directory.exists && info.taskId) {
    try {
      for (const entry of readdirSync(directory.absolute, { withFileTypes: true })) {
        const path = `.omx/context/${entry.name}`;
        const match = path.match(contextPattern);
        if (match?.[1] === info.taskId && filenameTime(path) !== null) candidates.push(path);
      }
    } catch {
      limitations.push('context-unavailable');
    }
  } else if (!directory.safe) limitations.push('unsafe-path');
  candidates.sort((a, b) => filenameTime(b) - filenameTime(a) || comparePaths(a, b));
  for (const path of candidates) {
    if (paths.size === candidateLimit) break;
    paths.add(path);
  }
  if (candidates.some((path) => !paths.has(path))) limitations.push('candidate-limit');
  const checked = [...paths].map((path) =>
    inspectContext(
      path,
      info,
      path === priorityPath ? priority.value : null,
      priority.summary.valid,
    ),
  );
  checked.sort(
    (a, b) => (b.time ?? -Infinity) - (a.time ?? -Infinity) || comparePaths(a.path, b.path),
  );
  const pointer = checked.find((item) => item.path === priorityPath);
  const priorityDiagnostic = pointer
    ? pointer.diagnostic
    : {
        taskMatch: 'unknown',
        freshness: 'unknown',
        reasons: [
          ...new Set([
            ...limitations,
            priority.summary.valid ? 'context-missing' : 'context-invalid',
          ]),
        ],
      };
  return {
    plan: selected ? { path: selected.path, exists: selected.exists } : null,
    planBinding,
    notepadPriority: priority.summary,
    contextSnapshots: checked.map((item) => item.path),
    diagnostics: {
      taskId: info.taskId,
      taskIdSource: info.taskIdSource,
      planStatus: metadata.status,
      priority: priorityDiagnostic,
      snapshots: checked.map((item) => ({ path: item.path, ...item.diagnostic })),
      recommendedContextPath:
        checked.find(
          (item) =>
            item.diagnostic.taskMatch === 'matched' && item.diagnostic.freshness === 'current',
        )?.path ?? null,
      limitations: [...new Set(limitations)],
    },
    warning:
      'Local pointers are hints only; current request and working-tree evidence have higher authority.',
  };
}

function comparePaths(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function inspectContext(path, info, pointer, pointerValid) {
  const reasons = [];
  let unknown = false;
  let needsReview = false;
  let expired = false;
  const gap = (code) => {
    unknown = true;
    reasons.push(code);
  };
  const drift = (code) => {
    needsReview = true;
    reasons.push(code);
  };
  if (!info.selected) gap('no-selected-plan');
  else if (!info.selected.exists) gap('selected-plan-missing');
  if (!info.taskId || info.metadata.status === 'unknown') gap('plan-metadata-unknown');
  if (info.planBinding && info.planBinding.state !== 'active') gap('plan-not-active');
  if (['completed', 'cancelled', 'superseded'].includes(info.metadata.status)) {
    expired = true;
    reasons.push('plan-terminal');
  }
  if (
    info.planBinding?.state === 'archived' ||
    info.selected?.path.startsWith('.omx/plans/finished/')
  )
    drift('archived-plan');
  if (statusLines.length) drift('dirty-tree');
  if (pointer && !pointerValid) gap('priority-invalid');

  const body = readBounded(path, '.omx/context');
  const parsed = body.ok ? parseContextContract(body.text, now) : null;
  if (!body.ok)
    gap(
      body.reason === 'missing'
        ? 'context-missing'
        : body.reason === 'unsafe-path'
          ? 'unsafe-path'
          : 'context-invalid',
    );
  else if (!parsed.valid) gap('context-invalid');
  const value = parsed?.value;
  let taskMatch = 'unknown';
  let time = null;
  if (value) {
    const owner = planOwner(value.activePlan);
    const activePlan = owner ? inspectPath(value.activePlan, owner) : { safe: false };
    const knownTask =
      typeof value.taskSlug === 'string' && /^[a-z0-9][a-z0-9-]*$/u.test(value.taskSlug);
    const knownPointerTask =
      typeof pointer?.task === 'string' && /^[a-z0-9][a-z0-9-]*$/u.test(pointer.task);
    const knownConflict =
      (activePlan.safe && info.selected && activePlan.path !== info.selected.path) ||
      (knownTask && info.metadata.idState === 'valid' && value.taskSlug !== info.taskId) ||
      (knownPointerTask &&
        ((knownTask && pointer.task !== value.taskSlug) ||
          (info.metadata.idState === 'valid' && pointer.task !== info.taskId)));
    if (knownConflict) {
      taskMatch = 'mismatched';
      gap('identity-conflict');
    } else if (
      parsed.valid &&
      knownTask &&
      (!pointer || knownPointerTask) &&
      activePlan.safe &&
      activePlan.exists &&
      info.selected?.exists &&
      info.taskId &&
      activePlan.path === info.selected.path
    )
      taskMatch = 'matched';
    else gap('identity-unknown');
    if (!activePlan.safe) gap('unsafe-path');

    const created = parseTimestamp(value.createdAt);
    const stamped = filenameTime(path);
    if (!Number.isFinite(created) || created > now.getTime() || stamped === null)
      gap('timestamp-invalid');
    else if (Math.floor(created / 1000) !== stamped / 1000) gap('timestamp-conflict');
    else time = created;
    if (value.expiresAt === 'on-phase-completion') gap('expiry-unknown');
    else {
      const expiry = parseTimestamp(value.expiresAt);
      if (!Number.isFinite(expiry)) gap('expiry-unknown');
      else if (expiry <= now.getTime()) {
        expired = true;
        reasons.push('expired');
      }
    }
    checkGitIdentity(value, gap, drift);
    if (!Array.isArray(value.relevantFiles) || !value.relevantFiles.length)
      gap('relevant-path-missing');
    else
      for (const input of value.relevantFiles) {
        const relevant = inspectPath(input);
        if (!relevant.safe) gap('unsafe-path');
        else if (!relevant.exists) gap('relevant-path-missing');
      }
  }
  if (pointer) checkGitIdentity(pointer, gap, drift);
  return {
    path,
    time,
    diagnostic: {
      taskMatch,
      freshness: expired
        ? 'expired'
        : unknown
          ? 'unknown'
          : needsReview
            ? 'needs-review'
            : 'current',
      reasons: [...new Set(reasons)],
    },
  };
}

function checkGitIdentity(value, gap, drift) {
  if (typeof value.branch !== 'string' || !value.branch.trim()) gap('branch-unknown');
  else if (value.branch !== branch) drift('branch-changed');
  if (typeof value.head !== 'string' || !/^[a-f0-9]{7,40}$/u.test(value.head)) {
    gap('head-unknown');
    return;
  }
  if (!commitCache.has(value.head)) {
    const resolved = spawnSync(
      'git',
      ['rev-parse', '--verify', '--end-of-options', `${value.head}^{commit}`],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        timeout: 5000,
        maxBuffer: readLimit,
      },
    );
    const sha = resolved.stdout?.trim();
    commitCache.set(
      value.head,
      resolved.status === 0 && /^[a-f0-9]{40}$/u.test(sha ?? '') ? sha : null,
    );
  }
  const recorded = commitCache.get(value.head);
  if (!recorded) gap('head-unknown');
  else if (recorded !== head) drift('head-changed');
}

function filenameTime(path) {
  const stamp = path.match(contextPattern)?.[2];
  if (!stamp) return null;
  const iso = `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(9, 11)}:${stamp.slice(11, 13)}:${stamp.slice(13, 15)}Z`;
  const time = Date.parse(iso);
  return Number.isFinite(time) && new Date(time).toISOString() === iso.replace('Z', '.000Z')
    ? time
    : null;
}

// Date.parse alone normalizes February 30 and accepts locale-dependent prose.
function parseTimestamp(value) {
  if (typeof value !== 'string') return NaN;
  const parts = value.match(
    /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/u,
  );
  if (!parts) return NaN;
  const calendar = `${parts[1]}T${parts[2]}.${(parts[3] ?? '').padEnd(3, '0').slice(0, 3)}Z`;
  const time = Date.parse(calendar);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== calendar) return NaN;
  if (parts[4] !== 'Z' && (Number(parts[4].slice(1, 3)) > 23 || Number(parts[4].slice(4, 6)) > 59))
    return NaN;
  return Date.parse(value);
}

// Porcelain -z preserves both columns and literal paths. R/C records carry a second
// source-path token; only the destination belongs in the current path collections.
function statusRecords(raw) {
  const tokens = raw.split('\0');
  const records = [];
  for (let index = 0; index < tokens.length; index++) {
    const record = tokens[index];
    if (!record) continue;
    records.push(record);
    if (/[RC]/u.test(record.slice(0, 2))) index++;
  }
  return records;
}

function classifyChanges(lines) {
  const result = { staged: [], unstaged: [], untracked: [] };
  for (const line of lines) {
    const status = line.slice(0, 2);
    const path = line.slice(3);
    if (status === '??') result.untracked.push(path);
    else {
      if (status[0] !== ' ') result.staged.push(path);
      if (status[1] !== ' ') result.unstaged.push(path);
    }
  }
  return result;
}

function unknownMetadata() {
  return { id: null, idState: 'unknown', status: 'unknown' };
}

function readPlanMetadata(path) {
  const source = readBounded(path, '.omx/plans');
  if (!source.ok) return unknownMetadata();
  const statuses = [];
  const ids = [];
  let fence = null;
  const aliases = new Map([
    ['complete', 'completed'],
    ['completed', 'completed'],
    ['done', 'completed'],
    ['완료', 'completed'],
    ['in-progress', 'in-progress'],
    ['진행중', 'in-progress'],
    ['진행 중', 'in-progress'],
    ['cancelled', 'cancelled'],
    ['canceled', 'cancelled'],
    ['취소', 'cancelled'],
    ['draft', 'draft'],
    ['초안', 'draft'],
    ['proposed', 'proposed'],
    ['제안', 'proposed'],
    ['implementation-ready', 'implementation-ready'],
    ['구현 준비 완료', 'implementation-ready'],
    ['blocked', 'blocked'],
    ['차단', 'blocked'],
  ]);
  for (const line of source.text.split('\n')) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/u)?.[1];
    if (fence) {
      if (marker?.[0] === fence[0] && marker.length >= fence.length && line.trim() === marker)
        fence = null;
      continue;
    }
    if (marker) {
      fence = marker;
      continue;
    }
    if (/^ {0,3}##(?:\s|$)/u.test(line)) break;
    const status = line.match(/^- (?:Status|상태):\s*(.*)$/u);
    if (status) {
      const text = status[1].split(';')[0].trim();
      const value = text.startsWith('`') && text.endsWith('`') ? text.slice(1, -1) : text;
      statuses.push(aliases.get(value) ?? 'unknown');
    }
    const id = line.match(/^- Plan ID:\s*(.*)$/u);
    if (id) {
      const text = id[1].trim();
      ids.push(text.startsWith('`') && text.endsWith('`') ? text.slice(1, -1) : text);
    }
  }
  const uniqueIds = [...new Set(ids)];
  const idValid = uniqueIds.length === 1 && /^[a-z0-9][a-z0-9-]*$/u.test(uniqueIds[0]);
  return {
    id: idValid ? uniqueIds[0] : null,
    idState: !ids.length ? 'absent' : idValid ? 'valid' : 'unknown',
    status: statuses.length && new Set(statuses).size === 1 ? statuses[0] : 'unknown',
  };
}

function readOmxJson(commandArgs) {
  const response = spawnSync('omx', commandArgs, {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 5000,
    maxBuffer: readLimit,
  });
  if (response.error || response.status !== 0) return null;
  try {
    const value = JSON.parse(response.stdout);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function readOmxActiveModes() {
  const value = readOmxJson(['state', 'list-active', '--json']);
  return value && Array.isArray(value.active_modes)
    ? { available: true, activeModes: value.active_modes }
    : { available: false, activeModes: [] };
}

function readNotepadPriority() {
  const response = readOmxJson([
    'notepad',
    'notepad_read',
    '--input',
    '{"section":"priority"}',
    '--json',
  ]);
  if (!response || typeof response.content !== 'string')
    return {
      summary: { available: false, exists: false, valid: false, contextPath: null },
      value: null,
    };
  const parsed = parsePriorityPointer(response.content);
  return {
    summary: {
      available: true,
      exists: parsed.exists,
      valid: parsed.valid,
      contextPath:
        typeof parsed.value?.contextPath === 'string' &&
        contextPattern.test(parsed.value.contextPath)
          ? parsed.value.contextPath
          : null,
      errors: parsed.valid ? [] : ['priority-invalid'],
    },
    // Invalid structure never grants a read slot. Retain only bounded known fields so
    // discovery of the same path cannot erase an already visible identity conflict.
    value:
      parsed.value &&
      typeof parsed.value.contextPath === 'string' &&
      contextPattern.test(parsed.value.contextPath)
        ? {
            contextPath: parsed.value.contextPath,
            task: parsed.value.task,
            branch: parsed.value.branch,
            head: parsed.value.head,
          }
        : null,
  };
}

function planOwner(input) {
  if (typeof input !== 'string') return null;
  if (input.startsWith('.plans/')) return '.plans';
  if (input.startsWith('.omx/plans/')) return '.omx/plans';
  return null;
}

function resolveRepositoryPath(input) {
  // Preserve the legacy CLI's explicit path normalization, not legacy discovery.
  const legacyPath = relative(repoRoot, resolve(repoRoot, input));
  const path =
    planOwner(input) !== '.plans' && legacyPath.startsWith('.omx/plans/') ? legacyPath : input;
  const owner = planOwner(path);
  if (!owner) fail('--plan must point safely inside .plans/ or explicitly inside .omx/plans/.');
  const binding = owner === '.plans' ? readPlan(repoRoot, path) : null;
  if (binding?.state === 'unsafe') fail('--plan must point safely inside .plans/.');
  const inspected = inspectPath(path, owner);
  if (!inspected.safe) fail('--plan must point safely inside .plans/ or .omx/plans/.');
  return { ...inspected, binding };
}

// Check every component before opening a body, including symlinked owner directories.
function inspectPath(input, owner = '', kind = 'file') {
  if (typeof input !== 'string' || !input || isAbsolute(input)) return { safe: false };
  const absolute = resolve(repoRoot, input);
  const path = relative(repoRoot, absolute);
  if (
    !path ||
    path === '..' ||
    path.startsWith(`..${sep}`) ||
    (owner && path !== owner && !path.startsWith(`${owner}/`))
  )
    return { safe: false };
  const parts = path.split(sep);
  let current = repoRoot;
  try {
    for (let index = 0; index < parts.length; index++) {
      current = resolve(current, parts[index]);
      const stat = lstatSync(current);
      if (
        stat.isSymbolicLink() ||
        (index < parts.length - 1
          ? !stat.isDirectory()
          : kind === 'directory'
            ? !stat.isDirectory()
            : !stat.isFile())
      )
        return { safe: false };
    }
    const actual = relative(realpathSync(repoRoot), realpathSync(absolute));
    if (actual !== path) return { safe: false };
    return { safe: true, exists: true, path, absolute };
  } catch (error) {
    return error.code === 'ENOENT'
      ? { safe: true, exists: false, path, absolute }
      : { safe: false };
  }
}

function readBounded(input, owner) {
  const path = inspectPath(input, owner);
  if (!path.safe) return { ok: false, reason: 'unsafe-path' };
  if (!path.exists) return { ok: false, reason: 'missing' };
  let fd;
  try {
    // O_NOFOLLOW protects the final component; recheck the containing path after opening.
    fd = openSync(path.absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    const rechecked = inspectPath(input, owner);
    if (!stat.isFile() || !rechecked.safe || !rechecked.exists)
      return { ok: false, reason: 'unsafe-path' };
    const current = lstatSync(path.absolute);
    if (current.ino !== stat.ino || current.dev !== stat.dev)
      return { ok: false, reason: 'unsafe-path' };
    if (stat.size > readLimit) return { ok: false, reason: 'over-limit' };
    const buffer = Buffer.alloc(readLimit + 1);
    let bytes = 0;
    while (bytes < buffer.length) {
      const count = readSync(fd, buffer, bytes, buffer.length - bytes, null);
      if (!count) break;
      bytes += count;
    }
    return bytes > readLimit
      ? { ok: false, reason: 'over-limit' }
      : { ok: true, text: buffer.subarray(0, bytes).toString('utf8') };
  } catch {
    return { ok: false, reason: 'invalid' };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function git(commandArgs, { trim = true } = {}) {
  const result = spawnSync('git', commandArgs, {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (result.status !== 0) fail(result.stderr.trim() || `git ${commandArgs.join(' ')} failed`);
  return trim ? result.stdout.trim() : result.stdout;
}

function resolveBranch() {
  const symbolicBranch = git(['branch', '--show-current']);
  if (symbolicBranch) return symbolicBranch;

  return process.env.GITHUB_HEAD_REF?.trim() || process.env.GITHUB_REF_NAME?.trim() || 'detached';
}

function printText(summary) {
  process.stdout.write(
    [
      `mode: ${summary.mode}`,
      `branch: ${summary.repository.branch}`,
      `HEAD: ${summary.repository.head}`,
      `working tree: ${summary.repository.dirty ? `${summary.repository.changes.length} visible change(s)` : 'clean'}`,
      summary.next,
    ].join('\n') + '\n',
  );
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
